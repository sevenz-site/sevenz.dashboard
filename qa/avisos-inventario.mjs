// CT-162 · migration 183: the bell's inventory notices.
//
// DEV ONLY, writes and cleans up after itself. Runs against the owner of
// QA_OWNER_EMAIL with one product of its own (marked «ZZ QA avisos»), and
// restores that owner's threshold at the end.
//
// What it pins down, and why each matters:
//   - the rule is the same as `stockState()` (lib/products/availability.ts),
//     so the bell never contradicts the amber/red chip — EXCEPT threshold 0,
//     which is the owner's «no me avises» and produces nothing;
//   - one notice per product, per day and per kind, however many times the
//     count moves (the owner chose «cada día mientras siga bajo»);
//   - a notice that stopped being true the same day and was never read is
//     removed (restock, or a restored sale), a READ one stays;
//   - the owner reads and marks read with HIS session, and cannot write rows
//     by hand: a missing grant would leave the bell silent with every
//     service-role check green (the lesson of migration 108);
//   - `refresh_stock_alerts()` brings back «today's» notice for a product
//     still low — that is how the «every day» happens without a cron.
//
//   npm run qa:avisos-inventario
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { stockState } from "../lib/products/availability.ts";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const DEV_REF = "vzqppwrwnmlbrxizskdh";
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
if (ref !== DEV_REF) {
  console.error(`ME NIEGO A CORRER. .env.local apunta a "${ref}", no a la rama dev (${DEV_REF}).`);
  process.exit(1);
}

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

async function comoDueno(email) {
  const { data: link, error: eL } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (eL) throw new Error(`generateLink: ${eL.message}`);
  const { data: s, error: eV } = await anon.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });
  if (eV) throw new Error(`verifyOtp: ${eV.message}`);
  return {
    id: s.user.id,
    db: createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${s.session.access_token}` } },
    }),
  };
}

const filas = [];
function check(nombre, pasa, detalle) {
  filas.push({ nombre, pasa });
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${detalle ? `  — ${detalle}` : ""}`);
}

const MARCA = "ZZ QA avisos";
let productId = null;
let ownerId = null;
let umbralOriginal = null;

const avisos = async () => {
  const { data, error } = await admin
    .from("stock_alerts")
    .select("id, kind, quantity, threshold, alert_day, read_at")
    .eq("product_id", productId)
    .order("created_at");
  if (error) throw new Error(`stock_alerts: ${error.message}`);
  return data;
};
const cantidad = async (n) => {
  const { error } = await admin.from("products").update({ stock_opening: n }).eq("id", productId);
  if (error) throw new Error(`update stock: ${error.message}`);
};
const resumen = (rows) => rows.map((r) => `${r.kind}${r.read_at ? "(leído)" : ""}`).join(", ") || "ninguno";

