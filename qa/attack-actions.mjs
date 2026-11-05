// SERVER ACTIONS ATTACKED OVER HTTP -- the gap left by `qa:attack`, closed at
// the owner's request of 2026-11-02 («haz la fase 1 en dev y luego implementa
// la fase 2»).
//
// WHY A SUITE OF ITS OWN: an action is not a fixed URL. The page POSTs to
// itself with a `next-action` header holding an id that changes on every
// build, and the arguments go in React's internal reply format. This suite
// reads the ids from the dev server's manifest and encodes the arguments with
// React's OWN encoder (the one shipped inside Next), so the request is the
// one a browser sends -- nothing hand-rolled to drift.
//
// EVERY ATTACK HAS A POSITIVE CONTROL, and it is the point of the design: the
// SAME call, same shape, with the attacker's own ids, must WORK. Without it a
// malformed request is refused for the wrong reason («monto inválido») and the
// row reads «blocked» having attacked nothing -- the worst failure here,
// because it looks like safety. A control that does not work marks the row
// «SIN PROBAR», never «BLOQUEADO».
//
// THE VERDICT IS READ IN THE DATABASE: a snapshot of the victim's rows before
// and after every attack must be identical, and nothing of the victim may come
// back in the response.
//
// NOTHING LEAVES THE MACHINE: no control is allowed to send a WhatsApp, call
// Gemini, send an e-mail or emit a Mixpanel event. Actions that would, get
// their control from a sibling with the same arguments, or are covered by an
// existing suite that already attacks them -- both named in
// `qa/attack-surface.mjs`, so `qa:attack-coverage` fails on any action that is
// neither attacked nor covered.
//
// Phase 1: the 14 actions guarded only by code (/admin, the client's link, the
// catalogue). Phase 2: the owner's actions, double-guarded by code and RLS.
//
// Needs `npm run dev`. Dev only.
import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createRequire } from "node:module";
import { MANIFEST } from "./attack-surface.mjs";

const require = createRequire(import.meta.url);
const { encodeReply } = require("next/dist/compiled/react-server-dom-webpack/client.edge");

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const REF = "vzqppwrwnmlbrxizskdh";
if (!env.NEXT_PUBLIC_SUPABASE_URL.includes(REF)) {
  console.error("Esta suite ataca la app: solo corre contra la rama dev (vzqppwrwnmlbrxizskdh).");
  process.exit(1);
}
const BASE = "http://localhost:3000";
const MANIFIESTO = new URL("../.next/dev/server/server-reference-manifest.json", import.meta.url);
const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const login = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const R = [];
const rec = (fase, accion, ataque, verdict, detalle = "") => {
  R.push({ fase, accion, verdict });
  if (!["BLOQUEADO", "CUBIERTA", "INALCANZABLE"].includes(verdict) || process.argv.includes("--todo"))
    console.log(`${verdict.padEnd(10)} | fase ${fase} | ${accion} | ${ataque}${detalle ? `  — ${String(detalle).slice(0, 180)}` : ""}`);
};
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = Date.now().toString().slice(-6);

// ── Sessions ─────────────────────────────────────────────────────────────
const usuarios = [];
async function sesion(email, tipo = "magiclink") {
  // tipo "recovery" gives the session the e-mailed reset link gives -- made
  // here with the admin API, so no e-mail is sent.
  const { data: lk } = await svc.auth.admin.generateLink({ type: tipo, email });
  const { data: ses, error } = await login.auth.verifyOtp({ type: tipo, token_hash: lk.properties.hashed_token });
  if (error) throw new Error(`otp: ${error.message}`);
  // Chunked like @supabase/ssr does above ~3180 characters.
  const valor = `base64-${Buffer.from(JSON.stringify(ses.session)).toString("base64url")}`;
  const MAX = 3180;
  const partes = valor.length <= MAX ? [[`sb-${REF}-auth-token`, valor]] : Array.from({ length: Math.ceil(valor.length / MAX) }, (_, i) => [`sb-${REF}-auth-token.${i}`, valor.slice(i * MAX, (i + 1) * MAX)]);
  return partes.map(([k, v]) => `${k}=${v}`).join("; ");
}
async function dueno(tag) {
  const email = `zz-actions-${tag}-${stamp}@sevenz-qa.test`;
  const { data, error } = await svc.auth.admin.createUser({ email, email_confirm: true, user_metadata: { business_name: `ZZ Actions ${tag}`, country: "VE", first_name: tag } });
  if (error) throw new Error(`createUser: ${error.message}`);
  usuarios.push(data.user.id);
  // Onboarding done, or every page of the app redirects there (307) and no
  // control can work.
  await svc.from("owners").update({ onboarding_completed_at: new Date().toISOString() }).eq("id", data.user.id);
  return { id: data.user.id, email, cookie: await sesion(email) };
}

// ── Calling an action exactly like the browser does ──────────────────────
let acciones = {};
const leerManifiesto = () => {
  if (!existsSync(MANIFIESTO)) return {};
  const m = JSON.parse(readFileSync(MANIFIESTO, "utf8")).node;
  const porClave = {};
  for (const [id, v] of Object.entries(m)) porClave[`${v.filename}#${v.exportedName}`] = { id, paginas: Object.keys(v.workers ?? {}) };
  return porClave;
};

async function llamar(clave, args, cookie, pagina) {
  const a = acciones[clave];
  if (!a) return { status: 0, valor: undefined, error: "acción no compilada" };
  const body = await encodeReply(args);
  const headers = { "next-action": a.id, accept: "text/x-component", origin: BASE };
  if (cookie) headers.cookie = cookie;
  if (typeof body === "string") headers["content-type"] = "text/plain;charset=UTF-8";
  const res = await fetch(BASE + (pagina ?? a.ruta), { method: "POST", headers, body, redirect: "manual" });
  const texto = await res.clone().text();
  return { status: res.status, valor: valorDeLaAccion(texto), texto };
}

