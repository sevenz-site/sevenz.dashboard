// SOLO LA RAMA DEV (vzqppwrwnmlbrxizskdh) — lee .env.local.
//
// Comprueba la migración 081: dónde se guarda el permiso del cliente final
// (MS-25). SÍ ESCRIBE en dev, a propósito, porque lo único que importa aquí
// son los efectos — y crea y borra su propio cliente de prueba, sin tocar
// ninguna fila real. Si el script se cae a mitad, el `finally` limpia igual.
//
// LO QUE VIGILA, y por qué cada cosa:
//
//   1. Que la normalización del teléfono sea ESTABLE. Es la clave de la tabla:
//      si "+58 412-1234567" y "584121234567" no dan la misma cadena, la misma
//      persona acaba con dos permisos distintos según cómo el tendero teclee
//      su número, y el que no se encuentre se traduce en silencio.
//
//   2. Que un número editado CADUQUE el permiso. Es la decisión del dueño del
//      2026-10-09 y el motivo de que la clave sea el teléfono. Si esto se
//      rompe, Sevenz le manda el saldo de un cliente a quien tuviera antes ese
//      número — una fuga de datos y un reporte a Meta casi seguro, que pega a
//      los 24 dueños a la vez porque la calidad se mide por NÚMERO.
//
//   3. Que un cliente sin número NO pueda aceptar. El modal no se le debe
//      enseñar: un "Aceptar" que no guarda nada es peor que no preguntar.
//
//   4. Que aceptar dos veces escriba UNA fila. La tabla es la evidencia, y una
//      fila duplicada se lee como dos decisiones separadas.
//
//   5. Que darse de baja NO borre el alta. El alta es la evidencia que
//      ampara los mensajes YA enviados a esa persona; borrarla al apagar
//      destruiria justo la prueba que haria falta si alguien pregunta por uno
//      de ellos. El par se lee como historia: alta el 9, baja el 20.
//
//   6. Que la puerta esté cerrada. Si `anon` pudiera llamar a la función de
//      escritura, cualquiera con un token escribiría su propia frase en la
//      evidencia — una prueba que nadie vio, que es peor que no tener ninguna.
//
// La 081 tiene que estar corrida en dev antes de esto. Si no, los nombres de
// función no existen y el script lo dice en vez de dar un PASS vacío.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

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

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

