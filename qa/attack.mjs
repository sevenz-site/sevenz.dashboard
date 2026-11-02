// SIMULATED ATTACK ON DEV -- the offensive audit of 2026-11-02, kept as a
// suite so it runs on every release (the owner's request the same day:
// «incluye las pruebas de ciberataque simuladas en el QA checklist para que
// sean parte de él en cada liberación»).
//
// THE ATTACKER HAS WHAT A REAL ONE HAS: the anon key (it ships in the public
// JavaScript), the session of an ordinary owner A, and plain HTTP to the app.
// The victim is owner B. The service-role key only builds and removes the
// fixtures and reads the database afterwards to judge -- it never attacks.
//
// AIMED BY `qa/attack-surface.mjs`: every table and SECURITY DEFINER function
// listed there is attacked here, so a piece classified there is a piece under
// attack. `qa:attack-coverage` fails when something exists that is not listed.
//
// THE VERDICT IS READ FROM THE DATABASE, NOT FROM THE RESPONSE. Since 177 some
// attacks are ACCEPTED and neutralised (a forged running_balance is put back,
// a forged author is overwritten). Judging by «the request went through» would
// call those vulnerabilities; the audit did exactly that on its first rerun.
//
// AND THE TWO CLIENTS ARE SEPARATE ON PURPOSE: `login` keeps the session of
// the last verifyOtp, `anon` never logs in. Sharing one made the first run of
// the audit report sixteen false vulnerabilities -- B reading B's own rows.
//
// Needs `npm run dev` for the HTTP section. Dev only; refuses anything else.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { parseSurface, MANIFEST } from "./attack-surface.mjs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
if (!URL_.includes("vzqppwrwnmlbrxizskdh")) {
  console.error("Esta suite ataca la base: solo corre contra la rama dev (vzqppwrwnmlbrxizskdh).");
  process.exit(1);
}
const BASE = "http://localhost:3000";
const REF = "vzqppwrwnmlbrxizskdh";
const svc = createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const login = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const R = [];
// BLOQUEADO = the attack failed · VULN = it worked · DECISIÓN = allowed on
// purpose or waiting for the owner, reported but not failing.
const rec = (area, ataque, verdict, detalle = "") => {
  R.push({ area, ataque, verdict });
  if (verdict !== "BLOQUEADO" || process.argv.includes("--todo"))
    console.log(`${verdict.padEnd(9)} | ${area} | ${ataque}${detalle ? `  — ${String(detalle).slice(0, 200)}` : ""}`);
};
const vacio = (data, error) => !!error || data == null || (Array.isArray(data) && data.length === 0);

