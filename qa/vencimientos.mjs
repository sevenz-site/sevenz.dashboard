// ESCRIBE EN DEV y se limpia sola: crea dos usuarios de prueba, juega con las
// fechas de su suscripción y los borra al terminar.
//
// What it pins: phase C of the plan of 2026-10-31 (migration 171).
//   - Every signup is born in a 3-month trial, ending at the last second of
//     the day in the zone of ITS business. Checked with a REAL signup, not by
//     looking for the function: the trap written in CLAUDE.md is a trigger on
//     auth.users that was not cloned, which a function check never sees.
//   - The block arrives by itself: a trial past its end, and a paid period
//     more than 5 days past its end. The 4th day still writes -- that is the
//     grace the owner chose.
//   - The daily cron writes it down (state and history), and «Reactivar»
//     really reactivates: before 171's fix it left an expired paid period in
//     place and the rule blocked the account again on the spot.
//   - A manual block after an automatic one does not inherit «tu prueba
//     terminó».
//   - The test-business mark, and the metrics leaving those businesses out.
//
// The writes are made AS THE OWNER, with their own session: the block lives in
// RLS, and the service key would walk straight through it.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { sinNegociosDePrueba } from "../lib/admin/metrics.ts";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);
const REF = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
if (REF !== "vzqppwrwnmlbrxizskdh") throw new Error("Esta suite solo corre contra dev (vzqppwrwnmlbrxizskdh).");

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });

