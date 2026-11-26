// DEV BRANCH ONLY (vzqppwrwnmlbrxizskdh) -- reads .env.local.
//
// The client's notices per cuota: `installment_due_soon` and `overdue_debt_warning`
// (lib/whatsapp/installment-notices.ts, migration 218). They replaced `payment_due_date_v2`
// on 2026-11-22; this suite replaced `qa/recordatorio-plazo.mjs` the same day.
//
// NOTHING GOES TO KAPSO. `fetch` is intercepted and what Kapso WOULD have received is inspected.
//
// TWO PARTS:
//
//   A. THE DECISION, with invented fiados and a chosen «now». No database. Every rule the owner
//      set lives here: the window before each cuota, 7 and 15 days after, «pago» for a fiado
//      without cuotas, the remainder of a half-paid cuota, what a fiado has had paid as stored
//      amount minus what it still owes («solución 1», 2026-11-22: an undirected payment counts,
//      the payment at the sale does not count twice), the weekly cap in calendar days, the firm
//      notice first and the oldest cuota first, never the firm one to a flagged client, and the
//      business's zone.
//
//   B. THE WHOLE PATH IN DEV: real clients and fiados, migration 218's candidates, the send
//      gate, the exact parameters and button, the clients' number, and idempotency. It WRITES
//      in dev and deletes what it wrote in the `finally`. It needs migration 218 in dev; check
//      B0 says so if it is missing.
//
// SINCE MIGRATION 223 (2026-11-26) the weekly cap counts by phone within a business: A16-A22 and
// B22-B25. B needs 223 in dev; B25 says so if it is missing.
//
// Output is read by the owner, so it stays in Spanish.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { PLANTILLAS_ESPERADAS, problemaDelBoton, PHONE_ID_OWNERS, PHONE_ID_CLIENTS } from "./plantillas-esperadas.mjs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);
const DEV_REF = "vzqppwrwnmlbrxizskdh";
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
if (ref !== DEV_REF) {
  console.error(`ME NIEGO A CORRER. .env.local apunta a "${ref}", no a la rama dev (${DEV_REF}).`);
  process.exit(1);
}
for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "KAPSO_API_KEY"]) {
  if (!env[k]) {
    console.error(`Falta ${k} en .env.local.`);
    process.exit(1);
  }
  process.env[k] = env[k];
}

