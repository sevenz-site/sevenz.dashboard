// SOLO LA RAMA DEV (vzqppwrwnmlbrxizskdh) — lee .env.local.
//
// EL INVENTARIO QUE BAJA CON CADA VENTA — migración `163`.
//
// Decisión del dueño el 2026-10-27: *«Actualicemos para que la cantidad de
// productos se descuenta con cada venta y sacamos la data de allí»*.
//
// **SÍ ESCRIBE en dev** —crea un producto, una venta y sus líneas— y lo borra
// todo en el `finally`, aunque el guion se caiga a mitad.
//
// ═══════════════════════════════════════════════════════════════════════
// POR QUÉ ESTA SUITE EXISTE, Y POR QUÉ NINGUNA OTRA LA CUBRE
//
// El descuento lo hace un DISPARADOR, no una acción de servidor. Eso es lo
// que cierra las dos puertas de la venta de golpe, y también lo que hace que
// un fallo aquí sea invisible desde el código: no hay función que leer, no
// hay error que salte, y lo único que pasa es que la cantidad de un producto
// queda mal. Igual que un saldo mal calculado, es un número creíble.
//
// ═══════════════════════════════════════════════════════════════════════
// QUÉ VIGILA, Y QUÉ CUESTA CADA UNO SI SE ROMPE
//
//   1. Vender descuenta. Lo evidente, y la base de todo lo demás.
//   2. **UN PRODUCTO SIN CANTIDAD CONTADA NO SE TOCA.** Es la comprobación
//      más importante del archivo. La migración `107` hizo pública la
//      diferencia entre NULL y 0: null es «Disponible» en verde, 0 es «No
//      disponible» en ROJO en el catálogo que ve el cliente. Un 0 nacido de
//      una venta apagaría un producto que está en el mostrador, y el tendero
//      se enteraría por un cliente que no le compró.
//   3. Vender de más deja la cuenta en 0, nunca en negativo: el catálogo
//      publica esa cifra y «−2 disponibles» se lee como app rota.
//   4. **Borrar la venta devuelve lo que SE LLEVÓ, no lo que se vendió.** Una
//      venta de 5 sobre una estantería de 3 devuelve 3. Sin esto, borrar una
//      venta fabrica mercancía que nunca existió.
//   5. Restaurar la venta vuelve a descontar. Sin esta mitad, borrar y
//      restaurar es una forma silenciosa de duplicar inventario.
//   6. Una línea sin producto no rompe nada ni toca a nadie.
//   7. El umbral existe, vale 5, y **el dueño puede leerlo con su propia
//      sesión**. Una columna nueva en `owners` sin el `grant` correcto es
//      exactamente el fallo de la migración `108`, que dejó a `qa:pedidos`
//      pasando 14 de 14 con la pantalla vacía.
// ═══════════════════════════════════════════════════════════════════════

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

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
  console.error("Este script ESCRIBE. Nunca contra producción.");
  process.exit(1);
}

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

const filas = [];
function check(nombre, pasa, detalle) {
  filas.push({ nombre, pasa });
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${detalle ? `  — ${detalle}` : ""}`);
}

async function comoDueno(ownerId) {
  const { data: u } = await admin.auth.admin.getUserById(ownerId);
  const { data: link } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: u.user.email,
  });
  const { data: s, error } = await anon.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });
  if (error) throw new Error(`verifyOtp: ${error.message}`);
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${s.session.access_token}` } },
  });
}

const MARCA = "ZZ QA inventario";
const productIds = [];
const saleIds = [];
let clientId = null;

const cantidad = async (id) =>
  Number(
    (await admin.from("products").select("stock_opening").eq("id", id).single()).data
      ?.stock_opening ?? NaN,
  );
const cruda = async (id) =>
  (await admin.from("products").select("stock_opening").eq("id", id).single()).data?.stock_opening;

