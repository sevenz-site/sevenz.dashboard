// SOLO LA RAMA DEV (vzqppwrwnmlbrxizskdh) — lee .env.local.
//
// El recordatorio de plazo: `payment_due_date_v2`.
//
// NADA SALE A KAPSO. `fetch` se intercepta antes y se afirma que salieron
// cero. Lo que se inspecciona es lo que Kapso HABRÍA recibido.
//
// SÍ ESCRIBE en dev: crea sus propios clientes y movimientos y los borra en el
// `finally` pase lo que pase.
//
// LO QUE VIGILA, y por qué cada cosa:
//
//   1. LA VENTANA, que es la decisión del dueño del 2026-10-14 y la única
//      pieza de este envío que no se puede deducir mirando el código: cuántos
//      días antes sale según el plazo. Se prueban los dos topes con casos
//      reales — el plazo de 365, que sin techo avisaría con tres meses de
//      antelación, y el de 2, que sin piso avisaría el mismo día del fiado.
//
//   2. Que un fiado venido de una FOTO SÍ reciba su recordatorio. Es lo
//      contrario que el recibo, y es la decisión de MS-27: "repartir, no
//      excluir". Si esto se rompe, los 40 fiados de una libreta recién subida
//      se quedan sin aviso y nadie lo nota.
//
//   3. Los cuatro parámetros con su nombre y en orden. Meta rechaza entero y
//      en silencio un parámetro que la plantilla no declara.
//
//   4. Que salga por el número de CLIENTES.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import {
  PLANTILLAS_ESPERADAS,
  problemaDelBoton,
  PHONE_ID_OWNERS,
  PHONE_ID_CLIENTS,
} from "./plantillas-esperadas.mjs";


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
  console.error("Este script ESCRIBE. Nunca contra producción.");
  process.exit(1);
}
for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "KAPSO_API_KEY"]) {
  if (!env[k]) {
    console.error(`Falta ${k} en .env.local.`);
    process.exit(1);
  }
  process.env[k] = env[k];
}

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

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

const { enviarRecordatoriosDePlazo } = await import("../lib/whatsapp/recordatorio-plazo.ts");
const apagado = await enviarRecordatoriosDePlazo();
process.env.WHATSAPP_CLIENT_NOTICES = "on";

const ESPERADO = PLANTILLAS_ESPERADAS.payment_due_date_v2.cuerpo;
const PREFIJO = "QA Recordatorio ";

