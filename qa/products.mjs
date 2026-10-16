// SOLO LA RAMA DEV (vzqppwrwnmlbrxizskdh) — lee .env.local.
//
// Comprueba la migración 083: la ficha de producto y sus candados de precio.
// SÍ ESCRIBE en dev, a propósito, porque lo único que importa de una
// restricción es que de verdad rechace. Crea y borra lo suyo, y el `finally`
// limpia aunque el script se caiga a mitad.
//
// LO QUE VIGILA, y por qué cada cosa:
//
//   1. Que un producto SIN precio no pueda existir. Es la mitad del mínimo
//      obligatorio; sin esa restricción el catálogo enseñaría huecos y el
//      selector del formulario de movimiento tendría filas que no se pueden
//      cobrar.
//
//   2. Que CON UNO SOLO de los dos precios sí entre. Es el caso de los chips
//      detal/mayor al crear un producto sobre la marcha dentro de un fiado —
//      decisión 11 del dueño. Si esto falla, ese atajo es imposible y el
//      tendero tiene que irse al catálogo a media venta.
//
//   3. Que un precio no se pueda fijar dos veces en la misma casilla. La clave
//      primaria de los candados es lo que impide que un producto tenga dos
//      precios manuales distintos en la misma moneda, que es un estado del que
//      no se sale mirando la pantalla.
//
//   4. Que `anon` no vea el catálogo de nadie. Los precios de compra de un
//      negocio son suyos: el costo de cada producto es exactamente lo que no
//      quiere que vea su competencia.
//
//   5. Que borrar un producto se lleve sus candados. Si no, quedan filas
//      apuntando a nada y el siguiente producto que reciba ese id —no pasa con
//      uuid, pero la basura se acumula igual— heredaría precios ajenos.

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

const MARCA = "QA 083";
const creados = [];

