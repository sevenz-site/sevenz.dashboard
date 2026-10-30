// SOLO LA RAMA DEV (vzqppwrwnmlbrxizskdh) — lee .env.local.
//
// EL ASISTENTE DE REPORTES — migración `165`.
//
// Encargo del dueño el 2026-10-29. **Escribe en dev** —una fila en
// `report_assistant_notes`— y la borra en el `finally`, aunque el guion se
// caiga a mitad.
//
// ═══════════════════════════════════════════════════════════════════════
// LA COMPROBACIÓN 1 ES LA RAZÓN DE QUE ESTE ARCHIVO EXISTA
//
// El dueño eligió el nivel GRATUITO de Gemini a sabiendas, y en ese nivel los
// términos de Google dicen dos cosas: que usa el contenido enviado para
// mejorar sus productos, y que *«human reviewers may read, annotate, and
// process your API input and output»*.
//
// Así que lo único que separa «unas cifras huérfanas» de «la bodega de Fulano,
// con sus proveedores» es que el objeto de hechos no lleve ni un nombre. Eso
// no se garantiza leyendo el código: se garantiza **buscando los nombres
// reales de un negocio real dentro del JSON que se mandaría**, que es lo que
// hace la comprobación 1.
//
// Y es una PARADA DURA. Si falla, no se despliega — no porque algo se rompa,
// sino porque lo que se escapa no se puede recuperar.
//
// ═══════════════════════════════════════════════════════════════════════
// LAS DEMÁS, Y QUÉ CUESTA CADA UNA
//
//   2. La ventana son 7 días siempre. Si alguien la ata al selector de fechas,
//      vuelve el problema que el dueño señaló: cien tenderos generando a la
//      vez.
//   3-7. El respaldo recorre los cuatro motivadores EN ORDEN. Si el orden se
//      rompe, el asistente seguirá diciendo cosas ciertas — pero la de menos
//      importancia primero, que es justo lo que las 450 letras no permiten.
//   8. El tope de 450 recorta recomendaciones enteras, nunca media frase.
//   9. Un negocio sin nada NO llama al modelo. Es dinero y es sentido: no hay
//      nada que resumir.
//  10-12. La tabla: una sola nota por día, y las dos restricciones que impiden
//      que una caída quede sin motivo (o un motivo sin caída), que es lo que
//      dejaría la tarjeta de /admin contando fantasmas.
//  13-14. **COMO EL DUEÑO, con su sesión.** La tabla es nueva y lleva RLS: es
//      exactamente el fallo de la `108` —política correcta, `grant` olvidado—
//      que dejó la pantalla de Pedidos vacía con tres pedidos dentro mientras
//      su suite pasaba 14 de 14, porque corría con la clave de servicio.
// ═══════════════════════════════════════════════════════════════════════

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { buildFacts, assistantWindow, ASSISTANT_WINDOW_DAYS } from "../lib/reports/assistant/facts.ts";
import { buildFallbackNote, noteLength, trimToBudget, MAX_CHARS } from "../lib/reports/assistant/fallback.ts";

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

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const filas = [];
const check = (nombre, pasa, detalle) => {
  filas.push({ nombre, pasa });
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${detalle ? `  — ${detalle}` : ""}`);
};

const escritas = [];

try {
  // ── El negocio de prueba: el que más variedad tiene ──────────────────
  const { data: dueno, error: eDueno } = await admin
    .from("owners")
    .select("id, business_name, country")
    .eq("business_name", "Negocio prueba DEV")
    .maybeSingle();
  if (eDueno || !dueno) throw new Error(`no encuentro el negocio de prueba: ${eDueno?.message ?? "no existe"}`);

  const hechos = await buildFacts({
    supabase: admin,
    ownerId: dueno.id,
    dosLibros: dueno.country === "VE",
    // Tasas fijas y no las reales: lo que se mide aquí es qué SALE, no cuánto
    // vale. Una tasa que se mueve haría que esta suite fallara por motivos que
    // no tienen nada que ver con lo que vigila.
    effectiveRate: { usd: 1, eur: 1 },
    rates: { usd: 1, eur: 1, usdt: null },
  });
  const json = JSON.stringify(hechos);

  // ── 1. PARADA DURA: NI UN NOMBRE ────────────────────────────────────
  const [{ data: clientes }, { data: productos }] = await Promise.all([
    admin.from("clients").select("name, document_id, phone").eq("owner_id", dueno.id),
    admin.from("products").select("name, supplier").eq("owner_id", dueno.id),
  ]);

  const prohibidas = [];
  const anotar = (valor, que) => {
    if (typeof valor === "string" && valor.trim().length >= 3) prohibidas.push({ valor: valor.trim(), que });
  };
  anotar(dueno.business_name, "nombre del negocio");
  for (const c of clientes ?? []) {
    anotar(c.name, "nombre de cliente");
    anotar(c.document_id, "cédula");
    anotar(c.phone, "teléfono");
  }
  for (const p of productos ?? []) {
    anotar(p.name, "nombre de producto");
    anotar(p.supplier, "nombre de proveedor");
  }

  const filtradas = prohibidas.filter((p) => json.toLowerCase().includes(p.valor.toLowerCase()));
  check(
    `1. ningún nombre del negocio viaja en los hechos  (${prohibidas.length} cadenas buscadas)`,
    filtradas.length === 0,
    filtradas.length ? `SE ESCAPARON: ${filtradas.map((f) => `${f.que} «${f.valor}»`).join(", ")}` : "limpio",
  );

  const uuids = json.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? [];
  check("1b. tampoco ningún identificador", uuids.length === 0, uuids.length ? uuids.join(", ") : "ningún uuid");

  // ── 2. LA VENTANA SON 7 DÍAS, SIEMPRE ───────────────────────────────
  const v = assistantWindow(new Date("2026-10-29T15:00:00Z"));
  const dias = Math.round((v.hasta - v.desde) / (24 * 60 * 60 * 1000));
  check(
    "2. la ventana es de 7 días y no la mueve el selector",
    ASSISTANT_WINDOW_DAYS === 7 && dias === 7 && hechos.windowDays === 7,
    `${dias} días`,
  );

  // ── 3-7. EL RESPALDO, MOTIVADOR A MOTIVADOR ─────────────────────────
  const base = {
    ledgers: ["USD"],
    windowDays: 7,
    receivable: {},
    clients: { dueSoon: 0, overdue: 0, critical: 0, flagged: 0, noTerm: 0 },
    collectedCash: {},
    collectedOnDebt: {},
    lent: {},
    stock: { threshold: 5, available: 0, runningLow: 0, outOfStock: 0, uncounted: 0, total: 0, bestSellersRunningLow: 0 },
    catalogSales: {},
    unhandledOrders: 0,
    suppliers: { total: 0, withComputableMargin: 0, lowestMarginPct: null, highestMarginPct: null },
    dormantGoodPayers: 0,
    gaps: { productsWithoutCost: 0, productsUncounted: 0, unattributedSaleLines: 0 },
    empty: false,
  };

  const critico = buildFallbackNote({ ...base, clients: { ...base.clients, critical: 2, overdue: 5 } });
  check(
    "3. motivador 1 · un cliente crítico manda sobre uno con el plazo vencido",
    /crítico/i.test(critico.recommendations[0] ?? ""),
    critico.recommendations[0],
  );

  const estante = buildFallbackNote({
    ...base,
    stock: { ...base.stock, bestSellersRunningLow: 3, outOfStock: 9 },
  });
  check(
    "4. motivador 2 · lo más vendido por agotarse manda sobre lo ya agotado",
    /más vendidos que están por agotarse/i.test(estante.recommendations[0] ?? ""),
    estante.recommendations[0],
  );

  const pedidos = buildFallbackNote({ ...base, unhandledOrders: 4 });
  check(
    "5. motivador 3 · los pedidos sin atender salen cuando no hay nada peor",
    /pedidos del catálogo/i.test(pedidos.recommendations[0] ?? ""),
    pedidos.recommendations[0],
  );

  const dormidos = buildFallbackNote({ ...base, dormantGoodPayers: 1 });
  check(
    "6. motivador 4 · un buen pagador que dejó de comprar",
    /mejores pagadores/i.test(dormidos.recommendations[0] ?? ""),
    dormidos.recommendations[0],
  );

  const todoJunto = buildFallbackNote({
    ...base,
    clients: { ...base.clients, critical: 2, flagged: 1 },
    stock: { ...base.stock, bestSellersRunningLow: 3 },
    unhandledOrders: 4,
    dormantGoodPayers: 2,
  });
  check(
    "7. con los cuatro a la vez, el orden lo decide la prelación y no el azar",
    /crítico/i.test(todoJunto.recommendations[0] ?? "") &&
      todoJunto.recommendations.length === 3 &&
      !todoJunto.recommendations.some((r) => /mejores pagadores/i.test(r)),
    `${todoJunto.recommendations.length} recomendaciones; la 4ª se quedó fuera`,
  );

  const sano = buildFallbackNote(base);
  check(
    "7b. sin nada preocupante, habla igual pero de lo bueno",
    /vas al día/i.test(sano.summary) && sano.recommendations.length === 0,
    sano.summary,
  );

  // ── 8. EL TOPE DE 450 ───────────────────────────────────────────────
  const largo = {
    summary: "x".repeat(300),
    recommendations: ["a".repeat(100), "b".repeat(100), "c".repeat(100)],
  };
  const recortado = trimToBudget(largo);
  check(
    "8. el tope de 450 quita recomendaciones enteras, nunca media frase",
    noteLength(recortado) <= MAX_CHARS &&
      recortado.summary === largo.summary &&
      recortado.recommendations.every((r) => largo.recommendations.includes(r)),
    `${noteLength(largo)} → ${noteLength(recortado)} caracteres`,
  );
  check(
    "8b. y el texto real de un negocio de verdad cabe",
    noteLength(buildFallbackNote(hechos)) <= MAX_CHARS,
    `${noteLength(buildFallbackNote(hechos))} caracteres`,
  );

  // ── 9. UN NEGOCIO SIN NADA NO LLAMA AL MODELO ───────────────────────
  const vacio = buildFallbackNote({ ...base, empty: true });
  check(
    "9. un negocio sin nada no tiene nada que resumir",
    vacio.recommendations.length === 0 && /todavía no has registrado/i.test(vacio.summary),
    vacio.summary,
  );

  // ── 10-12. LA TABLA ─────────────────────────────────────────────────
  const hoy = new Date().toISOString().slice(0, 10);
  const { error: e1 } = await admin
    .from("report_assistant_notes")
    .insert({ owner_id: dueno.id, day: hoy, summary: "QA ASISTENTE", recommendations: ["uno"] });
  if (!e1) escritas.push({ owner_id: dueno.id, day: hoy });
  check("10. se puede guardar la nota del día", !e1, e1?.message);

  // ── LA TRAMPA QUE ESTA SUITE YA PISÓ UNA VEZ ──────────────────────
  //
  // Las tres comprobaciones de abajo esperan un RECHAZO. Si la tabla no
  // existe, PostgREST también rechaza --con `PGRST205`-- y las tres salían
  // en verde con la migración sin correr: un detector que confirma lo que
  // quiere oír. Así que el rechazo tiene que ser EL SUYO, por código, y la
  // falta de tabla se reporta como lo que es.
  const RECHAZO_POR_FALTA_DE_TABLA = "PGRST205";
  const hayTabla = e1?.code !== RECHAZO_POR_FALTA_DE_TABLA;
  const exigeTabla = (nombre, codigoEsperado, error) => {
    if (!hayTabla) {
      check(nombre, false, "la migración 165 no está corrida en dev — no se puede comprobar");
      return;
    }
    check(nombre, error?.code === codigoEsperado, error?.code ?? "LA ACEPTÓ");
  };

  const { error: e2 } = await admin
    .from("report_assistant_notes")
    .insert({ owner_id: dueno.id, day: hoy, summary: "QA ASISTENTE segunda", recommendations: [] });
  exigeTabla("11. y la base rechaza una SEGUNDA del mismo día", "23505", e2);

  const { error: e3 } = await admin
    .from("report_assistant_notes")
    .insert({ owner_id: dueno.id, day: "2020-01-01", summary: "QA ASISTENTE sin motivo", degraded: true });
  exigeTabla(
    "12. una caída sin motivo se rechaza (la tarjeta de /admin contaría fantasmas)",
    "23514",
    e3,
  );
  if (hayTabla && !e3) escritas.push({ owner_id: dueno.id, day: "2020-01-01" });

  const { error: e4 } = await admin
    .from("report_assistant_notes")
    .update({ rating: "mucho" })
    .eq("owner_id", dueno.id)
    .eq("day", hoy);
  exigeTabla(
    "12b. y una calificación en español se rechaza: los valores guardados son en inglés",
    "23514",
    e4,
  );

  // ── 13-14. COMO EL DUEÑO, CON SU SESIÓN ─────────────────────────────
  const { data: u } = await admin.auth.admin.getUserById(dueno.id);
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user.email });
  const { data: ses } = await anon.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });
  const comoDueno = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${ses.session.access_token}` } },
  });

  const { data: suya, error: e5 } = await comoDueno
    .from("report_assistant_notes")
    .select("summary")
    .eq("day", hoy)
    .maybeSingle();
  check(
    "13. el dueño LEE su propia nota (política + grant, la trampa de la 108)",
    !e5 && suya?.summary === "QA ASISTENTE",
    e5 ? `${e5.code}: ${e5.message}` : suya?.summary,
  );

  const { error: e6 } = await comoDueno
    .from("report_assistant_notes")
    .update({ rating: "not_useful" })
    .eq("owner_id", dueno.id)
    .eq("day", hoy);
  check("14. y puede calificarla: `update` es un permiso aparte de `select`", !e6, e6?.message);

  const { data: ajenas, error: e7 } = await comoDueno
    .from("report_assistant_notes")
    .select("owner_id")
    .neq("owner_id", dueno.id);
  // «Cero filas» también es lo que devuelve una tabla que no existe, así que
  // esta exige que la consulta haya SALIDO BIEN además de volver vacía.
  check(
    "14b. y no ve las de ningún otro negocio",
    hayTabla && !e7 && (ajenas ?? []).length === 0,
    e7 ? `${e7.code}: ${e7.message}` : `${(ajenas ?? []).length} filas ajenas`,
  );
} finally {
  for (const f of escritas) {
    await admin.from("report_assistant_notes").delete().eq("owner_id", f.owner_id).eq("day", f.day);
  }
  const { count } = await admin
    .from("report_assistant_notes")
    .select("owner_id", { count: "exact", head: true })
    .like("summary", "QA ASISTENTE%");
  check("15. limpieza: no queda nada de la prueba en dev", (count ?? 0) === 0, `quedan ${count ?? 0}`);

  const pasan = filas.filter((f) => f.pasa).length;
  console.log(`\n${pasan}/${filas.length} pasan.`);
  if (pasan !== filas.length) process.exitCode = 1;
}