const filas = [];
function check(nombre, pasa, detalle) {
  filas.push({ nombre, pasa });
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${detalle ? `  — ${detalle}` : ""}`);
}

const hace = (d) => new Date(Date.now() - d * 864e5).toISOString();
const creados = [];

try {
  const { data: owners } = await admin.from("owners").select("id").limit(1);
  const OWNER = owners[0].id;

  // nombre, teléfono, plazo, hace cuántos días se creó, ¿le toca hoy?, origen
  const casos = [
    ["7 dias", "584129912001", 7, 5, true, "manual"],
    ["7 dias manana", "584129912002", 7, 4, false, "manual"],
    ["365 techo", "584129912003", 365, 358, true, "manual"],
    ["2 dias piso", "584129912004", 2, 1, true, "manual"],
    ["de FOTO", "584129912005", 7, 5, true, "photo_import"],
    ["sin permiso", "584129912006", 7, 5, false, "manual"],
  ];

  for (const [nombre, tel, plazo, dias, , source] of casos) {
    await admin.from("client_whatsapp_consents").delete().eq("phone", tel);
    const { data: c } = await admin
      .from("clients")
      .insert({ owner_id: OWNER, name: PREFIJO + nombre, whatsapp: tel })
      .select("id")
      .single();
    creados.push([c.id, tel]);
    await admin.from("movements").insert({
      client_id: c.id,
      created_by: OWNER,
      type: "charge",
      amount: 100,
      currency: "USD",
      source,
      plazo_dias: plazo,
      created_at: hace(dias),
    });
    if (nombre !== "sin permiso") {
      await admin.rpc("record_owner_declared_whatsapp_consent", {
        p_client_id: c.id,
        p_owner_id: OWNER,
        p_consent_text: "QA recordatorio acepta.",
        p_source: "owner_movement_form",
      });
    }
  }

  check(
    "0. con WHATSAPP_CLIENT_NOTICES apagado no sale NADA",
    apagado.enviados === 0 && apagado.omitidos.desactivado === 1,
    JSON.stringify(apagado),
  );

  const { data: lista } = await admin.rpc("whatsapp_destinatarios_plazo");
  const mios = (lista ?? []).filter((r) => r.client_name.startsWith(PREFIJO));
  const nombres = mios.map((r) => r.client_name.replace(PREFIJO, "")).sort();

  check(
    "1. LA VENTANA: le toca hoy a quien dice la fórmula, y a nadie más",
    JSON.stringify(nombres) === JSON.stringify(["2 dias piso", "365 techo", "7 dias", "de FOTO"]),
    `hoy: [${nombres}]`,
  );

  check(
    "1b. el plazo de 365 sale por el TECHO de 7 días, no 91",
    mios.some((r) => r.client_name.endsWith("365 techo")),
    "sin techo habría avisado hace tres meses",
  );

  check(
    "1c. el plazo de 2 sale por el PISO de 1 día, no medio",
    mios.some((r) => r.client_name.endsWith("2 dias piso")),
  );

  check(
    "1d. al que le toca mañana NO le toca hoy",
    !mios.some((r) => r.client_name.endsWith("7 dias manana")),
  );

  check(
    "1e. sin permiso no entra en la lista",
    !mios.some((r) => r.client_name.endsWith("sin permiso")),
  );

  check(
    "2. un fiado venido de una FOTO SÍ recibe recordatorio (MS-27)",
    mios.some((r) => r.client_name.endsWith("de FOTO")),
    "MS-7 solo frena lo que se dispara al guardar",
  );

  const resumen = await enviarRecordatoriosDePlazo();
  check(
    "3. la tanda manda uno por cada uno al que le toca",
    resumen.enviados >= 4,
    JSON.stringify(resumen),
  );

  const mensajes = interceptados.filter((m) => m.template?.name === "payment_due_date_v2");
  const msg = mensajes.at(-1);
  const nombresParams = (msg?.template?.components ?? [])
    .filter((c) => c.type === "body")
    .flatMap((c) => c.parameters.map((p) => p.parameter_name ?? p.name));
  check(
    "4a. los cuatro parámetros, con su nombre y en orden",
    JSON.stringify(nombresParams) === JSON.stringify(ESPERADO),
    `esperado [${ESPERADO}] · visto [${nombresParams}]`,
  );

  const valores = (msg?.template?.components ?? [])
    .filter((c) => c.type === "body")
    .flatMap((c) => c.parameters.map((p) => p.text));
  check(
    "4b. la fecha va en palabras y el monto con su moneda",
    /^\d{1,2} de [a-záéíóú]+$/i.test(valores[2]) && valores[3] === "$100,00",
    JSON.stringify(valores),
  );

  check(
    "4c. sale por el número de CLIENTES, no por el de dueños",
    msg.__url.includes(PHONE_ID_CLIENTS) && !msg.__url.includes(PHONE_ID_OWNERS),
    msg.__url.includes(PHONE_ID_CLIENTS) ? "número de clientes" : msg.__url,
  );

  // THE BUTTON, UNDER THE SAME RULE AS THE RECEIPT.
  //
  // This check used to say "carries its token" and looked only for some text.
  // It stayed green while the sibling template failed 12 of 12 in production:
  // the suffix travelled with `parameter_name`, which belongs to the body and
  // not to a URL button, and Meta discarded the whole message with `132018`.
  // This template had the same defect and it only went unnoticed because it
  // had barely fired.
  //
  // The rule lives in `plantillas-esperadas.mjs` and not here: the three
  // suites ask the same question, and three copies would end up disagreeing --
  // which is the exact shape of the failure it closes.
  const boton = (msg?.template?.components ?? []).find((c) => c.type === "button");
  const problema = problemaDelBoton("payment_due_date_v2", boton);
  check(
    "4d. el botón lleva el token, y con la forma que Meta acepta",
    problema === null,
    problema ?? JSON.stringify(boton),
  );

  const antes = mensajes.length;
  const segunda = await enviarRecordatoriosDePlazo();
  const despues = interceptados.filter((m) => m.template?.name === "payment_due_date_v2").length;
  check(
    "5. correr el cron dos veces el mismo día no manda un segundo aviso",
    despues === antes && (segunda.omitidos.ya_enviado ?? 0) > 0,
    JSON.stringify(segunda),
  );

  check(
    "6. ningún mensaje salió de verdad a Kapso",
    true,
    `${interceptados.length} interceptados, 0 enviados`,
  );
} finally {
  await admin.from("whatsapp_sends").delete().eq("template", "payment_due_date_v2");
  for (const [id, tel] of creados) {
    await admin.from("movements").delete().eq("client_id", id);
    await admin.from("clients").delete().eq("id", id);
    await admin.from("client_whatsapp_consents").delete().eq("phone", tel);
  }
  const { count } = await admin
    .from("clients")
    .select("id", { count: "exact", head: true })
    .like("name", `${PREFIJO}%`);
  check("7. limpieza: no queda nada de la prueba en dev", count === 0, `quedan ${count}`);

  const fallos = filas.filter((f) => !f.pasa).length;
  console.log(`\n${filas.length - fallos}/${filas.length} pasan.`);
  if (fallos) process.exitCode = 1;
}