try {
  const { data: owners, error: eOwners } = await admin.from("owners").select("id").limit(1);
  if (eOwners) {
    console.error(`\nNO PUDE HABLAR CON LA BASE: ${eOwners.message}`);
    console.error("Esto NO dice nada sobre si la migración está corrida.");
    process.exit(1);
  }
  const ownerId = owners[0].id;

  const crear = (campos) =>
    admin.from("products").insert({ owner_id: ownerId, ...campos }).select("id").single();

  // ── 1. Sin precio no entra ──────────────────────────────────────────────
  const sinPrecio = await crear({ name: `${MARCA} sin precio`, base_currency: "USD" });
  if (sinPrecio.error?.message?.includes("does not exist")) {
    console.error(`\nFALTA LA MIGRACIÓN 083: ${sinPrecio.error.message}`);
    console.error("Córrela en la rama DEV (vzqppwrwnmlbrxizskdh) y vuelve a intentarlo.");
    process.exit(1);
  }
  check(
    "1. un producto SIN precio es rechazado",
    sinPrecio.error != null && /products_at_least_one_price/.test(sinPrecio.error.message),
    sinPrecio.error?.message?.slice(0, 60) ?? "ENTRÓ, y no debería",
  );

  // ── 2. Con uno solo de los dos, sí ──────────────────────────────────────
  const soloDetal = await crear({
    name: `${MARCA} detal`,
    base_currency: "USD",
    price_retail: 12,
  });
  const soloMayor = await crear({
    name: `${MARCA} mayor`,
    base_currency: "USD",
    price_wholesale: 10,
  });
  if (soloDetal.data) creados.push(soloDetal.data.id);
  if (soloMayor.data) creados.push(soloMayor.data.id);
  check(
    "2. con UNO SOLO de los dos precios sí entra — el caso de los chips",
    soloDetal.error == null && soloMayor.error == null,
    soloDetal.error?.message ?? soloMayor.error?.message ?? "las dos entraron",
  );

  // ── 3. Lo que no es un producto tampoco entra ───────────────────────────
  const sinNombre = await crear({ name: "   ", base_currency: "USD", price_retail: 5 });
  check("3a. un nombre en blanco es rechazado", sinNombre.error != null);

  const precioCero = await crear({ name: `${MARCA} cero`, base_currency: "USD", price_retail: 0 });
  check("3b. un precio de 0 es rechazado", precioCero.error != null);

  const monedaInventada = await crear({
    name: `${MARCA} moneda rara`,
    base_currency: "BTC",
    price_retail: 5,
  });
  check("3c. una moneda fuera de la lista es rechazada", monedaInventada.error != null);

  // ── 4. Los candados ─────────────────────────────────────────────────────
  const productoId = soloDetal.data.id;
  const fijar = (currency, amount, tier = "retail") =>
    admin.from("product_price_overrides").insert({ product_id: productoId, tier, currency, amount });

  check("4a. fijar un precio a mano entra", (await fijar("USDT", 12.5)).error == null);
  check(
    "4b. fijarlo DOS veces en la misma casilla es rechazado",
    (await fijar("USDT", 99)).error != null,
  );
  check(
    "4c. la misma moneda en el otro escalón sí es otra casilla",
    (await fijar("USDT", 11, "wholesale")).error == null,
  );
  check("4d. un candado con importe 0 es rechazado", (await fijar("EUR", 0)).error != null);

  // Volver a vincular = borrar la fila. Es lo que hace el candado al abrirse.
  const { error: eDesfijar } = await admin
    .from("product_price_overrides")
    .delete()
    .eq("product_id", productoId)
    .eq("tier", "retail")
    .eq("currency", "USDT");
  const { count: trasAbrir } = await admin
    .from("product_price_overrides")
    .select("product_id", { count: "exact", head: true })
    .eq("product_id", productoId)
    .eq("tier", "retail");
  check(
    "4e. volver a vincular borra la fila y el precio vuelve a calcularse",
    eDesfijar == null && trasAbrir === 0,
    `quedan ${trasAbrir} en detal`,
  );

  // ── 5. anon no ve nada ──────────────────────────────────────────────────
  const { data: vistoPorAnon, error: eAnonLee } = await anon.from("products").select("id").limit(1);
  check(
    "5a. anon NO ve el catálogo de nadie",
    eAnonLee != null || (vistoPorAnon?.length ?? 0) === 0,
    eAnonLee?.message?.slice(0, 50) ?? `devolvió ${vistoPorAnon?.length} filas`,
  );
  const { error: eAnonEscribe } = await anon
    .from("products")
    .insert({ owner_id: ownerId, name: "pirata", base_currency: "USD", price_retail: 1 });
  check("5b. anon NO puede crear productos", eAnonEscribe != null);

  const { data: candadosAnon, error: eAnonCandados } = await anon
    .from("product_price_overrides")
    .select("product_id")
    .limit(1);
  check(
    "5c. anon NO ve los precios fijados",
    eAnonCandados != null || (candadosAnon?.length ?? 0) === 0,
  );

  // ── 6. Borrar el producto se lleva sus candados ─────────────────────────
  await admin.from("products").delete().eq("id", productoId);
  creados.splice(creados.indexOf(productoId), 1);
  const { count: candadosHuerfanos } = await admin
    .from("product_price_overrides")
    .select("product_id", { count: "exact", head: true })
    .eq("product_id", productoId);
  check(
    "6. borrar un producto se lleva sus candados por cascada",
    candadosHuerfanos === 0,
    `quedan ${candadosHuerfanos}`,
  );
} finally {
  for (const id of creados) await admin.from("products").delete().eq("id", id);
  const { count: quedan } = await admin
    .from("products")
    .select("id", { count: "exact", head: true })
    .like("name", `${MARCA}%`);
  check("7. limpieza: no queda nada de la prueba en dev", quedan === 0, `quedan ${quedan}`);

  const fallos = filas.filter((f) => !f.pasa).length;
  console.log(`\n${filas.length - fallos}/${filas.length} pasan.`);
  if (fallos) process.exitCode = 1;
}