try {
  // ── 0. The migration is there. Without it everything below is a false red.
  const { error: e0 } = await admin.from("stock_alerts").select("id").limit(1);
  check("0. la tabla stock_alerts existe (migración 183 corrida en dev)", !e0, e0?.message);
  if (e0) throw new Error("sin la 183 no tiene sentido seguir");

  // ── 1. The SQL rule against TypeScript's stockState(), threshold > 0.
  const casos = [
    [10, 5], [6, 5], [5, 5], [4, 5], [1, 5], [0, 5], [0.5, 1], [3, 3],
  ];
  const esperado = (q, t) => {
    const s = stockState(q, t);
    return s === "out" ? "out" : s === "low" ? "low" : null;
  };

  const email = env.QA_OWNER_EMAIL;
  if (!email) throw new Error("falta QA_OWNER_EMAIL en .env.local");
  const dueno = await comoDueno(email);
  ownerId = dueno.id;

  const { data: own } = await admin
    .from("owners")
    .select("low_stock_threshold, country")
    .eq("id", ownerId)
    .single();
  umbralOriginal = own.low_stock_threshold;

  const { data: prod, error: eProd } = await admin
    .from("products")
    .insert({
      owner_id: ownerId,
      name: `${MARCA} ${Date.now()}`,
      base_currency: own.country === "VE" ? "USD" : null,
      price_retail: 1,
      stock_opening: 50,
      stock_opening_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (eProd) throw new Error(`insert product: ${eProd.message}`);
  productId = prod.id;

  check("1a. un producto con existencias de sobra no avisa", (await avisos()).length === 0);

  let iguales = 0;
  const distintos = [];
  for (const [q, t] of casos) {
    await admin.from("stock_alerts").delete().eq("product_id", productId);
    await admin.from("owners").update({ low_stock_threshold: t }).eq("id", ownerId);
    await cantidad(q);
    const rows = await avisos();
    const sql = rows.length ? rows[rows.length - 1].kind : null;
    if (sql === esperado(q, t)) iguales++;
    else distintos.push(`${q}/${t}: SQL ${sql} · TS ${esperado(q, t)}`);
  }
  check(
    "1b. la regla de la base es la de stockState() con umbral > 0",
    distintos.length === 0,
    distintos.length ? distintos.join("; ") : `${iguales} casos`,
  );

  // ── 2. One per day and kind, however often the count moves.
  await admin.from("stock_alerts").delete().eq("product_id", productId);
  await admin.from("owners").update({ low_stock_threshold: 5 }).eq("id", ownerId);
  await cantidad(50);
  await cantidad(4);
  await cantidad(3);
  await cantidad(2);
  let rows = await avisos();
  check("2a. bajar tres veces el mismo día deja UN aviso «por agotarse»", rows.length === 1 && rows[0].kind === "low", resumen(rows));
  check("2b. el aviso guarda la cantidad y el umbral de ese momento", rows[0]?.threshold === 5 && Number(rows[0]?.quantity) === 4, `cantidad ${rows[0]?.quantity}, umbral ${rows[0]?.threshold}`);

  // Day in the business's zone, the same rule as migration 168.
  const zona = own.country === "VE" ? "America/Caracas" : "America/Bogota";
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: zona }).format(new Date());
  check("2c. el día es el de la zona del negocio", rows[0]?.alert_day === hoy, `${rows[0]?.alert_day} vs ${hoy}`);

  // ── 3. Hitting zero: «se agotó», and the unread «se está agotando» goes.
  await cantidad(0);
  rows = await avisos();
  check("3. al llegar a 0 sale «agotado» y se va el «por agotarse» sin leer", rows.length === 1 && rows[0].kind === "out", resumen(rows));

  // ── 4. Restock: today's unread notice stops being true and goes away.
  await cantidad(30);
  rows = await avisos();
  check("4. reponer por encima del umbral quita el aviso de hoy sin leer", rows.length === 0, resumen(rows));

  // ── 5. A READ notice stays: it was true when he read it.
  await cantidad(2);
  await admin.from("stock_alerts").update({ read_at: new Date().toISOString() }).eq("product_id", productId);
  await cantidad(30);
  rows = await avisos();
  check("5. un aviso ya leído se queda aunque se reponga", rows.length === 1 && rows[0].read_at !== null, resumen(rows));

  // ── 6. No count, bin, or threshold 0: nothing.
  await admin.from("stock_alerts").delete().eq("product_id", productId);
  await admin.from("products").update({ stock_opening: null }).eq("id", productId);
  check("6a. un producto sin cantidad contada no avisa", (await avisos()).length === 0);
  await cantidad(0);
  await admin.from("stock_alerts").delete().eq("product_id", productId);
  await admin.from("products").update({ trashed_at: new Date().toISOString() }).eq("id", productId);
  check("6b. un producto en la papelera no avisa", (await avisos()).length === 0);
  await admin.from("products").update({ trashed_at: null }).eq("id", productId);
  await admin.from("stock_alerts").delete().eq("product_id", productId);
  await admin.from("owners").update({ low_stock_threshold: 0 }).eq("id", ownerId);
  await cantidad(0);
  check("6c. umbral 0 («no me avises») no avisa ni del agotado", (await avisos()).length === 0);

  // ── 7. Changing the threshold re-judges the products at once.
  await cantidad(4);
  await admin.from("stock_alerts").delete().eq("product_id", productId);
  await admin.from("owners").update({ low_stock_threshold: 5 }).eq("id", ownerId);
  rows = await avisos();
  check("7. subir el umbral a 5 con 4 en estante avisa en el acto", rows.length === 1 && rows[0].kind === "low", resumen(rows));

  // ── 8. As the OWNER, with his session.
  const { data: suyos, error: eSuyos } = await dueno.db
    .from("stock_alerts")
    .select("id, kind, read_at")
    .eq("product_id", productId);
  check("8a. el dueño LEE sus avisos con su sesión", !eSuyos && suyos?.length === 1, eSuyos?.message ?? `${suyos?.length} fila(s)`);

  const { error: eLeer } = await dueno.db
    .from("stock_alerts")
    .update({ read_at: new Date().toISOString() })
    .eq("product_id", productId);
  rows = await avisos();
  check("8b. el dueño los MARCA leídos con su sesión", !eLeer && rows[0]?.read_at !== null, eLeer?.message);

  const { error: eEscribir } = await dueno.db.from("stock_alerts").insert({
    owner_id: ownerId,
    product_id: productId,
    kind: "out",
    alert_day: "2000-01-01",
    quantity: 0,
    threshold: 5,
  });
  check("8c. el dueño NO puede escribir un aviso a mano", !!eEscribir, eEscribir?.message ?? "¡la inserción entró!");

  const { error: eCantidad } = await dueno.db
    .from("stock_alerts")
    .update({ quantity: 999 })
    .eq("product_id", productId);
  rows = await avisos();
  check("8d. el dueño NO puede cambiar la cantidad de un aviso", !!eCantidad || Number(rows[0]?.quantity) !== 999, eCantidad?.message);

  // ── 9. «Each day»: with no row for today, refresh brings it back.
  await admin.from("stock_alerts").delete().eq("product_id", productId);
  const { error: eRef } = await dueno.db.rpc("refresh_stock_alerts");
  rows = await avisos();
  check("9a. refresh_stock_alerts() recrea el aviso de hoy de un producto que sigue bajo", !eRef && rows.length === 1, eRef?.message ?? resumen(rows));
  await dueno.db.rpc("refresh_stock_alerts");
  rows = await avisos();
  check("9b. llamarla dos veces no duplica", rows.length === 1, resumen(rows));

  // A FRESH anonymous client: `verifyOtp` above left the owner's session on
  // `anon`, and asking it would test the owner, not a stranger (the second
  // trap of qa:attack, which gave 16 false findings once).
  const extrano = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: eAnon } = await extrano.rpc("refresh_stock_alerts");
  check("9c. sin sesión refresh_stock_alerts() no se puede llamar", !!eAnon, eAnon?.message ?? "¡entró sin sesión!");
  const { error: eSync } = await dueno.db.rpc("sync_stock_alert", { p_product_id: productId });
  check("9d. sync_stock_alert() es interna: un dueño no la llama", !!eSync, eSync?.message ?? "¡un dueño la llamó!");
} catch (e) {
  check("ejecución", false, e.message);
} finally {
  if (productId) {
    await admin.from("stock_alerts").delete().eq("product_id", productId);
    await admin.from("products").delete().eq("id", productId);
  }
  if (ownerId && umbralOriginal != null) {
    await admin.from("owners").update({ low_stock_threshold: umbralOriginal }).eq("id", ownerId);
  }
}

const fallos = filas.filter((f) => !f.pasa).length;
console.log(`\n${filas.length - fallos}/${filas.length} pasan.`);
if (fallos) process.exitCode = 1;
