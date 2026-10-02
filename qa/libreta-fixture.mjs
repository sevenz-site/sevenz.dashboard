// Fixture desechable para revisar "Subir libreta" a mano. SOLO RAMA DEV — lee
// .env.local, que apunta a la rama dev (vzqppwrwnmlbrxizskdh). Nunca apuntarlo a
// producción.
//
// Crea un dueño VENEZOLANO aislado, que es lo que no tenía ninguno de los
// fixtures que ya había: `papelera-fixture` crea uno colombiano, y en un negocio
// CO todo el aparato de moneda de esta pantalla —la modal, los dos radios, el
// selector por cliente, los dos totales de la cartera mixta— no se dibuja
// siquiera. Comprobar esa pantalla con un dueño CO es comprobar la mitad que no
// cambió.
//
// Y le pone dos clientes que cubren los caminos que el rediseño estrena:
//
//   QA Petronila   ya existe, con cédula Y con saldo en dólares. Es el caso de
//                  CT-19: cuando el cliente ya debe algo, la página no se puede
//                  dar por empezada en cero, así que el primer total escrito se
//                  gasta en deducir la base.
//   QA Juanito     ya existe pero SIN cédula. La revisión tiene que pedirla
//                  igual que a un cliente nuevo.
//
//   npm run qa:libreta:fixture            crearlo
//   npm run qa:libreta:fixture -- clean   borrarlo
//
// La contraseña es una constante fija para poder entrar por /login y revisar la
// pantalla a mano. Eso solo es seguro porque esta cuenta existe únicamente en la
// rama dev, no tiene nada más que sus propias filas generadas, y se borra y se
// recrea en cada corrida.
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

// Parada dura. Este script tiene la clave de servicio y crea y borra usuarios.
// Producción es rabmiyqodnvnrwiartuj; si .env.local llegara a apuntar ahí —a
// mitad de un debug, o en otra máquina— correrlo tocaría datos de clientes
// reales. Negarse por el ref del proyecto es gratis y el fallo que evita no se
// recupera.
const DEV_REF = "vzqppwrwnmlbrxizskdh";
const projectRef = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
if (projectRef !== DEV_REF) {
  console.error(
    `REFUSING TO RUN. .env.local apunta a "${projectRef}", no a la rama dev (${DEV_REF}).\n` +
      "Este script escribe con la clave de servicio y es solo para la rama dev.",
  );
  process.exit(1);
}

const EMAIL = "qa-libreta-ve@example.com";
const QA_PASSWORD = "LibretaQA!2026";
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data: existing } = await db.auth.admin.listUsers({ perPage: 1000 });
for (const u of existing.users.filter((u) => u.email === EMAIL)) {
  await db.auth.admin.deleteUser(u.id);
}
if (process.argv[2] === "clean") {
  console.log("cleaned");
  process.exit(0);
}

const { data: created, error: createError } = await db.auth.admin.createUser({
  email: EMAIL,
  password: QA_PASSWORD,
  email_confirm: true,
  user_metadata: {
    business_name: "QA Libreta VE",
    first_name: "QA",
    last_name: "Libreta",
    country: "VE",
    whatsapp: "+584121112233",
  },
});
if (createError) throw createError;
const ownerId = created.user.id;

// El trigger `on_auth_user_created` crea la fila de `owners`. Se comprueba en vez
// de suponerse: es justo lo que NO se clona al crear una rama de Supabase —la
// función sí, el trigger no—, y el síntoma sería un alta silenciosa sin dueño.
const { data: owner } = await db.from("owners").select("id, country").eq("id", ownerId).maybeSingle();
if (!owner) throw new Error("el trigger on_auth_user_created no creó la fila de owners");
if (owner.country !== "VE") throw new Error(`el dueño quedó como ${owner.country}, no VE`);

async function makeClient(name, documentId, movements) {
  const { data: c, error } = await db
    .from("clients")
    .insert({ owner_id: ownerId, name, document_id: documentId, whatsapp: null })
    .select("id")
    .single();
  if (error) throw error;
  if (movements.length > 0) {
    const { error: mError } = await db
      .from("movements")
      .insert(movements.map((m) => ({ client_id: c.id, created_by: ownerId, ...m })));
    if (mError) throw mError;
  }
  return c.id;
}

const petronila = await makeClient("QA Petronila", "V-9001101", [
  { type: "charge", amount: 40, currency: "USD", description: "Fiado anterior" },
]);
const juanito = await makeClient("QA Juanito", null, []);

console.log(
  JSON.stringify(
    {
      signIn: { email: EMAIL, password: QA_PASSWORD },
      ownerId,
      clients: { petronila, juanito },
    },
    null,
    2,
  ),
);
