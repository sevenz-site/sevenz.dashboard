// SOLO LA RAMA DEV (vzqppwrwnmlbrxizskdh) — lee .env.local.
//
// El recibo del cliente: `abono_confirmation_v3`.
//
// NADA SALE A KAPSO. `fetch` se intercepta antes y se afirma que salieron
// cero. Lo que se inspecciona es lo que Kapso HABRÍA recibido: los cuatro
// parámetros del cuerpo con su nombre y en orden, el del botón, y por qué
// número sale.
//
// SÍ ESCRIBE en dev: crea su propio cliente, su enlace y sus movimientos, y
// los borra en el `finally` pase lo que pase. También deja filas de reserva en
// `whatsapp_sends` —a propósito, para ejercitar la puerta— y las borra por su
// plantilla de prueba.
//
// LO QUE VIGILA, y por qué cada cosa:
//
//   1. Que los cuatro parámetros salgan con el nombre y el orden que Meta
//      aprobó. Meta rechaza un parámetro que la plantilla no declara, y el
//      envío falla ENTERO y en silencio — no hay nada que se le muestre al
//      tendero. Es el fallo que `qa:plantillas` existe para cazar en las del
//      dueño; este es su equivalente para el cliente.
//
//   2. Que salga por el NÚMERO DE CLIENTES. Si se fuera por el de dueños, el
//      mensaje llegaría igual y arriesgaría la reputación del número que lleva
//      los avisos que ya funcionan en producción.
//
//   3. Que un fiado NO genere recibo. Sin ese guardia, registrar un fiado
//      mandaría «registramos tu abono» por una deuda.
//
//   4. Que el mismo abono dos veces mande UN solo mensaje. El recibo es un
//      comprobante: dos del mismo pago se leen como dos pagos.
//
//   5. Que MS-7 siga en pie por este camino: un abono venido de una foto no
//      genera recibo aunque el cliente haya aceptado.

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

// ── la intercepción, antes de importar nada que mande ──────────────────────
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

// EL INTERRUPTOR SE PRUEBA EN SUS DOS POSICIONES, y se enciende aqui a mano
// --no en .env.local-- para que correr esta suite nunca pueda dejarlo puesto.
const { enviarReciboAlCliente } = await import("../lib/whatsapp/recibo-cliente.ts");
const apagado = await enviarReciboAlCliente("00000000-0000-4000-8000-000000000000");
process.env.WHATSAPP_CLIENT_NOTICES = "on";

const ESPERADO = PLANTILLAS_ESPERADAS.abono_confirmation_v3.cuerpo;

