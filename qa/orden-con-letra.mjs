// ¿LA LETRA DEL DOCUMENTO LLEGA HASTA UNA ORDEN DEL CATÁLOGO?
//
// Encargo del dueño el 2026-10-24: el selector en el formulario público. La
// migración `155` añadió `catalog_orders.customer_document_type` y rehízo
// `create_catalog_order` con un argumento más.
//
// CORRE POR EL CAMINO ANÓNIMO, con la clave `anon` y no con la de servicio, y
// eso es la mitad del valor de esta suite: `create_catalog_order` es la ÚNICA
// escritura de Sevenz sin sesión detrás, así que probarla con la clave de
// servicio comprobaría un camino que ningún cliente recorre. Es la misma
// razón por la que `qa:pedidos` lee como el dueño.
//
// LOS TRES CASOS, y el que importa no es el primero:
//
//   · una letra válida se guarda;
//   · una que NO corresponde al país ('NIT' desde una bodega venezolana) se
//     descarta a null **y la orden pasa igual** — la letra es un adorno del
//     documento, no el documento, y tumbar la compra de alguien por eso sería
//     cobrarle el error de otro;
//   · sin letra, la orden entra como siempre: todo pedido anterior a la `155`
//     no tiene ninguna y nadie se la va a inventar.
//
// Y COMPRUEBA QUE LA FIRMA VIEJA YA NO EXISTE. Postgres sobrecarga por tipos:
// si la de siete argumentos sobreviviera, PostgREST resolvería las llamadas a
// cualquiera de las dos y la letra se perdería según el día.
//
// Publica un producto temporalmente si en dev no hay ninguno, y lo restaura.
// Borra sus propias órdenes al terminar.
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });
const U = process.env.NEXT_PUBLIC_SUPABASE_URL;
const db = createClient(U, process.env.SUPABASE_SERVICE_ROLE_KEY);
const anon = createClient(U, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
let n=0, ok=0;
const t=(titulo,real,esp)=>{n++;const p=String(real)===String(esp);if(p)ok++;console.log(`${p?"PASS":"FAIL"}  ${titulo}  — ${real}  (esperado ${esp})`);};

// 1 · el esquema
const { data: led } = await db.from("schema_migrations").select("key").eq("key","155_el_pedido_guarda_la_letra");
t("1. el apunte 155 esta en el ledger de dev", (led??[]).length, 1);
const { error: eCol } = await db.from("catalog_orders").select("customer_document_type").limit(1);
t("2. la columna customer_document_type existe", eCol?("ERROR "+eCol.code):"si", "si");

// 2 · la firma vieja ya no responde, la nueva si
const vieja = await anon.rpc("create_catalog_order",{p_token:"x",p_customer_name:"x",p_customer_document:"1",p_customer_whatsapp:"",p_wants_notices:false,p_consent_text:null,p_items:[]});
t("3. la firma de 7 argumentos ya NO existe", vieja.error? vieja.error.code : "sigue viva", "PGRST202");

// 3 · una orden de verdad, por el camino anonimo
// Se elige el enlace cuyo dueño SÍ tiene producto publicado, no el primero.
const { data: enlaces } = await db.from("catalog_share_links").select("token, owner_id");
let link=null, prod=null, o=null;
for (const e of enlaces ?? []) {
  const { data: pr } = await db.from("products").select("id").eq("owner_id", e.owner_id).eq("published_retail", true).limit(1).maybeSingle();
  if (pr) { link=e; prod=pr; const { data: ow } = await db.from("owners").select("country").eq("id", e.owner_id).single(); o=ow; break; }
}
// Ninguno publicado en dev: se publica uno para la prueba y se restaura.
let restaurar = null;
if (!link) {
  for (const e of enlaces ?? []) {
    const { data: pr } = await db.from("products").select("id, published_retail").eq("owner_id", e.owner_id).limit(1).maybeSingle();
    if (pr) {
      await db.from("products").update({ published_retail: true }).eq("id", pr.id);
      restaurar = { id: pr.id, antes: pr.published_retail };
      link = e; prod = pr;
      const { data: ow } = await db.from("owners").select("country").eq("id", e.owner_id).single(); o = ow;
      console.log("(se publico temporalmente un producto para la prueba)");
      break;
    }
  }
}
if (!link) { console.log("NO hay con que probar en dev"); process.exit(1); }
const pedir = async (tipo) => {
  const r = await anon.rpc("create_catalog_order", {
    p_token: link.token, p_customer_name: "ZZ QA letra", p_customer_document: "70707077",
    p_customer_document_type: tipo, p_customer_whatsapp: "584141234567", p_wants_notices: false,
    p_consent_text: null, p_items: [{ product_id: prod.id, quantity: 1, currency: "USD", comment: null }],
  });
  if (r.error) return { err: r.error.message };
  if (!r.data?.ok) return { err: "rpc: " + r.data?.reason };
  const { data: fila } = await db.from("catalog_orders").select("id, customer_document_type").eq("id", r.data.order_id ?? r.data.id).maybeSingle();
  return fila ?? { err: "no se encontro la fila: " + JSON.stringify(r.data).slice(0,90) };
};
console.log(`\n(negocio del enlace: pais=${o.country})`);
const a = await pedir("V");
t("4. una orden con letra V la guarda", a.err ?? a.customer_document_type, o.country==="VE" ? "V" : "null");
const b = await pedir("NIT");
t("5. un NIT desde ese negocio se descarta a null, y la orden PASA", b.err ?? String(b.customer_document_type), o.country==="VE" ? "null" : "NIT");
const c = await pedir(null);
t("6. sin letra, la orden entra igual", c.err ?? String(c.customer_document_type), "null");
const ids=[a.id,b.id,c.id].filter(Boolean);
await db.from("catalog_order_items").delete().in("order_id", ids);
await db.from("catalog_orders").delete().in("id", ids);
if (restaurar) await db.from("products").update({ published_retail: restaurar.antes }).eq("id", restaurar.id);
const { data: quedan } = await db.from("catalog_orders").select("id").like("customer_name","ZZ QA letra%");
console.log(`\nlimpieza: quedan ${(quedan??[]).length}`);
console.log(`\n${ok}/${n} pasan.`);
