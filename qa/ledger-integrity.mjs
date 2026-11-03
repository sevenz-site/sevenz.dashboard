// The ledger cannot be written by hand (migration 177, offensive audit of
// 2026-11-02). Every attack here runs AS AN OWNER, with a real session -- the
// service-role key bypasses RLS and would prove nothing (CLAUDE.md: «A `qa/`
// script runs as the service role. The owner does not.»). The service role
// only builds and removes the fixtures.
//
// Dev only: it refuses to run against any other project.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
if (!URL_.includes("vzqppwrwnmlbrxizskdh")) {
  console.error("Esta suite solo corre contra la rama dev (vzqppwrwnmlbrxizskdh).");
  process.exit(1);
}
const svc = createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
// Two anon clients on purpose: `login` keeps the session of the last
// verifyOtp; `anon` must stay a stranger. Sharing one made a whole audit
// report sixteen false vulnerabilities on 2026-11-02.
const login = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const filas = [];
const check = (n, ok, d = "") => { filas.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  — ${d}` : ""}`); };
const stamp = Date.now().toString().slice(-6);
const usuarios = [];

async function dueno(tag) {
  const email = `zz-ledger-${tag}-${stamp}@sevenz-qa.test`;
  const { data, error } = await svc.auth.admin.createUser({ email, email_confirm: true, user_metadata: { business_name: `ZZ Ledger ${tag}`, country: "VE" } });
  if (error) throw new Error(`createUser: ${error.message}`);
  usuarios.push(data.user.id);
  const { data: lk } = await svc.auth.admin.generateLink({ type: "magiclink", email });
  const { data: ses, error: e2 } = await login.auth.verifyOtp({ type: "magiclink", token_hash: lk.properties.hashed_token });
  if (e2) throw new Error(`otp: ${e2.message}`);
  return {
    id: data.user.id,
    db: createClient(URL_, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${ses.session.access_token}` } } }),
  };
}
const saldo = async (clientId) => Number((await svc.from("client_summary_all").select("balance_usd").eq("client_id", clientId).single()).data?.balance_usd);

try {
  const A = await dueno("a");
  const B = await dueno("b");
  const { data: cli } = await svc.from("clients").insert({ owner_id: A.id, name: "QA libro" }).select("id").single();
  const nuevo = (extra = {}) => A.db.from("movements").insert({ client_id: cli.id, type: "charge", amount: 50, currency: "USD", source: "manual", ...extra }).select("id, created_by, running_balance").single();

  // 1. A forged balance never reaches the client.
  const { data: m1 } = await nuevo();
  await A.db.from("movements").update({ running_balance: 777 }).eq("id", m1.id);
  const r1 = (await svc.from("movements").select("running_balance").eq("id", m1.id).single()).data.running_balance;
  check("1. el dueño escribe running_balance = 777 y vuelve a 50", Number(r1) === 50, `queda ${r1}`);
  check("1b. y el saldo que ve el cliente sigue en 50", (await saldo(cli.id)) === 50, `saldo ${await saldo(cli.id)}`);

  // 2. Until 180 the rest of the same update still applied (description
  // edited, balance restored). Since 180 (2026-11-02) a session may not edit
  // any column of a movement but `deleted_at`: the whole update is refused
  // with SZ002, and both the balance and the description stay as they were.
  // `qa:ledger-console` holds the full set of those refusals.
  const { error: e2 } = await A.db.from("movements").update({ running_balance: 1, description: "nota del dueño" }).eq("id", m1.id);
  const r2 = (await svc.from("movements").select("running_balance, description").eq("id", m1.id).single()).data;
  check("2. una edición que toca otra columna se rechaza entera (SZ002), y el saldo se queda", e2?.code === "SZ002" && r2.description == null && Number(r2.running_balance) === 50, `${e2?.code ?? "ENTRÓ"} · ${JSON.stringify(r2)}`);

  // 3. The service role is no exception: only the recalculation writes it.
  await svc.from("movements").update({ running_balance: 999 }).eq("id", m1.id);
  const r3 = (await svc.from("movements").select("running_balance").eq("id", m1.id).single()).data.running_balance;
  check("3. tampoco la clave de servicio lo escribe a mano", Number(r3) === 50, `queda ${r3}`);

  // 4. On insert the value is computed, whatever the caller sends.
  const { data: m4 } = await nuevo({ running_balance: 12345 });
  check("4. al insertar, el saldo lo calcula la base (50 + 50 = 100)", Number(m4.running_balance) === 100, `nace con ${m4.running_balance}`);

  // 5. The recalculation still writes: delete the first fiado, recalc, the
  //    second one's balance has to drop to 50.
  await A.db.from("movements").update({ deleted_at: new Date().toISOString() }).eq("id", m1.id);
  const { error: e5 } = await A.db.rpc("recalc_client_running_balance", { p_client_id: cli.id });
  const r5 = (await svc.from("movements").select("running_balance").eq("id", m4.id).single()).data.running_balance;
  check("5. el recálculo SÍ lo reescribe (borrar un fiado deja el otro en 50)", !e5 && Number(r5) === 50, e5 ? e5.message : `queda ${r5}`);
  check("5b. y el saldo del cliente cuadra con la suma", (await saldo(cli.id)) === 50, `saldo ${await saldo(cli.id)}`);

  // 6. Authorship is the session.
  const { data: m6 } = await nuevo({ created_by: B.id });
  check("6. un fiado firmado con el id de otro queda a nombre de quien lo escribió", m6.created_by === A.id, `created_by = ${m6.created_by === B.id ? "B (falsificado)" : m6.created_by === A.id ? "A" : m6.created_by}`);
  await A.db.from("movements").update({ created_by: B.id }).eq("id", m6.id);
  const r6 = (await svc.from("movements").select("created_by").eq("id", m6.id).single()).data.created_by;
  check("6b. y cambiar el autor después tampoco se puede", r6 === A.id, r6 === B.id ? "cambió a B" : "sigue A");

  // 7. With no session (service role) the author sent is respected.
  const { data: m7 } = await svc.from("movements").insert({ client_id: cli.id, created_by: B.id, type: "charge", amount: 1, currency: "USD", source: "manual" }).select("created_by").single();
  check("7. con la clave de servicio se respeta el autor que se manda", m7.created_by === B.id);

  // 8. The split payment (SECURITY DEFINER) signs as the owner and keeps the
  //    chain right -- it calls the recalculation inside.
  const { data: rep, error: e8 } = await A.db.rpc("registrar_abono_repartido", { p_lineas: [{ fiado_id: m4.id, amount: 20 }] });
  const { data: abono } = rep?.ok ? await svc.from("movements").select("created_by").eq("id", rep.movement_ids[0]).single() : { data: null };
  // The expected balance is the sum of the live movements, not a number
  // written by hand: by now the client holds three fiados (50 + 50 + 1), and a
  // hardcoded 31 made this row red on its first run while the database was
  // right (81).
  const { data: vivos } = await svc.from("movements").select("type, amount").eq("client_id", cli.id).is("deleted_at", null);
  const suma = vivos.reduce((s, m) => s + (m.type === "charge" ? 1 : -1) * Number(m.amount), 0);
  check("8. el abono repartido firma como el dueño y el saldo es la suma de los movimientos", !e8 && rep?.ok && abono?.created_by === A.id && (await saldo(cli.id)) === suma, e8 ? e8.message : `saldo ${await saldo(cli.id)} · suma ${suma} · autor ${abono?.created_by === A.id ? "A" : abono?.created_by}`);

  // 9. A stranger cannot ask whether a business is blocked; the owner's
  //    policies, which call the same function, keep working.
  const { error: e9 } = await anon.rpc("owner_puede_escribir", { p_owner: A.id });
  check("9. un anónimo ya no puede preguntar si un negocio está bloqueado", !!e9 && e9.code === "42501", e9 ? e9.code : "respondió");
  const { error: e9b } = await nuevo();
  check("9b. el dueño sigue pudiendo escribir (sus políticas usan esa función)", !e9b, e9b?.message);
  await svc.from("subscriptions").update({ estado: "bloqueada" }).eq("owner_id", A.id);
  const { error: e9c } = await nuevo();
  check("9c. y bloqueado sigue sin poder", !!e9c && e9c.code === "42501", e9c ? e9c.code : "escribió");
} catch (e) {
  check("ERROR: la suite se detuvo", false, e instanceof Error ? e.message : String(e));
} finally {
  for (const id of usuarios) {
    const { data: cs } = await svc.from("clients").select("id").eq("owner_id", id);
    for (const c of cs ?? []) await svc.from("movements").delete().eq("client_id", c.id);
    await svc.from("clients").delete().eq("owner_id", id);
    await svc.from("subscription_events").delete().eq("owner_id", id);
    await svc.from("subscriptions").delete().eq("owner_id", id);
    await svc.from("owners").delete().eq("id", id);
    await svc.auth.admin.deleteUser(id);
  }
  console.log(`\n${filas.filter(Boolean).length}/${filas.length} pasan.`);
  process.exit(filas.every(Boolean) ? 0 : 1);
}
