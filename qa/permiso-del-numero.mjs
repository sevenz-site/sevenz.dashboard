// SOLO LA RAMA DEV (vzqppwrwnmlbrxizskdh) — lee .env.local.
//
// Prueba `whatsapp_consent_for_phone(text)`, la función de la migración `135`
// que permite a los formularios de alta decir «este número ya recibe
// notificaciones» en vez de enseñar una casilla desmarcada.
//
// NO ESCRIBE NADA. Lee el registro de consentimientos y las fichas que ya
// existen en dev, así que se puede correr tantas veces como haga falta.
//
// ===========================================================================
// SE CORRE COMO EL TENDERO, Y ESO NO ES UN DETALLE
//
// La función es `security definer`, pero quien la llama es el dueño desde su
// sesión: la clave de servicio daría `auth.uid() is null` y la función se
// niega, así que una suite escrita con esa clave vería SIEMPRE «no acepta» y
// pasaría en verde con los tres formularios rotos. Es la regla de `CLAUDE.md`
// —«una suite que cubre lo que el dueño lee tiene al menos un control que corre
// como el dueño»— aplicada al caso que la hace obvia.
//
// ===========================================================================
// LO QUE VIGILA, Y POR QUÉ CADA COSA
//
//   1. Las dos guardas: anon no puede llamarla, y con la clave de servicio se
//      niega. Sin la primera, cualquiera podría sondear el registro número a
//      número y averiguar qué teléfonos son clientes de Sevenz.
//
//   2. Que un número propio que concede devuelva SU NOMBRE. Es lo que el dueño
//      pidió el 2026-10-21: «se debería mencionar que el número ya se encuentra
//      registrado a <nombre del cliente>».
//
//   3. **Que un número de OTRA bodega NO devuelva nombre.** Es la frontera de
//      privacidad de toda esta migración y la única afirmación aquí que no se
//      puede comprobar leyendo la pantalla: las dos frases se parecen, y la que
//      sobra —la que nombra a un cliente de otro negocio— solo se distingue
//      sabiendo de quién es la ficha. Si alguien «simplifica» la consulta del
//      nombre quitándole el `owner_id = auth.uid()`, TODO seguiría funcionando
//      y esta fila es lo único que se pondría roja.
//
//   4. Que un número sin consentimiento, y uno ilegible, respondan que no.
//      Fallar cerrado enseña la casilla, y que te pregunten dos veces se
//      arregla; un mensaje que nadie aceptó, no.
//
//   5. Que coincida con `client_accepts_whatsapp`, que es la que de verdad
//      abre la puerta de envío. Las dos leen la misma tabla por la misma clave
//      y por eso no pueden discrepar — pero «no pueden» es un razonamiento, y
//      esto es la comprobación.
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
  console.error(`REFUSING TO RUN. .env.local apunta a "${ref}", no a la rama dev (${DEV_REF}).`);
  process.exit(1);
}

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