const filas = [];
function check(nombre, pasa, detalle) {
  filas.push({ nombre, pasa });
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${detalle ? `  — ${detalle}` : ""}`);
}

// El texto que el modal enseñará. Aquí es una cadena de prueba a propósito: lo
// que se comprueba es que se guarda LITERALMENTE lo que se pasa, no que
// coincida con la constante de producción, que todavía no existe.
const TEXTO = "QA 081: acepto recibir avisos de mi saldo por WhatsApp.";

// Un número que no puede chocar con ninguno real: prefijo 58 y un bloque fijo
// reservado para esto.
const TELEFONO = "584129900081";
const TELEFONO_EDITADO = "584129900082";

let clienteId = null;
let token = null;

try {
  // ── 1. La normalización ────────────────────────────────────────────────
  const variantes = ["584121234567", "+58 412-1234567", "0584121234567", "+584121234567"];
  const normalizadas = [];
  for (const v of variantes) {
    const { data, error } = await admin.rpc("normalize_whatsapp_phone", { p_raw: v });
    if (error) {
      console.error(`\nFALTA LA MIGRACIÓN 081. normalize_whatsapp_phone no responde: ${error.message}`);
      console.error("Córrela en la rama DEV (vzqppwrwnmlbrxizskdh) y vuelve a intentarlo.");
      process.exit(1);
    }
    normalizadas.push(data);
  }
  const todasIguales = normalizadas.every((n) => n === "584121234567");
  check(
    "1a. las 4 formas de escribir un número dan la MISMA clave",
    todasIguales,
    normalizadas.join(" | "),
  );

  const basura = [];
  for (const v of ["123", "", "no soy un numero", "0000000000000"]) {
    const { data } = await admin.rpc("normalize_whatsapp_phone", { p_raw: v });
    basura.push(data);
  }
  check(
    "1b. lo que no es un número devuelve null (falla CERRADO)",
    basura.every((b) => b === null),
    JSON.stringify(basura),
  );

  // ── el cliente de prueba ───────────────────────────────────────────────
  const { data: owners, error: eOwners } = await admin.from("owners").select("id").limit(1);
  if (eOwners || !owners?.length) throw new Error(`sin dueños en dev: ${eOwners?.message}`);

  const { data: cliente, error: eCliente } = await admin
    .from("clients")
    .insert({ owner_id: owners[0].id, name: "QA 081 consent", whatsapp: TELEFONO })
    .select("id")
    .single();
  if (eCliente) throw new Error(`no pude crear el cliente de prueba: ${eCliente.message}`);
  clienteId = cliente.id;

  const { data: link, error: eLink } = await admin
    .from("share_links")
    .insert({ client_id: clienteId })
    .select("token")
    .single();
  if (eLink) throw new Error(`no pude crear el enlace: ${eLink.message}`);
  token = link.token;

  // ── 2. El estado antes de aceptar ──────────────────────────────────────
  const estado = async (t) => (await admin.rpc("client_whatsapp_consent_state", { p_token: t })).data;
  const acepta = async (id) => (await admin.rpc("client_accepts_whatsapp", { p_client_id: id })).data;

  const antes = await estado(token);
  check(
    "2a. con número y sin aceptar: se puede preguntar, y no hay permiso",
    antes?.can_consent === true && antes?.granted === false,
    JSON.stringify(antes),
  );
  check("2b. y la puerta de envío dice NO", (await acepta(clienteId)) === false);

  const inexistente = await estado("no-existe-este-token-0000");
  check("2c. un token desconocido devuelve null, no un error", inexistente === null);

  // ── 3. Aceptar ─────────────────────────────────────────────────────────
  const { data: ok1 } = await admin.rpc("record_client_whatsapp_consent", {
    p_token: token,
    p_consent_text: TEXTO,
  });
  check("3a. aceptar devuelve true", ok1 === true);

  const despues = await estado(token);
  check(
    "3b. el estado pasa a aceptado",
    despues?.can_consent === true && despues?.granted === true,
    JSON.stringify(despues),
  );
  check("3c. y la puerta de envío dice SÍ", (await acepta(clienteId)) === true);

  const { data: guardadas } = await admin
    .from("client_whatsapp_consents")
    .select("phone, event, consent_text, via_client_id")
    .eq("phone", TELEFONO);
  check(
    "3d. se guardó el texto LITERAL que se mostró, y de quién vino",
    guardadas?.length === 1 &&
      guardadas[0].consent_text === TEXTO &&
      guardadas[0].event === "granted" &&
      guardadas[0].via_client_id === clienteId,
    guardadas?.length ? `"${guardadas[0].consent_text}"` : "ninguna fila",
  );

  // ── 4. Aceptar dos veces no duplica ────────────────────────────────────
  await admin.rpc("record_client_whatsapp_consent", { p_token: token, p_consent_text: TEXTO });
  const { count: cuantas } = await admin
    .from("client_whatsapp_consents")
    .select("id", { count: "exact", head: true })
    .eq("phone", TELEFONO);
  check("4. aceptar dos veces deja UNA sola fila", cuantas === 1, `filas: ${cuantas}`);

  // ── 5. EL NÚMERO EDITADO CADUCA EL PERMISO ─────────────────────────────
  // La razón de ser del diseño. Se prueba con un cambio real, no leyendo el
  // SQL: es justo la comprobación que, si se da por buena, deja la fuga abierta.
  await admin.from("clients").update({ whatsapp: TELEFONO_EDITADO }).eq("id", clienteId);

  const trasEditar = await estado(token);
  check(
    "5a. tras editar el número, el permiso NO aplica y se vuelve a preguntar",
    trasEditar?.can_consent === true && trasEditar?.granted === false,
    JSON.stringify(trasEditar),
  );
  check("5b. y la puerta de envío vuelve a decir NO", (await acepta(clienteId)) === false);

  const { count: siguenGuardadas } = await admin
    .from("client_whatsapp_consents")
    .select("id", { count: "exact", head: true })
    .eq("phone", TELEFONO);
  check(
    "5c. la fila vieja NO se borra: sigue siendo cierto que ESE número aceptó",
    siguenGuardadas === 1,
  );

  // Y al volver al número original, el permiso vuelve a valer sin preguntar.
  await admin.from("clients").update({ whatsapp: TELEFONO }).eq("id", clienteId);
  check("5d. al restaurar el número, el permiso vuelve a aplicar", (await acepta(clienteId)) === true);

  // ── 6. Un cliente sin número no puede aceptar ──────────────────────────
  await admin.from("clients").update({ whatsapp: null }).eq("id", clienteId);
  const sinNumero = await estado(token);
  check(
    "6a. sin número: can_consent=false, el modal NO se enseña",
    sinNumero?.can_consent === false && sinNumero?.granted === false,
    JSON.stringify(sinNumero),
  );
  const { data: okSinNumero } = await admin.rpc("record_client_whatsapp_consent", {
    p_token: token,
    p_consent_text: TEXTO,
  });
  check("6b. y aceptar devuelve false en vez de guardar basura", okSinNumero === false);
  await admin.from("clients").update({ whatsapp: TELEFONO }).eq("id", clienteId);

  // ── 7. Texto vacío ─────────────────────────────────────────────────────
  const { data: okVacio } = await admin.rpc("record_client_whatsapp_consent", {
    p_token: token,
    p_consent_text: "   ",
  });
  check("7. un texto en blanco se rechaza: la evidencia no puede estar vacía", okVacio === false);

  // ── 8. DARSE DE BAJA (migración 082, MS-31) ────────────────────────────
  // El permiso vuelve a estar puesto: el paso 6 lo dejó así.
  const { data: okBaja } = await admin.rpc("revoke_client_whatsapp_consent", { p_token: token });
  check("8a. darse de baja devuelve true", okBaja === true);
  check("8b. la puerta de envío dice NO", (await acepta(clienteId)) === false);

  const trasBaja = await estado(token);
  check(
    "8c. y el estado lo refleja",
    trasBaja?.can_consent === true && trasBaja?.granted === false,
    JSON.stringify(trasBaja),
  );

  // LO QUE DE VERDAD IMPORTA DE LA BAJA. Si el alta se borrara, se perdería la
  // evidencia que ampara los mensajes YA enviados a esa persona — que es justo
  // la que haría falta si alguien pregunta por uno de ellos.
  const { data: historia } = await admin
    .from("client_whatsapp_consents")
    .select("event, consent_text")
    .eq("phone", TELEFONO)
    .order("occurred_at");
  check(
    "8d. el alta NO se borra: quedan las dos filas, en orden",
    historia?.length === 2 &&
      historia[0].event === "granted" &&
      historia[0].consent_text === TEXTO &&
      historia[1].event === "revoked",
    historia?.map((h) => h.event).join(" → "),
  );

  await admin.rpc("revoke_client_whatsapp_consent", { p_token: token });
  const { count: trasDoble } = await admin
    .from("client_whatsapp_consents")
    .select("id", { count: "exact", head: true })
    .eq("phone", TELEFONO);
  check("8e. darse de baja dos veces no escribe otra fila", trasDoble === 2, `filas: ${trasDoble}`);

  // Volver a aceptar después de la baja. Es el camino de quien lo apagó sin
  // querer, y tiene que escribir un alta NUEVA, no resucitar la vieja.
  await admin.rpc("record_client_whatsapp_consent", { p_token: token, p_consent_text: TEXTO });
  const { data: historia2 } = await admin
    .from("client_whatsapp_consents")
    .select("event")
    .eq("phone", TELEFONO)
    .order("occurred_at");
  check(
    "8f. volver a aceptar añade un alta nueva y vuelve a valer",
    historia2?.length === 3 &&
      historia2[2].event === "granted" &&
      (await acepta(clienteId)) === true,
    historia2?.map((h) => h.event).join(" → "),
  );

  // ── 9. La puerta cerrada ───────────────────────────────────────────────
  const fuera = [
    ["record_client_whatsapp_consent", { p_token: token, p_consent_text: "pirata" }],
    ["revoke_client_whatsapp_consent", { p_token: token }],
    ["client_whatsapp_consent_state", { p_token: token }],
    ["client_accepts_whatsapp", { p_client_id: clienteId }],
  ];
  for (const [fn, args] of fuera) {
    const { error } = await anon.rpc(fn, args);
    check(`9. anon NO puede llamar a ${fn}()`, error !== null, error?.message?.slice(0, 60));
  }

  const { error: eLectura } = await anon.from("client_whatsapp_consents").select("phone").limit(1);
  check("9b. anon NO puede leer la tabla de permisos", eLectura !== null, eLectura?.message?.slice(0, 60));

  const { data: pirata } = await admin
    .from("client_whatsapp_consents")
    .select("id")
    .eq("consent_text", "pirata");
  check("9c. y el intento de anon no escribió nada", (pirata?.length ?? 0) === 0);
} finally {
  // Borra exactamente lo que creó, por id. El cliente se lleva su enlace por
  // cascada; las filas de permiso NO cuelgan del cliente a propósito (su
  // via_client_id queda null), así que se borran por teléfono.
  if (clienteId) await admin.from("clients").delete().eq("id", clienteId);
  await admin.from("client_whatsapp_consents").delete().in("phone", [TELEFONO, TELEFONO_EDITADO]);

  const { count: quedan } = await admin
    .from("client_whatsapp_consents")
    .select("id", { count: "exact", head: true })
    .in("phone", [TELEFONO, TELEFONO_EDITADO]);
  const { count: clientesQuedan } = clienteId
    ? await admin.from("clients").select("id", { count: "exact", head: true }).eq("id", clienteId)
    : { count: 0 };
  check("10. limpieza: no queda nada de la prueba en dev", quedan === 0 && clientesQuedan === 0);

  const fallos = filas.filter((f) => !f.pasa).length;
  console.log(`\n${filas.length - fallos}/${filas.length} pasan.`);
  if (fallos) process.exitCode = 1;
}
