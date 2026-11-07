// B OF PL-22: credit balances born from a return that are worth a look.
//
// Part 1 needs no database: the pure rule in lib/returns/credit-watch.ts, with the
// edges the owner agreed on 2026-11-05 ($20 and 24 hours; COP has its own floor).
// Part 2 reads DEV (vzqppwrwnmlbrxizskdh) through the function of migration 191 with
// the service role, read-only, and says plainly when the migration is missing: a
// card that cannot read is a card that lies, and a suite that skips that is worse.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  assessCreditWatch,
  creditWatchForLog,
  CREDIT_WATCH_MIN_CREDIT,
  CREDIT_WATCH_MIN_CREDIT_COP,
  CREDIT_WATCH_MAX_HOURS,
  CREDIT_WATCH_WINDOW_DAYS,
} from "../lib/returns/credit-watch.ts";

const filas = [];
const check = (nombre, pasa, detalle = "") => {
  filas.push(pasa);
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${pasa || !detalle ? "" : `  — ${detalle}`}`);
};

const AHORA = new Date("2026-11-05T18:00:00Z");
const hace = (ms) => new Date(AHORA.getTime() - ms).toISOString();
const MIN = 60_000;
const H = 60 * MIN;
const fila = (extra = {}) => ({
  business_name: "Abasto La Esquina",
  owner_country: "VE",
  currency: "USD",
  to_credit: 5000,
  sale_created_at: hace(3 * MIN + 10 * MIN),
  returned_at: hace(10 * MIN),
  ...extra,
});

// 1. Nothing to look at.
{
  const w = assessCreditWatch([], AHORA);
  check("1. sin filas: ok, cero, y la frase lo dice", w.status === "ok" && w.count === 0 && /ninguna/i.test(w.detail), JSON.stringify(w));
}

// 2. The textbook case: $5.000 returned as credit three minutes after the sale.
{
  const w = assessCreditWatch([fila()], AHORA);
  const frase = w.items[0] ?? "";
  check("2a. una fila: warn, nunca fail", w.status === "warn" && w.count === 1, JSON.stringify(w));
  check("2b. la frase nombra el negocio, el monto y los minutos", /La Esquina/.test(frase) && /5\.000/.test(frase) && /3 minutos/.test(frase), frase);
  check("2c. la frase dice que casi siempre es una corrección", /Casi siempre/.test(w.explain), w.explain);
}

// 3. Thresholds, both sides of the line, in the pure rule too (SQL filters first, this is belt and braces).
{
  const bajo = assessCreditWatch([fila({ to_credit: CREDIT_WATCH_MIN_CREDIT - 0.01 })], AHORA);
  const justo = assessCreditWatch([fila({ to_credit: CREDIT_WATCH_MIN_CREDIT })], AHORA);
  check("3a. $19,99 queda fuera", bajo.count === 0, JSON.stringify(bajo));
  check("3b. $20,00 entra", justo.count === 1, JSON.stringify(justo));
  const cop = assessCreditWatch([fila({ currency: null, owner_country: "CO", to_credit: CREDIT_WATCH_MIN_CREDIT_COP })], AHORA);
  const copBajo = assessCreditWatch([fila({ currency: null, owner_country: "CO", to_credit: CREDIT_WATCH_MIN_CREDIT_COP - 1 })], AHORA);
  check("3c. un libro colombiano usa su propio piso: 80.000 entra", cop.count === 1, JSON.stringify(cop));
  check("3d. 79.999 pesos quedan fuera", copBajo.count === 0, JSON.stringify(copBajo));
  check("3e. la frase colombiana no lleva $ ni €", cop.items[0] != null && !/[$€]/.test(cop.items[0]), cop.items[0]);
}

// 4. The sale's age: a return of a sale from the day before yesterday is a normal return.
{
  const vieja = assessCreditWatch([fila({ sale_created_at: hace(10 * MIN + (CREDIT_WATCH_MAX_HOURS + 1) * H) })], AHORA);
  const limite = assessCreditWatch([fila({ sale_created_at: hace(10 * MIN + CREDIT_WATCH_MAX_HOURS * H) })], AHORA);
  check("4a. venta de hace 25 h: fuera", vieja.count === 0, JSON.stringify(vieja));
  check("4b. venta de hace 24 h justas: dentro, y la frase habla de horas", limite.count === 1 && /24 horas/.test(limite.items[0] ?? ""), JSON.stringify(limite));
}

// 5. The window: returns older than 7 days do not count even if the SQL sent them.
{
  const w = assessCreditWatch([fila({ returned_at: hace((CREDIT_WATCH_WINDOW_DAYS * 24 + 1) * H), sale_created_at: hace((CREDIT_WATCH_WINDOW_DAYS * 24 + 1) * H + 5 * MIN) })], AHORA);
  check("5. devolución de hace 8 días: fuera", w.count === 0, JSON.stringify(w));
}

// 6. Many: newest first, five sentences at most, the count says all of them.
{
  const rows = Array.from({ length: 7 }, (_, i) => fila({ returned_at: hace((i + 1) * H), sale_created_at: hace((i + 1) * H + 2 * MIN), business_name: `Negocio ${i}` }));
  const w = assessCreditWatch(rows.reverse(), AHORA);
  check("6a. siete filas: cuenta 7, cinco frases", w.count === 7 && w.items.length === 5, JSON.stringify([w.count, w.items.length]));
  check("6b. la primera frase es la más reciente", /Negocio 0/.test(w.items[0] ?? ""), w.items[0]);
}

// 7. What the daily GitHub check may print: counts only. The workflow's logs are public.
{
  const w = assessCreditWatch([fila()], AHORA);
  const log = JSON.stringify(creditWatchForLog(w));
  check("7. el resumen para el log no lleva el nombre del negocio", !/La Esquina/.test(log) && /"count":1/.test(log), log);
}

// 8. Bad input never throws: a NaN amount or a null date is skipped, not a crash in /admin.
{
  let w;
  try {
    w = assessCreditWatch([fila({ to_credit: "abc" }), fila({ returned_at: null }), fila({ sale_created_at: undefined })], AHORA);
    check("8. filas rotas se saltan sin reventar", w.count === 0, JSON.stringify(w));
  } catch (e) {
    check("8. filas rotas se saltan sin reventar", false, String(e));
  }
}

// ── Part 2: DEV, read-only, through migration 191 ─────────────────────────────
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);
if (!env.NEXT_PUBLIC_SUPABASE_URL?.includes("vzqppwrwnmlbrxizskdh")) {
  check("9. .env.local apunta a la rama dev", false, "esta suite solo lee dev");
} else {
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data, error } = await admin.rpc("admin_credit_watch", {
    p_days: CREDIT_WATCH_WINDOW_DAYS,
    p_min_credit: CREDIT_WATCH_MIN_CREDIT,
    p_min_credit_cop: CREDIT_WATCH_MIN_CREDIT_COP,
    p_max_hours: CREDIT_WATCH_MAX_HOURS,
  });
  if (error) {
    check("9. la función admin_credit_watch existe en dev", false, `${error.code ?? ""} ${error.message} — ¿falta correr la 191 en DEV?`);
  } else {
    const w = assessCreditWatch(data ?? []);
    check("9. la función admin_credit_watch responde en dev", true);
    console.log(`     dev hoy: ${w.count} en ${CREDIT_WATCH_WINDOW_DAYS} días · ${w.detail}`);
    const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { error: e2 } = await anon.rpc("admin_credit_watch", { p_days: 7, p_min_credit: 20, p_min_credit_cop: 80000, p_max_hours: 24 });
    check("10. anon NO puede llamarla — solo service_role", e2 != null && /permission denied|42501/.test(`${e2.code} ${e2.message}`), e2 ? `${e2.code} ${e2.message}` : "respondió sin error");
  }
}

const ok = filas.filter(Boolean).length;
console.log(`\n${ok}/${filas.length} pasan.`);
process.exit(ok === filas.length ? 0 : 1);
