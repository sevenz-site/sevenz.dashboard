"use server";

import { createClient } from "@/lib/supabase/server";
import { getOwnerRateContext } from "@/lib/exchange-rate/owner-rate";
import { getBolivarRates } from "@/lib/products/catalog";
import type { BloqueCrudo, ProductoPublico } from "@/lib/products/public-pricing";
import { bloqueDesdeRpc } from "@/lib/products/public-pricing";
import type { BolivarRates, PriceCurrency } from "@/lib/products/price";

// LOS PRODUCTOS QUE EL TENDERO PUEDE VENDER, con sus precios ya resueltos.
//
// ===========================================================================
// POR QUÉ NO SIRVE `buscarProductos`, QUE YA EXISTE
//
// Esa devuelve `priceRetail` y `baseCurrencyRetail` y nada más, que es lo que
// el selector de un fiado necesita: una cifra en el libro del movimiento. La
// venta necesita otra cosa — **en qué monedas se puede cobrar cada línea y a
// qué precio en cada una**, porque el carrito del sitemap deja cambiarla con
// su «Cambiar».
//
// ===========================================================================
// Y DEVUELVE EL PRODUCTO EN LA MISMA FORMA QUE VE EL CLIENTE
//
// `ProductoPublico` es el tipo que `/c/[token]` usa, y eso no es comodidad:
// el precio que el tendero cobra y el que su cliente vio en el catálogo
// tienen que salir de la MISMA función. Con dos caminos, el día que uno
// cambie —un escalón, un precio fijado a mano, una moneda desactivada— el
// mostrador y el catálogo empiezan a decir cifras distintas por el mismo
// producto, y nadie se entera hasta que un cliente lo reclama.
//
// Por eso la pantalla llama a `escalonParaCantidad`, `monedasDelBloque` y
// `precioEnMoneda` con lo que esto devuelve: son las tres que el catálogo
// público ya usa.
export type ProductoParaVenta = {
  id: string;
  name: string;
  unit: string | null;
  photoPath: string | null;
  producto: ProductoPublico;
};

export type ProductosParaVenta = {
  productos: ProductoParaVenta[];
  // LAS TASAS VIAJAN UNA VEZ, con la lista. Sin ellas el navegador no puede
  // convertir y tendría que preguntar por cada línea que cambie de moneda.
  rates: BolivarRates | null;
  // LAS MONEDAS QUE EL LIBRO SABE GUARDAR, y es la decisión del dueño del
  // 2026-10-17 hecha dato: un negocio venezolano cobra en dólares o euros, y
  // uno colombiano en pesos. NI BOLÍVARES NI USDT.
  //
  // Los bolívares no porque `movements.currency` no los admite: se paga en
  // bolívares y se guarda convertido, que es para lo que existe
  // `entry_currency` desde la migración `022`. El USDT no porque vuelve con
  // el paso 11 (`CT-79`).
  monedasDelLibro: PriceCurrency[];
};

export async function buscarProductosParaVenta(query: string): Promise<ProductosParaVenta> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { productos: [], rates: null, monedasDelLibro: [] };

  const rateContext = await getOwnerRateContext(supabase, user.id);
  const rates = rateContext?.effectiveRate ? await getBolivarRates(rateContext.effectiveRate) : null;
  const monedasDelLibro: PriceCurrency[] = rates ? ["USD", "EUR"] : ["COP"];

  const texto = query.trim();
  let consulta = supabase
    .from("products")
    .select(
      "id, name, unit, photo_path, price_retail, price_wholesale, base_currency, base_currency_retail, base_currency_wholesale, wholesale_min_quantity",
    )
    // EL `owner_id` SALE DE LA SESIÓN Y NUNCA DEL NAVEGADOR. Es la misma
    // comprobación explícita que pide `CLAUDE.md` para toda acción que lea
    // una fila por un id que llegó de fuera -- aquí ni siquiera llega, y aun
    // así se filtra, porque la RLS es el respaldo y no la única defensa.
    .eq("owner_id", user.id)
    .is("trashed_at", null)
    .order("name", { ascending: true })
    .limit(12);
  if (texto !== "") consulta = consulta.ilike("name", `%${texto}%`);

  const { data, error } = await consulta;
  if (error) {
    console.error("buscarProductosParaVenta:", error.message);
    return { productos: [], rates, monedasDelLibro };
  }

  const ids = (data ?? []).map((p) => p.id);
  if (ids.length === 0) return { productos: [], rates, monedasDelLibro };

  // LOS PRECIOS FIJADOS A MANO Y LAS MONEDAS ACTIVAS, en dos consultas para
  // toda la lista y no dos por producto. Son doce filas como mucho.
  const [{ data: overrides }, { data: activas }] = await Promise.all([
    supabase.from("product_price_overrides").select("product_id, tier, currency, amount").in("product_id", ids),
    supabase.from("product_currencies").select("product_id, tier, currency").in("product_id", ids),
  ]);

  const fijados = new Map<string, Partial<Record<PriceCurrency, number>>>();
  for (const o of overrides ?? []) {
    const clave = `${o.product_id}:${o.tier}`;
    const actual = fijados.get(clave) ?? {};
    actual[o.currency as PriceCurrency] = Number(o.amount);
    fijados.set(clave, actual);
  }
  const monedas = new Map<string, PriceCurrency[]>();
  for (const c of activas ?? []) {
    const clave = `${c.product_id}:${c.tier}`;
    monedas.set(clave, [...(monedas.get(clave) ?? []), c.currency as PriceCurrency]);
  }

  const bloque = (
    p: (typeof data)[number],
    tier: "retail" | "wholesale",
  ): BloqueCrudo | null => {
    const price = tier === "retail" ? p.price_retail : p.price_wholesale;
    if (price == null) return null;
    const base = tier === "retail" ? p.base_currency_retail : p.base_currency_wholesale;
    return {
      price: Number(price),
      pinned: fijados.get(`${p.id}:${tier}`) ?? {},
      base_currency: (base ?? p.base_currency) as PriceCurrency | null,
      currencies: monedas.get(`${p.id}:${tier}`) ?? null,
    };
  };

  return {
    rates,
    monedasDelLibro,
    productos: (data ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      unit: p.unit,
      photoPath: p.photo_path,
      producto: {
        // `bloqueDesdeRpc` es la misma traducción que hace el catálogo
        // público, incluido su respaldo para la ventana en la que el código
        // está desplegado y la migración `114` todavía no ha corrido.
        retail: bloqueDesdeRpc(bloque(p, "retail"), (p.base_currency ?? "USD") as PriceCurrency),
        wholesale: bloqueDesdeRpc(bloque(p, "wholesale"), (p.base_currency ?? "USD") as PriceCurrency),
        wholesale_min_quantity: p.wholesale_min_quantity,
      },
    })),
  };
}
