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
import { validarNota } from "../lib/reports/assistant/validate.ts";
import { partirPorImportes } from "../lib/reports/assistant/importes.ts";

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

let comoDueno = null;

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

  // ── 8c-8e. LA VALIDACIÓN DE CIFRAS, Y MI PROPIO FALLO ──────────────
  //
  // La 8d es la que importa y nació de un fallo real, no de imaginarlo: el
  // 2026-10-30, en la PRIMERA llamada de verdad a Gemini, el validador
  // rechazó dos resúmenes correctos por «inventar» cifras que sí estaban en
  // los hechos. El patrón era codicioso con los separadores y se tragaba la
  // coma de la frase --«€793,82, y además…» daba el token `793,82,`--.
  //
  // Un guardia contra números falsos produciendo acusaciones falsas es peor
  // que no tenerlo: cada rechazo se apunta como caída del asistente y manda a
  // mirar a Google cuando el problema está aquí.
  const hechosReales = hechos;

  check(
    "8c. una cifra que NO está en los hechos se rechaza",
    validarNota({ summary: "Tienes $999.999,99 por cobrar.", recommendations: [] }, hechosReales).ok === false,
    "rechazada",
  );

  const conComa = `Te fiaron ${(hechosReales.lent.EUR ?? hechosReales.lent.USD ?? 0).toLocaleString("es-VE", { minimumFractionDigits: 2 })}, y eso pesa.`;
  const vComa = validarNota({ summary: conComa, recommendations: [] }, hechosReales);
  check(
    "8d. una cifra REAL seguida de coma NO se rechaza (mi fallo del 2026-10-30)",
    vComa.ok === true,
    vComa.ok ? conComa : vComa.detalle,
  );

  check(
    "8e. y un texto que parece nombrar a alguien se rechaza",
    validarNota({ summary: "Cóbrale al cliente Pedro.", recommendations: [] }, hechosReales).ok === false,
    "rechazado",
  );

  // ── 8f-8h. LAS BANDERAS DE LOS IMPORTES ───────────────────────────
  //
  // El dueno pidio el 2026-10-30 que cada saldo del resumen lleve su bandera.
  // Como la nota se guarda COMO TEXTO, la moneda se deduce de como la escribio
  // la app, y lo unico que separa un peso colombiano de un dolar es un ESPACIO
  // detras del `$`. De ahi que esto tenga pruebas propias.
  const frase = "Tienes $11.852,69 y €5.456,21 por cobrar, $ 60.000,00 en pesos y Bs. 1.000,50.";
  const trozos = partirPorImportes(frase);
  const monedas = trozos.filter((t) => t.moneda).map((t) => `${t.texto}=${t.moneda}`);
  check(
    "8f. cada importe se reconoce con su moneda, y el espacio separa el peso del dolar",
    monedas.join(" ") === "$11.852,69=USD €5.456,21=EUR $ 60.000,00=COP Bs. 1.000,50=VES",
    monedas.join(" "),
  );

  // LA QUE MAS VALE DE LAS TRES: una funcion que parte texto y se come un
  // trozo lo hace en silencio, y lo que se perderia aqui es media frase del
  // informe de alguien.
  check(
    "8g. y no se pierde ni un caracter de la frase",
    trozos.map((t) => t.texto).join("") === frase,
    `${trozos.map((t) => t.texto).join("").length} de ${frase.length} caracteres`,
  );

  check(
    "8h. una frase sin dinero sale entera y sin banderas",
    (() => {
      const f = "Tienes 14 clientes con el plazo vencido.";
      const t = partirPorImportes(f);
      return t.map((x) => x.texto).join("") === f && t.every((x) => !x.moneda);
    })(),
    "sin falsos positivos",
  );

  // ── 9. UN NEGOCIO SIN NADA NO LLAMA AL MODELO ───────────────────────
  const vacio = buildFallbackNote({ ...base, empty: true });
  check(
    "9. un negocio sin nada no tiene nada que resumir",
    vacio.recommendations.length === 0 && /todavía no has registrado/i.test(vacio.summary),
    vacio.summary,
  );

  // ── 10-12. LA TABLA ─────────────────────────────────────────────────
  // UNA FECHA CENTINELA Y NO HOY.
  //
  // La clave primaria es (owner_id, day), así que usar HOY hacía que la suite
  // chocara con la nota que la propia app acaba de generar al abrir Reportes
  // --y entonces fallaba por existir, no por estar rota--. Una fecha que
  // ningún día real va a ocupar deja la prueba independiente de si alguien
  // miró la pantalla antes de correrla.
  const hoy = "2019-01-01";

  // ── SE ESCRIBE POR LA FUNCIÓN, COMO LA APP ────────────────────────
  //
  // Hasta la migración `166` esto insertaba en la tabla con la clave de
  // servicio. La `166` le revocó ese permiso --porque producción se lo revoca
  // y el código no podía depender de él-- y la suite se puso roja, que es la
  // migración haciendo su trabajo.
  //
  // Pasar por `upsert_report_assistant_note` no es un apaño para que vuelva al
  // verde: es MEJOR prueba. Ahora ejercita exactamente el camino que usa la
  // app, incluido el `security definer` que lo hace posible sin permiso de
  // tabla. Antes probaba un camino que ningún código recorre.
  const escribir = (day, extra = {}) =>
    admin.rpc("upsert_report_assistant_note", {
      p_owner_id: dueno.id,
      p_day: day,
      p_summary: "QA ASISTENTE",
      p_recommendations: ["uno"],
      p_degraded: false,
      p_model: "prueba",
      p_failure_reason: null,
      ...extra,
    });

  const { error: e1 } = await escribir(hoy);
  check("10. se puede guardar la nota del día", !e1, e1?.message);

  // ── LA TRAMPA QUE ESTA SUITE YA PISÓ UNA VEZ ──────────────────────
  //
  // Las comprobaciones de abajo esperan un RECHAZO. Si la función no existe,
  // PostgREST también rechaza --con `PGRST202`-- y salían en verde con la
  // migración sin correr: un detector que confirma lo que quiere oír. Así que
  // el rechazo tiene que ser EL SUYO, por código.
  const SIN_FUNCION = "PGRST202";
  const hayFuncion = e1?.code !== SIN_FUNCION;
  const exige = (nombre, codigoEsperado, error) => {
    if (!hayFuncion) {
      check(nombre, false, "la migración 166 no está corrida en dev — no se puede comprobar");
      return;
    }
    check(nombre, error?.code === codigoEsperado, error?.code ?? "LA ACEPTÓ");
  };

  // ── LA SESIÓN DEL DUEÑO, ARRIBA ───────────────────────────────────
  //
  // Se crea aquí y no más abajo porque desde la `166` es el ÚNICO cliente que
  // puede LEER esta tabla: a la clave de servicio se le revocó el `select`,
  // igual que en producción. Contar filas, leer la nota y calificarla pasan
  // todas por aquí.
  const { data: u } = await admin.auth.admin.getUserById(dueno.id);
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user.email });
  const { data: ses } = await anon.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });
  comoDueno = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${ses.session.access_token}` } },
  });

  // UNA SOLA FILA POR DÍA. La función hace `upsert`, así que la segunda
  // llamada REEMPLAZA en vez de fallar -- y lo que se comprueba es justo eso:
  // que la clave primaria impide que existan dos.
  await escribir(hoy, { p_summary: "QA ASISTENTE reescrita" });
  const { count: cuantas } = await comoDueno
    .from("report_assistant_notes")
    .select("owner_id", { count: "exact", head: true })
    .eq("day", hoy);
  check(
    "11. una segunda escritura REEMPLAZA, nunca duplica",
    hayFuncion && cuantas === 1,
    `${cuantas} fila(s) para ese día`,
  );

  const { error: e3 } = await escribir("2019-01-02", { p_degraded: true, p_failure_reason: null });
  exige(
    "12. una caída sin motivo se rechaza (la tarjeta de /admin contaría fantasmas)",
    "23514",
    e3,
  );

  // LA CALIFICACIÓN EN ESPAÑOL, POR LA PUERTA DEL DUEÑO, que es la única que
  // escribe en esa columna: `authenticated` tiene `update` y nada más.
  const { error: e4 } = await comoDueno
    .from("report_assistant_notes")
    .update({ rating: "mucho" })
    .eq("owner_id", dueno.id)
    .eq("day", hoy);
  exige(
    "12b. y una calificación en español se rechaza: los valores guardados son en inglés",
    "23514",
    e4,
  );

  const { data: suya, error: e5 } = await comoDueno
    .from("report_assistant_notes")
    .select("summary")
    .eq("owner_id", dueno.id)
    .eq("day", hoy)
    .maybeSingle();
  check(
    "13. el dueño LEE su propia nota (política + grant, la trampa de la 108)",
    !e5 && suya?.summary === "QA ASISTENTE reescrita",
    e5 ? `${e5.code}: ${e5.message}` : suya?.summary,
  );

  const { error: e6 } = await comoDueno
    .from("report_assistant_notes")
    .update({ rating: "not_useful" })
    .eq("owner_id", dueno.id)
    .eq("day", hoy);
  check("14. y puede calificarla: `update` es un permiso aparte de `select`", !e6, e6?.message);

  // ── EL PERMISO DE `service_role` NO SE PUEDE COMPROBAR AQUÍ ───────
  //
  // La ruta escribe la nota con el cliente de SERVICIO. En dev ese rol tiene
  // permisos sobre todo --la migración `045` lo dejó así a propósito-- y en
  // PRODUCCIÓN los tiene revocados sobre las tablas de clientes. Así que un
  // `grant` que faltara pasaría esta suite entera y fallaría para todos los
  // tenderos el día del despliegue.
  //
  // Intentar la escritura aquí no lo distingue: sale bien con grant y sin él.
  // Lo único que lo contesta es preguntárselo a PRODUCCIÓN, y está escrito en
  // la sección de verificación del informe como una consulta que corre el
  // dueño. La migración `165` concede el permiso explícitamente para que haya
  // algo que comprobar.

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
  // ── LA LIMPIEZA CAMBIÓ CON LA `166`, Y DECIRLO ES LA MITAD ────────
  //
  // Antes esta suite borraba sus filas con la clave de servicio. La `166` le
  // revocó ese permiso --igual que producción-- así que **nada puede borrar
  // una nota**: ni el servidor, que solo escribe por la función, ni el
  // tendero, que solo tiene `select` y `update`. Es deliberado: una nota es
  // un apunte diario de 24 filas al día en el peor caso, y no hay ningún
  // camino de la app que deba borrarlas.
  //
  // ASÍ QUE LA SUITE DEJA SUS DOS FILAS CENTINELA, en 2019, y las reescribe
  // en cada corrida en vez de acumularlas. Lo que NO puede dejar es una nota
  // con la fecha de HOY, que sería basura mezclada con las de verdad.
  //
  // Y SE CUENTA COMO EL DUEÑO. Contarlo con la clave de servicio daba 42501,
  // `count` llegaba nulo, y `null ?? 0 === 0` pintaba un PASS diciendo «no
  // queda nada» con la fila delante. Un detector que confirma lo que quiere
  // oír -- el mismo fallo que esta suite ya cazó en las comprobaciones 11 y 12.
  const ahora = new Date().toISOString().slice(0, 10);
  if (comoDueno) {
    const { count, error } = await comoDueno
      .from("report_assistant_notes")
      .select("owner_id", { count: "exact", head: true })
      .like("summary", "QA ASISTENTE%")
      .eq("day", ahora);
    check(
      "15. limpieza: la suite no dejó ninguna nota con la fecha de hoy",
      !error && (count ?? -1) === 0,
      error ? `${error.code}: ${error.message}` : `quedan ${count}`,
    );
  } else {
    check("15. limpieza: la suite no dejó ninguna nota con la fecha de hoy", false, "sin sesión de dueño");
  }

  const pasan = filas.filter((f) => f.pasa).length;
  console.log(`\n${pasan}/${filas.length} pasan.`);
  if (pasan !== filas.length) process.exitCode = 1;
}
