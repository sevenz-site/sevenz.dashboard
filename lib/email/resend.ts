import "server-only";

// THE ONE WAY THE SERVER SENDS AN EMAIL (C1 of PL-22, reviewed 2026-11-05 with
// `new-api-risk-review`, approved by the owner the same day).
//
// Resend was already Sevenz's provider: production's Auth emails leave through its SMTP
// from `no-reply@mail.sevenz.site`, configured in the Supabase panel. What is new here is
// a second key, in Vercel, and sends from code: the second-factor code when WhatsApp is
// not an option, and the notice that an account's email changed.
//
// A `fetch`, not the SDK, for the reason `lib/whatsapp/kapso.ts` gives: one POST with a
// header does not justify a dependency, and a function of our own keeps every send
// passing through here.
//
// NEVER THROWS. An email is a fallback; the screen says «no pudimos enviar el correo» and
// the shopkeeper tries again. The caller decides what to do with `ok:false`.
//
// `Idempotency-Key` is per code: a retried request cannot deliver the same code twice.
// Keys expire at Resend after 24 h, so a key reused the next day sends again — fine, a
// code lives 10 minutes.

export type EmailResult = { ok: true; id: string | null } | { ok: false; error: string };

function apiKey(): string | null {
  return process.env.RESEND_API_KEY ?? null;
}

function from(): string {
  // "Sevenz DEV" on the dev branch so a test mail is recognisable in a real inbox.
  return process.env.RESEND_FROM ?? "Sevenz <no-reply@mail.sevenz.site>";
}

export async function sendEmail(opciones: {
  to: string;
  subject: string;
  text: string;
  idempotencyKey: string;
  tag: string;
}): Promise<EmailResult> {
  const key = apiKey();
  if (!key) return { ok: false, error: "RESEND_API_KEY no está configurada." };
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "Idempotency-Key": opciones.idempotencyKey.slice(0, 256),
      },
      body: JSON.stringify({
        from: from(),
        to: [opciones.to],
        subject: opciones.subject,
        text: opciones.text,
        tags: [{ name: "kind", value: opciones.tag.replace(/[^a-z0-9_-]/gi, "_") }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await r.text();
    if (!r.ok) {
      console.error(`[correo] Resend HTTP ${r.status}: ${body.slice(0, 300)}`);
      return { ok: false, error: `HTTP ${r.status}` };
    }
    try {
      const json = JSON.parse(body) as { id?: string };
      return { ok: true, id: json.id ?? null };
    } catch {
      return { ok: true, id: null };
    }
  } catch (e) {
    console.error("[correo] Resend:", e instanceof Error ? e.message : e);
    return { ok: false, error: "network" };
  }
}
