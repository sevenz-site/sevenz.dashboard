import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getImportUsageForOwner } from "@/lib/import-usage";
import type { ExtractedMovement } from "@/lib/types";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export const runtime = "nodejs";
export const maxDuration = 90;

// Gemini's free tier is rate- and token-limited, and this key is SHARED
// across every owner on the platform — two different owners importing a
// libreta at the same moment must not exceed it together. Each actual call
// claims a slot from a rate limiter stored in Postgres (see
// claim_rate_limit_slot in supabase/schema.sql), which is the one shared
// clock every request — from any owner, any server instance — waits on. A
// per-call timeout and a couple of retries on 429 cover the rest.
//
// One request = one photo now (the client calls this once per photo, not
// once per batch) — that's what makes per-photo progress possible, and it
// also means each request only has to budget time for a single Gemini call
// instead of a whole batch.
const RATE_LIMIT_KEY = "gemini_extract";

// Retryable failures carry their status so the message the owner finally sees
// can tell "we are over the free-tier quota" apart from "Google is having a
// moment" — those call for different reactions, and one of them is not the
// owner's fault in any way they can act on.
class TransientGeminiError extends Error {
  constructor(readonly status: number) {
    super(`Gemini respondió ${status}`);
    this.name = "TransientGeminiError";
  }
}
const REQUEST_TIMEOUT_MS = 55_000;
const SPACING_BETWEEN_CALLS_MS = 4_000;
const MAX_RETRIES_ON_RATE_LIMIT = 2;
const RETRY_BACKOFF_MS = [5_000, 10_000];

const EXTRACTION_PROMPT = `Eres un asistente que digitaliza la libreta de fiado de una tienda de barrio.
Mira la foto de la página de la libreta y extrae cada movimiento que veas como una lista JSON.

Para cada movimiento identifica:
- client_name: el nombre del cliente tal como está escrito (corrige mayúsculas obvias, no inventes apellidos)
- date: la fecha si está escrita, en formato ISO "YYYY-MM-DD"; si no hay fecha legible, usa null
- type: "charge" si el cliente se llevó algo fiado (aumenta lo que debe), "payment" si el cliente abonó/pagó (disminuye lo que debe)
- amount: el monto del movimiento en pesos, solo el número (sin puntos, comas ni símbolo $)
- description: qué se llevó o detalle breve, si está escrito; si no, null
- read_balance: si en esa misma línea hay un saldo/total escrito a mano, el número de ese saldo; si no hay saldo legible en esa línea, null
- confidence: "low" si la letra es ambigua, el monto no se lee con certeza, o estás adivinando; "high" si lo leíste con claridad

Devuelve ÚNICAMENTE un objeto JSON válido con esta forma, sin texto adicional ni bloques de código:
{"movements": [{"client_name": "...", "date": null, "type": "charge", "amount": 0, "description": null, "read_balance": null, "confidence": "high"}]}

Si la foto no tiene movimientos legibles, devuelve {"movements": []}.`;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Blocks until Postgres says it's this request's turn. Shared across every
// owner and every server instance — this is what actually prevents two
// simultaneous imports (from different owners) from together exceeding the
// one shared Gemini quota.
async function waitForGlobalSlot(supabase: SupabaseServerClient, spacingMs: number) {
  const { data: waitUntil, error } = await supabase.rpc("claim_rate_limit_slot", {
    p_key: RATE_LIMIT_KEY,
    p_spacing_ms: spacingMs,
  });
  if (error) {
    // If the limiter itself is unreachable, fail open with a flat local
    // pause rather than blocking imports entirely.
    await sleep(spacingMs);
    return;
  }
  const waitMs = new Date(waitUntil as string).getTime() - Date.now();
  if (waitMs > 0) await sleep(waitMs);
}

// Turns the model's raw JSON text into validated, typed movements. Shared by
// every provider below since they all end up with the same "{"movements":
// [...]}"-shaped text response.
function parseExtractionResponse(raw: string): ExtractedMovement[] {
  const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();

  let parsed: { movements?: unknown };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("No pudimos interpretar la respuesta del modelo.");
  }

  if (!Array.isArray(parsed.movements)) return [];

  return parsed.movements
    .filter((m): m is Record<string, unknown> => typeof m === "object" && m !== null)
    .map((m): ExtractedMovement => ({
      client_name: String(m.client_name ?? "").trim(),
      date: typeof m.date === "string" ? m.date : null,
      type: m.type === "payment" ? "payment" : "charge",
      amount: Number(m.amount) || 0,
      description: typeof m.description === "string" ? m.description : null,
      read_balance: typeof m.read_balance === "number" ? m.read_balance : null,
      confidence: m.confidence === "low" ? "low" : "high",
      document_id: null,
      // Both filled in by the owner during review, never read from the photo.
      // The review screen seeds this to USD for a VE owner and leaves it null
      // for a CO owner, rather than guessing a currency from a handwritten
      // page where the symbol is usually absent or ambiguous.
      currency: null,
    }))
    .filter((m) => m.client_name && m.amount > 0);
}

