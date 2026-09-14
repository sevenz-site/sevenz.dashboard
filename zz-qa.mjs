import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env=Object.fromEntries(readFileSync(".env.local","utf8").split(/\r?\n/).filter(l=>l.includes("=")&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")];}));
const db=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const {data:ex}=await db.auth.admin.listUsers({perPage:1000});
for(const u of ex.users.filter(u=>/^qa-(co|ve)-launch@example\.com$/.test(u.email??""))) await db.auth.admin.deleteUser(u.id);
const out={};
for(const [key,email,country,biz] of [["co","qa-co-launch@example.com","CO","QA CO Launch"],["ve","qa-ve-launch@example.com","VE","QA VE Launch"]]){
  const {data:c,error}=await db.auth.admin.createUser({email,password:"Prueba!Segura2026",email_confirm:true,
    user_metadata:{business_name:biz,first_name:key.toUpperCase(),last_name:"QA",country,whatsapp:country==="VE"?"+584141234567":"+573001112233"}});
  if(error) throw error;
  const {data:cl}=await db.from("clients").insert([{owner_id:c.user.id,name:`Cliente ${key.toUpperCase()}`,document_id:`1100${key==="co"?1:2}111`,whatsapp:"573001112233"}]).select("id").single();
  const movs = country==="VE"
    ? [{client_id:cl.id,type:"charge",amount:90,currency:"USD",description:"USD"},{client_id:cl.id,type:"charge",amount:200,currency:"EUR",description:"EUR"}]
    : [{client_id:cl.id,type:"charge",amount:50000,description:"Fiado base"}];
  await db.from("movements").insert(movs);
  const {data:lk}=await db.from("share_links").insert([{client_id:cl.id}]).select("token").single();
  out[key]={owner:c.user.id, client:cl.id, token:lk.token};
}
console.log(JSON.stringify(out,null,1));