// THE ACTION'S RETURN VALUE, read from the raw Flight rows. Row 0 points at
// the row holding it («"a":"$@1"»); that row is plain JSON for every value
// these actions return. Rebuilding the whole tree with createFromFetch fails
// on any action that also re-renders the page, because the tree carries
// client components this script cannot load -- and that failure would read
// as «the action did not work».
function valorDeLaAccion(texto) {
  const filas = texto.split("\n");
  const raiz = filas.find((l) => l.startsWith("0:"));
  const ref = raiz && /"a":"\$@([0-9a-f]+)"/.exec(raiz)?.[1];
  if (!ref) return new Error(texto.slice(0, 120) || "respuesta vacía");
  const propias = filas.filter((l) => l.startsWith(`${ref}:`) && !l.startsWith(`${ref}:D`));
  const ultima = propias.at(-1);
  if (!ultima) return new Error("sin valor");
  if (ultima.startsWith(`${ref}:E`)) return new Error(ultima.slice(ref.length + 2, 160));
  const cuerpo = ultima.slice(ref.length + 1);
  if (cuerpo === "\"$undefined\"") return undefined;
  try { return JSON.parse(cuerpo); } catch { return cuerpo; }
}

// «Did it work?» -- for an action that returns {ok}, {error} or data.
const funciono = (r) =>
  r.status === 200 && !(r.valor instanceof Error) &&
  !(r.valor && typeof r.valor === "object" && (r.valor.ok === false || (typeof r.valor.error === "string" && r.valor.error)));

const puedeEntrar = async (email, password) => {
  const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  return !error;
};
const perfilA = { business_name: "ZZ Actions a", first_name: "a", last_name: "zz", whatsapp: "04121112255", address: "", tax_id: "", country: "VE" };
const fd = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, String(v)); return f; };

