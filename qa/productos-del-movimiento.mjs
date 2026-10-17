// SOLO LA RAMA DEV (vzqppwrwnmlbrxizskdh) — lee .env.local.
//
// Qué se llevó el cliente en un movimiento: migración `122`, paso 8 del orden
// acordado, entregable `E` / `CT-51`. SÍ ESCRIBE en dev y lo borra todo en el
// `finally`, aunque el script se caiga a mitad.
//
// LEE COMO EL DUEÑO Y NO SOLO CON LA CLAVE DE SERVICIO, y esa es la razón de
// que esta suite exista en esta forma. La regla de CLAUDE.md viene de la
// migración `108`: creó `catalog_orders` con RLS y una política correcta, se
// le olvidó el `grant`, y la pantalla de Pedidos dijo «no te ha llegado
// ningún pedido» con tres órdenes dentro — mientras `qa:pedidos` pasaba 14 de
// 14, porque la clave de servicio ni usa RLS ni necesita permisos. Aquí la
// tabla la lee la app con la sesión del tendero, así que la prueba también.

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

const MARCA = "ZZ QA productos-mov";
const clientes = [];
const movimientos = [];
const productos = [];

try {
  const { data: owners } = await admin.from("owners").select("id, country").eq("country", "VE");
  const ve = owners[0];
  if (!ve) throw new Error("Hace falta un dueño venezolano en dev.");

  const { data: cliente } = await admin
    .from("clients")
    .insert({ owner_id: ve.id, name: `${MARCA} cliente` })
    .select("id")
    .single();
  clientes.push(cliente.id);

  const { data: producto } = await admin
    .from("products")
    .insert({
      owner_id: ve.id,
      name: `${MARCA} arroz`,
      price_retail: 10,
      base_currency: "USD",
      base_currency_retail: "USD",
    })
    .select("id")
    .single();
  productos.push(producto.id);

  async function nuevoMovimiento(tipo, monto) {
    const { data } = await admin
      .from("movements")
      .insert({
        client_id: cliente.id,
        type: tipo,
        amount: monto,
        currency: "USD",
        source: "manual",
        description: `${MARCA}`,
      })
      .select("id")
      .single();
    movimientos.push(data.id);
    return data.id;
  }

  // ── 1. UN FIADO LLEVA LO QUE SE LLEVÓ ─────────────────────────────────
  const fiado = await nuevoMovimiento("charge", 25);
  const r1 = await admin.from("movement_products").insert({
    movement_id: fiado,
    product_id: producto.id,
    name: `${MARCA} arroz`,
    quantity: 3,
    unit_price: 10,
  });
  check("1. un fiado puede llevar productos", !r1.error, r1.error?.message);

  // ── 2. UN ABONO NO, Y LO DICE LA BASE ─────────────────────────────────
  //
  // La guarda vive en un trigger y no solo en la acción del servidor: una
  // regla que solo existe en TypeScript está a una migración de no existir.
  const abono = await nuevoMovimiento("payment", 5);
  const r2 = await admin.from("movement_products").insert({
    movement_id: abono,
    name: `${MARCA} arroz`,
    quantity: 1,
    unit_price: 10,
  });
  check("2. un abono NO puede llevar productos, y lo rechaza la base", Boolean(r2.error), r2.error?.message);

  // ── 3. LO QUE LA BASE TIENE QUE RECHAZAR ──────────────────────────────
  const intento = async (fila) => {
    const { error } = await admin.from("movement_products").insert({ movement_id: fiado, ...fila });
    return Boolean(error);
  };
  check("3a. cantidad cero, rechazada", await intento({ name: "x", quantity: 0, unit_price: 1 }));
  check("3b. cantidad negativa, rechazada", await intento({ name: "x", quantity: -1, unit_price: 1 }));
  check("3c. precio negativo, rechazado", await intento({ name: "x", quantity: 1, unit_price: -1 }));
  check("3d. nombre vacío, rechazado", await intento({ name: "   ", quantity: 1, unit_price: 1 }));

  // ── 4. TRES DECIMALES EN LA CANTIDAD ──────────────────────────────────
  //
  // 1,125 kilos es una cantidad real en una bodega. Redondearla a 1 sería
  // inventar una venta, y es la misma precisión que `products.stock_opening`.
  const r4 = await admin
    .from("movement_products")
    .insert({ movement_id: fiado, name: `${MARCA} queso`, quantity: 1.125, unit_price: 4 })
    .select("quantity")
    .single();
  check(
    "4. la cantidad admite tres decimales: 1,125 kilos no se redondea",
    !r4.error && Number(r4.data.quantity) === 1.125,
    r4.error?.message ?? `quantity = ${r4.data?.quantity}`,
  );

  // ── 5. BORRAR EL MOVIMIENTO SE LLEVA SUS LÍNEAS ───────────────────────
  //
  // `on delete cascade`. Sin esto, un movimiento borrado de verdad dejaría
  // filas huérfanas apuntando a un id que ya no existe.
  const temporal = await nuevoMovimiento("charge", 9);
  await admin.from("movement_products").insert({ movement_id: temporal, name: `${MARCA} temp`, quantity: 1, unit_price: 9 });
  await admin.from("movements").delete().eq("id", temporal);
  movimientos.splice(movimientos.indexOf(temporal), 1);
  const { count: huerfanas } = await admin
    .from("movement_products")
    .select("id", { count: "exact", head: true })
    .eq("movement_id", temporal);
  check("5. al borrar el movimiento se van sus líneas", huerfanas === 0, `quedan ${huerfanas}`);

  // ── 6. BORRAR EL PRODUCTO NO SE LLEVA LA HISTORIA ─────────────────────
  //
  // `on delete set null`. La decisión 12 del dueño deja borrar el producto
  // que creó un movimiento; si eso se llevara la línea por delante, el fiado
  // dejaría de decir qué se llevó el cliente.
  const { data: efimero } = await admin
    .from("products")
    .insert({ owner_id: ve.id, name: `${MARCA} efimero`, price_retail: 2, base_currency: "USD", base_currency_retail: "USD" })
    .select("id")
    .single();
  const { data: linea } = await admin
    .from("movement_products")
    .insert({ movement_id: fiado, product_id: efimero.id, name: `${MARCA} efimero`, quantity: 1, unit_price: 2 })
    .select("id")
    .single();
  await admin.from("products").delete().eq("id", efimero.id);
  const { data: sobrevive } = await admin
    .from("movement_products")
    .select("product_id, name")
    .eq("id", linea.id)
    .maybeSingle();
  check(
    "6. al borrar el producto, la línea sobrevive y dice qué se llevó",
    sobrevive != null && sobrevive.product_id === null && sobrevive.name.includes("efimero"),
    sobrevive == null ? "la línea desapareció" : `product_id = ${sobrevive.product_id}`,
  );

  // ── 7. EL DUEÑO LAS LEE CON SU SESIÓN. anon NO ────────────────────────
  const { data: link } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: (await admin.auth.admin.listUsers({ perPage: 200 })).data.users.find((u) => u.id === ve.id)?.email,
  });
  const { data: sesion } = await anon.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });
  const dueno = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${sesion.session.access_token}` } },
  });

  const r7 = await dueno.from("movement_products").select("id, name").eq("movement_id", fiado);
  check(
    "7. el DUEÑO lee las líneas de su propio movimiento",
    !r7.error && (r7.data ?? []).length > 0,
    r7.error ? `${r7.error.code} ${r7.error.message}` : `${r7.data.length} líneas`,
  );

  // UN CLIENTE ANÓNIMO RECIÉN HECHO, y no el de arriba. El de arriba canjeó el
  // enlace mágico con `verifyOtp`, y eso le deja la sesión del dueño dentro
  // aunque `persistSession` esté en false: preguntarle a ÉL si anon puede leer
  // es preguntarle al dueño. La primera versión de esta comprobación lo hacía
  // así y fallaba diciendo que anon SÍ podía -- una alarma de seguridad falsa,
  // que es casi peor que no tenerla.
  const anonDeVerdad = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { persistSession: false } },
  );
  const r7b = await anonDeVerdad.from("movement_products").select("id").limit(1);
  check("7b. anon NO las puede leer", Boolean(r7b.error), r7b.error?.code ?? "las leyó");

  // ── 8. Y NO VE LAS DE OTRO DUEÑO ──────────────────────────────────────
  const { data: otro } = await admin.from("owners").select("id").neq("id", ve.id).limit(1).single();
  const { data: suCliente } = await admin
    .from("clients")
    .insert({ owner_id: otro.id, name: `${MARCA} ajeno` })
    .select("id")
    .single();
  clientes.push(suCliente.id);
  const { data: suMovimiento } = await admin
    .from("movements")
    .insert({ client_id: suCliente.id, type: "charge", amount: 1, currency: "USD", source: "manual" })
    .select("id")
    .single();
  movimientos.push(suMovimiento.id);
  await admin.from("movement_products").insert({ movement_id: suMovimiento.id, name: `${MARCA} ajeno`, quantity: 1, unit_price: 1 });

  const r8 = await dueno.from("movement_products").select("id").eq("movement_id", suMovimiento.id);
  check(
    "8. el dueño NO ve las líneas de otro negocio",
    !r8.error && (r8.data ?? []).length === 0,
    r8.error ? r8.error.code : `vio ${r8.data.length}`,
  );
} catch (e) {
  console.error("\nSE CAYÓ:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  for (const id of movimientos) {
    await admin.from("movement_products").delete().eq("movement_id", id);
    await admin.from("movements").delete().eq("id", id);
  }
  for (const id of clientes) {
    await admin.from("movements").delete().eq("client_id", id);
    await admin.from("clients").delete().eq("id", id);
  }
  for (const id of productos) await admin.from("products").delete().eq("id", id);
  const { data: quedan } = await admin.from("products").select("id").like("name", `${MARCA}%`);
  for (const p of quedan ?? []) await admin.from("products").delete().eq("id", p.id);
  const { data: sobras } = await admin.from("clients").select("id").like("name", `${MARCA}%`);
  check("9. limpieza: no queda nada de la prueba en dev", (sobras ?? []).length === 0, `quedan ${(sobras ?? []).length}`);
}

const fallos = filas.filter((f) => !f.pasa).length;
console.log(`\n${filas.length - fallos}/${filas.length} pasan.`);
if (fallos) process.exitCode = 1;