// ACTIVE: calls Gemini directly (Google AI Studio), no middleman. Cheapest
// path for early validation — Google's free tier covers this comfortably as
// long as we stay under its rate limits (hence the global slot claim below).
async function extractFromImageViaGemini(
  supabase: SupabaseServerClient,
  dataUrl: string,
): Promise<ExtractedMovement[]> {
  // trim() because a trailing newline survives a paste into Vercel's env
  // editor and would previously have been interpolated straight into the URL.
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY no está configurada.");

  // A clipped paste is the failure this catches, and it cost a day: Google
  // answers a truncated key with 401 "Expected OAuth 2 access token, login
  // cookie or other valid authentication credential" — describing a mechanism
  // this code does not use and never mentioning the API key at all. Checked as
  // "implausibly short" rather than against an exact length, so a future change
  // to Google's key format does not turn this into a false alarm.
  if (apiKey.length < 30) {
    throw new Error(
      `GEMINI_API_KEY parece incompleta (${apiKey.length} caracteres). Suele ser un pegado truncado en las variables de entorno.`,
    );
  }

  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) throw new Error("Formato de imagen inválido.");
  const [, mimeType, base64Data] = match;

  await waitForGlobalSlot(supabase, SPACING_BETWEEN_CALLS_MS);

  const model = "gemini-3-flash-preview";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(
      // Key in a header, not `?key=${apiKey}`. A query string is logged by
      // Vercel, by Google and by anything in between, so the old form wrote a
      // live credential into three sets of logs on every import.
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: EXTRACTION_PROMPT },
                { inline_data: { mime_type: mimeType, data: base64Data } },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
          },
        }),
      },
    );
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Gemini tardó más de ${REQUEST_TIMEOUT_MS / 1000}s en responder.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  // 5xx alongside 429. gemini-3-flash-preview is a preview model and returns
  // 503 "high demand" with a perfectly valid key; before this it fell through
  // as a permanent failure, so a transient overload was indistinguishable from
  // a broken configuration — including to whoever had just fixed the key and
  // was checking whether the fix worked.
  if (response.status === 429 || response.status >= 500) {
    throw new TransientGeminiError(response.status);
  }

  if (!response.ok) {
    const text = await response.text();

    // Google's own wording for a rejected credential is actively misleading
    // (see the length check above), and it reached the owner verbatim through
    // import_notifications. The detail belongs in the server log, where it can
    // be searched; the owner gets a short code that says "not your fault, not
    // your photo".
    if (response.status === 401 || response.status === 403) {
      console.error(`[extract] Gemini rechazó la credencial (${response.status}):`, text);
      throw new Error(
        `Error de configuración del servicio de lectura (${response.status}). Revisa GEMINI_API_KEY.`,
      );
    }

    console.error(`[extract] Gemini respondió ${response.status}:`, text);
    throw new Error(`Gemini respondió ${response.status}: ${text.slice(0, 300)}`);
  }

  const payload = await response.json();
  const raw: string = payload?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return parseExtractionResponse(raw);
}

async function extractFromImageViaGeminiWithRetry(
  supabase: SupabaseServerClient,
  dataUrl: string,
): Promise<ExtractedMovement[]> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await extractFromImageViaGemini(supabase, dataUrl);
    } catch (error) {
      const transient = error instanceof TransientGeminiError ? error : null;
      // A timeout is deliberately NOT retried. maxDuration is 90s and the
      // per-call timeout is 55s, so a second attempt would be killed mid-flight
      // and the owner would wait a minute and a half to be told nothing.
      if (!transient || attempt >= MAX_RETRIES_ON_RATE_LIMIT) {
        if (!transient) throw error;
        throw new Error(
          transient.status === 429
            ? "Gemini está saturado (límite de la capa gratuita). Intenta de nuevo en un minuto."
            : "El servicio de lectura está sobrecargado ahora mismo. Intenta de nuevo en unos minutos.",
        );
      }
      await sleep(RETRY_BACKOFF_MS[attempt] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1]);
    }
  }
}

// PARKED (not called right now, kept for when OpenRouter comes back into the
// rotation): same model, routed through OpenRouter's OpenAI-compatible API
// instead of calling Google directly.
type OpenRouterMessage = {
  role: "user";
  content: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
};

async function extractFromImageViaOpenRouter(dataUrl: string): Promise<ExtractedMovement[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY no está configurada.");

  const messages: OpenRouterMessage[] = [
    {
      role: "user",
      content: [
        { type: "text", text: EXTRACTION_PROMPT },
        { type: "image_url", image_url: { url: dataUrl } },
      ],
    },
  ];

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://sevenz.app",
      "X-Title": "Sevenz",
    },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages,
      response_format: { type: "json_object" },
      temperature: 0,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter respondió ${response.status}: ${text.slice(0, 300)}`);
  }

  const payload = await response.json();
  const raw: string = payload?.choices?.[0]?.message?.content ?? "";
  return parseExtractionResponse(raw);
}

// Swap this one line to switch providers — both implementations stay ready.
const extractFromImage = extractFromImageViaGeminiWithRetry;
void extractFromImageViaOpenRouter; // keep it referenced so lint doesn't flag it as unused

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const usage = await getImportUsageForOwner(supabase, user.id);
  if (usage.plan === "free" && usage.remaining !== null && usage.remaining <= 0) {
    return NextResponse.json(
      { error: `Alcanzaste el límite de ${usage.limit} fotos este mes en el plan Free.` },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => null);
  const dataUrl: unknown = body?.image;
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    return NextResponse.json({ error: "Envía una imagen válida." }, { status: 400 });
  }

  try {
    const movements = await extractFromImage(supabase, dataUrl);
    return NextResponse.json({ movements });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error extrayendo la libreta.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
