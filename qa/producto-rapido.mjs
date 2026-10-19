// SOLO LA RAMA DEV (vzqppwrwnmlbrxizskdh) — lee .env.local. NO ESCRIBE NADA.
//
// LA HOJA «AGREGAR PRODUCTO» DEL ASISTENTE DE VENTA, y la forma de producto
// que crea: precio al detal y ninguno al mayor.
//
// ===========================================================================
// POR QUÉ EXISTE ESTE FICHERO
//
// Esa hoja NUNCA funcionó. Nació el 2026-10-18 mandando la lista de monedas
// del mayoreo VACÍA, con un comentario que razonaba —bien— que un escalón al
// mayor inventado haría que el carrito cobrara otro precio al subir la
// cantidad. Lo que no se comprobó es la consecuencia: `createProduct` exige al
// menos una moneda POR ESCALÓN, así que toda alta moría con «Deja al menos una
// moneda en el precio al mayor», un mensaje sobre un campo que esa pantalla ni
// siquiera enseña. Lo reportó el dueño con una captura.
//
// El arreglo manda la misma moneda en los dos escalones y deja
// `price_wholesale` en null. Este script comprueba las dos mitades de ese
// arreglo:
//
//   1. Que la forma resultante EXISTE YA en dev y no es un estado inventado.
//   2. Que con ella el carrito NO puede cobrar precio de mayoreo por mucha
//      cantidad que se pida — que era justo el temor del comentario original.
//
// LO QUE NO COMPRUEBA, y hay que decirlo: la validación de `createProduct`
// vive en un fichero `"use server"` y no se puede importar desde aquí, así que
// el camino completo —tocar «Agregar producto» y que el producto se guarde—
// sigue necesitando un dedo sobre la pantalla.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { bloqueDesdeRpc, escalonParaCantidad, precioEnMoneda } from "../lib/products/public-pricing.ts";

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

const filas = [];
function check(nombre, pasa, detalle) {
  filas.push({ nombre, pasa });
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${detalle ? `  — ${detalle}` : ""}`);
}

// ── 1. LA FORMA YA VIVE EN LA BASE ──────────────────────────────────────
//
// `base_currency_wholesale` es NOT NULL desde la migración 114, así que la
// moneda del mayoreo no es opcional. Lo que sí puede faltar es su PRECIO, y
// eso es lo que distingue «este producto no se vende al mayor» de «este
// producto no tiene moneda en la que escribir su precio al mayor».
const { data: sinPrecioMayor, error } = await admin
  .from("products")
  .select("id, name, price_retail, price_wholesale, base_currency_retail, base_currency_wholesale")
  .is("price_wholesale", null)
  .not("price_retail", "is", null)
  .limit(5);

check(
  "1. en dev hay productos con moneda de mayoreo y SIN precio de mayoreo",
  !error && (sinPrecioMayor ?? []).length > 0,
  error ? error.message : `${(sinPrecioMayor ?? []).length} productos`,
);

check(
  "1b. y todos traen su `base_currency_wholesale` puesta — la columna es NOT NULL",
  (sinPrecioMayor ?? []).every((p) => p.base_currency_wholesale != null),
  (sinPrecioMayor ?? []).map((p) => `${p.name}:${p.base_currency_wholesale}`).join(", "),
);

// ── 2. CON ESA FORMA, EL MAYOREO NO EXISTE PARA EL CARRITO ──────────────
//
// Es el temor del comentario original, comprobado en vez de razonado: se monta
// el producto con las MISMAS funciones que usan el asistente y el catálogo
// público, y se le pide precio para cantidades absurdas.
const producto = {
  retail: bloqueDesdeRpc(
    { price: 10, pinned: {}, base_currency: "USD", currencies: ["USD"] },
    "USD",
  ),
  // Lo que `armarProductos` hace con un escalón sin precio: devolver null.
  wholesale: bloqueDesdeRpc(null, "USD"),
  wholesale_min_quantity: null,
};

check(
  "2. un escalón sin precio se convierte en un bloque nulo",
  producto.wholesale === null,
  `wholesale = ${JSON.stringify(producto.wholesale)}`,
);

const cantidades = [1, 2, 12, 100, 10000];
const escalones = cantidades.map((c) => escalonParaCantidad(producto, c));
check(
  "3. por mucha cantidad que se pida, el escalón siempre es «al detal»",
  escalones.every((e) => e === "retail"),
  cantidades.map((c, i) => `${c}->${escalones[i]}`).join(" · "),
);

const precio = precioEnMoneda(producto.retail, "USD", null);
check(
  "4. y el precio al detal se sigue leyendo — el producto SE PUEDE VENDER",
  precio === 10,
  `${precio}`,
);

// ── 5. EL OTRO LADO: con precio al mayor Y umbral, el escalón SÍ cambia ──
//
// Sin esta fila, la 3 pasaría igual con una función rota que devolviera
// siempre «retail». Una comprobación que no puede fallar no comprueba nada.
const conMayoreo = {
  retail: bloqueDesdeRpc({ price: 10, pinned: {}, base_currency: "USD", currencies: ["USD"] }, "USD"),
  wholesale: bloqueDesdeRpc({ price: 8, pinned: {}, base_currency: "USD", currencies: ["USD"] }, "USD"),
  wholesale_min_quantity: 12,
};
check(
  "5. control: con precio al mayor y umbral 12, 12 unidades SÍ cambian de escalón",
  escalonParaCantidad(conMayoreo, 11) === "retail" && escalonParaCantidad(conMayoreo, 12) === "wholesale",
  `11->${escalonParaCantidad(conMayoreo, 11)} · 12->${escalonParaCantidad(conMayoreo, 12)}`,
);

const fallos = filas.filter((f) => !f.pasa).length;
console.log(`\n${filas.length - fallos}/${filas.length} pasan.`);
if (fallos) process.exitCode = 1;
