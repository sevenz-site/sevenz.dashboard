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
import { consentPhoneKey } from "@/lib/phone";

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
      // DOS CAUSAS QUE NO SE PARECEN EN NADA, y hasta el 2026-10-09 este
      // bloque culpaba siempre a la primera. Un "fetch failed" de red salió
      // como "falta la migración 081" estando la 081 corrida — mandar a buscar
      // donde no es cuesta más que no decir nada.
      const noExiste = /PGRST202|could not find|does not exist|schema cache/i.test(error.message);
      console.error(
        noExiste
          ? `\nFALTA LA MIGRACIÓN 081: ${error.message}\nCórrela en la rama DEV (vzqppwrwnmlbrxizskdh) y vuelve a intentarlo.`
          : `\nNO PUDE HABLAR CON LA BASE DE DATOS: ${error.message}\nEsto NO dice nada sobre si la migración está corrida. Comprueba la conexión y reintenta.`,
      );
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

  // ── 8 bis. DE DONDE SALIO CADA PERMISO (migracion 091, MS-34) ───────
  //
  // Lo que las pruebas de arriba NO pueden ver: todas pasan por el camino del
  // cliente, que escribe `client_self` siempre. La via del tendero es nueva y
  // hasta aqui no la habia llamado nadie.
  //
  // Se prueba lo que puede hacer dano, no lo que es comodo de probar:
  //   - que un tendero NO pueda escribir un permiso para el cliente de otro.
  //     `p_client_id` llega del navegador y aqui RLS no vigila nada (security
  //     definer sobre una tabla con cero politicas), asi que el predicado de
  //     `owner_id` dentro de la funcion es la unica defensa de la base.
  //   - que NO pueda marcar `client_self`. Si pudiera, el camino debil
  //     escribiria la etiqueta fuerte y la columna dejaria de medir nada.
  //   - que no pueda DEGRADAR un permiso que el cliente ya se dio solo.
  const historiaDe = async (tel) =>
    (
      await admin
        .from("client_whatsapp_consents")
        .select("event, source, occurred_at, id")
        .eq("phone", tel)
        .order("occurred_at", { ascending: true })
        .order("id", { ascending: true })
    ).data ?? [];

  const declara = async (clientId, ownerId, texto, source) =>
    (
      await admin.rpc("record_owner_declared_whatsapp_consent", {
        p_client_id: clientId,
        p_owner_id: ownerId,
        p_consent_text: texto,
        p_source: source,
      })
    ).data;

  // Partimos de limpio: el bloque 8 dejo granted -> revoked -> granted.
  await admin.from("client_whatsapp_consents").delete().eq("phone", TELEFONO);

  const TEXTO_TENDERO = "QA 091: Pedro acepta recibir avisos de su saldo por WhatsApp.";

  check(
    "11a. el tendero declara el permiso de SU cliente: true",
    (await declara(clienteId, owners[0].id, TEXTO_TENDERO, "owner_movement_form")) === true,
  );

  const h1 = await historiaDe(TELEFONO);
  check(
    "11b. y la fila queda marcada con SU origen, no con client_self",
    h1.length === 1 && h1[0].event === "granted" && h1[0].source === "owner_movement_form",
    h1.map((h) => `${h.event}/${h.source}`).join(" \u2192 "),
  );

  check("11c. y la puerta de envio dice SI", (await acepta(clienteId)) === true);

  check(
    "11d. la misma casilla marcada otra vez NO escribe una segunda fila",
    (await declara(clienteId, owners[0].id, TEXTO_TENDERO, "owner_movement_form")) === true &&
      (await historiaDe(TELEFONO)).length === 1,
    `filas: ${(await historiaDe(TELEFONO)).length}`,
  );

  check(
    "11e. el origen de la libreta tambien vale",
    (await declara(clienteId, owners[0].id, `${TEXTO_TENDERO} (libreta)`, "owner_import")) === true &&
      (await historiaDe(TELEFONO)).some((h) => h.source === "owner_import"),
  );

  // ── lo que NO debe poder hacer ─────────────────────────────────
  const antesDelAtaque = (await historiaDe(TELEFONO)).length;

  // Un uuid que no es dueno de nadie. Es el ataque realista: un tendero con
  // sesion valida pasando el id de un cliente que no es suyo.
  const OTRO_DUENO = "00000000-0000-4000-8000-000000000000";
  check(
    "11f. un dueno que NO es el suyo: false",
    (await declara(clienteId, OTRO_DUENO, TEXTO_TENDERO + " ajeno", "owner_movement_form")) === false,
  );

  check(
    "11g. y NO escribio nada",
    (await historiaDe(TELEFONO)).length === antesDelAtaque,
    `filas: ${(await historiaDe(TELEFONO)).length} (antes ${antesDelAtaque})`,
  );

  check(
    "11h. el tendero NO puede marcar client_self: false",
    (await declara(clienteId, owners[0].id, TEXTO_TENDERO + " falso", "client_self")) === false,
  );

  check(
    "11i. ni un origen inventado",
    (await declara(clienteId, owners[0].id, TEXTO_TENDERO + " raro", "lo_que_sea")) === false,
  );

  check(
    "11j. ni un texto vacio: la evidencia no puede estar en blanco",
    (await declara(clienteId, owners[0].id, "   ", "owner_movement_form")) === false,
  );

  check(
    "11k. y despues de los cuatro intentos, la tabla sigue igual",
    (await historiaDe(TELEFONO)).length === antesDelAtaque,
    `filas: ${(await historiaDe(TELEFONO)).length} (antes ${antesDelAtaque})`,
  );

  // ── que no degrade lo que el cliente se dio solo ──────────────────
  await admin.from("client_whatsapp_consents").delete().eq("phone", TELEFONO);
  await admin.rpc("record_client_whatsapp_consent", { p_token: token, p_consent_text: TEXTO });

  check(
    "11l. si el cliente ya acepto solo, la casilla del tendero no lo pisa",
    (await declara(clienteId, owners[0].id, TEXTO, "owner_movement_form")) === true &&
      (await historiaDe(TELEFONO)).every((h) => h.source === "client_self"),
    (await historiaDe(TELEFONO)).map((h) => `${h.event}/${h.source}`).join(" \u2192 "),
  );

  // ── la columna misma ─────────────────────────────────────
  // Nada puede entrar sin origen. Se intenta por la puerta de atras -- un
  // insert directo con la clave de servicio -- porque las funciones ya lo
  // rellenan y nunca probarian el not null.
  const { error: eSinSource } = await admin
    .from("client_whatsapp_consents")
    .insert({ phone: TELEFONO, event: "granted", consent_text: "sin origen" });
  check(
    "11m. una fila sin `source` es imposible, venga de donde venga",
    eSinSource !== null,
    eSinSource?.message?.slice(0, 50),
  );

  // ── 12. DOS FICHAS, UN SOLO TELEFONO ──────────────────────────
  //
  // Pedro y el hijo de Pedro comparten telefono. Son dos fichas en la misma
  // bodega y una sola persona a la que escribirle, asi que el permiso tiene
  // que ser el mismo para las dos: si Pedro dijo que si, no hay a quien
  // volver a preguntarle, y si Pedro se da de baja, no se le puede seguir
  // escribiendo por la ficha del hijo.
  //
  // NO ES UN CASO RARO. Medido en dev el 2026-10-10: 32 clientes vivos con
  // numero y solo 16 telefonos distintos -- la mitad de las fichas comparten
  // numero con otra, y un numero lo comparten NUEVE. Es la situacion normal
  // de un barrio, no una esquina del dominio.
  //
  // Sale gratis porque la 081 eligio el telefono normalizado como clave en vez
  // de columnas en `clients`, y esto lo deja clavado: cambiar esa clave por
  // algo por ficha rompe estas tres y dice por que.
  let hijoId = null;
  try {
    const { data: hijo } = await admin
      .from("clients")
      .insert({ owner_id: owners[0].id, name: "QA 091 mismo numero", whatsapp: TELEFONO })
      .select("id")
      .single();
    hijoId = hijo?.id ?? null;

    // El bloque 11 dejo a TELEFONO con un `granted` de `client_self`.
    check(
      "12a. una ficha NUEVA con el mismo numero hereda el permiso, sin preguntar",
      (await acepta(hijoId)) === true,
    );

    await admin.rpc("revoke_client_whatsapp_consent", { p_token: token });

    check(
      "12b. y una baja desde ese numero apaga LAS DOS fichas",
      (await acepta(clienteId)) === false && (await acepta(hijoId)) === false,
    );

    // Lo que NO comparten: a quien se le ha preguntado ya. Es estado de
    // interfaz por ficha (093), no evidencia por persona, y por eso vive en
    // `clients`. La consecuencia esta anotada en MS-34.
    const { data: fichas } = await admin
      .from("clients")
      .select("whatsapp_consent_asked_at")
      .in("id", [clienteId, hijoId]);
    check(
      "12c. pero `asked_at` NO se comparte: es por ficha, no por persona",
      (fichas ?? []).every((f) => f.whatsapp_consent_asked_at === null),
      "las dos sin preguntar: la casilla saldria dos veces por el mismo telefono",
    );
  } finally {
    if (hijoId) await admin.from("clients").delete().eq("id", hijoId);
  }

  // ── 13. EL ESPEJO EN JS NO SE SEPARA DE POSTGRES ──────────────────
  //
  // `consentPhoneKey` en lib/phone.ts copia la regla de
  // `normalize_whatsapp_phone()`, porque la pantalla tiene que saber si marcar
  // la casilla va a servir de algo y no puede preguntarselo a Postgres en cada
  // tecla. Dos copias de una regla acaban discrepando, y la discrepancia aqui
  // seria una casilla que se ve funcional y no escribe nada -- o un aviso rojo
  // sobre un numero perfectamente bueno.
  //
  // Los casos cortos no son inventados: "581", "582", "583" y "570" son
  // telefonos REALES de 19 clientes de produccion, medidos el 2026-10-12. Un
  // prefijo y un digito suelto, de alguien que empezo a teclear y guardo.
  const casosClave = [
    "581",
    "582",
    "583",
    "570",
    "",
    "0",
    "abc",
    "4149900094",
    "04149900094",
    "584149900094",
    "+58 414-9900094",
    "58416111111",
    "571234567890",
    "573238130265",
    "1234567890123456",
  ];
  const discrepan = [];
  for (const caso of casosClave) {
    const { data: sql } = await admin.rpc("normalize_whatsapp_phone", { p_raw: caso });
    const js = consentPhoneKey(caso);
    if ((sql ?? null) !== js) {
      discrepan.push(caso + ": sql=" + JSON.stringify(sql) + " js=" + JSON.stringify(js));
    }
  }
  check(
    "13. consentPhoneKey (JS) y normalize_whatsapp_phone (SQL) coinciden",
    discrepan.length === 0,
    discrepan.length ? discrepan.join(" | ") : casosClave.length + " casos iguales",
  );

  // ── 9. La puerta cerrada ───────────────────────────────────────────────
  const fuera = [
    ["record_client_whatsapp_consent", { p_token: token, p_consent_text: "pirata" }],
    ["revoke_client_whatsapp_consent", { p_token: token }],
    // La via del tendero NO lleva token: su credencial es el dueno
    // autenticado. Si anon pudiera llamarla, bastaria adivinar dos uuid para
    // escribir un permiso a nombre de un desconocido.
    [
      "record_owner_declared_whatsapp_consent",
      {
        p_client_id: clienteId,
        p_owner_id: owners[0].id,
        p_consent_text: "pirata",
        p_source: "owner_movement_form",
      },
    ],
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
