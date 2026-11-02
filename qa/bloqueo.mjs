// ESCRIBE EN DEV y se limpia sola. Bloquea un negocio de prueba y lo
// DESBLOQUEA al terminar, también si algo falla a mitad (está en el `finally`).
//
// What it pins: phase B of the plan of 2026-10-31 (migration 170) -- a blocked
// account is READ-ONLY across everything it can write. The owner's list:
// «registrar pedidos, crear producto, publicar producto en catálogo, registrar
// fiado o venta, registrar abono, registrar cliente».
//
// IT WRITES AS THE OWNER, with the owner's own session (magic link, no
// password typed), never with the service key. The service key bypasses RLS,
// so a suite built on it would pass with every policy of this migration
// missing -- the lesson of migration 108, whose suite passed 14/14 while the
// Pedidos screen was empty for every owner.
//
// EVERY WRITE IS TRIED TWICE: blocked (it must be refused) and unblocked (the
// SAME write must succeed). The second half is not decoration. A write that is
// refused for any OTHER reason -- a missing column, a check constraint --
// looks exactly like a write refused by the block, and the first draft of this
// suite had two of those: it would have reported the block working with the
// block absent.
//
// And it checks what a careless block would break: a blocked owner still READS
// everything, still empties the bell, and still receives catalog orders.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

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
// A refused insert comes back as an error; a refused update or delete comes
// back as ZERO rows, with no error at all. Both count as refused.
const rechazado = ({ data, error }) => Boolean(error) || (Array.isArray(data) && data.length === 0);
const motivo = ({ data, error }) => (error ? `${error.code ?? ""} ${error.message}`.trim().slice(0, 90) : `${Array.isArray(data) ? data.length : "ok"} filas`);

const NEGOCIO = "QA Security Test";
const MARCA = "QA Bloqueo";
const ACTOR = "qa-bloqueo@sevenz.test";
const creados = { productos: [], ventas: [], pedidos: [], clientes: [], enlaces: [], fotos: [] };

const { data: dueno } = await admin.from("owners").select("id, country").eq("business_name", NEGOCIO).single();
if (!dueno) throw new Error(`no existe el negocio ${NEGOCIO} en dev`);
const OWNER = dueno.id;

const u = await admin.auth.admin.getUserById(OWNER);
const { data: lk } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.data.user.email });
const { data: ses } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: lk.properties.hashed_token });
const comoDueno = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
  global: { headers: { Authorization: `Bearer ${ses.session.access_token}` } },
});