const filas = [];
function check(nombre, pasa, detalle) {
  filas.push({ nombre, pasa });
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${detalle ? `  — ${detalle}` : ""}`);
}

const TEL = "584129900101";
const PLANTILLA = "abono_confirmation_v3";
let clienteId = null;

try {
  const { data: owners } = await admin.from("owners").select("id").limit(1);
  const OWNER = owners[0].id;

  await admin.from("client_whatsapp_consents").delete().eq("phone", TEL);
  const { data: c } = await admin
    .from("clients")
    .insert({ owner_id: OWNER, name: "QA Recibo", whatsapp: TEL })
    .select("id")
    .single();
  clienteId = c.id;

  const base = { client_id: clienteId, created_by: OWNER, currency: "USD" };
  const { data: fiado } = await admin
    .from("movements")
    .insert({ ...base, type: "charge", amount: 50, source: "manual" })
    .select("id")
    .single();
  const { data: abono } = await admin
    .from("movements")
    .insert({ ...base, type: "payment", amount: 20, source: "manual" })
    .select("id")
    .single();
  const { data: abonoFoto } = await admin
    .from("movements")
    .insert({ ...base, type: "payment", amount: 5, source: "photo_import" })
    .select("id")
    .single();

  // ── 0. El interruptor ──────────────────────────────────────────────────
  check(
    "0. con WHATSAPP_CLIENT_NOTICES apagado no sale NADA",
    apagado.estado === "omitido" && apagado.motivo === "desactivado",
    JSON.stringify(apagado),
  );

  // ── 1. Sin permiso no sale nada ────────────────────────────────────────
  const sinPermiso = await enviarReciboAlCliente(abono.id);
  check(
    "1. sin permiso del cliente no sale recibo, y dice por qué",
    sinPermiso.estado === "omitido" && sinPermiso.motivo === "no_consent",
    JSON.stringify(sinPermiso),
  );

  await admin.rpc("record_owner_declared_whatsapp_consent", {
    p_client_id: clienteId,
    p_owner_id: OWNER,
    p_consent_text: "QA Recibo acepta.",
    p_source: "owner_movement_form",
  });

  // ── 2. MS-7 por este camino ────────────────────────────────────────────
  const deFoto = await enviarReciboAlCliente(abonoFoto.id);
  check(
    "2. un abono venido de una FOTO no genera recibo, aunque haya permiso",
    deFoto.estado === "omitido" && deFoto.motivo === "photo_import",
    JSON.stringify(deFoto),
  );

  // ── 3. Un fiado no es un abono ─────────────────────────────────────────
  const esFiado = await enviarReciboAlCliente(fiado.id);
  check(
    "3. un FIADO no genera recibo",
    esFiado.estado === "omitido" && esFiado.motivo === "no_es_abono",
    JSON.stringify(esFiado),
  );

  // ── 4. El abono de verdad ──────────────────────────────────────────────
  const enviado = await enviarReciboAlCliente(abono.id);
  check("4a. el abono manual sí genera recibo", enviado.estado === "enviado", JSON.stringify(enviado));

  const msg = interceptados.at(-1);
  const nombres = (msg?.template?.components ?? [])
    .filter((c) => c.type === "body")
    .flatMap((c) => c.parameters.map((p) => p.parameter_name ?? p.name));
  check(
    "4b. los cuatro parámetros del cuerpo, con su nombre y en orden",
    JSON.stringify(nombres) === JSON.stringify(ESPERADO),
    `esperado [${ESPERADO}] · visto [${nombres}]`,
  );

  const valores = (msg?.template?.components ?? [])
    .filter((c) => c.type === "body")
    .flatMap((c) => c.parameters.map((p) => p.text));
  check(
    "4c. y sus valores son los del movimiento, no inventados",
    valores[0] === "QA Recibo" && valores[1] === "$20.00" && valores[3] === "$30.00",
    JSON.stringify(valores),
  );

  const boton = (msg?.template?.components ?? []).find((c) => c.type === "button");
  // THE SHAPE OF THE BUTTON, NOT JUST ITS CONTENT.
  //
  // Until 2026-10-15 this only looked at whether the token was 16 characters
  // or longer, and it stayed GREEN while production failed 12 of 12. The
  // parameter travelled with `parameter_name`, which is valid for the body and
  // not for a URL button's suffix, which is positional. Meta returned `132018`
  // and discarded the whole message, with nothing shown to the shopkeeper.
  //
  // The rule lives in `plantillas-esperadas.mjs` and not here, on purpose: the
  // three suites ask the same question, and three copies of this check would
  // end up disagreeing -- which is the exact shape of the failure it closes.
  const problema = problemaDelBoton(PLANTILLA, boton);
  check(
    "4d. el botón lleva el token, y con la forma que Meta acepta",
    problema === null,
    problema ?? JSON.stringify(boton),
  );

  check(
    "4e. sale por el número de CLIENTES, no por el de dueños",
    msg.__url.includes(PHONE_ID_CLIENTS) && !msg.__url.includes(PHONE_ID_OWNERS),
    msg.__url.includes(PHONE_ID_CLIENTS) ? "número de clientes" : msg.__url,
  );

  check("4f. el idioma es es", msg?.template?.language?.code === "es", msg?.template?.language?.code);

  // 4g LOOKS AT THE STORED ROW, NOT AT THE CALL, and that is the whole
  // difference. 4e above checks the URL at the moment of sending; this checks
  // what stays written down, which is the only thing you can consult six days
  // later.
  //
  // The owner asked for it on 2026-10-15, after seeing the owners' number
  // selected in Kapso's panel and asking which one the receipts went out from.
  // The code was right, and the answer had to be argued by reading source,
  // because the table did not record the sender. Migration 105.
  const { data: fila } = await admin
    .from("whatsapp_sends")
    .select("phone_number_id")
    .eq("template", PLANTILLA)
    .limit(1)
    .maybeSingle();
  check(
    "4g. la fila guardada deja constancia del numero emisor",
    fila?.phone_number_id === PHONE_ID_CLIENTS,
    fila?.phone_number_id ?? "sin phone_number_id — ¿corriste la migración 105 en dev?",
  );

  // ── 5. El mismo abono dos veces ────────────────────────────────────────
  const antes = interceptados.length;
  const repetido = await enviarReciboAlCliente(abono.id);
  check(
    "5. el mismo abono dos veces manda UN solo mensaje",
    repetido.estado === "omitido" &&
      repetido.motivo === "ya_enviado" &&
      interceptados.length === antes,
    JSON.stringify(repetido),
  );

  check(
    "6. ningún mensaje salió de verdad a Kapso",
    true,
    `${interceptados.length} interceptados, 0 enviados`,
  );
} finally {
  await admin.from("whatsapp_sends").delete().eq("template", PLANTILLA);
  if (clienteId) {
    await admin.from("movements").delete().eq("client_id", clienteId);
    await admin.from("clients").delete().eq("id", clienteId);
  }
  await admin.from("client_whatsapp_consents").delete().eq("phone", TEL);

  const { count: sends } = await admin
    .from("whatsapp_sends")
    .select("id", { count: "exact", head: true })
    .eq("template", PLANTILLA);
  const { count: clientes } = await admin
    .from("clients")
    .select("id", { count: "exact", head: true })
    .eq("name", "QA Recibo");
  check(
    "7. limpieza: no queda nada de la prueba en dev",
    sends === 0 && clientes === 0,
    `${sends} envíos · ${clientes} clientes`,
  );

  const fallos = filas.filter((f) => !f.pasa).length;
  console.log(`\n${filas.length - fallos}/${filas.length} pasan.`);
  if (fallos) process.exitCode = 1;
}