const stamp = Date.now().toString().slice(-6);
const usuarios = [];
async function dueno(tag) {
  const email = `zz-attack-${tag}-${stamp}@sevenz-qa.test`;
  const { data, error } = await svc.auth.admin.createUser({ email, email_confirm: true, user_metadata: { business_name: `ZZ Attack ${tag}`, country: "VE", first_name: tag } });
  if (error) throw new Error(`createUser: ${error.message}`);
  usuarios.push(data.user.id);
  const { data: lk } = await svc.auth.admin.generateLink({ type: "magiclink", email });
  const { data: ses, error: e2 } = await login.auth.verifyOtp({ type: "magiclink", token_hash: lk.properties.hashed_token });
  if (e2) throw new Error(`otp: ${e2.message}`);
  return {
    id: data.user.id,
    email,
    session: ses.session,
    db: createClient(URL_, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${ses.session.access_token}` } } }),
  };
}

try {
  if ((await anon.auth.getSession()).data.session) throw new Error("el cliente anónimo tiene sesión: la prueba no valdría");
  const A = await dueno("a");
  const B = await dueno("b");

  // ── Victim fixtures ───────────────────────────────────────────────────
  const { data: cB } = await svc.from("clients").insert({ owner_id: B.id, name: "Cliente de B", document_id: "12345678", whatsapp: "584121112233" }).select("id").single();
  const { data: mB } = await svc.from("movements").insert({ client_id: cB.id, created_by: B.id, type: "charge", amount: 100, currency: "USD", source: "manual" }).select("id").single();
  const tokB = `zzattack${Math.random().toString(16).slice(2, 14)}`;
  await svc.from("share_links").insert({ client_id: cB.id, token: tokB });
  const { data: pB } = await svc.from("products").insert({ owner_id: B.id, name: "Producto de B", base_currency: "USD", price_retail: 10, published_retail: true }).select("id").single();
  const { data: sB } = await svc.from("sales").insert({ owner_id: B.id, client_id: cB.id }).select("id").single();
  await svc.from("sale_lines").insert({ sale_id: sB.id, name: "Línea de B", quantity: 1, unit_price: 10, currency: "USD" });
  await svc.from("sale_payments").insert({ sale_id: sB.id, amount: 10, currency: "USD" });
  const { data: oB } = await svc.from("catalog_orders").insert({ owner_id: B.id, customer_name: "Pedido de B", customer_document: "1234567", customer_whatsapp: "584121112233", customer_whatsapp_raw: "04121112233" }).select("id").single();
  await svc.from("client_flags").insert({ owner_id: B.id, client_id: cB.id, reason: "x" });
  const { data: linkB } = await svc.from("catalog_share_links").insert({ owner_id: B.id }).select("token").single();
  const { data: cA } = await svc.from("clients").insert({ owner_id: A.id, name: "Cliente de A" }).select("id").single();
  const { data: mA } = await svc.from("movements").insert({ client_id: cA.id, created_by: A.id, type: "charge", amount: 50, currency: "USD", source: "manual" }).select("id").single();

  // Anything that comes back holding one of these leaked the victim.
  const SECRETOS = ["Cliente de B", "Producto de B", "Pedido de B", "Línea de B", "12345678", tokB, B.email, "ZZ Attack b"];
  const filtra = (x) => { const t = JSON.stringify(x ?? ""); return SECRETOS.find((s) => t.includes(s)) ?? null; };
  const DE_B = { owner: ["owner_id", B.id], id: ["id", B.id], client: ["client_id", cB.id], sale: ["sale_id", sB.id], product: ["product_id", pB.id], order: ["order_id", oB.id] };

  // ── 1. Every table and view: a stranger, and A against B ─────────────
  for (const [tabla, { via }] of Object.entries(MANIFEST.tables)) {
    const { data, error } = await anon.from(tabla).select("*").limit(5);
    rec("anónimo · tablas", `leer ${tabla}`, vacio(data, error) ? "BLOQUEADO" : "VULN", error ? error.code : `${data.length} filas`);
    const ins = await anon.from(tabla).insert({ owner_id: B.id }).select();
    rec("anónimo · tablas", `escribir en ${tabla}`, ins.error || !ins.data?.length ? "BLOQUEADO" : "VULN", ins.error?.code);
    if (DE_B[via]) {
      const [col, val] = DE_B[via];
      const r = await A.db.from(tabla).select("*").eq(col, val);
      rec("A → B · leer", tabla, vacio(r.data, r.error) ? "BLOQUEADO" : "VULN", r.error ? r.error.code : `${r.data.length} filas de B`);
    }
  }

  // ── 2. Every SECURITY DEFINER function, by its reviewed exposure ─────
  const superficie = parseSurface();
  const argumentos = (params, quien) => {
    const a = {};
    for (const { name, type } of params) {
      const n = name.toLowerCase();
      if (type.endsWith("[]")) a[name] = type.startsWith("uuid") ? [B.id] : [];
      else if (type.startsWith("uuid"))
        a[name] = /client/.test(n) ? cB.id : /movement|fiado|charge/.test(n) ? mB.id : /product/.test(n) ? pB.id : /order/.test(n) ? oB.id : /sale/.test(n) ? sB.id : B.id;
      else if (/token/.test(n)) a[name] = `zz-no-existe-${quien}`;
      else if (/key/.test(n)) a[name] = `zz_attack_${stamp}`;
      else if (/whatsapp|phone|telefono/.test(n)) a[name] = "584121112233";
      else if (/^(int|integer|bigint|numeric|smallint)/.test(type)) a[name] = 1;
      else if (type.startsWith("bool")) a[name] = false;
      else if (type.startsWith("json")) a[name] = /lineas|items|rows|movements|payload/.test(n) ? [] : {};
      else if (/time|date/.test(type)) a[name] = null;
      else a[name] = "x";
    }
    return a;
  };
  for (const [fn, { params }] of superficie.definers) {
    const esperado = MANIFEST.definers[fn];
    if (!esperado) { rec("funciones", `${fn}: sin clasificar en attack-surface.mjs`, "VULN", "corre qa:attack-coverage"); continue; }
    for (const [quien, cli] of [["anónimo", anon], ["dueño A", A.db]]) {
      const { data, error } = await cli.rpc(fn, argumentos(params, quien));
      if (fn === "generar_codigo_transaccion" && typeof data === "string") await svc.from("transaction_codes").delete().eq("code", data);
      const debeNegarse = esperado === "service" || (esperado === "owner" && quien === "anónimo");
      if (debeNegarse) {
        const negado = !!error && (error.code === "42501" || /permission denied/i.test(error.message));
        rec(`${quien} · funciones`, `${fn} (solo ${esperado === "service" ? "el servidor" : "dueños"})`, negado ? "BLOQUEADO" : "VULN", error ? `${error.code} ${error.message.slice(0, 70)}` : `EJECUTÓ: ${JSON.stringify(data).slice(0, 80)}`);
      } else {
        const fuga = filtra(data);
        rec(`${quien} · funciones`, `${fn} con los ids de B / un token falso`, fuga ? "VULN" : "BLOQUEADO", fuga ? `devolvió «${fuga}»` : error?.code ?? "sin datos de B");
      }
    }
  }
  await svc.from("rate_limiters").delete().like("key", "zz_attack_%");
  await svc.from("rate_limit_counters").delete().like("key", "zz_attack_%");

  // FINDING 7: pushing the libreta queue weeks ahead. Tried by a stranger AND
  // by a logged-in owner: a per-call cap alone would still let an owner call
  // it a thousand times in a row, which is why 178 makes it server-only.
  for (const [quien, cli] of [["anónimo", anon], ["dueño A", A.db]]) {
    const k = `zz_attack_turno_${stamp}`;
    const { error } = await cli.rpc("claim_rate_limit_slot", { p_key: k, p_spacing_ms: 2147483647 });
    const { data: fila } = await svc.from("rate_limiters").select("next_available_at").eq("key", k).maybeSingle();
    const dias = fila ? (new Date(fila.next_available_at) - Date.now()) / 864e5 : 0;
    rec(`${quien} · funciones`, "congelar el turnero de la libreta (intervalo gigante)", error || dias < 1 ? "BLOQUEADO" : "VULN", error ? error.code : `turno dentro de ${dias.toFixed(1)} días`);
    await svc.from("rate_limiters").delete().eq("key", k);
  }

  // ── 3. A writes into B, and plants its own rows on B ─────────────────
  const { data: pA } = await svc.from("products").insert({ owner_id: A.id, name: "Producto de A", base_currency: "USD", price_retail: 1 }).select("id").single();
  const { data: sA } = await svc.from("sales").insert({ owner_id: A.id, client_id: cA.id }).select("id").single();
  const { data: c2 } = await svc.from("clients").insert({ owner_id: A.id, name: "Cliente regalado" }).select("id").single();
  const intentos = [
    ["fiado en un cliente de B", () => A.db.from("movements").insert({ client_id: cB.id, type: "charge", amount: 999, currency: "USD", source: "manual" }).select("id")],
    ["renombrar cliente de B", () => A.db.from("clients").update({ name: "HACKED" }).eq("id", cB.id).select("id")],
    ["borrar fiado de B", () => A.db.from("movements").update({ deleted_at: new Date().toISOString() }).eq("id", mB.id).select("id")],
    ["bajar el precio de B", () => A.db.from("products").update({ price_retail: 0.01 }).eq("id", pB.id).select("id")],
    ["descartar el pedido de B", () => A.db.from("catalog_orders").update({ status: "discarded" }).eq("id", oB.id).select("id")],
    ["cliente a nombre de B", () => A.db.from("clients").insert({ owner_id: B.id, name: "falso" }).select("id")],
    ["venta a nombre de B", () => A.db.from("sales").insert({ owner_id: B.id, client_id: cB.id }).select("id")],
    ["pago dentro de la venta de B", () => A.db.from("sale_payments").insert({ sale_id: sB.id, amount: 1, currency: "USD" }).select("id")],
    ["enlace para el cliente de B", () => A.db.from("share_links").insert({ client_id: cB.id, token: `zzattackA${stamp}` }).select("id")],
    ["editar el negocio de B", () => A.db.from("owners").update({ business_name: "HACKED" }).eq("id", B.id).select("id")],
    ["abono repartido sobre el fiado de B", () => A.db.rpc("registrar_abono_repartido", { p_lineas: [{ fiado_id: mB.id, amount: 1 }] })],
    ["plantar: mover su fiado al cliente de B", () => A.db.from("movements").update({ client_id: cB.id }).eq("id", mA.id).select("id")],
    ["plantar: regalarle un cliente a B", () => A.db.from("clients").update({ owner_id: B.id }).eq("id", c2.id).select("id")],
    ["plantar: regalarle un producto a B", () => A.db.from("products").update({ owner_id: B.id }).eq("id", pA.id).select("id")],
    ["plantar: pasarle una venta a B", () => A.db.from("sales").update({ owner_id: B.id }).eq("id", sA.id).select("id")],
  ];
  for (const [n, f] of intentos) {
    const { data, error } = await f();
    const paso = !error && (Array.isArray(data) ? data.length > 0 : data?.ok === true);
    rec("A → B · escribir", n, paso ? "VULN" : "BLOQUEADO", error?.code ?? JSON.stringify(data)?.slice(0, 60));
  }

  // ── 4. A against its own limits ──────────────────────────────────────
  for (const [n, f] of [
    ["subirse a Pro", () => A.db.from("owners").update({ plan: "pro" }).eq("id", A.id)],
    ["cambiarse de país", () => A.db.from("owners").update({ country: "CO" }).eq("id", A.id)],
    ["alargarse la prueba", () => A.db.from("subscriptions").update({ demo_termina_el: "2099-01-01T00:00:00Z" }).eq("owner_id", A.id)],
    ["marcarse como pagada", () => A.db.from("subscriptions").update({ estado: "activa", periodo_termina_el: "2099-01-01T00:00:00Z" }).eq("owner_id", A.id)],
    ["borrar su historial de suscripción", () => A.db.from("subscription_events").delete().eq("owner_id", A.id)],
    ["apuntarse un pago falso", () => A.db.from("subscription_events").insert({ owner_id: A.id, motivo: "pago falso", monto_usd: 19.5 })],
  ]) await f();
  const { data: oA } = await svc.from("owners").select("plan, country").eq("id", A.id).single();
  const { data: subA } = await svc.from("subscriptions").select("estado, demo_termina_el, periodo_termina_el").eq("owner_id", A.id).single();
  const { count: pagosFalsos } = await svc.from("subscription_events").select("id", { count: "exact", head: true }).eq("owner_id", A.id).eq("motivo", "pago falso");
  rec("A · escalar", "plan, país, prueba, pago y historial (leído en la base)", oA.plan !== "pro" && oA.country === "VE" && subA.estado === "demo" && !String(subA.demo_termina_el).startsWith("2099") && !subA.periodo_termina_el && !pagosFalsos ? "BLOQUEADO" : "VULN", JSON.stringify({ ...oA, ...subA, pagosFalsos }));

  // ── 5. The ledger written by hand (177) ──────────────────────────────
  await A.db.from("movements").update({ running_balance: 777 }).eq("id", mA.id);
  const { data: s1 } = await svc.from("client_summary_all").select("balance_usd").eq("client_id", cA.id).single();
  rec("A · libro", "falsear el saldo que ve su cliente (running_balance = 777)", Number(s1.balance_usd) === 777 ? "VULN" : "BLOQUEADO", `el cliente ve ${s1.balance_usd}`);
  const { data: mF } = await A.db.from("movements").insert({ client_id: cA.id, created_by: B.id, type: "charge", amount: 1, currency: "USD", source: "manual" }).select("created_by").single();
  rec("A · libro", "firmar un fiado como si lo hubiera escrito B", mF?.created_by === B.id ? "VULN" : "BLOQUEADO", mF?.created_by === A.id ? "queda firmado por A" : mF?.created_by);
  const e3 = (await A.db.from("movements").insert({ client_id: cA.id, type: "charge", amount: -50, currency: "USD", source: "manual" })).error;
  rec("A · libro", "fiado con monto negativo", e3 ? "BLOQUEADO" : "VULN", e3?.code);
  const e5 = (await A.db.from("movements").insert({ client_id: cA.id, type: "charge", amount: 5, currency: "XYZ", source: "manual" })).error;
  rec("A · libro", "moneda inventada", e5 ? "BLOQUEADO" : "VULN", e5?.code);
  const e4 = (await A.db.from("movements").insert({ client_id: cA.id, type: "payment", amount: 5000, currency: "USD", source: "manual" })).error;
  rec("A · libro", "abono mayor que la deuda escrito directo a la tabla", e4 ? "BLOQUEADO" : "DECISIÓN", e4?.code ?? "hallazgo 6 de la auditoría: la regla solo vive en la acción del servidor");

  // ── 6. A blocked owner ───────────────────────────────────────────────
  await svc.from("subscriptions").update({ estado: "bloqueada", bloqueo_motivo: "prueba_vencida" }).eq("owner_id", A.id);
  for (const [n, f, decision] of [
    ["fiado", () => A.db.from("movements").insert({ client_id: cA.id, type: "charge", amount: 1, currency: "USD", source: "manual" }).select("id")],
    ["cliente nuevo", () => A.db.from("clients").insert({ owner_id: A.id, name: "bloq" }).select("id")],
    ["editar un cliente", () => A.db.from("clients").update({ name: "bloq" }).eq("id", cA.id).select("id")],
    ["borrar un movimiento", () => A.db.from("movements").update({ deleted_at: new Date().toISOString() }).eq("id", mA.id).select("id")],
    ["producto nuevo", () => A.db.from("products").insert({ owner_id: A.id, name: "bloq", base_currency: "USD", price_retail: 1 }).select("id")],
    ["venta", () => A.db.from("sales").insert({ owner_id: A.id, client_id: cA.id }).select("id")],
    ["crear el enlace de un cliente", () => A.db.from("share_links").insert({ client_id: cA.id, token: `zzattackB${stamp}` }).select("id"), "hallazgo 5: compartir es leer"],
    ["editar los datos del negocio", () => A.db.from("owners").update({ business_name: "ZZ Attack a" }).eq("id", A.id).select("id"), "hallazgo 5"],
  ]) {
    const { data, error } = await f();
    const paso = !error && data?.length > 0;
    rec("A bloqueada", n, !paso ? "BLOQUEADO" : decision ? "DECISIÓN" : "VULN", error?.code ?? (paso ? `permitido${decision ? ` — ${decision}` : ""}` : ""));
  }
  await svc.from("subscriptions").update({ estado: "demo", bloqueo_motivo: null }).eq("owner_id", A.id);

  // ── 7. Storage ───────────────────────────────────────────────────────
  for (const bucket of Object.keys(MANIFEST.buckets)) {
    const ruta = `${B.id}/zz-attack-${stamp}.png`;
    const up = await A.db.storage.from(bucket).upload(ruta, new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), { upsert: true });
    rec("archivos", `A sube a la carpeta de B en ${bucket}`, up.error ? "BLOQUEADO" : "VULN", up.error?.message);
    if (!up.error) await svc.storage.from(bucket).remove([ruta]);
    const ls = await A.db.storage.from(bucket).list(B.id);
    rec("archivos", `A lista la carpeta de B en ${bucket}`, (ls.data ?? []).length === 0 ? "BLOQUEADO" : "VULN", ls.error?.message ?? `${(ls.data ?? []).length} objetos`);
  }

  // ── 8. Catalog order forged by a stranger ────────────────────────────
  {
    const base = { p_token: linkB.token, p_customer_name: "ZZ Attack", p_customer_document: "V-12345678", p_customer_document_type: "V", p_customer_whatsapp: "584121990109", p_wants_notices: false, p_consent_text: null };
    const r = await anon.rpc("create_catalog_order", { ...base, p_items: [{ product_id: pB.id, quantity: 1, currency: "USD", unit_price: 0.01 }] });
    const id = r.data?.order_id;
    const { data: it } = id ? await svc.from("catalog_order_items").select("unit_price").eq("order_id", id) : { data: [] };
    rec("anónimo · pedido", "precio inventado (0,01) en un pedido del catálogo", !id || Number(it?.[0]?.unit_price) === 10 ? "BLOQUEADO" : "VULN", id ? `guardó ${it?.[0]?.unit_price}` : r.error?.code ?? r.data?.reason);
    if (id) { await svc.from("catalog_order_items").delete().eq("order_id", id); await svc.from("catalog_orders").delete().eq("id", id); }
    for (const [n, items] of [["cantidad negativa", [{ product_id: pB.id, quantity: -5, currency: "USD" }]], ["cantidad gigante", [{ product_id: pB.id, quantity: 1e12, currency: "USD" }]], ["300 líneas", Array.from({ length: 300 }, () => ({ product_id: pB.id, quantity: 1, currency: "USD" }))]]) {
      const x = await anon.rpc("create_catalog_order", { ...base, p_items: items });
      if (x.data?.order_id) { await svc.from("catalog_order_items").delete().eq("order_id", x.data.order_id); await svc.from("catalog_orders").delete().eq("id", x.data.order_id); }
      rec("anónimo · pedido", n, x.data?.ok ? "VULN" : "BLOQUEADO", x.data?.reason ?? x.error?.code);
    }
  }

  // ── 9. HTTP: routes, pages, errors, headers ──────────────────────────
  const vivo = await fetch(`${BASE}/login`).then((r) => r.ok).catch(() => false);
  if (!vivo) {
    rec("http", "servidor local apagado: la mitad HTTP no corrió (npm run dev)", "VULN");
  } else {
    const cookieA = `sb-${REF}-auth-token=base64-${Buffer.from(JSON.stringify(A.session)).toString("base64url")}`;
    for (const [ruta, tipo] of Object.entries(MANIFEST.routes)) {
      if (tipo === "cron") {
        const rs = await Promise.all([{}, { authorization: "Bearer undefined" }, { authorization: "Bearer " }].map((h) => fetch(BASE + ruta, { headers: h })));
        rec("http · rutas", `${ruta} sin la clave del cron`, rs.every((r) => r.status === 401) ? "BLOQUEADO" : "VULN", rs.map((r) => r.status).join(","));
      } else if (tipo === "session") {
        const r = await fetch(BASE + ruta, { redirect: "manual" });
        rec("http · rutas", `${ruta} sin sesión`, r.status === 401 || (r.status >= 300 && r.status < 400) || r.status === 405 ? "BLOQUEADO" : "VULN", r.status);
      } else {
        const r = await fetch(BASE + ruta, { method: "POST", headers: { "content-type": "application/json" }, body: '{"token":{"$gt":""},"x":' });
        const t = await r.text();
        rec("http · rutas", `${ruta} con JSON roto: ¿suelta errores internos?`, /\bat \w|stack|PGRST|postgres|supabase\.co/i.test(t) ? "VULN" : "BLOQUEADO", `${r.status} ${t.slice(0, 60)}`);
      }
    }
    const adm = await fetch(`${BASE}/admin`, { redirect: "manual", headers: { cookie: cookieA } });
    rec("http · páginas", "un dueño normal abre /admin", adm.status === 200 ? "VULN" : "BLOQUEADO", adm.status);
    for (const [n, ruta, marca] of [["la ficha del cliente de B", `/clients/${cB.id}`, "Cliente de B"], ["el pedido de B", `/productos/ordenes/${oB.id}`, "Pedido de B"], ["el export de movimientos de B", `/api/reportes/movimientos?cliente=${cB.id}&client=${cB.id}&clientId=${cB.id}`, "Cliente de B"]]) {
      const t = await (await fetch(BASE + ruta, { headers: { cookie: cookieA } })).text();
      rec("http · páginas", `A abre por URL ${n}`, t.includes(marca) ? "VULN" : "BLOQUEADO");
    }
    const enlace = await (await fetch(`${BASE}/s/${tokB}`)).text();
    rec("http · enlace", "el enlace del cliente no enseña su cédula", enlace.includes("12345678") ? "VULN" : "BLOQUEADO");
    const iny = await fetch(`${BASE}/s/'%3Bselect%201--`);
    rec("http · enlace", "inyección SQL en el token", iny.status === 404 && !/syntax|42601|PGRST/i.test(await iny.text()) ? "BLOQUEADO" : "VULN", iny.status);
    await svc.from("owners").update({ business_name: `<img src=x onerror=alert(1)>"><script>alert(2)</script>` }).eq("id", B.id);
    await svc.from("clients").update({ name: `<script>alert(3)</script>` }).eq("id", cB.id);
    const xss = await (await fetch(`${BASE}/s/${tokB}`)).text();
    rec("http · enlace", "XSS guardado en los nombres del negocio y del cliente", /<script>alert\(\d\)|<img src=x onerror/.test(xss) ? "VULN" : "BLOQUEADO");
    const h = (await fetch(`${BASE}/login`)).headers;
    const faltan = [["content-security-policy", /frame-ancestors 'none'/], ["x-frame-options", /DENY/i], ["x-content-type-options", /nosniff/], ["referrer-policy", /./]].filter(([k, re]) => !re.test(h.get(k) ?? "")).map(([k]) => k);
    rec("http · cabeceras", "contra clickjacking y sniffing", faltan.length ? "VULN" : "BLOQUEADO", faltan.length ? `faltan ${faltan.join(", ")}` : "");
  }

  // ── 10. After everything: B is exactly as it was ────────────────────
  const [{ data: bm }, { data: bp }, { data: bo }, { data: bs }, { count: deMas }] = await Promise.all([
    svc.from("movements").select("deleted_at, amount").eq("id", mB.id).single(),
    svc.from("products").select("price_retail, owner_id").eq("id", pB.id).single(),
    svc.from("catalog_orders").select("status").eq("id", oB.id).single(),
    svc.from("subscriptions").select("estado, is_test_account").eq("owner_id", B.id).single(),
    svc.from("movements").select("id", { count: "exact", head: true }).eq("client_id", cB.id),
  ]);
  const intacto = !bm.deleted_at && Number(bp.price_retail) === 10 && bp.owner_id === B.id && bo.status !== "discarded" && bs.estado === "demo" && !bs.is_test_account && deMas === 1;
  rec("víctima", "B termina exactamente como empezó (leído en la base)", intacto ? "BLOQUEADO" : "VULN", JSON.stringify({ fiadoBorrado: !!bm.deleted_at, precio: bp.price_retail, pedido: bo.status, ...bs, movimientos: deMas }));
} catch (e) {
  rec("ERROR", "la suite se detuvo", "VULN", e instanceof Error ? e.stack : String(e));
} finally {
  for (const id of usuarios) {
    const { data: cs } = await svc.from("clients").select("id").eq("owner_id", id);
    for (const c of cs ?? []) {
      for (const t of ["share_links", "client_flags", "movements"]) await svc.from(t).delete().eq("client_id", c.id);
    }
    const { data: ss } = await svc.from("sales").select("id").eq("owner_id", id);
    for (const s of ss ?? []) { await svc.from("sale_payments").delete().eq("sale_id", s.id); await svc.from("sale_lines").delete().eq("sale_id", s.id); }
    const { data: os } = await svc.from("catalog_orders").select("id").eq("owner_id", id);
    for (const o of os ?? []) await svc.from("catalog_order_items").delete().eq("order_id", o.id);
    for (const t of ["sales", "catalog_orders", "catalog_share_links", "products", "clients", "subscription_events", "subscriptions", "movement_rejections"]) await svc.from(t).delete().eq("owner_id", id);
    await svc.from("owners").delete().eq("id", id);
    await svc.auth.admin.deleteUser(id);
  }
  const { count } = await svc.from("owners").select("id", { count: "exact", head: true }).ilike("business_name", "ZZ Attack%");
  const vuln = R.filter((r) => r.verdict === "VULN").length;
  const dec = R.filter((r) => r.verdict === "DECISIÓN").length;
  console.log(`\nLimpieza: quedan ${count} negocios de ataque en dev.`);
  console.log(`${R.length} ataques · ${R.length - vuln - dec} bloqueados · ${vuln} VULN · ${dec} por decisión del dueño`);
  process.exit(vuln === 0 ? 0 : 1);
}
