import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(".env.local","utf8").split(/\r?\n/)
  .filter(l=>l.includes("=")&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");
  return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,"")];}));
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
if (ref !== "vzqppwrwnmlbrxizskdh") { console.error("no es dev"); process.exit(1); }
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth:{persistSession:false} });
const { data: o } = await admin.from("owners").select("id").eq("business_name","Negocio prueba DEV").single();
const { data: cs } = await admin.from("clients").select("id").eq("owner_id", o.id).is("trashed_at", null).limit(40);
let fiado = null;
for (const c of cs ?? []) {
  const { data: r } = await admin.rpc("get_open_charges_for_client", { p_client_id: c.id });
  if ((r ?? []).length) { fiado = r[0].movement_id; break; }
}
if (!fiado) { console.error("sin fiados abiertos"); process.exit(1); }
const us = await admin.auth.admin.listUsers({ perPage: 200 });
const correo = us.data.users.find(u=>u.id===o.id)?.email;
const { data: link } = await admin.auth.admin.generateLink({ type:"magiclink", email: correo });
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth:{persistSession:false} });
const { data: v } = await anon.auth.verifyOtp({ type:"magiclink", token_hash: link.properties.hashed_token });
const nombre = `sb-${ref}-auth-token`;
const valor = "base64-" + Buffer.from(JSON.stringify(v.session),"utf8").toString("base64url");
const MAX = 3180;
const cookie = (valor.length<=MAX ? [`${nombre}=${valor}`]
  : Array.from({length:Math.ceil(valor.length/MAX)},(_,i)=>`${nombre}.${i}=${valor.slice(i*MAX,(i+1)*MAX)}`)).join("; ");
const U = `https://dev.sevenz.site/abonos/nuevo/${fiado}/monto`;
for (let i=1;i<=22;i++){
  const r = await fetch(U+"?cb="+Date.now(), { headers:{ Cookie: cookie, "Cache-Control":"no-store" } });
  const h = await r.text();
  const vive = !/This page could not be found/.test(h);
  console.log("intento",i,"|", vive ? "DESPLEGADA" : "todavia 404");
  if (vive) break;
  await new Promise(x=>setTimeout(x,30000));
}
