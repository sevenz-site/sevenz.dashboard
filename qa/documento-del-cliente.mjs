// ¿EL CLIENTE PUEDE GUARDAR SU PROPIO DOCUMENTO, CON SU LETRA?
//
// `submit_shared_document_id` es una de las DOS escrituras de Sevenz sin
// sesión detrás: la llama un visitante anónimo desde `/s/[token]`. La
// migración `156` le añadió un argumento para la letra.
//
// EL CONTROL QUE DE VERDAD IMPORTA ES EL DEL PERMISO. Cambiar la firma obliga
// a `drop function`, y un `drop` SE LLEVA LOS GRANTS. Sin volver a concederlo,
// el diálogo —que no se puede cerrar— respondería «No pudimos guardar tu
// cédula» a todos los clientes, y la migración no habría dado ni un error. Es
// la misma forma del fallo de la `108`, donde una política correcta sin grant
// dejó la pantalla de Pedidos vacía con tres pedidos dentro.
//
// Por eso corre con la clave `anon` y no con la de servicio.
//
// Crea su propio cliente de prueba con su enlace y los borra al terminar.
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
config({ path: ".env.local" });
const U = process.env.NEXT_PUBLIC_SUPABASE_URL;
const db = createClient(U, process.env.SUPABASE_SERVICE_ROLE_KEY);
const anon = createClient(U, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
let n = 0, ok = 0;
const t = (titulo, real, esp) => { n++; const p = String(real) === String(esp); if (p) ok++; console.log(`${p ? "PASS" : "FAIL"}  ${titulo}  — ${real}  (esperado ${esp})`); };

const { data: o } = await db.from("owners").select("id, country").eq("country", "VE").limit(1).single();
const hechos = [];
const nuevo = async () => {
  const { data: c } = await db.from("clients").insert({ owner_id: o.id, name: "ZZ QA doc cliente" }).select("id").single();
  const { data: sl } = await db.from("share_links").insert({ client_id: c.id, token: "zzqa" + Math.random().toString(16).slice(2, 14) }).select("token").single();
  hechos.push(c.id);
  return { id: c.id, token: sl.token };
};
const leer = async (id) => (await db.from("clients").select("document_id, document_type").eq("id", id).single()).data;

// 1 · anon sigue pudiendo llamarla: el grant sobrevivió al drop
const a = await nuevo();
const r1 = await anon.rpc("submit_shared_document_id", { p_token: a.token, p_document_id: "70707077", p_document_type: "J" });
t("1. anon puede llamarla (el grant sobrevivio al drop)", r1.error ? "NO: " + r1.error.code : "si", "si");
const f1 = await leer(a.id);
t("2. guarda los digitos", f1.document_id, "70707077");
t("3. y guarda la letra que eligio el cliente", f1.document_type, "J");

// 2 · una letra que no corresponde al pais se descarta, pero NO rechaza
const b = await nuevo();
await anon.rpc("submit_shared_document_id", { p_token: b.token, p_document_id: "80808088", p_document_type: "NIT" });
const f2 = await leer(b.id);
t("4. un NIT en un negocio venezolano se descarta a null...", String(f2.document_type), "null");
t("5. ...y el documento SE GUARDA igual (el dialogo no se puede cerrar)", f2.document_id, "80808088");

// 3 · nunca pisa uno ya guardado
const c = await nuevo();
await db.from("clients").update({ document_id: "11111111", document_type: "V" }).eq("id", c.id);
await anon.rpc("submit_shared_document_id", { p_token: c.token, p_document_id: "99999999", p_document_type: "E" });
const f3 = await leer(c.id);
t("6. NUNCA pisa un documento ya guardado", f3.document_id + "/" + f3.document_type, "11111111/V");

// 4 · sin letra, el documento entra igual
const d = await nuevo();
await anon.rpc("submit_shared_document_id", { p_token: d.token, p_document_id: "12121212", p_document_type: null });
const f4 = await leer(d.id);
t("7. sin letra, el documento entra igual", f4.document_id + "/" + String(f4.document_type), "12121212/null");

await db.from("share_links").delete().in("client_id", hechos);
await db.from("clients").delete().in("id", hechos);
const { data: quedan } = await db.from("clients").select("id").like("name", "ZZ QA doc cliente%");
console.log(`\nlimpieza: quedan ${(quedan ?? []).length}`);
console.log(`\n${ok}/${n} pasan.`);
process.exit(ok === n ? 0 : 1);
