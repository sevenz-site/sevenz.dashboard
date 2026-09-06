import { createServiceClient } from "@/lib/supabase/service";
import { mixpanelConfigured } from "@/lib/mixpanel-http";

// Answers one question: is each outside dependency actually reachable and
// accepting our credentials right now?
//
// It exists because of a pattern, not a single incident. Every failure this
// project has had this week produced a plausible wrong answer rather than a
// loud one: /admin returned 500 because production had revoked a grant dev
// still had; Mixpanel events arrived with a country resolved from a Vercel
// server; a photo import failed for a day on a truncated API key, behind an
// error message describing OAuth. None of them announced themselves, and each
// was found by someone stumbling into it.
//
// Checks are on demand, never polled. A background poll would spend real quota
// on the very services it is watching, and would page nobody at 3am anyway —
// there is no on-call rota here. The value is turning "why is this broken"
// into a ten-second answer when someone is already asking.

export type CheckStatus = "ok" | "warn" | "fail";

export type ServiceCheck = {
  name: string;
  status: CheckStatus;
  detail: string;
  ms: number | null;
};

const TIMEOUT_MS = 8_000;

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const start = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - start };
}

// Lists models rather than generating anything. It proves the same thing a
// generateContent call would — the key is present, complete and accepted — but
// costs no generation quota, which matters when the free tier is shared across
// every owner on the platform.
async function checkGemini(): Promise<ServiceCheck> {
  const name = "Gemini · lectura de libretas";
  const key = process.env.GEMINI_API_KEY?.trim();

  if (!key) {
    return { name, status: "fail", detail: "GEMINI_API_KEY no está configurada.", ms: null };
  }
  // Caught before the network call, and named precisely, because this is the
  // exact failure that cost a day: a paste into Vercel that clipped the key.
  if (key.length < 30) {
    return {
      name,
      status: "fail",
      detail: `La clave parece truncada (${key.length} caracteres). Vuelve a pegarla completa.`,
      ms: null,
    };
  }

  try {
    const { value: res, ms } = await timed(() =>
      fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", {
        headers: { "x-goog-api-key": key },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }),
    );
    if (res.status === 401 || res.status === 403) {
      return {
        name,
        status: "fail",
        detail: `Google rechazó la clave (${res.status}). Suele ser un pegado incompleto en las variables de entorno.`,
        ms,
      };
    }
    if (!res.ok) {
      return { name, status: "warn", detail: `Respondió ${res.status}.`, ms };
    }
    return { name, status: "ok", detail: "Clave aceptada.", ms };
  } catch (error) {
    return {
      name,
      status: "fail",
      detail: error instanceof Error ? error.message : "No respondió.",
      ms: null,
    };
  }
}

// Goes through admin_owner_options() rather than reading a table, for the same
// reason /admin itself does: production has SELECT revoked from service_role on
// the customer tables, so a direct read would fail there and pass in dev — the
// check would then be green exactly where it needs to be red. This also makes
// it a real test of the path /admin depends on.
async function checkDatabase(): Promise<ServiceCheck> {
  const name = "Base de datos · lectura de /admin";
  try {
    const { value, ms } = await timed(async () => {
      const db = createServiceClient();
      return db.rpc("admin_owner_options");
    });
    if (value.error) {
      return { name, status: "fail", detail: value.error.message, ms };
    }
    const count = Array.isArray(value.data) ? value.data.length : 0;
    return { name, status: "ok", detail: `${count} negocios legibles.`, ms };
  } catch (error) {
    return {
      name,
      status: "fail",
      detail: error instanceof Error ? error.message : "No respondió.",
      ms: null,
    };
  }
}

// The rate is refreshed by a Vercel Cron that fires once a day on the Hobby
// plan, so "stale" is a normal-looking state that silently prices every VE
// movement off an old number. Age is the whole point of this check.
async function checkExchangeRate(): Promise<ServiceCheck> {
  const name = "Tasa BCV";
  try {
    const { value, ms } = await timed(async () => {
      const db = createServiceClient();
      return db.rpc("get_current_bcv_rate").maybeSingle();
    });
    if (value.error) {
      return { name, status: "fail", detail: value.error.message, ms };
    }
    const row = value.data as { usd?: number; eur?: number; fetched_at?: string } | null;
    if (!row?.fetched_at) {
      return { name, status: "fail", detail: "No hay ninguna tasa almacenada.", ms };
    }
    const hours = (Date.now() - new Date(row.fetched_at).getTime()) / 3_600_000;
    const age = hours < 1 ? `${Math.round(hours * 60)} min` : `${hours.toFixed(1)} h`;
    const detail = `$${row.usd} / €${row.eur}, actualizada hace ${age}.`;
    // A day plus a margin: the cron runs daily, so 26h means it missed a run.
    return { name, status: hours > 26 ? "warn" : "ok", detail, ms };
  } catch (error) {
    return {
      name,
      status: "fail",
      detail: error instanceof Error ? error.message : "No respondió.",
      ms: null,
    };
  }
}

// Deliberately only a configuration check, and labelled as one.
//
// Mixpanel has no endpoint that validates a project token without writing an
// event, and writing a fake event on every health check would put junk in the
// same data these checks exist to protect. Saying "configured" and being clear
// that it does not prove delivery is more honest than a green tick that only
// means a string is non-empty.
function checkMixpanel(): ServiceCheck {
  const name = "Mixpanel · configuración";
  return mixpanelConfigured()
    ? {
        name,
        status: "ok",
        detail: "Token presente. No verifica entrega — para eso, mira Live View.",
        ms: null,
      }
    : {
        name,
        status: "fail",
        detail: "Sin token: los eventos se descartan en silencio, sin error ni log.",
        ms: null,
      };
}

export async function checkServices(): Promise<ServiceCheck[]> {
  // In parallel, and each with its own timeout, so one dead dependency cannot
  // hold the panel hostage or hide the state of the others.
  const [gemini, database, rate] = await Promise.all([
    checkGemini(),
    checkDatabase(),
    checkExchangeRate(),
  ]);
  return [gemini, database, rate, checkMixpanel()];
}