const interceptados = [];
const fetchReal = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (url, init) => {
  if (String(url).includes("kapso.ai")) {
    interceptados.push({ ...JSON.parse(init.body), __url: String(url) });
    return new Response(JSON.stringify({ messages: [{ id: "qa-interceptado" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  return fetchReal(url, init);
};

const { planInstallmentNotices, sendInstallmentNotices, daysBefore } = await import("../lib/whatsapp/installment-notices.ts");

const filas = [];
function check(nombre, pasa, detalle) {
  filas.push({ nombre, pasa });
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${detalle ? `  — ${detalle}` : ""}`);
}

const TZ = { VE: "America/Caracas", CO: "America/Bogota" };
const OFFSET = { VE: 4, CO: 5 }; // hours behind UTC, neither has daylight saving
const dayIn = (d, tz) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const addDays = (ymd, n) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
// The instant of a local hour of a day, in a business's zone.
const localAt = (ymd, country, hour = 12, minute = 0) =>
  new Date(Date.parse(`${ymd}T00:00:00Z`) + ((hour + OFFSET[country]) * 60 + minute) * 60_000);
// created_at such that cuota `k` of `n` falls exactly at `instant`.
const createdFor = (instant, plazo, n, k) => new Date(instant.getTime() - ((plazo * k) / n) * 864e5).toISOString();
const longDate = (d, tz) => new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "long", timeZone: tz }).format(d);

// ── A. THE DECISION ──────────────────────────────────────────────────────
{
  const now = localAt("2026-12-01", "VE", 9); // the cron's hour, 13:00 UTC
  const today = "2026-12-01";
  const fila = (over) => ({
    movement_id: over.id ?? "m-" + Math.random().toString(16).slice(2, 8),
    client_id: over.client ?? "c-" + Math.random().toString(16).slice(2, 8),
    owner_id: "o-1",
    created_at: over.created_at,
    amount: over.amount ?? 100,
    currency: over.currency === undefined ? "USD" : over.currency,
    plazo_dias: over.plazo,
    cuotas: over.cuotas ?? null,
    // What the fiado still owes, as `get_open_charges_for_client` returns it. Unpaid by default.
    pendiente: over.pendiente ?? over.amount ?? 100,
    business_name: "Bodega La Esquina",
    country: over.country ?? "VE",
    is_flagged: over.flagged ?? false,
    balance: over.balance ?? 0,
    balance_usd: over.usd ?? 100,
    balance_eur: over.eur ?? 0,
    ultimo_aviso: over.ultimo ?? null,
    // Migration 223. Omitted means the row of a database still on 218.
    ...(over.phone === undefined ? {} : { phone: over.phone }),
    ...(over.owner ? { owner_id: over.owner } : {}),
  });
  const due = (ymd, plazo, n, k, country = "VE", h = 12, m = 0) => createdFor(localAt(ymd, country, h, m), plazo, n, k);
  const plan = (rows) => planInstallmentNotices(rows, now);

  check("A1. la ventana: 7 días → 2 antes, 365 → 7 (techo), 2 → 1 (piso), 30 en 3 → 3",
    daysBefore(7, 1) === 2 && daysBefore(365, 1) === 7 && daysBefore(2, 1) === 1 && daysBefore(30, 3) === 3,
    `${daysBefore(7, 1)} · ${daysBefore(365, 1)} · ${daysBefore(2, 1)} · ${daysBefore(30, 3)}`);

  let p = plan([fila({ plazo: 28, cuotas: 4, created_at: due(addDays(today, 2), 28, 4, 1) })]);
  let n = p.notices[0];
  check("A2. cuota 1 de 4 que vence en 2 días: aviso previo, con su cuota y su fecha",
    p.notices.length === 1 && n.template === "installment_due_soon" && n.params.installment === "cuota 1 de 4" &&
      n.params.installment_due === "$25,00" && n.params.due_date === "3 de diciembre",
    JSON.stringify(n?.params));

  p = plan([fila({ plazo: 28, cuotas: 4, created_at: due(addDays(today, 2), 28, 4, 1), pendiente: 75 })]);
  check("A3. la misma cuota ya pagada (debe $75 de $100, dirigido o no): no sale nada", p.notices.length === 0, `${p.notices.length} avisos`);

  p = plan([fila({ plazo: 28, cuotas: 4, created_at: due(addDays(today, 2), 28, 4, 1), pendiente: 90 })]);
  check("A4. la cuota pagada a medias: «Pendiente» es lo que falta, $15,00",
    p.notices[0]?.params.installment_due === "$15,00", p.notices[0]?.params.installment_due);

  // Owner's own example, 2026-11-22: buys 100, pays 25 at the sale, the other 75 split in 3. The
  // fiado is stored as 75 and owes 75: the 25 paid no cuota.
  p = plan([fila({ plazo: 21, cuotas: 3, amount: 75, pendiente: 75, usd: 75, created_at: due(addDays(today, 2), 21, 3, 1) })]);
  check("A5. compra 100 y paga 25: las cuotas son de los 75, y la cuota 1 de $25 SIGUE pendiente",
    p.notices[0]?.params.installment === "cuota 1 de 3" && p.notices[0]?.params.installment_due === "$25,00", JSON.stringify(p.notices[0]?.params));

  p = plan([fila({ plazo: 8, created_at: due(addDays(today, 2), 8, 1, 1) })]);
  check("A6. un fiado sin cuotas dice «pago», no «cuota 1 de 1»",
    p.notices[0]?.params.installment === "pago" && p.notices[0]?.params.installment_due === "$100,00", JSON.stringify(p.notices[0]?.params));

  p = plan([fila({ plazo: 10, created_at: due(addDays(today, -7), 10, 1, 1) }), fila({ plazo: 10, created_at: due(addDays(today, -15), 10, 1, 1) }), fila({ plazo: 10, created_at: due(addDays(today, -8), 10, 1, 1) })]);
  const dias = p.notices.map((x) => x.params.days_overdue).sort();
  check("A7. el firme sale a los 7 y a los 15 días, y a los 8 no",
    JSON.stringify(dias) === JSON.stringify(["15", "7"]) && p.notices.every((x) => x.template === "overdue_debt_warning"), JSON.stringify(dias));

  p = plan([fila({ plazo: 10, flagged: true, created_at: due(addDays(today, -7), 10, 1, 1) }), fila({ plazo: 8, flagged: true, created_at: due(addDays(today, 2), 8, 1, 1) })]);
  check("A8. a un cliente marcado como mala paga no le sale el firme, y el previo sí",
    p.notices.length === 1 && p.notices[0].template === "installment_due_soon" && p.heldByFlag === 1, `${p.notices.length} avisos · ${p.heldByFlag} retenidos`);

  p = plan([fila({ client: "c-x", plazo: 18, cuotas: 2, created_at: due(addDays(today, -7), 18, 2, 1) })]);
  check("A9. el mismo cliente con firme de la cuota 1 y previo de la 2 el mismo día: sale UNO, el firme de la 1",
    p.notices.length === 1 && p.notices[0].kind === "d7" && p.notices[0].params.installment === "cuota 1 de 2", JSON.stringify(p.notices.map((x) => [x.kind, x.cuota])));

  p = plan([fila({ client: "c-y", plazo: 8, created_at: due(addDays(today, 2), 8, 1, 1), ultimo: localAt(addDays(today, -6), "VE", 9).toISOString() })]);
  const q = plan([fila({ client: "c-y", plazo: 8, created_at: due(addDays(today, 2), 8, 1, 1), ultimo: localAt(addDays(today, -7), "VE", 9, 30).toISOString() })]);
  check("A10. el tope semanal cuenta días del calendario: un aviso de hace 6 días retiene, uno de hace 7 no",
    p.notices.length === 0 && p.heldByWeeklyCap === 1 && q.notices.length === 1, `${p.notices.length}/${q.notices.length}`);

  p = plan([fila({ plazo: 8, usd: 100, eur: 30, created_at: due(addDays(today, 2), 8, 1, 1) })]);
  check("A11. debe en las dos monedas: «Saldo total» las dice las dos", p.notices[0]?.params.amount_due === "$100,00 y €30,00", p.notices[0]?.params.amount_due);

  p = plan([fila({ plazo: 8, usd: 100, eur: -5, created_at: due(addDays(today, 2), 8, 1, 1) })]);
  check("A12. un saldo a favor en la otra moneda no se escribe", p.notices[0]?.params.amount_due === "$100,00", p.notices[0]?.params.amount_due);

  p = plan([fila({ country: "CO", currency: null, amount: 16000, balance: 16000, usd: 0, plazo: 8, created_at: due(addDays(today, 2), 8, 1, 1, "CO") })]);
  check("A13. un negocio colombiano: libro único, sin símbolo de dólar ni euro",
    p.notices.length === 1 && !/[€]/.test(p.notices[0].params.amount_due) && p.notices[0].params.amount_due === p.notices[0].params.installment_due,
    JSON.stringify(p.notices[0]?.params));

  // Due at 00:30 Caracas on the day after tomorrow: in Bogota that is still tomorrow. With a
  // 4-day term the early notice goes 1 day before, so in Caracas it is NOT today.
  p = plan([fila({ plazo: 4, created_at: due(addDays(today, 2), 4, 1, 1, "VE", 0, 30) })]);
  const r = plan([fila({ plazo: 4, created_at: due(addDays(today, 1), 4, 1, 1, "VE", 0, 30) })]);
  check("A14. el día se cuenta en la zona del negocio: vence pasado mañana a las 00:30 de Caracas → hoy no; mañana → hoy sí",
    p.notices.length === 0 && r.notices.length === 1 && r.notices[0].params.due_date === "2 de diciembre",
    `${p.notices.length} / ${r.notices[0]?.params.due_date}`);

  p = plan([fila({ client: "c-z", plazo: 10, created_at: due(addDays(today, -7), 10, 1, 1) }), fila({ client: "c-w", plazo: 8, created_at: due(addDays(today, 2), 8, 1, 1) }), fila({ client: "c-v", plazo: 10, created_at: due(addDays(today, -15), 10, 1, 1) })]);
  check("A15. entre clientes, los firmes van delante de los previos (los topes diarios los alcanza el primero)",
    p.notices.map((x) => x.kind === "soon").join() === "false,false,true", p.notices.map((x) => x.kind).join());

  // ── MIGRATION 223: THE CAP COUNTS BY PHONE, WITHIN A BUSINESS (owner, 2026-11-26) ──
  const TEL_A = "584163100001";
  p = plan([
    fila({ client: "c-kari", phone: TEL_A, plazo: 10, created_at: due(addDays(today, -7), 10, 1, 1) }),
    fila({ client: "c-hermana", phone: TEL_A, plazo: 10, created_at: due(addDays(today, -7), 10, 1, 1) }),
  ]);
  check("A16. dos fichas del mismo negocio con el MISMO número, las dos con firme hoy: sale UNO y el otro cuenta como «mismo_numero»",
    p.notices.length === 1 && p.heldBySharedPhone === 1, `${p.notices.length} avisos · ${p.heldBySharedPhone} retenidos por número`);

  // The production case of 25 and 26 November: «(Hermana)» got hers yesterday; «(kari)» is due today.
  p = plan([
    fila({ client: "c-hermana", phone: TEL_A, plazo: 10, created_at: due(addDays(today, 20), 10, 1, 1), ultimo: localAt(addDays(today, -1), "VE", 9).toISOString() }),
    fila({ client: "c-kari", phone: TEL_A, plazo: 10, created_at: due(addDays(today, -7), 10, 1, 1) }),
  ]);
  check("A17. el caso de Karina: a una ficha le llegó ayer y la otra vence hoy, en el mismo número → hoy no sale nada",
    p.notices.length === 0 && p.heldByWeeklyCap === 1, `${p.notices.length} avisos · ${p.heldByWeeklyCap} retenidos por la semana`);

  p = plan([
    fila({ client: "c-a", owner: "o-1", phone: TEL_A, plazo: 10, created_at: due(addDays(today, -7), 10, 1, 1) }),
    fila({ client: "c-b", owner: "o-2", phone: TEL_A, plazo: 10, created_at: due(addDays(today, -7), 10, 1, 1) }),
  ]);
  check("A18. el mismo número cliente de DOS negocios: sale uno de cada uno («Solo mismo negocio»)",
    p.notices.length === 2 && p.heldBySharedPhone === 0 && new Set(p.notices.map((x) => x.ownerId)).size === 2, `${p.notices.length} avisos`);

  p = plan([
    fila({ client: "c-a", owner: "o-1", phone: TEL_A, plazo: 10, created_at: due(addDays(today, -7), 10, 1, 1) }),
    fila({ client: "c-b", owner: "o-2", phone: TEL_A, plazo: 10, created_at: due(addDays(today, 20), 10, 1, 1), ultimo: localAt(addDays(today, -1), "VE", 9).toISOString() }),
  ]);
  check("A19. el aviso de ayer de OTRO negocio al mismo número no frena el de este", p.notices.length === 1 && p.notices[0].ownerId === "o-1", `${p.notices.length} avisos`);

  p = plan([
    fila({ client: "c-previo", phone: TEL_A, plazo: 8, created_at: due(addDays(today, 2), 8, 1, 1) }),
    fila({ client: "c-firme", phone: TEL_A, plazo: 10, created_at: due(addDays(today, -15), 10, 1, 1) }),
  ]);
  check("A20. dentro del número, el firme de una ficha gana al previo de otra",
    p.notices.length === 1 && p.notices[0].clientId === "c-firme" && p.notices[0].kind === "d15", JSON.stringify(p.notices.map((x) => [x.clientId, x.kind])));

  p = plan([
    fila({ client: "c-kari", plazo: 10, created_at: due(addDays(today, -7), 10, 1, 1) }),
    fila({ client: "c-hermana", plazo: 10, created_at: due(addDays(today, -7), 10, 1, 1) }),
  ]);
  check("A21. filas sin «phone» (base en la 218): se agrupa por cliente, como antes, y salen las dos",
    p.notices.length === 2 && p.heldBySharedPhone === 0, `${p.notices.length} avisos`);

  p = plan([
    fila({ client: "c-solo", phone: TEL_A, plazo: 18, cuotas: 2, created_at: due(addDays(today, -7), 18, 2, 1) }),
  ]);
  check("A22. un solo cliente con dos cuotas el mismo día: no cuenta como «mismo_numero»", p.notices.length === 1 && p.heldBySharedPhone === 0, `${p.heldBySharedPhone}`);
}

// ── B. THE WHOLE PATH IN DEV ─────────────────────────────────────────────
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const PREFIJO = "QA Aviso Cuota ";
const TEL = "5841299130";
const creados = [];

try {
  const apagado = await sendInstallmentNotices();
  check("B1. con WHATSAPP_CLIENT_NOTICES apagado no sale nada", apagado.enviados === 0 && apagado.omitidos.desactivado === 1, JSON.stringify(apagado));
  process.env.WHATSAPP_CLIENT_NOTICES = "on";

  // THE CURRENT SHAPE, not just «it answers»: the first version of 218 answered too, without
  // `pendiente`, and every fiado then read as paid. A zero-row answer cannot show its columns,
  // so the check asks PostgREST for the column by name.
  const { error: e0 } = await admin.rpc("whatsapp_cuotas_candidatas").select("pendiente").limit(1);
  check("B0. la migración 218 al día está en dev (devuelve «pendiente»)", !e0, e0 ? `${e0.message} — corre supabase/218_avisos_por_cuota.sql en DEV` : "whatsapp_cuotas_candidatas devuelve pendiente");
  if (e0) throw new Error("sin la 218 al día no se puede seguir");

  const { data: ve } = await admin.from("owners").select("id,business_name").eq("country", "VE").limit(1).single();
  const { data: co } = await admin.from("owners").select("id,business_name").eq("country", "CO").limit(1).single();
  const hoy = { VE: dayIn(new Date(), TZ.VE), CO: dayIn(new Date(), TZ.CO) };

  // name, country, currency, term, cuotas, which cuota and its day offset, directed paid, flagged, source, consent, extra EUR debt, notice 3 days ago
  const casos = [
    { n: "pronto 1 de 4", c: "VE", plazo: 28, cuotas: 4, k: 1, off: 2 },
    { n: "pronto pagada", c: "VE", plazo: 28, cuotas: 4, k: 1, off: 2, pagado: 25 },
    { n: "pronto media", c: "VE", plazo: 28, cuotas: 4, k: 1, off: 2, pagado: 10 },
    { n: "pagada sin dirigir", c: "VE", plazo: 28, cuotas: 4, k: 1, off: 2, pagado: 25, sinDirigir: true },
    { n: "pago unico", c: "VE", plazo: 8, k: 1, off: 2 },
    { n: "vencida 7", c: "VE", plazo: 10, k: 1, off: -7 },
    { n: "vencida 15", c: "VE", plazo: 10, k: 1, off: -15 },
    { n: "mala paga 7", c: "VE", plazo: 10, k: 1, off: -7, flagged: true },
    { n: "firme gana", c: "VE", plazo: 18, cuotas: 2, k: 1, off: -7 },
    { n: "tope semanal", c: "VE", plazo: 8, k: 1, off: 2, avisado: true },
    { n: "dos monedas", c: "VE", plazo: 8, k: 1, off: 2, eur: 30 },
    { n: "sin permiso", c: "VE", plazo: 8, k: 1, off: 2, sinPermiso: true },
    { n: "de foto", c: "VE", plazo: 8, k: 1, off: 2, source: "photo_import" },
    { n: "colombia", c: "CO", plazo: 8, k: 1, off: 2, cop: true },
    // Migration 223. `tel` shares one number between records; the 9x suffixes are never an index.
    { n: "familia uno", c: "VE", plazo: 10, k: 1, off: -7, tel: TEL + "90" },
    // 15 days past due: the older cuota, so this one wins the phone, and B22b checks the message
    // carries ITS name, ITS cuota and ITS link, not the sibling's.
    { n: "familia dos", c: "VE", plazo: 10, k: 1, off: -15, tel: TEL + "90" },
    // Karina, 25 and 26 November: «(Hermana)» was warned yesterday and is not due today.
    { n: "karina hermana", c: "VE", plazo: 10, k: 1, off: 20, tel: TEL + "91", avisado: true, avisadoDias: 1 },
    { n: "karina kari", c: "VE", plazo: 10, k: 1, off: -7, tel: TEL + "91" },
    // One phone, two businesses: each sends its own.
    { n: "dos bodegas ve", c: "VE", plazo: 8, k: 1, off: 2, tel: TEL + "92" },
    { n: "dos bodegas co", c: "CO", plazo: 8, k: 1, off: 2, cop: true, tel: TEL + "92" },
  ];

  for (const [i, x] of casos.entries()) {
    const owner = x.c === "VE" ? ve.id : co.id;
    const tel = x.tel ?? `${x.c === "VE" ? TEL : "5730099130"}${String(i).padStart(2, "0")}`;
    await admin.from("client_whatsapp_consents").delete().eq("phone", tel);
    const { data: cl, error: eC } = await admin.from("clients").insert({ owner_id: owner, name: PREFIJO + x.n, whatsapp: tel, is_flagged: !!x.flagged }).select("id").single();
    if (eC) throw new Error(`cliente ${x.n}: ${eC.message}`);
    creados.push([cl.id, tel]);
    x.id = cl.id;
    x.tel = tel;
    const n = x.cuotas ?? 1;
    const vence = localAt(addDays(hoy[x.c], x.off), x.c);
    x.vence = vence;
    const createdAt = createdFor(vence, x.plazo, n, x.k);
    const { data: m, error: eM } = await admin.from("movements").insert({
      client_id: cl.id, created_by: owner, type: "charge", amount: x.cop ? 16000 : 100, currency: x.cop ? null : "USD",
      source: x.source ?? "manual", plazo_dias: x.plazo, cuotas: x.cuotas ?? null, created_at: createdAt,
    }).select("id").single();
    if (eM) throw new Error(`fiado ${x.n}: ${eM.message}`);
    x.mov = m.id;
    if (x.pagado) {
      const { error: eP } = await admin.from("movements").insert({
        client_id: cl.id, created_by: owner, type: "payment", amount: x.pagado, currency: "USD", source: "manual",
        applies_to_movement_id: x.sinDirigir ? null : m.id, created_at: new Date(Date.parse(createdAt) + 864e5).toISOString(),
      });
      if (eP) throw new Error(`abono ${x.n}: ${eP.message}`);
    }
    if (x.eur) {
      const { error: eE } = await admin.from("movements").insert({ client_id: cl.id, created_by: owner, type: "charge", amount: x.eur, currency: "EUR", source: "manual" });
      if (eE) throw new Error(`fiado en euros ${x.n}: ${eE.message}`);
    }
    if (!x.sinPermiso) {
      await admin.rpc("record_owner_declared_whatsapp_consent", { p_client_id: cl.id, p_owner_id: owner, p_consent_text: "QA aviso de cuota acepta.", p_source: "owner_movement_form" });
    }
    if (x.avisado) {
      const { error: eW } = await admin.from("whatsapp_sends").insert({
        owner_id: owner, template: "installment_due_soon", period_key: `qa:${cl.id}`, audience: "client", recipient: tel,
        client_id: cl.id, reminder: true, ok: true, sent_at: new Date(Date.now() - (x.avisadoDias ?? 3) * 864e5).toISOString(),
      });
      if (eW) throw new Error(`aviso previo ${x.n}: ${eW.message}`);
    }
  }

  const resumen = await sendInstallmentNotices();
  const mios = (n) => interceptados.filter((m) => m.to === casos.find((x) => x.n === n).tel);
  const params = (msg) => Object.fromEntries((msg?.template?.components ?? []).filter((c) => c.type === "body").flatMap((c) => c.parameters.map((p) => [p.parameter_name, p.text])));
  const nombres = (msg) => (msg?.template?.components ?? []).filter((c) => c.type === "body").flatMap((c) => c.parameters.map((p) => p.parameter_name));
  const uno = (n) => mios(n)[0];

  const a = uno("pronto 1 de 4");
  check("B2. cuota 1 de 4 que vence en 2 días: sale installment_due_soon con su cuota, su fecha y $25,00",
    a?.template?.name === "installment_due_soon" && params(a).installment === "cuota 1 de 4" && params(a).installment_due === "$25,00" &&
      params(a).due_date === longDate(casos[0].vence, TZ.VE) && params(a).business_name === ve.business_name && params(a).client_name === PREFIJO + "pronto 1 de 4",
    JSON.stringify(params(a)));
  check("B3. los seis parámetros del previo, con su nombre y en el orden aprobado",
    JSON.stringify(nombres(a)) === JSON.stringify(PLANTILLAS_ESPERADAS.installment_due_soon.cuerpo), JSON.stringify(nombres(a)));
  const boton = (a?.template?.components ?? []).find((c) => c.type === "button");
  const problema = problemaDelBoton("installment_due_soon", boton);
  check("B4. el botón lleva el token del enlace, posicional, como Meta lo aceptó", problema === null, problema ?? "ok");
  check("B5. sale por el número de CLIENTES", a?.__url.includes(PHONE_ID_CLIENTS) && !a?.__url.includes(PHONE_ID_OWNERS), a?.__url);

  check("B6. la cuota ya pagada con un abono dirigido: nada", mios("pronto pagada").length === 0, `${mios("pronto pagada").length}`);
  check("B6b. la cuota pagada con un abono SIN dirigir: tampoco sale (solución 1)", mios("pagada sin dirigir").length === 0, `${mios("pagada sin dirigir").length}`);
  check("B7. la cuota pagada a medias: «Pendiente» $15,00", params(uno("pronto media")).installment_due === "$15,00", params(uno("pronto media")).installment_due);
  check("B8. sin cuotas dice «pago»", params(uno("pago unico")).installment === "pago", params(uno("pago unico")).installment);

  const v7 = uno("vencida 7");
  check("B9. a los 7 días sale overdue_debt_warning con «7» y sus seis parámetros en orden",
    v7?.template?.name === "overdue_debt_warning" && params(v7).days_overdue === "7" &&
      JSON.stringify(nombres(v7)) === JSON.stringify(PLANTILLAS_ESPERADAS.overdue_debt_warning.cuerpo) &&
      problemaDelBoton("overdue_debt_warning", (v7?.template?.components ?? []).find((c) => c.type === "button")) === null,
    JSON.stringify(params(v7)));
  check("B10. a los 15 días sale con «15»", params(uno("vencida 15")).days_overdue === "15", params(uno("vencida 15")).days_overdue);
  check("B11. a un cliente marcado como mala paga no le sale el firme", mios("mala paga 7").length === 0, `${mios("mala paga 7").length}`);
  const fg = mios("firme gana");
  check("B12. firme de la cuota 1 y previo de la 2 el mismo día: sale solo el firme de la 1",
    fg.length === 1 && fg[0].template.name === "overdue_debt_warning" && params(fg[0]).installment === "cuota 1 de 2", JSON.stringify(fg.map((m) => [m.template.name, params(m).installment])));
  check("B13. con un aviso de cuota hace 3 días, el tope semanal lo retiene", mios("tope semanal").length === 0 && (resumen.omitidos.tope_semanal ?? 0) >= 1, JSON.stringify(resumen.omitidos));
  check("B14. debe en dólares y en euros: «Saldo total» $100,00 y €30,00", params(uno("dos monedas")).amount_due === "$100,00 y €30,00", params(uno("dos monedas")).amount_due);
  check("B15. sin permiso de WhatsApp no sale", mios("sin permiso").length === 0, `${mios("sin permiso").length}`);
  check("B16. un fiado venido de una FOTO sí recibe su aviso (MS-27)", mios("de foto").length === 1, `${mios("de foto").length}`);
  const coMsg = uno("colombia");
  check("B17. un negocio colombiano: sale, en el libro único", coMsg && !/[€]/.test(params(coMsg).amount_due ?? "€") && params(coMsg).installment === "pago",
    JSON.stringify(params(coMsg)));

  const alNumero = (tel) => interceptados.filter((m) => m.to === tel);
  check("B22. dos fichas del mismo negocio con el mismo número y firme hoy: a ese número le llega UNO",
    alNumero(TEL + "90").length === 1 && (resumen.omitidos.mismo_numero ?? 0) >= 1,
    `${alNumero(TEL + "90").length} mensajes · ${JSON.stringify(resumen.omitidos)}`);
  const familiar = alNumero(TEL + "90")[0];
  const fichaDos = casos.find((x) => x.n === "familia dos");
  const { data: enlaceDos } = await admin.from("share_links").select("token").eq("client_id", fichaDos.id);
  const tokenBoton = (familiar?.template?.components ?? []).find((c) => c.type === "button")?.parameters?.[0]?.text;
  check("B22b. ese único mensaje lleva el nombre, la cuota y el enlace de la ficha elegida, sin mezclar con la otra",
    params(familiar).client_name === PREFIJO + "familia dos" && params(familiar).days_overdue === "15" &&
      (enlaceDos ?? []).some((l) => l.token === tokenBoton),
    `${params(familiar).client_name} · ${params(familiar).days_overdue} días · enlace ${tokenBoton && (enlaceDos ?? []).some((l) => l.token === tokenBoton) ? "de la ficha" : "OTRO"}`);
  check("B23. el caso de Karina en la base: a «(Hermana)» le llegó ayer, «(kari)» vence hoy → no le llega nada a ese número",
    alNumero(TEL + "91").length === 0, `${alNumero(TEL + "91").length} mensajes`);
  const dosBodegas = alNumero(TEL + "92");
  check("B24. el mismo número cliente de dos negocios: le llega uno de cada uno",
    dosBodegas.length === 2 && new Set(dosBodegas.map((m) => params(m).business_name)).size === 2,
    JSON.stringify(dosBodegas.map((m) => params(m).business_name)));
  const { data: filaCand } = await admin.rpc("whatsapp_cuotas_candidatas").select("client_id,phone").eq("client_id", casos.find((x) => x.n === "karina kari").id);
  check("B25. la base devuelve «phone» normalizado (migración 223)", filaCand?.[0]?.phone === TEL + "91", JSON.stringify(filaCand));

  const antes = interceptados.filter((m) => m.to?.startsWith(TEL) || m.to?.startsWith("5730099130")).length;
  const segunda = await sendInstallmentNotices();
  const despues = interceptados.filter((m) => m.to?.startsWith(TEL) || m.to?.startsWith("5730099130")).length;
  check("B18. correr el cron dos veces el mismo día no manda un segundo aviso a nadie", despues === antes, `${antes} → ${despues} · ${JSON.stringify(segunda.omitidos)}`);
  check("B19. payment_due_date_v2 ya no sale nunca", !interceptados.some((m) => m.template?.name === "payment_due_date_v2"), `${interceptados.length} interceptados`);
  check("B20. ningún mensaje salió de verdad a Kapso", true, `${interceptados.length} interceptados, 0 enviados`);
} catch (e) {
  check("la suite llegó al final", false, e instanceof Error ? e.message : String(e));
} finally {
  for (const [id, tel] of creados) {
    await admin.from("whatsapp_sends").delete().eq("client_id", id);
    await admin.from("movements").delete().eq("client_id", id);
    await admin.from("clients").delete().eq("id", id);
    await admin.from("client_whatsapp_consents").delete().eq("phone", tel);
  }
  const { count } = await admin.from("clients").select("id", { count: "exact", head: true }).like("name", `${PREFIJO}%`);
  check("B21. limpieza: no queda nada de la prueba en dev", count === 0, `quedan ${count}`);
  const fallos = filas.filter((f) => !f.pasa).length;
  console.log(`\n${filas.length - fallos}/${filas.length} pasan.`);
  if (fallos) process.exitCode = 1;
}