const filas = [];
const check = (nombre, pasa, detalle) => {
  filas.push({ nombre, pasa });
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${detalle ? `  — ${detalle}` : ""}`);
};

// ── las dos guardas ─────────────────────────────────────────────────────
{
  const { error } = await anon.rpc("whatsapp_consent_for_phone", { p_phone: "584141111111" });
  check("anon NO puede llamar a whatsapp_consent_for_phone()", !!error, error ? error.code : "LO CONSIGUIO");
}
{
  const { data, error } = await admin.rpc("whatsapp_consent_for_phone", { p_phone: "584141111111" });
  check(
    "con la clave de servicio se niega: auth.uid() es nulo",
    !error && data?.granted === false && data?.client_name === null,
    error ? error.message : JSON.stringify(data),
  );
}

// ── quién concede hoy en dev, y de quién es cada ficha ───────────────────
//
// Los casos NO están escritos a mano. Se eligen de lo que dev tenga en este
// momento, porque una lista de números fijos deja de probar nada el día que
// alguien borre una ficha — y lo haría en silencio, pasando en verde.
const { data: consents } = await admin
  .from("client_whatsapp_consents")
  .select("phone, event, occurred_at")
  .order("occurred_at", { ascending: false });
const ultimo = new Map();
for (const c of consents ?? []) if (!ultimo.has(c.phone)) ultimo.set(c.phone, c.event);
const conceden = [...ultimo].filter(([, e]) => e === "granted").map(([p]) => p);

const { data: fichas } = await admin
  .from("clients")
  .select("id, name, whatsapp, owner_id, created_at")
  .not("whatsapp", "is", null)
  .is("trashed_at", null)
  .is("deleted_at", null);

// SE PREGUNTA A LA BASE, no se reimplementa aquí. Una copia de la regla en
// este archivo sería una tercera versión de la misma decisión --ya hay dos,
// `normalize_whatsapp_phone` y `consentPhoneKey`-- y una prueba que compara
// el producto contra su propia copia de la regla pasa en verde cuando las dos
// están equivocadas igual.
const normaliza = async (t) => {
  const { data } = await admin.rpc("normalize_whatsapp_phone", { p_raw: t ?? "" });
  return data;
};

// ── la sesión del tendero ────────────────────────────────────────────────
const EMAIL = process.env.QA_OWNER_EMAIL ?? "contactojesusdelgado@gmail.com";
const { data: link, error: eLink } = await admin.auth.admin.generateLink({
  type: "magiclink",
  email: EMAIL,
});
if (eLink) {
  console.error("no se pudo emitir la sesión:", eLink.message);
  process.exit(1);
}
const { data: ses, error: eOtp } = await anon.auth.verifyOtp({
  type: "magiclink",
  token_hash: link.properties.hashed_token,
});
if (eOtp) {
  console.error("verifyOtp:", eOtp.message);
  process.exit(1);
}
const dueno = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
  global: { headers: { Authorization: `Bearer ${ses.session.access_token}` } },
});
const ownerId = ses.user.id;
console.log(`\ndueño de prueba: ${EMAIL} (${ownerId.slice(0, 8)})\n`);

// ===========================================================================
// LOS DOS CASOS SE ELIGEN, NO SE TOMA EL PRIMERO QUE APAREZCA
//
// Esto fue un fallo el 2026-10-21, después de que la migración `136` reparara
// las claves: el primer número que concedía resultó estar en OCHO fichas mías
// y una ajena a la vez, así que «el nombre que vuelve» no era comparable con
// «la ficha que encontré primero», y las dos filas fallaron sin que el
// producto tuviera nada mal.
//
// Para que cada fila afirme lo suyo hacen falta dos números distintos:
//
//   EL PROPIO  -> al menos una ficha mía. El nombre que la función devuelve
//                 es el de la MÁS ANTIGUA de las mías, que es su contrato
//                 escrito, así que eso es lo que se compara.
//   EL AJENO   -> CERO fichas mías y al menos una de otro dueño. Si tengo una
//                 ficha con ese número, que vuelva mi nombre es correcto y la
//                 fila no probaría la frontera.
const porNumero = new Map();
for (const f of fichas ?? []) {
  const k = await normaliza(f.whatsapp);
  if (!k || !conceden.includes(k)) continue;
  if (!porNumero.has(k)) porNumero.set(k, []);
  porNumero.get(k).push(f);
}

let mia = null;
let ajena = null;
for (const [, lista] of porNumero) {
  const mias = lista
    .filter((f) => f.owner_id === ownerId)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  if (!mia && mias.length) mia = mias[0];
  if (!ajena && mias.length === 0 && lista.length) ajena = lista[0];
}

// ── 2. un número PROPIO que concede: sale con su nombre ──────────────────
if (!mia) {
  check("hay una ficha propia con número que concede, para probar el caso con nombre", false, "no hay ninguna en dev");
} else {
  const { data, error } = await dueno.rpc("whatsapp_consent_for_phone", { p_phone: mia.whatsapp });
  check(
    `número propio que concede devuelve granted y el nombre de mi ficha MÁS ANTIGUA con ese número («${mia.name}»)`,
    !error && data?.granted === true && data?.client_name === mia.name,
    error ? error.message : JSON.stringify(data),
  );
}

// ── 3. un número de OTRA bodega: concede, pero SIN nombre ────────────────
//
// La fila que justifica el archivo. Ver la cabecera.
if (!ajena) {
  check("hay una ficha de otro dueño con número que concede, para probar la frontera", false, "no hay ninguna en dev");
} else {
  const { data, error } = await dueno.rpc("whatsapp_consent_for_phone", { p_phone: ajena.whatsapp });
  check(
    "número de OTRA bodega: concede pero NO viaja el nombre",
    !error && data?.granted === true && data?.client_name === null,
    error ? error.message : `${JSON.stringify(data)} (la ficha ajena se llama "${ajena.name}")`,
  );
}

// ── 3b. EL CONTROL DE LA FILA ANTERIOR, y hace tanta falta como ella ─────
//
// Sin esto, la fila 3 pasa igual si el nombre no se encuentra NUNCA — porque
// el teléfono de la ficha está escrito de otra forma, porque la consulta tiene
// una errata, porque el `where` no casa con nada. Una prueba que afirma «no
// sale el nombre» y no demuestra que ese nombre SÍ sale cuando debe no está
// comprobando el filtro: está comprobando que algo falla.
//
// Así que se pide el mismo número desde la sesión de SU dueño, y ahí el nombre
// tiene que aparecer. Si las dos filas pasan, lo que separa una respuesta de la
// otra es exactamente el `owner_id = auth.uid()`.
if (ajena) {
  const { data: linkB, error: eB } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: (await admin.auth.admin.getUserById(ajena.owner_id)).data.user.email,
  });
  if (eB) {
    check("control: el dueño de la ficha ajena SÍ ve su nombre", false, eB.message);
  } else {
    const { data: sesB, error: eOtpB } = await anon.auth.verifyOtp({
      type: "magiclink",
      token_hash: linkB.properties.hashed_token,
    });
    if (eOtpB) {
      check("control: el dueño de la ficha ajena SÍ ve su nombre", false, eOtpB.message);
    } else {
      const otro = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
        auth: { persistSession: false },
        global: { headers: { Authorization: `Bearer ${sesB.session.access_token}` } },
      });
      const { data, error } = await otro.rpc("whatsapp_consent_for_phone", { p_phone: ajena.whatsapp });
      check(
        `control: el dueño de esa ficha SÍ ve el nombre (${ajena.name})`,
        !error && data?.client_name === ajena.name,
        error ? error.message : JSON.stringify(data),
      );
    }
  }
}

// ── 4. lo que debe responder que NO ──────────────────────────────────────
{
  // Un número con la forma correcta que no está en el registro. Se construye
  // buscando uno libre en vez de escribirlo fijo: un literal podría recibir un
  // consentimiento mañana y esta fila empezaría a fallar sin que nada cambie.
  let libre = null;
  for (let i = 0; i < 50 && !libre; i++) {
    const cand = `58414${String(1000000 + i).padStart(7, "0")}`;
    if (!ultimo.has(cand)) libre = cand;
  }
  const { data, error } = await dueno.rpc("whatsapp_consent_for_phone", { p_phone: libre });
  check(
    "número sin consentimiento responde que NO (se enseña la casilla)",
    !error && data?.granted === false && data?.client_name === null,
    error ? error.message : JSON.stringify(data),
  );
}
{
  const { data, error } = await dueno.rpc("whatsapp_consent_for_phone", { p_phone: "no-es-un-telefono" });
  check(
    "número ilegible falla CERRADO: responde que NO",
    !error && data?.granted === false,
    error ? error.message : JSON.stringify(data),
  );
}

// ── 5. coincide con la puerta de envío ───────────────────────────────────
if (mia) {
  const { data: puerta, error } = await dueno.rpc("client_accepts_whatsapp", { p_client_id: mia.id });
  const { data: nuestra } = await dueno.rpc("whatsapp_consent_for_phone", { p_phone: mia.whatsapp });
  check(
    "coincide con client_accepts_whatsapp(), que es la que abre la puerta",
    !error && puerta === nuestra?.granted,
    error ? error.message : `puerta=${puerta} formulario=${nuestra?.granted}`,
  );
}

const fallos = filas.filter((f) => !f.pasa).length;
console.log(`\n${fallos} FALLO(S) de ${filas.length}`);
process.exit(fallos === 0 ? 0 : 1);