try {
  const { data: dueno } = await admin
    .from("owners")
    .select("id, business_name")
    .eq("country", "VE")
    .order("created_at", { ascending: true })
    .limit(1)
    .single();
  console.log(`Dueño: ${dueno.business_name}\n`);

  // `sales.client_id` es OBLIGATORIO -- una venta sin cliente usa el
  // «Mostrador» que la app crea sola. Aquí vale uno de prueba.
  const { data: cli, error: eCli } = await admin
    .from("clients")
    .insert({ owner_id: dueno.id, name: `${MARCA} comprador` })
    .select("id")
    .single();
  if (eCli) throw new Error(`crear cliente: ${eCli.message}`);
  clientId = cli.id;

  // ── Un producto CON cantidad y otro SIN ella ─────────────────────────
  const nuevo = async (stock) => {
    const { data, error } = await admin
      .from("products")
      .insert({
        owner_id: dueno.id,
        name: `${MARCA} ${stock == null ? "sin contar" : stock}`,
        base_currency: "USD",
        price_retail: 10,
        stock_opening: stock,
      })
      .select("id")
      .single();
    if (error) throw new Error(`crear producto: ${error.message}`);
    productIds.push(data.id);
    return data.id;
  };
  const conStock = await nuevo(20);
  const sinStock = await nuevo(null);
  const escaso = await nuevo(3);

  const vender = async (lineas) => {
    const { data: venta, error } = await admin
      .from("sales")
      .insert({ owner_id: dueno.id, client_id: clientId, note: MARCA })
      .select("id")
      .single();
    if (error) throw new Error(`crear venta: ${error.message}`);
    saleIds.push(venta.id);
    const { error: e2 } = await admin.from("sale_lines").insert(
      lineas.map((l) => ({
        sale_id: venta.id,
        product_id: l.productId ?? null,
        name: l.name ?? `${MARCA} linea`,
        quantity: l.quantity,
        unit_price: 10,
        currency: "USD",
      })),
    );
    if (e2) throw new Error(`crear lineas: ${e2.message}`);
    return venta.id;
  };

  // ── 1. VENDER DESCUENTA ──────────────────────────────────────────────
  const v1 = await vender([{ productId: conStock, quantity: 5 }]);
  check("1. vender 5 de 20 deja 15", (await cantidad(conStock)) === 15, `quedó ${await cantidad(conStock)}`);

  // ── 2. SIN CANTIDAD CONTADA NO SE TOCA ───────────────────────────────
  await vender([{ productId: sinStock, quantity: 7 }]);
  check(
    "2. un producto SIN cantidad contada sigue en null, no en 0",
    (await cruda(sinStock)) === null,
    `quedó ${JSON.stringify(await cruda(sinStock))} — un 0 aquí lo pintaría «No disponible» en rojo en el catálogo del cliente`,
  );

  // ── 3. VENDER DE MAS NO BAJA DE CERO ─────────────────────────────────
  const v3 = await vender([{ productId: escaso, quantity: 5 }]);
  check("3. vender 5 de 3 deja 0 y nunca negativo", (await cantidad(escaso)) === 0, `quedó ${await cantidad(escaso)}`);
  const { data: lineasEscaso } = await admin
    .from("sale_lines")
    .select("stock_taken")
    .eq("sale_id", v3);
  check(
    "3b. y anota que se llevó 3, no 5",
    Number(lineasEscaso?.[0]?.stock_taken) === 3,
    `stock_taken = ${lineasEscaso?.[0]?.stock_taken}`,
  );

  // ── 4. BORRAR DEVUELVE LO QUE SE LLEVO ───────────────────────────────
  await admin.from("sales").update({ deleted_at: new Date().toISOString() }).eq("id", v3);
  check(
    "4. borrar esa venta devuelve 3 y no 5 — no fabrica mercancía",
    (await cantidad(escaso)) === 3,
    `quedó ${await cantidad(escaso)}`,
  );

  // ── 5. RESTAURAR VUELVE A DESCONTAR ──────────────────────────────────
  await admin.from("sales").update({ deleted_at: null }).eq("id", v3);
  check(
    "5. restaurarla vuelve a descontar — borrar y restaurar no duplica",
    (await cantidad(escaso)) === 0,
    `quedó ${await cantidad(escaso)}`,
  );

  // ── 5b. Y la venta normal también va y vuelve ────────────────────────
  await admin.from("sales").update({ deleted_at: new Date().toISOString() }).eq("id", v1);
  const tras = await cantidad(conStock);
  await admin.from("sales").update({ deleted_at: null }).eq("id", v1);
  check(
    "5b. la venta normal devuelve sus 5 al borrarla y los quita al restaurar",
    tras === 20 && (await cantidad(conStock)) === 15,
    `tras borrar ${tras}, tras restaurar ${await cantidad(conStock)}`,
  );

  // ── 6. UNA LINEA SIN PRODUCTO NO ROMPE NADA ──────────────────────────
  const antes = await cantidad(conStock);
  await vender([{ productId: null, quantity: 2, name: `${MARCA} suelto` }]);
  check(
    "6. una línea sin producto no mueve ningún inventario",
    (await cantidad(conStock)) === antes,
    `${antes} -> ${await cantidad(conStock)}`,
  );

  // ── 7. EL UMBRAL, Y QUE EL DUEÑO PUEDA LEERLO ────────────────────────
  const { data: porServicio } = await admin
    .from("owners")
    .select("low_stock_threshold")
    .eq("id", dueno.id)
    .single();
  check("7. el umbral existe y arranca en 5", porServicio?.low_stock_threshold === 5, `vale ${porServicio?.low_stock_threshold}`);

  const suyo = await comoDueno(dueno.id);
  const { data: porDueno, error: eLectura } = await suyo
    .from("owners")
    .select("low_stock_threshold")
    .eq("id", dueno.id)
    .maybeSingle();
  check(
    "7b. el DUEÑO lo lee con su propia sesión (no solo la clave de servicio)",
    !eLectura && porDueno?.low_stock_threshold === 5,
    eLectura ? eLectura.message : `vale ${porDueno?.low_stock_threshold}`,
  );

  const { error: eEscritura } = await suyo
    .from("owners")
    .update({ low_stock_threshold: 7 })
    .eq("id", dueno.id);
  const { data: trasEscribir } = await admin
    .from("owners")
    .select("low_stock_threshold")
    .eq("id", dueno.id)
    .single();
  check(
    "7c. y puede CAMBIARLO — es un ajuste suyo, no de solo lectura",
    !eEscritura && trasEscribir?.low_stock_threshold === 7,
    eEscritura ? eEscritura.message : `quedó en ${trasEscribir?.low_stock_threshold}`,
  );
  await admin.from("owners").update({ low_stock_threshold: 5 }).eq("id", dueno.id);

  // ── 8. EL PRODUCTO, LEIDO POR SU DUEÑO ───────────────────────────────
  const { data: vistoPorDueno, error: eProd } = await suyo
    .from("products")
    .select("stock_opening")
    .eq("id", conStock)
    .maybeSingle();
  check(
    "8. el dueño ve la cantidad ya descontada con su propia sesión",
    !eProd && Number(vistoPorDueno?.stock_opening) === 15,
    eProd ? eProd.message : `ve ${vistoPorDueno?.stock_opening}`,
  );
} finally {
  if (saleIds.length) {
    await admin.from("sale_lines").delete().in("sale_id", saleIds);
    await admin.from("sales").delete().in("id", saleIds);
  }
  if (productIds.length) await admin.from("products").delete().in("id", productIds);
  if (clientId) {
    await admin.from("movements").delete().eq("client_id", clientId);
    await admin.from("clients").delete().eq("id", clientId);
  }
  const { count } = await admin
    .from("products")
    .select("id", { count: "exact", head: true })
    .like("name", `${MARCA}%`);
  check("9. limpieza: no queda nada de la prueba en dev", (count ?? 0) === 0, `quedan ${count ?? 0}`);
}

const fallos = filas.filter((f) => !f.pasa).length;
console.log(`\n${filas.length - fallos}/${filas.length} pasan.`);
if (fallos) process.exitCode = 1;
