import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(".env.local","utf8").split(/\r?\n/).filter(l=>l.includes("=")&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,"")];}));
if(new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0]!=="vzqppwrwnmlbrxizskdh"){console.error("REFUSING TO RUN");process.exit(1);}
const db=createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const OWNER="3b6a7602-d031-4bda-a836-df0ef168dca8";
if (process.argv[2] === "limpiar") {
  await db.from("clients").delete().eq("owner_id",OWNER).like("name","Karina castillo%");
  console.log("limpiadas");
} else {
  for (const n of ["Karina castillo (negocio lomas)","Karina castillo (kari)"]) {
    await db.from("clients").insert({ owner_id: OWNER, name: n, document_id: "18356808", document_country: "VE" });
  }
  const { data } = await db.from("clients").select("id, name, document_id").eq("owner_id",OWNER).like("name","Karina castillo%");
  console.log(data);
}
