import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(".env.local","utf8").split(/\r?\n/).filter(l=>l.includes("=")&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,"")];}));
if (!env.NEXT_PUBLIC_SUPABASE_URL.includes("vzqppwrwnmlbrxizskdh")) { console.error("PARADA: no es dev"); process.exit(1); }
const svc  = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
let fallos = 0;
const check = (n, ok, d) => { if (!ok) fallos++; console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); };

const OWNER = "ce68896a-3965-48d4-9734-6e4f6e697781";
const TOKEN = "cfccd0e6914360872815b8cf0cbad636";
const { data: prod } = await svc.from("products").select("id,name,base_currency_retail,price_retail")
  .eq("owner_id", OWNER).is("trashed_at", null).eq("published_retail", true).not("price_retail","is",null).limit(1).maybeSingle();
if (!prod) { console.error("sin producto publicado al detal en dev"); process.exit(1); }
console.log("producto:", prod.name, "| base detal:", prod.base_currency_retail, "| precio:", prod.price_retail, "\n");

const base = { p_token: TOKEN, p_customer_name:"QA 157", p_customer_document:"157157157", p_customer_document_type:"V",
  p_customer_whatsapp:"584140000157", p_wants_notices:false, p_consent_text:"prueba 157",
  p_items:[{ product_id: prod.id, quantity:1, currency: prod.base_currency_retail ?? "USD", comment:null }] };

// LA LLAMADA QUE HACE PRODUCCION AHORA MISMO: ocho argumentos con nombre.
const { data: r8, error: e8 } = await anon.rpc("create_catalog_order", base);
check("4. LA LLAMADA DE 8 ARGUMENTOS RESUELVE (lo que hace prod)", !e8 && r8?.ok === true, e8?.message ?? JSON.stringify(r8));

const { data: r9, error: e9 } = await anon.rpc("create_catalog_order", { ...base, p_customer_address: "Calle 56 #1200-56" });
check("5. la llamada de 9 argumentos resuelve", !e9 && r9?.ok === true, e9?.message ?? JSON.stringify(r9));

if (r9?.order_id) {
  const { data: o } = await svc.from("catalog_orders").select("customer_address, sale_id, registered_at, customer_document_type").eq("id", r9.order_id).single();
  check("6. la direccion quedo guardada tal cual", o?.customer_address === "Calle 56 #1200-56", JSON.stringify(o?.customer_address));
  check("7. sale_id y registered_at nacen vacios", o?.sale_id === null && o?.registered_at === null);
  check("8. la letra del documento sigue entrando (la 155 intacta)", o?.customer_document_type === "V", JSON.stringify(o?.customer_document_type));
  const { data: li } = await svc.from("catalog_order_items").select("product_name, quantity, unit_price, currency, tier").eq("order_id", r9.order_id);
  check("9. las lineas se guardaron: los candados del nucleo siguen enteros", (li??[]).length === 1, JSON.stringify(li));
}
if (r8?.order_id) {
  const { data: o } = await svc.from("catalog_orders").select("customer_address").eq("id", r8.order_id).single();
  check("10. sin direccion queda null, no cadena vacia", o?.customer_address === null, JSON.stringify(o?.customer_address));
}
const { data: r0, error: e0 } = await anon.rpc("create_catalog_order", { ...base, p_token: "__token_que_no_existe__" });
check("11. un enlace invalido se sigue rechazando", !e0 && r0?.ok === false, e0?.message ?? JSON.stringify(r0));
const { data: rAjeno, error: eA } = await anon.rpc("create_catalog_order", { ...base, p_items:[{ product_id: "b2d935f4-f6e8-4859-a290-792cab959ebe", quantity:1, currency:"USD", comment:null }] });
check("12. un producto de OTRO dueño se sigue rechazando", !eA && rAjeno?.ok === false, eA?.message ?? JSON.stringify(rAjeno));

for (const id of [r8?.order_id, r9?.order_id, rAjeno?.order_id].filter(Boolean)) await svc.from("catalog_orders").delete().eq("id", id);
console.log("\npedidos de prueba borrados de dev");
console.log(fallos === 0 ? "TODO PASA" : `${fallos} FALLOS`);
process.exit(fallos ? 1 : 0);
