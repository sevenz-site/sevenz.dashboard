import type { ProductosParaVenta } from "@/app/(app)/ventas/actions";
import type { LineaVenta } from "@/components/dashboard/paso-producto";
import type { DatosRapidos } from "@/components/dashboard/quick-product-sheet";
import { cantidadMinima, escalonParaCantidad, monedasDelBloque } from "@/lib/products/public-pricing";

// A CART LINE FOR A PRODUCT FETCHED BY ID (CT-182): the scanner's «Vender», a code read
// inside a sale, and a product created from a scan. The same rules as the quick-create
// path of `paso-producto.tsx` -- the wholesale minimum, then the first currency the block
// offers that the book can keep -- so a scanned line behaves like any other.
//
// Null when the product cannot be sold here: gone, or with no price in a currency the
// book keeps. The caller says so; a scan must never add nothing silently.
export function lineaParaProducto(
  r: ProductosParaVenta,
  productId: string,
  cantidad: number,
  creadoEnVenta?: DatosRapidos,
): LineaVenta | null {
  const p = r.productos.find((x) => x.id === productId);
  if (!p) return null;
  const unidades = Math.max(cantidad, cantidadMinima(p.producto));
  const bloque = escalonParaCantidad(p.producto, unidades) === "wholesale" ? p.producto.wholesale : p.producto.retail;
  const moneda = monedasDelBloque(bloque ?? null, r.rates).filter((c) => r.monedasDelLibro.includes(c))[0];
  if (!moneda) return null;
  return {
    productId: p.id,
    name: p.name,
    unit: p.unit,
    photoPath: p.photoPath,
    producto: p.producto,
    quantity: unidades,
    currency: moneda,
    ...(creadoEnVenta ? { creadoEnVenta } : {}),
  };
}