try {
  // ── Fixtures ───────────────────────────────────────────────────────────
  const A = await dueno("a");
  const B = await dueno("b");
  const superadminEmail = (env.SUPERADMIN_EMAILS ?? "").split(",")[0].trim();
  const SA = superadminEmail ? await sesion(superadminEmail) : null;

  const nuevoCliente = async (owner, name) => (await svc.from("clients").insert({ owner_id: owner, name, document_id: owner === B.id ? "12345678" : "23456789", document_type: "V", whatsapp: owner === B.id ? "584121112233" : "584121112244" }).select("id").single()).data.id;
  const ctx = { A, B };
  for (const [quien, o] of [["A", A], ["B", B]]) {
    ctx[`c${quien}`] = await nuevoCliente(o.id, `Cliente de ${quien}`);
    ctx[`m${quien}`] = (await svc.from("movements").insert({ client_id: ctx[`c${quien}`], created_by: o.id, type: "charge", amount: 100, currency: "USD", source: "manual", description: `Fiado de ${quien}` }).select("id, transaction_code").single()).data;
    ctx[`p${quien}`] = (await svc.from("products").insert({ owner_id: o.id, name: `Producto de ${quien}`, base_currency: "USD", price_retail: 10, published_retail: true }).select("id").single()).data.id;
    ctx[`s${quien}`] = (await svc.from("sales").insert({ owner_id: o.id, client_id: ctx[`c${quien}`] }).select("id").single()).data.id;
    await svc.from("sale_lines").insert({ sale_id: ctx[`s${quien}`], name: `Línea de ${quien}`, quantity: 1, unit_price: 10, currency: "USD" });
    await svc.from("sale_payments").insert({ sale_id: ctx[`s${quien}`], amount: 10, currency: "USD" });
    ctx[`o${quien}`] = (await svc.from("catalog_orders").insert({ owner_id: o.id, customer_name: `Pedido de ${quien}`, customer_document: "1234567", customer_whatsapp: "584121112233", customer_whatsapp_raw: "04121112233" }).select("id").single()).data.id;
    ctx[`l${quien}`] = (await svc.from("catalog_order_items").insert({ order_id: ctx[`o${quien}`], product_id: ctx[`p${quien}`], product_name: `Producto de ${quien}`, quantity: 1, unit_price: 10, currency: "USD", tier: "retail" }).select("id").single()).data?.id;
    ctx[`tok${quien}`] = `zzact${quien}${Math.random().toString(16).slice(2, 12)}`;
    await svc.from("share_links").insert({ client_id: ctx[`c${quien}`], token: ctx[`tok${quien}`] });
    ctx[`link${quien}`] = (await svc.from("catalog_share_links").insert({ owner_id: o.id }).select("token").single()).data.token;
    // Migration 179: one payment method each, B's being the one A goes after.
    ctx[`pm${quien}`] = (await svc.from("owner_payment_methods").insert({ owner_id: o.id, body: `Pago móvil de ${quien}` }).select("id").single()).data?.id;
    // Migration 184: a category each, B's being the one A goes after; A gets a
    // second one so the delete control has something of its own to delete.
    ctx[`cat${quien}`] = (await svc.from("product_categories").insert({ owner_id: o.id, name: `Categoría de ${quien}` }).select("id").single()).data?.id;
  }
  ctx.catA2 = (await svc.from("product_categories").insert({ owner_id: A.id, name: "Categoría de A para borrar" }).select("id").single()).data?.id;
  ctx.mA = ctx.mA.id; ctx.codigoB = ctx.mB.transaction_code; ctx.mB = ctx.mB.id;
  // B's logo, the file the logo attack tries to take over and delete.
  await svc.storage.from("logos").upload(`${B.id}/logo.png`, new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), { upsert: true });
  const SECRETOS = ["Cliente de B", "Producto de B", "Pedido de B", "Línea de B", "Fiado de B", "12345678", ctx.tokB, B.email, "ZZ Actions b", "Pago móvil de B", "Categoría de B"];
  const filtra = (x) => { let t; try { t = JSON.stringify(x ?? ""); } catch { t = String(x); } return SECRETOS.find((s) => t.includes(s)) ?? null; };

  // A snapshot of everything B owns, to compare before/after each attack.
  const foto = async (o, c) => {
    const [cli, mov, prod, ven, ped, flags, hides, links, sub, ev, own, pagos, cats] = await Promise.all([
      svc.from("clients").select("id,name,document_id,whatsapp,trashed_at,deleted_at,is_flagged,profile_picture_path").eq("owner_id", o).order("id"),
      svc.from("movements").select("id,amount,type,deleted_at,client_id,description").eq("client_id", c).order("id"),
      svc.from("products").select("id,name,price_retail,published_retail,published_wholesale,trashed_at,owner_id,category_id").eq("owner_id", o).order("id"),
      svc.from("sales").select("id,deleted_at,client_id").eq("owner_id", o).order("id"),
      svc.from("catalog_orders").select("id,status,sale_id,discarded_at").eq("owner_id", o).order("id"),
      svc.from("client_flags").select("id,unflagged_at").eq("owner_id", o).order("id"),
      svc.from("client_hides").select("*").eq("owner_id", o),
      svc.from("share_links").select("token").eq("client_id", c),
      svc.from("subscriptions").select("estado,plan_code,demo_termina_el,periodo_termina_el,is_test_account,precio_pactado_usd").eq("owner_id", o).maybeSingle(),
      svc.from("subscription_events").select("id", { count: "exact", head: true }).eq("owner_id", o),
      svc.from("owners").select("business_name,country,plan,whatsapp,logo_path").eq("id", o).single(),
      svc.from("owner_payment_methods").select("id,body,owner_id").eq("owner_id", o).order("id"),
      svc.from("product_categories").select("id,name,owner_id").eq("owner_id", o).order("id"),
    ]);
    return JSON.stringify([cli.data, mov.data, prod.data, ven.data, ped.data, flags.data, hides.data, links.data, sub.data, ev.count, own.data, pagos.data, cats.data]);
  };
  const fotoB = () => foto(B.id, ctx.cB);
  const fotoA = () => foto(A.id, ctx.cA);

  // ── Warm-up: compile every page so every action is in the manifest ────
  const rutas = [
    ["/dashboard", A.cookie], ["/clients", A.cookie], [`/clients/${ctx.cA}`, A.cookie], ["/clients/nuevo", A.cookie],
    ["/productos", A.cookie], ["/productos/nuevo", A.cookie], [`/productos/${ctx.pA}`, A.cookie], [`/productos/${ctx.pA}/editar`, A.cookie],
    ["/productos/ordenes", A.cookie], [`/productos/ordenes/${ctx.oA}`, A.cookie], [`/productos/ordenes/${ctx.oA}/registrar`, A.cookie],
    ["/ventas/nueva", A.cookie], [`/ventas/${ctx.sA}`, A.cookie], ["/abonos/nuevo", A.cookie], [`/abonos/nuevo/${ctx.mA}`, A.cookie],
    [`/abonos/nuevo/${ctx.mA}/monto`, A.cookie], [`/abonos/${ctx.mA}`, A.cookie], ["/import", A.cookie], ["/profile", A.cookie],
    ["/reportes", A.cookie], ["/malas-pagas", A.cookie], ["/papelera", A.cookie], ["/notificaciones", A.cookie], [`/transacciones/${ctx.mA}`, A.cookie],
    ["/admin", SA], ["/admin/cuentas", SA], [`/admin/cuentas/${A.id}`, SA],
    [`/s/${ctx.tokB}`, null], [`/s/${ctx.tokB}/perfil`, null], [`/c/${ctx.linkB}`, null], [`/c/${ctx.linkB}/carrito`, null],
    ["/login", null], ["/signup", null], ["/forgot-password", null], ["/reset-password", null],
  ];
  for (const [ruta, cookie] of rutas) await fetch(BASE + ruta, { headers: cookie ? { cookie } : {} }).catch(() => null);
  await dormir(1500);
  const crudo = leerManifiesto();

  // The page each action is POSTed to: one that includes it, params filled.
  const rellenar = (pagina) =>
    pagina.replace(/^app/, "").replace(/\/page$/, "").replace(/\/\([^)]+\)/g, "")
      .replace(/\/s\/\[token\]/, `/s/${ctx.tokB}`).replace(/\/c\/\[token\]/, `/c/${ctx.linkB}`)
      .replace(/\/clients\/\[id\]/, `/clients/${ctx.cA}`).replace(/\/productos\/ordenes\/\[id\]/, `/productos/ordenes/${ctx.oA}`)
      .replace(/\/productos\/\[id\]/, `/productos/${ctx.pA}`).replace(/\[movementId\]/, ctx.mA).replace(/\[ownerId\]/, A.id)
      .replace(/\[saleId\]/, ctx.sA).replace(/\[moneda\]/, "usd").replace(/\[itemId\]/, ctx.lA ?? "x").replace(/\[productId\]/, ctx.pB) || "/";
  for (const [clave, v] of Object.entries(crudo)) {
    const estatica = v.paginas.find((p) => !p.includes("["));
    acciones[clave] = { id: v.id, ruta: rellenar(estatica ?? v.paginas[0] ?? "app/page") };
  }

  // ── The attack table ───────────────────────────────────────────────────
  // ataque: who calls, with what. control: the SAME shape with the caller's
  // own data, or `hermana` (a sibling action with the same arguments) when the
  // action itself would reach outside the machine.
  const ADM = "app/admin/cuentas/actions.ts";
  const adminAccion = (nombre, campos) => ({
    clave: `${ADM}#${nombre}`, fase: 1,
    ataques: [
      ["un dueño la llama sobre sí mismo", A.cookie, () => [null, fd({ owner_id: A.id, ...campos })]],
      ["un dueño la llama sobre otro negocio", A.cookie, () => [null, fd({ owner_id: B.id, ...campos })]],
      ["un anónimo la llama", null, () => [null, fd({ owner_id: B.id, ...campos })]],
    ],
    control: SA && [SA, () => [null, fd({ owner_id: A.id, ...campos })]],
  });
  const S = "app/s/[token]/actions.ts";
  const C = "app/c/[token]/actions.ts";
  const P = (f) => `app/(app)/${f}`;
  const T = [
    // ── FASE 1 ──
    adminAccion("accionDarDemo", { dias: 30, notas: "zz", precio: "", periodicidad: "" }),
    adminAccion("accionCambiarPlan", { plan: "pro", periodicidad: "mensual", precio: "19.5", notas: "zz" }),
    adminAccion("accionRegistrarPago", { monto: 19.5, metodo: "zz", hasta: "2099-12-31", notas: "zz" }),
    adminAccion("accionBloquear", { motivo: "zz prueba" }),
    adminAccion("accionDesbloquear", { motivo: "zz" }),
    adminAccion("accionMarcarPrueba", { es_prueba: "1" }),
    { clave: "app/admin/actions.ts#runServiceChecks", fase: 1, ataques: [["un dueño pide el estado de los servicios", A.cookie, () => []], ["un anónimo", null, () => []]], control: null, sinControl: "hace sondas a servicios externos; el formato sin argumentos lo prueba getUnreadNotificationCount" },
    { clave: `${S}#submitDocumentId`, fase: 1, ataques: [["con un token falso", null, () => ["zz-no-existe", "87654321", "V"]]], control: [null, () => [ctx.tokB, "87654321", "V"]] },
    { clave: `${S}#submitFeedback`, fase: 1, ataques: [["con un token falso", null, () => ["zz-no-existe", "zz opinión"]]], control: [null, () => [ctx.tokB, "zz opinión"]] },
    { clave: `${S}#acceptWhatsappConsent`, fase: 1, ataques: [["con un token falso", null, () => ["zz-no-existe"]]], control: [null, () => [ctx.tokB]] },
    { clave: `${S}#revokeWhatsappConsent`, fase: 1, ataques: [["con un token falso", null, () => ["zz-no-existe"]]], control: [null, () => [ctx.tokB]] },
    { clave: `${S}#uploadProfilePicture`, fase: 1, inalcanzable: "cerrada a propósito junto con /s/[token]/perfil", ataques: [["sigue cerrada (no sube nada)", null, () => []]], control: null, sinControl: "cerrada a propósito; no tiene camino bueno que probar" },
    { clave: `${C}#productosDelCarrito`, fase: 1, ataques: [["con un token falso", null, () => ["zz-no-existe", [ctx.pB]]], ["con el catálogo de A, pide el producto de B", null, () => [ctx.linkA, [ctx.pB]]]], control: [null, () => [ctx.linkB, [ctx.pB]]], exito: (r) => funciono(r) && JSON.stringify(r.valor).includes("Producto de B") },
    { clave: `${C}#crearOrden`, fase: 1, ataques: [["con el catálogo de A, compra el producto de B", null, () => [ctx.linkA, { nombre: "zz", documento: "V-12345678", tipoDeDocumento: "V", whatsapp: "04121990109", direccion: "", quiereAvisos: false, textoDelPermiso: null }, [{ product_id: ctx.pB, quantity: 1, currency: "USD", comment: null }]]], ["con un token falso", null, () => ["zz-no-existe", { nombre: "zz", documento: "V-12345678", tipoDeDocumento: "V", whatsapp: "04121990109", direccion: "", quiereAvisos: false, textoDelPermiso: null }, [{ product_id: ctx.pB, quantity: 1, currency: "USD", comment: null }]]]], control: null, hermana: `${C}#productosDelCarrito`, sinControl: "manda un evento a Mixpanel al salir bien; su control es productosDelCarrito (mismo token, misma puerta)" },

    // ── FASE 2: reads by id ──
    ...[["ventas/actions.ts#datosDelCliente", "cB", "cA"], ["ventas/actions.ts#cuentaDelCliente", "cB", "cA"], ["ventas/actions.ts#resumenDeVenta", "sB", "sA"], ["ventas/actions.ts#productoParaVentaPorId", "pB", "pA"], ["dashboard/actions.ts#getOrCreateShareLink", "cB", "cA"]].map(([k, b, a]) => ({
      clave: P(k), fase: 2, ataques: [["con el id de B", A.cookie, () => [ctx[b]]]], control: [A.cookie, () => [ctx[a]]],
    })),
    { clave: P("dashboard/search-transactions.ts#searchTransactionsByCode"), fase: 2, ataques: [["busca el código de un movimiento de B", A.cookie, () => [ctx.codigoB ?? "ZZZZZZZ"]]], control: [A.cookie, () => ["zz"]] },
    { clave: P("productos/actions.ts#buscarProductos"), fase: 2, inalcanzable: "su único componente (movement-products-field) no está montado en ninguna pantalla", ataques: [["busca el producto de B por su nombre", A.cookie, () => ["Producto de B"]]], control: [A.cookie, () => ["Producto de A"]], exito: (r) => funciono(r) && JSON.stringify(r.valor).includes("Producto de A") },
    { clave: P("ventas/actions.ts#buscarProductosParaVenta"), fase: 2, ataques: [["busca el producto de B por su nombre", A.cookie, () => ["Producto de B"]]], control: [A.cookie, () => ["Producto de A"]], exito: (r) => funciono(r) && JSON.stringify(r.valor).includes("Producto de A") },

    // ── FASE 2: writes by id ──
    ...[["clients/[id]/actions.ts#unflagClient", "cB", "cA"], ["clients/[id]/actions.ts#trashClient", "cB", "cA"], ["clients/[id]/actions.ts#restoreClient", "cB", "cA"], ["clients/[id]/actions.ts#hideClientPermanently", "cB", null],
        ["dashboard/actions.ts#deleteMovement", "mB", "mA"], ["dashboard/actions.ts#restoreMovement", "mB", "mA"], ["productos/actions.ts#trashProduct", "pB", "pA"], ["productos/actions.ts#restoreProduct", "pB", "pA"],
        ["productos/ordenes/actions.ts#descartarPedido", "oB", "oA"], ["productos/ordenes/actions.ts#restaurarPedido", "oB", "oA"], ["ventas/actions.ts#eliminarVenta", "sB", "sA"]].map(([k, b, a]) => ({
      clave: P(k), fase: 2, ataques: [["con el id de B", A.cookie, () => [ctx[b]]]], control: a ? [A.cookie, () => [ctx[a]]] : null, hermana: a ? null : P("clients/[id]/actions.ts#trashClient"), sinControl: a ? null : "borra para siempre; su control es trashClient (mismo argumento)",
    })),
    { clave: P("clients/[id]/actions.ts#setClientProfilePicture"), fase: 2, ataques: [["con el cliente de B", A.cookie, () => [ctx.cB, `${A.id}/zz.png`]]], control: [A.cookie, () => [ctx.cA, null]] },
    { clave: P("clients/[id]/actions.ts#setClientWhatsappNotices"), fase: 2, ataques: [["con el cliente de B", A.cookie, () => [ctx.cB, true]]], control: [A.cookie, () => [ctx.cA, false]] },
    { clave: P("dashboard/actions.ts#guardarWhatsappDeCliente"), fase: 2, ataques: [["con el cliente de B", A.cookie, () => [ctx.cB, "04121110000"]]], control: [A.cookie, () => [ctx.cA, "04121110000"]] },
    { clave: P("clients/[id]/actions.ts#updateClient"), fase: 2, ataques: [["con el cliente de B", A.cookie, () => [null, fd({ client_id: ctx.cB, name: "HACKED", whatsapp: "", document_id: "34567890", document_type: "V", address: "" })]]], control: [A.cookie, () => [null, fd({ client_id: ctx.cA, name: "Cliente de A", whatsapp: "", document_id: "34567890", document_type: "V", address: "" })]] },
    { clave: P("clients/[id]/actions.ts#flagClient"), fase: 2, ataques: [["con el cliente de B", A.cookie, () => [null, fd({ client_id: ctx.cB, reason: "zz" })]]], control: [A.cookie, () => [null, fd({ client_id: ctx.cA, reason: "zz" })]] },
    { clave: P("productos/actions.ts#setProductPublished"), fase: 2, ataques: [["con el producto de B", A.cookie, () => [ctx.pB, { retail: false, wholesale: false }]]], control: [A.cookie, () => [ctx.pA, { retail: true, wholesale: false }]] },
    { clave: P("productos/ordenes/actions.ts#quitarLineaDelPedido"), fase: 2, ataques: [["con el pedido de B", A.cookie, () => [ctx.oB, ctx.lB]]], control: null, hermana: P("productos/ordenes/actions.ts#descartarPedido"), sinControl: "su control es descartarPedido (mismo pedido, misma comprobación de dueño)" },
    { clave: P("productos/ordenes/actions.ts#quitarMonedaDelPedido"), fase: 2, ataques: [["con el pedido de B", A.cookie, () => [ctx.oB, "USD"]]], control: null, hermana: P("productos/ordenes/actions.ts#descartarPedido"), sinControl: "su control es descartarPedido (mismo pedido, misma comprobación de dueño)" },
    { clave: P("productos/ordenes/actions.ts#restaurarMonedaDelPedido"), fase: 2, ataques: [["con el pedido de B", A.cookie, () => [ctx.oB, "USD"]]], control: null, hermana: P("productos/ordenes/actions.ts#descartarPedido"), sinControl: "su control es descartarPedido (mismo pedido, misma comprobación de dueño)" },
    { clave: P("ventas/actions.ts#guardarPermisoDeVenta"), fase: 2, ataques: [["con el cliente de B", A.cookie, () => [ctx.cB, "Cliente de B", true]]], control: [A.cookie, () => [ctx.cA, "Cliente de A", false]] },
    { clave: P("abonos/actions.ts#registrarAbonoRepartido"), fase: 2, ataques: [["reparte un abono sobre el cliente de B", A.cookie, () => [{ clienteId: ctx.cB, libro: "USD", montoTecleado: 1, monedaTecleada: "USD", avisarPorWhatsapp: false }]]], control: [A.cookie, () => [{ clienteId: ctx.cA, libro: "USD", montoTecleado: 1, monedaTecleada: "USD", avisarPorWhatsapp: false }]] },
    { clave: P("import/actions.ts#confirmImport"), fase: 2, ataques: [["escribe en el cliente de B desde una libreta", A.cookie, () => [[{ client_id: ctx.cB, client_name: "zz", type: "charge", amount: 7, description: "zz", document_id: null, whatsapp: null, currency: "USD" }]]]], control: null, hermana: P("ventas/actions.ts#datosDelCliente"), sinControl: "manda un evento a Mixpanel al salir bien; su ataque se juzga solo en la base (B intacto)" },

    // ── FASE 2: the owner's own account, mass assignment, strangers ──
    // The logo travels in this form since 2026-11-02 (updateLogo/deleteLogo
    // are gone), so every logo attack goes through it. Finding 10: a path into
    // B's folder, plainly or by climbing out of A's with `../`, must not be
    // stored; and saving with no logo must not delete B's file even when A's
    // row already points at it (the cleanup only touches A's own folder).
    { clave: P("profile/actions.ts#updateBusinessSettings"), fase: 2, ataques: [
      ["se cambia el país (solo lo cambia Sevenz)", A.cookie, () => [null, fd({ ...perfilA, logo_path: "", country: "CO" })]],
      ["pone como logo el archivo de B desde el formulario", A.cookie, () => [null, fd({ ...perfilA, logo_path: `${B.id}/logo.png` })]],
      ["llega a la carpeta de B saliendo de la suya (../)", A.cookie, () => [null, fd({ ...perfilA, logo_path: `${A.id}/../${B.id}/logo.png` })]],
      ["guarda sin logo con su fila apuntando al de B (lo borraría al limpiar)", A.cookie, async () => {
        await svc.from("owners").update({ logo_path: `${B.id}/logo.png` }).eq("id", A.id);
        return [null, fd({ ...perfilA, logo_path: "" })];
      }]],
      // The file is uploaded first, as the app does: since `DM-12` (2026-11-02)
      // a save refuses a NEW logo path whose file does not exist, so a
      // control that only wrote the column would now fail for a right reason.
      control: [A.cookie, async () => {
        await svc.storage.from("logos").upload(`${A.id}/logo-1730000000000.jpg`, Buffer.from([0xff, 0xd8, 0xff, 0xd9]), { contentType: "image/jpeg", upsert: true });
        return [null, fd({ ...perfilA, logo_path: `${A.id}/logo-1730000000000.jpg` })];
      }],
      // The control saves the owner's OWN logo path and checks it stuck: the
      // finding-10 filter must not drop a legitimate logo on every save.
      exitoAsync: async (r) => funciono(r) && (await svc.from("owners").select("logo_path").eq("id", A.id).single()).data.logo_path === `${A.id}/logo-1730000000000.jpg`,
      juzgar: async () => {
        const { data } = await svc.from("owners").select("country,logo_path").eq("id", A.id).single();
        const { data: files } = await svc.storage.from("logos").list(B.id);
        return data.country === "VE" && !String(data.logo_path ?? "").includes(B.id) && (files ?? []).some((o) => o.name === "logo.png");
      } },
    { clave: P("productos/actions.ts#createProduct"), fase: 2, ataques: [["crea un producto con owner_id de B", A.cookie, () => [{ ...productoBase("ZZ plantado"), owner_id: B.id }]], ["crea un producto en la categoría de B (184)", A.cookie, () => [{ ...productoBase("ZZ categoría ajena"), categoryId: ctx.catB }]]], control: [A.cookie, () => [{ ...productoBase("ZZ propio"), categoryId: ctx.catA }]] },
    { clave: P("productos/actions.ts#updateProduct"), fase: 2, ataques: [["edita el producto de B", A.cookie, () => [ctx.pB, productoBase("HACKED")]], ["pone su producto en la categoría de B (184)", A.cookie, () => [ctx.pA, { ...productoBase("Producto de A"), categoryId: ctx.catB }]]], control: [A.cookie, () => [ctx.pA, { ...productoBase("Producto de A"), categoryId: ctx.catA }]] },
    // Migration 184: renaming and deleting take an id from the browser.
    { clave: P("productos/actions.ts#renombrarCategoria"), fase: 2, ataques: [["renombra la categoría de B", A.cookie, () => [ctx.catB, "HACKED"]]], control: [A.cookie, () => [ctx.catA, "Categoría de A"]] },
    { clave: P("productos/actions.ts#eliminarCategoria"), fase: 2, ataques: [["elimina la categoría de B", A.cookie, () => [ctx.catB]]], control: [A.cookie, () => [ctx.catA2]] },
    ...[["actions.ts#getNotifications"], ["actions.ts#getUnreadNotificationCount"], ["actions.ts#completeOnboarding"], ["productos/actions.ts#getOrCreateCatalogLink"], ["ventas/actions.ts#resolverMostrador"],
        ["profile/actions.ts#registrarPreguntaAvisos"]].map(([k]) => ({
      clave: P(k), fase: 2, ataques: [["un anónimo la llama", null, () => []]], control: [A.cookie, () => []],
    })),
    { clave: P("actions.ts#recordImportNotification"), fase: 2, ataques: [["un anónimo la llama", null, () => [{ fileName: "zz", status: "done", movementsCount: 1 }]]], control: [A.cookie, () => [{ fileName: "zz", status: "done", movementsCount: 1 }]] },
    { clave: P("profile/actions.ts#changePassword"), fase: 2, ataques: [["un anónimo la llama", null, () => [null, fd({ new_password: "zzZZ1234!x", confirm_password: "zzZZ1234!x" })]]], control: [A.cookie, () => [null, fd({ new_password: "zzZZ1234!x", confirm_password: "zzZZ1234!x" })]] },
    { clave: P("profile/actions.ts#guardarAvisosWhatsapp"), fase: 2, ataques: [["un anónimo la llama", null, () => [false, "zz"]]], control: [A.cookie, () => [false, "zz"]] },
    // Payment methods (migration 179, 2026-11-02). The controls run with A's
    // own cookie, so a missing grant on the new table shows up here as a
    // failed control -- the `108` lesson -- and not only as a blocked attack.
    { clave: P("profile/actions.ts#addPaymentMethod"), fase: 2, ataques: [["un anónimo la llama", null, () => ["zz anónimo"]]], control: [A.cookie, () => ["Zelle de A"]],
      exitoAsync: async (r) => funciono(r) && (await svc.from("owner_payment_methods").select("id").eq("owner_id", A.id).eq("body", "Zelle de A")).data?.length === 1 },
    { clave: P("profile/actions.ts#updatePaymentMethod"), fase: 2, ataques: [["edita el método de pago de B", A.cookie, () => [ctx.pmB, "HACKED"]]], control: [A.cookie, () => [ctx.pmA, "Pago móvil de A, editado"]],
      exitoAsync: async (r) => funciono(r) && (await svc.from("owner_payment_methods").select("body").eq("id", ctx.pmA).single()).data?.body === "Pago móvil de A, editado" },
    { clave: P("profile/actions.ts#deletePaymentMethod"), fase: 2, orden: 40, ataques: [["borra el método de pago de B", A.cookie, () => [ctx.pmB]]], control: [A.cookie, () => [ctx.pmA]],
      exitoAsync: async (r) => funciono(r) && (await svc.from("owner_payment_methods").select("id").eq("id", ctx.pmA)).data?.length === 0 },
    { clave: P("reportes/actions.ts#guardarUmbralDeStock"), fase: 2, ataques: [["un anónimo la llama", null, () => [3]]], control: [A.cookie, () => [3]] },
    { clave: P("reportes/actions.ts#calificarAsistente"), fase: 2, ataques: [["un anónimo la llama", null, () => ["useful"]]], control: null, sinControl: "manda un evento a Mixpanel; su ataque es solo anónimo" },
    { clave: P("clients/nuevo/actions.ts#validarCliente"), fase: 2, ataques: [["un anónimo la llama", null, () => [fd({ name: "ZZ anónimo", whatsapp: "", address: "", document_id: "45678901", document_type: "V" })]]], control: [A.cookie, () => [fd({ name: "ZZ nuevo", whatsapp: "", address: "", document_id: "45678901", document_type: "V" })]] },
    { clave: P("clients/nuevo/actions.ts#registrarCliente"), fase: 2, ataques: [["un anónimo la llama", null, () => [fd({ name: "ZZ anónimo", whatsapp: "", address: "", document_id: "", document_type: "V" })]]], control: null, hermana: P("clients/nuevo/actions.ts#validarCliente"), sinControl: "manda un evento a Mixpanel al salir bien; su control es validarCliente (mismo formulario)" },
    { clave: P("clients/nuevo/actions.ts#permisoDelNumero"), fase: 2, ataques: [["un anónimo pregunta por un número", null, () => ["584121112233"]]], control: [A.cookie, () => ["584121112233"]] },

    // ── FASE 2: sign-in pages, which anyone reaches ──
    // E-mail enumeration: with a wrong password, the answer for an account
    // that exists must be word for word the answer for one that does not.
    { clave: "app/login/actions.ts#login", fase: 2, ataques: [["¿delata si un correo tiene cuenta?", null, () => [null, fd({ email: A.email, password: "zz-mala-1234" })]]],
      juzgar: async (r) => {
        const otra = await llamar("app/login/actions.ts#login", [null, fd({ email: `zz-no-existe-${stamp}@sevenz-qa.test`, password: "zz-mala-1234" })], null);
        // Only the message: the action echoes back the e-mail it was given,
        // which differs by construction and reveals nothing.
        return r.valor?.error === otra.valor?.error;
      },
      control: null, hermana: P("clients/nuevo/actions.ts#validarCliente"), sinControl: "el dueño de prueba no tiene contraseña; el formato del formulario lo prueba validarCliente" },
    // LAST, and with a session of its own: its control signs the owner out
    // everywhere, and run earlier it turned every later control into a 307.
    { clave: P("actions.ts#logout"), fase: 2, orden: 99, ataques: [["un anónimo la llama", null, () => []]], control: ["SESION_PROPIA", () => []], exito: (r) => r.status < 400 },
    // Judged by what matters: can anyone sign in with the new password. The
    // success path redirects, and the page it lands on carries texts that
    // made a response-based check unreliable.
    // `orden: 98`, right before logout: its control CHANGES A's password,
    // which ends A's other sessions. Every row that still uses `A.cookie`
    // must run before it -- until 2026-11-02 the deleteLogo attack (orden 50)
    // ran after it with a dead session and was counted as blocked without
    // ever reaching the action, until deletePaymentMethod's control hit the
    // same wall and came back "307 /login".
    { clave: "app/reset-password/actions.ts#resetPassword", fase: 2, orden: 98, ataques: [["un anónimo cambia una contraseña sin el enlace del correo", null, () => [null, fd({ new_password: "zzZZ1234!a", confirm_password: "zzZZ1234!a" })]]],
      juzgar: async () => !(await puedeEntrar(A.email, "zzZZ1234!a")),
      control: ["RECUPERACION", () => [null, fd({ new_password: "zzZZ1234!y", confirm_password: "zzZZ1234!y" })]], exitoAsync: async () => puedeEntrar(A.email, "zzZZ1234!y") },
  ];
  function productoBase(name) {
    return { name, unit: null, activeCurrenciesRetail: ["USD"], activeCurrenciesWholesale: ["USD"], priceRetail: "10", priceWholesale: "9", fixedRetail: {}, fixedWholesale: {}, cost: null, costCurrency: null, costCurrencyOther: null, marginRetailPct: null, marginWholesalePct: null, stockOpening: null, supplier: null, wholesaleMinQuantity: "5", publishedRetail: false, publishedWholesale: false, photoPath: null, description: null };
  }

  // ── Run ──────────────────────────────────────────────────────────────────
  const controles = {};
  const correrControl = async (t) => {
    if (controles[t.clave] !== undefined) return controles[t.clave];
    if (!t.control) return (controles[t.clave] = null);
    const [quien, args] = t.control;
    const cookie = quien === "RECUPERACION" ? await sesion(A.email, "recovery") : quien === "SESION_PROPIA" ? await sesion(A.email) : quien;
    const r = await llamar(t.clave, await args(), cookie);
    const bien = t.exitoAsync ? await t.exitoAsync(r) : (t.exito ?? funciono)(r);
    return (controles[t.clave] = bien ? true : `control falló: ${r.status} ${r.valor instanceof Error ? r.valor.message : JSON.stringify(r.valor)?.slice(0, 90)}`);
  };
  for (const fase of [1, 2]) {
    for (const t of T.filter((x) => x.fase === fase).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))) {
      const nombre = t.clave.split("#")[1];
      if (!acciones[t.clave]) {
        // No page imports it, so it has no HTTP route at all: the safest
        // state there is. Allowed only where the review says why.
        if (t.inalcanzable) rec(fase, nombre, "ninguna página la importa: no tiene ruta HTTP", "INALCANZABLE", t.inalcanzable);
        else rec(fase, nombre, "la acción no está en el manifiesto de dev", "SIN PROBAR", "¿página sin compilar o acción renombrada?");
        continue;
      }
      for (const [que, cookie, args] of t.ataques) {
        const antes = await fotoB();
        const antesA = await fotoA();
        const r = await llamar(t.clave, await args(), cookie);
        const despues = await fotoB();
        const fuga = filtra(r.valor);
        const juzgado = t.juzgar ? await t.juzgar(r) : true;
        const tocoA = cookie === A.cookie && /sobre sí mismo/.test(que) ? antesA !== (await fotoA()) : false;
        if (antes !== despues || fuga || !juzgado || tocoA) {
          rec(fase, nombre, que, "VULN", antes !== despues ? "B cambió en la base" : fuga ? `devolvió «${fuga}»` : tocoA ? "el dueño se cambió su propia suscripción" : "el campo protegido cambió");
          continue;
        }
        // Blocked -- but only counts if the same call works when it should.
        const c = t.hermana ? await correrControl(T.find((x) => x.clave === t.hermana)) : await correrControl(t);
        if (c === true) rec(fase, nombre, que, "BLOQUEADO", t.hermana ? `control: ${t.hermana.split("#")[1]}` : "");
        else if (c === null && t.sinControl) rec(fase, nombre, que, "BLOQUEADO", `sin control propio: ${t.sinControl}`);
        else rec(fase, nombre, que, "SIN PROBAR", c ?? "sin control");
      }
    }
  }

  // Every action in the code must be attacked here or covered elsewhere.
  for (const [clave, como] of Object.entries(MANIFEST.actions)) {
    if (como.startsWith("cubierta:")) rec(2, clave.split("#")[1], "cubierta por otra suite", "CUBIERTA", como.slice(9).trim());
    else if (como.startsWith("excluida:")) rec(2, clave.split("#")[1], "fuera del ataque, a propósito", "EXCLUIDA", como.slice(9).trim());
    else if (!T.find((t) => t.clave === clave)) rec(2, clave.split("#")[1], "clasificada como atacada pero sin ataque en esta suite", "SIN PROBAR");
  }
} catch (e) {
  rec(0, "ERROR", "la suite se detuvo", "SIN PROBAR", e instanceof Error ? e.stack : String(e));
} finally {
  for (const id of usuarios) {
    await svc.storage.from("logos").remove([`${id}/logo.png`, `${id}/logo-1730000000000.jpg`]).catch(() => null);
    const { data: cs } = await svc.from("clients").select("id").eq("owner_id", id);
    for (const c of cs ?? []) for (const t of ["share_links", "client_flags", "client_hides", "movements", "client_whatsapp_consents", "client_feedback", "import_notifications"]) await svc.from(t).delete().eq("client_id", c.id).then(() => null, () => null);
    const { data: ss } = await svc.from("sales").select("id").eq("owner_id", id);
    for (const s of ss ?? []) { await svc.from("sale_payments").delete().eq("sale_id", s.id); await svc.from("sale_lines").delete().eq("sale_id", s.id); }
    const { data: os } = await svc.from("catalog_orders").select("id").eq("owner_id", id);
    for (const o of os ?? []) await svc.from("catalog_order_items").delete().eq("order_id", o.id);
    for (const t of ["sales", "catalog_orders", "catalog_share_links", "product_hides", "products", "client_hides", "client_flags", "clients", "import_notifications", "subscription_events", "subscriptions", "movement_rejections"]) await svc.from(t).delete().eq("owner_id", id).then(() => null, () => null);
    await svc.from("owners").delete().eq("id", id);
    await svc.auth.admin.deleteUser(id);
  }
  const vuln = R.filter((r) => r.verdict === "VULN").length;
  const sin = R.filter((r) => r.verdict === "SIN PROBAR").length;
  const cub = R.filter((r) => r.verdict === "CUBIERTA").length;
  const exc = R.filter((r) => ["EXCLUIDA", "INALCANZABLE"].includes(r.verdict)).length;
  console.log(`\n${R.length} filas · ${R.length - vuln - sin - cub - exc} ataques bloqueados · ${cub} cubiertas por otra suite · ${exc} excluidas o sin ruta · ${vuln} VULN · ${sin} sin probar`);
  console.log(`fase 1: ${R.filter((r) => r.fase === 1).length} · fase 2: ${R.filter((r) => r.fase === 2).length}`);
  process.exit(vuln === 0 && sin === 0 ? 0 : 1);
}