const filas = [];
function check(nombre, pasa, detalle) {
  filas.push({ nombre, pasa });
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${detalle ? `  — ${detalle}` : ""}`);
}
const ACTOR = "qa-vencimientos@sevenz.test";
const dia = (d, tz) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const hora = (d, tz) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(d);
const tresMesesDespues = (ymd) => {
  const [y, m, d] = ymd.split("-").map(Number);
  const x = new Date(Date.UTC(y, m - 1 + 3, d));
  // Calendar months the way Postgres adds them: 31 Jul + 3 months = 31 Oct,
  // and 30 Nov + 3 months = 28 Feb (clamped to the end of the month).
  if (x.getUTCDate() !== d) x.setUTCDate(0);
  return x.toISOString().slice(0, 10);
};

const usuarios = [];
async function registrar(pais) {
  const email = `qa-vencimientos-${pais.toLowerCase()}-${Date.now()}@sevenz.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { business_name: `QA Vencimientos ${pais}`, country: pais, first_name: "QA" },
  });
  if (error) throw new Error(`createUser: ${error.message}`);
  usuarios.push(data.user.id);
  return { id: data.user.id, email };
}
async function sesion(email) {
  const { data: lk } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const { data: ses } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: lk.properties.hashed_token });
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${ses.session.access_token}` } },
  });
}
const sub = async (id) => (await admin.from("subscriptions").select("*").eq("owner_id", id).single()).data;
const fijar = (id, cambios) => admin.from("subscriptions").update(cambios).eq("owner_id", id);
// Can this owner write? Asked by WRITING, as the owner: a client insert.
async function escribe(cliente, ownerId) {
  const { data, error } = await cliente.from("clients").insert({ owner_id: ownerId, name: "QA Vencimientos cliente" }).select("id");
  return !error && (data ?? []).length === 1;
}
const haceDias = (n) => new Date(Date.now() - n * 864e5).toISOString();

try {
  // ── 1. A real signup, Venezuelan and Colombian ──
  for (const [pais, tz] of [["VE", "America/Caracas"], ["CO", "America/Bogota"]]) {
    const u = await registrar(pais);
    const { data: owner } = await admin.from("owners").select("id, country").eq("id", u.id).maybeSingle();
    const s = await sub(u.id);
    const fin = s?.demo_termina_el ? new Date(s.demo_termina_el) : null;
    const esperado = tresMesesDespues(dia(new Date(), tz));
    check(`1${pais === "VE" ? "a" : "b"}. registro real ${pais}: nace el negocio Y su prueba de 3 meses`,
      owner?.country === pais && s?.estado === "demo" && fin && dia(fin, tz) === esperado && hora(fin, tz) === "23:59:59",
      `negocio=${!!owner} · estado=${s?.estado} · fin ${fin ? `${dia(fin, tz)} ${hora(fin, tz)}` : "—"} en ${tz} (esperado ${esperado} 23:59:59)`);
    const { data: ev } = await admin.from("subscription_events").select("motivo, actor_email").eq("owner_id", u.id);
    check(`1${pais === "VE" ? "c" : "d"}. y queda en el historial`, (ev ?? []).some((e) => e.actor_email === "sistema" && /Prueba de 3 meses/.test(e.motivo ?? "")),
      (ev ?? []).map((e) => e.motivo).join(" | "));
  }

  // ── 2. The VE one, through every state ──
  const [veId] = usuarios;
  const { data: veUser } = await admin.auth.admin.getUserById(veId);
  const comoDueno = await sesion(veUser.user.email);

  check("2. en prueba, escribe", await escribe(comoDueno, veId));

  await fijar(veId, { demo_termina_el: haceDias(1) });
  const m1 = await comoDueno.rpc("mi_motivo_de_bloqueo");
  check("3. prueba vencida: NO escribe, y su motivo es «prueba_vencida»", !(await escribe(comoDueno, veId)) && m1.data === "prueba_vencida", `motivo=${m1.data}`);

  const n = await admin.rpc("bloquear_vencidas");
  const s3 = await sub(veId);
  const { data: ev3 } = await admin.from("subscription_events").select("motivo, hasta_estado, actor_email").eq("owner_id", veId).order("ocurrido_el", { ascending: false }).limit(1);
  check("4. el cron lo deja escrito: estado «bloqueada», motivo y fila en el historial",
    n.data >= 1 && s3.estado === "bloqueada" && s3.bloqueo_motivo === "prueba_vencida" && ev3?.[0]?.actor_email === "sistema" && /terminó la prueba/.test(ev3?.[0]?.motivo ?? ""),
    `bloqueadas por el cron=${n.data} · estado=${s3.estado} · motivo=${s3.bloqueo_motivo} · «${ev3?.[0]?.motivo}»`);
  const n2 = await admin.rpc("bloquear_vencidas");
  const { count: evDobles } = await admin.from("subscription_events").select("id", { count: "exact", head: true }).eq("owner_id", veId).like("motivo", "Bloqueo automático%");
  check("4b. correr el cron otra vez no la vuelve a apuntar", evDobles === 1, `eventos de bloqueo=${evDobles} · segunda corrida bloqueó ${n2.data}`);

  await admin.rpc("admin_desbloquear", { p_owner: veId, p_actor_email: ACTOR, p_motivo: "QA" });
  const s5 = await sub(veId);
  check("5. «Reactivar» la deja activa, escribiendo, y el motivo se borra", s5.estado === "activa" && s5.bloqueo_motivo === null && (await escribe(comoDueno, veId)), `estado=${s5.estado} · motivo=${s5.bloqueo_motivo}`);

  // A paid period: 4 days past still writes, 6 days past does not.
  await fijar(veId, { estado: "activa", periodo_termina_el: haceDias(4) });
  check("6. periodo pagado vencido hace 4 días: SIGUE escribiendo (5 días de gracia)", await escribe(comoDueno, veId));
  await fijar(veId, { periodo_termina_el: haceDias(6) });
  const m7 = await comoDueno.rpc("mi_motivo_de_bloqueo");
  check("7. vencido hace 6 días: NO escribe, motivo «pago_vencido»", !(await escribe(comoDueno, veId)) && m7.data === "pago_vencido", `motivo=${m7.data}`);

  await admin.rpc("admin_desbloquear", { p_owner: veId, p_actor_email: ACTOR, p_motivo: "QA" });
  const s8 = await sub(veId);
  check("8. «Reactivar» un pago vencido quita la fecha vencida y vuelve a escribir (antes se re-bloqueaba al instante)",
    s8.estado === "activa" && s8.periodo_termina_el === null && (await escribe(comoDueno, veId)), `periodo=${s8.periodo_termina_el}`);

  // Automatic block, then manual: the reason must not be inherited.
  await fijar(veId, { estado: "demo", demo_termina_el: haceDias(1) });
  await admin.rpc("bloquear_vencidas");
  await admin.rpc("admin_desbloquear", { p_owner: veId, p_actor_email: ACTOR, p_motivo: "QA" });
  await admin.rpc("admin_bloquear", { p_owner: veId, p_motivo: "QA: bloqueo manual", p_actor_email: ACTOR });
  const m9 = await comoDueno.rpc("mi_motivo_de_bloqueo");
  check("9. un bloqueo MANUAL después de uno automático dice «bloqueada», no «tu prueba terminó»", m9.data === "bloqueada", `motivo=${m9.data}`);

  await admin.rpc("admin_dar_demo", { p_owner: veId, p_dias: 90, p_actor_email: ACTOR });
  check("10. «Dar demo» vuelve a dejarla escribir", await escribe(comoDueno, veId));

  // ── 11. Every owner has a row after the backfill ──
  const { data: owners } = await admin.from("owners").select("id");
  const { data: subs } = await admin.from("subscriptions").select("owner_id");
  const conFila = new Set((subs ?? []).map((s) => s.owner_id));
  const sinFila = (owners ?? []).filter((o) => !conFila.has(o.id)).length;
  check("11. tras el relleno, ningún negocio queda sin suscripción", sinFila === 0, `${sinFila} sin fila de ${(owners ?? []).length}`);

  // ── 12. Test businesses ──
  await admin.rpc("admin_marcar_prueba", { p_owner: veId, p_es_prueba: true, p_actor_email: ACTOR });
  const { data: opciones } = await admin.rpc("admin_owner_options");
  const marcado = (opciones ?? []).find((o) => o.id === veId);
  const filtrado = sinNegociosDePrueba({}, opciones, false);
  const conPrueba = sinNegociosDePrueba({}, opciones, true);
  const aMano = sinNegociosDePrueba({ ownerIds: [veId] }, opciones, false);
  check("12. marcado como prueba: las métricas lo dejan fuera, salvo «incluir» o elegirlo a mano",
    marcado?.es_prueba === true && !filtrado.ownerIds.includes(veId) && filtrado.ownerIds.length > 0 &&
      (conPrueba.ownerIds ?? []).length === 0 && aMano.ownerIds[0] === veId,
    `marca=${marcado?.es_prueba} · por defecto ${filtrado.ownerIds.length} negocios sin él · incluir → sin filtro · a mano → él`);
  const todos = sinNegociosDePrueba({}, [{ id: "a", es_prueba: true }], false);
  check("12b. si todos fueran de prueba, la respuesta es «nada», no «todos»", todos.ownerIds.length === 1 && todos.ownerIds[0] === "00000000-0000-0000-0000-000000000000", JSON.stringify(todos.ownerIds));
} catch (e) {
  check("ERROR", false, e instanceof Error ? e.message : String(e));
} finally {
  for (const id of usuarios) {
    await admin.from("clients").delete().eq("owner_id", id);
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) console.log("no se pudo borrar el usuario", id, error.message);
  }
  const { count } = await admin.from("owners").select("id", { count: "exact", head: true }).like("business_name", "QA Vencimientos%");
  check("13. limpieza: ni usuarios ni negocios de prueba en dev", count === 0, `quedan ${count}`);
  const fallos = filas.filter((f) => !f.pasa).length;
  console.log(`\n${filas.length - fallos}/${filas.length} pasan.`);
  process.exit(fallos === 0 ? 0 : 1);
}