let bloqueado = false;
try {
  // ── Lo que ya existe antes del bloqueo, escrito con la clave de servicio ──
  const { data: cli } = await admin.from("clients").insert({ owner_id: OWNER, name: `${MARCA} cliente` }).select("id").single();
  creados.clientes.push(cli.id);
  const fiado = async () =>
    (await admin.from("movements").insert({ client_id: cli.id, created_by: OWNER, type: "charge", amount: 50000, currency: null, source: "manual" }).select("id").single()).data.id;
  const [f1, f2] = [await fiado(), await fiado()];
  const { data: prod } = await admin
    .from("products")
    .insert({ owner_id: OWNER, name: `${MARCA} producto`, base_currency: "COP", base_currency_retail: "COP", base_currency_wholesale: "COP", price_retail: 1000, price_wholesale: 900, published_retail: true, published_wholesale: false })
    .select("id")
    .single();
  creados.productos.push(prod.id);
  await admin.from("product_currencies").insert([{ product_id: prod.id, tier: "retail", currency: "COP" }]);
  const { data: venta } = await admin.from("sales").insert({ owner_id: OWNER, client_id: cli.id }).select("id").single();
  creados.ventas.push(venta.id);
  await admin.from("sale_lines").insert({ sale_id: venta.id, name: "QA", quantity: 1, unit_price: 1000, currency: "COP" });
  const nuevoPedido = async () => {
    const { data: p } = await admin
      .from("catalog_orders")
      .insert({ owner_id: OWNER, customer_name: `${MARCA} pedido`, customer_document: "12345678", customer_whatsapp: "573000000000", customer_whatsapp_raw: "3000000000", status: "new" })
      .select("id")
      .single();
    creados.pedidos.push(p.id);
    const { data: l } = await admin
      .from("catalog_order_items")
      .insert({ order_id: p.id, product_name: "QA", quantity: 1, unit_price: 1000, currency: "COP", tier: "retail" })
      .select("id")
      .single();
    return { pedido: p.id, linea: l.id };
  };
  const pedidoA = await nuevoPedido();
  const pedidoB = await nuevoPedido();
  const { data: oculto } = await admin.from("client_hides").insert({ owner_id: OWNER, client_id: cli.id, action: "trashed" }).select("id").single();
  let { data: enlace } = await admin.from("catalog_share_links").select("id, token").eq("owner_id", OWNER).maybeSingle();
  if (!enlace) {
    ({ data: enlace } = await admin.from("catalog_share_links").insert({ owner_id: OWNER }).select("id, token").single());
    creados.enlaces.push(enlace.id);
  }

  // ── Las escrituras, cada una como función para poder repetirla ──
  // `n` distingue el intento bloqueado (0) del desbloqueado (1) donde hace falta
  // un valor distinto, y cada una devuelve el resultado de Supabase.
  const escrituras = [
    ["1. crear producto", () =>
      comoDueno.from("products").insert({ owner_id: OWNER, name: `${MARCA} nuevo`, base_currency: "COP", base_currency_retail: "COP", base_currency_wholesale: "COP", price_retail: 5 }).select("id")],
    ["2. publicar en el catálogo (editar el producto)", (n) =>
      comoDueno.from("products").update({ published_wholesale: n === 1 }).eq("id", prod.id).select("id")],
    ["2b. cambiar las monedas del producto", async (n) => {
      // The unblocked attempt starts from the same state as the blocked one:
      // if the blocked insert ever got through, its row would make the second
      // one fail on the primary key instead of on the block.
      if (n === 1) await admin.from("product_currencies").delete().eq("product_id", prod.id).eq("tier", "wholesale");
      return comoDueno.from("product_currencies").insert({ product_id: prod.id, tier: "wholesale", currency: "COP" }).select("product_id");
    }],
    ["2c. subir la foto de un producto", () =>
      comoDueno.storage.from("product-photos").upload(`${OWNER}/qa-bloqueo-${Date.now()}.png`, new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }))],
    ["3. registrar una venta (también de contado)", () =>
      comoDueno.from("sales").insert({ owner_id: OWNER, client_id: cli.id }).select("id")],
    ["3b. añadir una línea a una venta", () =>
      comoDueno.from("sale_lines").insert({ sale_id: venta.id, name: "QA", quantity: 1, unit_price: 1, currency: "COP" }).select("id")],
    ["3c. cobrar en una venta", () =>
      comoDueno.from("sale_payments").insert({ sale_id: venta.id, amount: 1, currency: "COP" }).select("id")],
    ["4. registrar un fiado (061)", () =>
      comoDueno.from("movements").insert({ client_id: cli.id, created_by: OWNER, type: "charge", amount: 10, currency: null }).select("id")],
    ["5. registrar un abono dirigido (061)", () =>
      comoDueno.from("movements").insert({ client_id: cli.id, created_by: OWNER, type: "payment", amount: 10, currency: null, applies_to_movement_id: f1 }).select("id")],
    ["5b. registrar un abono REPARTIDO", async () => {
      const r = await comoDueno.rpc("registrar_abono_repartido", { p_lineas: [{ fiado_id: f1, amount: 10 }, { fiado_id: f2, amount: 10 }] });
      // The function answers with a body, never an error: turn it into the
      // same shape as a table write so both halves read it the same way.
      return r.data?.ok === true ? { data: [r.data], error: null } : { data: null, error: { message: JSON.stringify(r.data ?? r.error?.message) } };
    }],
    ["6. registrar un cliente (061)", () =>
      comoDueno.from("clients").insert({ owner_id: OWNER, name: `${MARCA} otro` }).select("id")],
    ["6b. marcar mala paga", () =>
      comoDueno.from("client_flags").insert({ owner_id: OWNER, client_id: cli.id, reason: "QA" }).select("id")],
    ["7. registrar un pedido", (n) =>
      comoDueno.from("catalog_orders").update({ status: "registered", registered_at: new Date().toISOString() }).eq("id", n === 0 ? pedidoA.pedido : pedidoB.pedido).select("id")],
    ["7b. descartar un pedido", (n) =>
      comoDueno.from("catalog_orders").update({ status: "discarded" }).eq("id", n === 0 ? pedidoB.pedido : pedidoA.pedido).select("id")],
    ["7c. quitar una línea del pedido", (n) =>
      comoDueno.from("catalog_order_items").update({ deleted_at: new Date().toISOString() }).eq("id", n === 0 ? pedidoA.linea : pedidoB.linea).select("id")],
  ];

  // ── Bloquear ──
  await admin.rpc("admin_asegura_suscripcion", { p_owner: OWNER });
  const rb = await admin.rpc("admin_bloquear", { p_owner: OWNER, p_motivo: "QA: prueba del bloqueo completo", p_actor_email: ACTOR });
  if (rb.error) throw new Error(`admin_bloquear: ${rb.error.message}`);
  bloqueado = true;
  const { data: puede } = await comoDueno.rpc("owner_puede_escribir", { p_owner: OWNER });
  check("0. el negocio queda bloqueado", puede === false, `owner_puede_escribir = ${puede}`);

  const bloqueadas = [];
  for (const [nombre, f] of escrituras) {
    const r = await f(0);
    if (!r.error && r.data?.path) creados.fotos.push(r.data.path);
    bloqueadas.push([nombre, r]);
  }

  // ── Lo que tiene que seguir funcionando con la cuenta bloqueada ──
  const lecturas = await Promise.all([
    comoDueno.from("clients").select("id").eq("id", cli.id),
    comoDueno.from("movements").select("id").eq("id", f1),
    comoDueno.from("products").select("id").eq("id", prod.id),
    comoDueno.from("sales").select("id").eq("id", venta.id),
    comoDueno.from("sale_lines").select("id").eq("sale_id", venta.id),
    comoDueno.from("catalog_orders").select("id").eq("id", pedidoA.pedido),
    comoDueno.from("catalog_order_items").select("id").eq("order_id", pedidoA.pedido),
    comoDueno.from("product_currencies").select("product_id").eq("product_id", prod.id),
  ]);
  check("8. bloqueado, SIGUE LEYENDO todo: clientes, fiados, productos, ventas, pedidos",
    lecturas.every((x) => !x.error && (x.data ?? []).length > 0),
    lecturas.map((x) => (x.error ? "error" : (x.data ?? []).length)).join(" · "));
  const leida = await comoDueno.from("client_hides").update({ read_at: new Date().toISOString() }).eq("id", oculto.id).select("id");
  check("9. bloqueado, SIGUE pudiendo vaciar la campana (marcar como leída)", !leida.error && (leida.data ?? []).length === 1, motivo(leida));
  const pedidoCliente = await anon.rpc("create_catalog_order", {
    p_token: enlace.token,
    p_customer_name: `${MARCA} comprador`,
    p_customer_document: "12345678",
    p_customer_document_type: "CC",
    p_customer_whatsapp: "3001234567",
    p_wants_notices: false,
    p_consent_text: null,
    p_items: [{ product_id: prod.id, quantity: 1, currency: "COP", comment: null }],
  });
  if (pedidoCliente.data?.order_id) creados.pedidos.push(pedidoCliente.data.order_id);
  check("10. bloqueado, el catálogo SIGUE recibiendo pedidos de clientes (decisión del dueño)",
    pedidoCliente.data?.ok === true, JSON.stringify(pedidoCliente.data ?? pedidoCliente.error?.message).slice(0, 120));

  // ── Desbloquear, y la MISMA escritura tiene que salir bien ──
  const rd = await admin.rpc("admin_desbloquear", { p_owner: OWNER, p_actor_email: ACTOR, p_motivo: "QA: fin de la prueba" });
  if (rd.error) throw new Error(`admin_desbloquear: ${rd.error.message}`);
  bloqueado = false;

  for (const [i, [nombre, f]] of escrituras.entries()) {
    const r = await f(1);
    if (!r.error && r.data?.path) creados.fotos.push(r.data.path);
    if (!r.error && Array.isArray(r.data) && r.data[0]?.id && nombre.startsWith("3. ")) creados.ventas.push(r.data[0].id);
    if (!r.error && Array.isArray(r.data) && r.data[0]?.id && nombre.startsWith("1. ")) creados.productos.push(r.data[0].id);
    if (!r.error && Array.isArray(r.data) && r.data[0]?.id && nombre.startsWith("6. ")) creados.clientes.push(r.data[0].id);
    const [, b] = bloqueadas[i];
    check(`${nombre}: rechazado bloqueado, aceptado desbloqueado`, rechazado(b) && !rechazado(r),
      `bloqueado: ${rechazado(b) ? "rechazado" : "ACEPTADO"} (${motivo(b)}) · desbloqueado: ${rechazado(r) ? "RECHAZADO" : "aceptado"} (${motivo(r)})`);
  }
} catch (e) {
  check("ERROR", false, e instanceof Error ? e.message : String(e));
} finally {
  if (bloqueado) await admin.rpc("admin_desbloquear", { p_owner: OWNER, p_actor_email: ACTOR, p_motivo: "QA: limpieza tras fallo" });
  if (creados.fotos.length) await admin.storage.from("product-photos").remove(creados.fotos);
  await admin.from("catalog_orders").delete().eq("owner_id", OWNER).like("customer_name", `${MARCA}%`);
  if (creados.pedidos.length) await admin.from("catalog_orders").delete().in("id", creados.pedidos);
  if (creados.ventas.length) await admin.from("sales").delete().in("id", creados.ventas);
  await admin.from("sales").delete().eq("owner_id", OWNER).in("client_id", creados.clientes.length ? creados.clientes : ["00000000-0000-0000-0000-000000000000"]);
  if (creados.productos.length) {
    await admin.from("product_currencies").delete().in("product_id", creados.productos);
    await admin.from("product_price_overrides").delete().in("product_id", creados.productos);
    await admin.from("products").delete().in("id", creados.productos);
  }
  await admin.from("products").delete().eq("owner_id", OWNER).like("name", `${MARCA}%`);
  if (creados.clientes.length) {
    await admin.from("client_hides").delete().in("client_id", creados.clientes);
    await admin.from("client_flags").delete().in("client_id", creados.clientes);
    await admin.from("movements").delete().in("client_id", creados.clientes);
    await admin.from("clients").delete().in("id", creados.clientes);
  }
  await admin.from("clients").delete().eq("owner_id", OWNER).like("name", `${MARCA}%`);
  if (creados.enlaces.length) await admin.from("catalog_share_links").delete().in("id", creados.enlaces);
  const { data: puedeAlFinal } = await admin.rpc("owner_puede_escribir", { p_owner: OWNER });
  const { count } = await admin.from("clients").select("id", { count: "exact", head: true }).like("name", `${MARCA}%`);
  const { count: prods } = await admin.from("products").select("id", { count: "exact", head: true }).like("name", `${MARCA}%`);
  check("12. limpieza: el negocio queda desbloqueado y sin restos", puedeAlFinal === true && count === 0 && prods === 0,
    `puede escribir = ${puedeAlFinal} · quedan ${count} clientes y ${prods} productos`);
  const fallos = filas.filter((f) => !f.pasa).length;
  console.log(`\n${filas.length - fallos}/${filas.length} pasan.`);
  process.exit(fallos === 0 ? 0 : 1);
}
