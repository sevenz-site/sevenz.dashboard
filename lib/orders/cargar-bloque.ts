import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOwnerRateContext } from "@/lib/exchange-rate/owner-rate";
import { getBolivarRates } from "@/lib/products/catalog";
import {
  bloquesDeMoneda,
  tieneAlgoQueCobrar,
  type BloqueDeMoneda,
} from "@/lib/orders/bloques-de-moneda";
import {
  estaDescartado,
  ORDER_COLUMNS,
  ORDER_ITEM_COLUMNS,
  readOrderProducts,
  type CatalogOrderRow,
  type CatalogOrderItemRow,
} from "@/lib/orders/catalog-orders";
import { quitadasPorMoneda } from "@/lib/orders/pasos-del-registro";
import type { BolivarRates } from "@/lib/products/price";

// WHAT `2/4 Confirmar pedido` AND `3/4 Pago` BOTH NEED, loaded once.
//
// ===========================================================================
// THE GUARDS LIVE HERE SO THEY CANNOT BE HALF-APPLIED
//
// Both screens take the order id and the currency from the URL, so both can
// be typed, bookmarked, or reached with the back button long after anything
// was decided. Each needs the same four answers: is this order the owner's,
// is it already registered, does this currency exist in it, and is there
// anything left in it to sell.
//
// Written twice, the pair drifts — and the way it drifts is that one screen
// keeps a guard the other loses, so the flow has a door with no lock on it.
// That is the shape of the bug this repo already paid for with
// `getOrCreateShareLink` and `confirmImport`, which relied on RLS alone.
//
// ===========================================================================
// WHY IT REDIRECTS INSTEAD OF 404-ing WHEN THE ORDER IS DONE
//
// The order exists; it is simply finished. A 404 would tell the shopkeeper
// their order vanished. Sending them to its detail shows them what happened
// to it, which is what they were actually asking.

export type BloqueCargado = {
  pedido: CatalogOrderRow;
  items: CatalogOrderItemRow[];
  bloques: BloqueDeMoneda[];
  bloque: BloqueDeMoneda;
  rates: BolivarRates | null;
  prevista: { fecha: string } | null;
  ownerId: string;
  productosPorId: Awaited<ReturnType<typeof readOrderProducts>>;
  // LAS MONEDAS QUITADAS, por su nombre y con cuántas líneas. Las devuelve
  // este cargador --y no cada pantalla-- porque de ellas depende si el paso
  // `1/x` existe, y dos pantallas que contesten distinto a eso dejan al
  // tendero sin forma de retroceder.
  quitadas: Map<string, number>;
};

export async function cargarBloque(
  pedidoId: string,
  moneda: string | undefined,
): Promise<BloqueCargado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // `.eq("owner_id", user.id)` EXPLICITLY. The id arrives from the URL, so
  // this is the rule this project wrote after its 2026-08-28 audit: RLS is
  // the backstop, not the only line of defence.
  const { data: order, error } = await supabase
    .from("catalog_orders")
    .select(ORDER_COLUMNS)
    .eq("id", pedidoId)
    .eq("owner_id", user.id)
    .maybeSingle();

  // A read that FAILED and an order that is not there both leave this null,
  // and only the second deserves a 404 — the trap migration `116` sprang on
  // this table in October.
  if (error) console.error("[orders] cargarBloque:", error.message);
  if (!order) notFound();
  const pedido = order as CatalogOrderRow;

  // THE HARD STOP. A finished order must never walk this flow again: the
  // second pass would write the charge twice and the customer would owe
  // double, with nothing on screen saying so.
  //
  // `registered_at` AND NOT `sale_id`: since migration `158` an order can
  // have several sales and `sale_id` holds only the first, so it is set while
  // the order is still half way through. `registered_at` is stamped by
  // `registrarPedidoComoVenta` when the LAST currency lands, which is exactly
  // «this order is done».
  if (pedido.registered_at != null) {
    redirect(`/productos/ordenes/${pedido.id}`);
  }

  // ── Y LA OTRA MITAD: UN PEDIDO DESCARTADO ─────────────────────────
  //
  // Desde el 2026-10-26. Las dos pantallas que cargan por aquí --`Confirmar`
  // y `Pago`-- respondían 200 sobre un pedido descartado, medido en dev. Va
  // junto al guardia de arriba a propósito: son la misma pregunta --«este
  // pedido ya no está en juego»-- y separarlas es cómo una se queda sin la
  // otra. Mismo destino, por la misma razón: el pedido existe, así que el
  // detalle le dice qué le pasó.
  if (estaDescartado(pedido)) {
    redirect(`/productos/ordenes/${pedido.id}`);
  }

  const { data: filas } = await supabase
    .from("catalog_order_items")
    .select(ORDER_ITEM_COLUMNS)
    // SOLO LAS VIVAS -- migración `161`. Si una moneda entera se quitó, su
    // bloque deja de existir y el guardia de abajo rebota al detalle, que es
    // lo mismo que ya hacía con una moneda que el pedido no tiene.
    .is("deleted_at", null)
    .eq("order_id", pedido.id)
    .order("created_at", { ascending: true });
  const items = (filas ?? []) as CatalogOrderItemRow[];

  // GROUPED BY THE SEALED CURRENCY, because the server cannot read the
  // browser's draft. An edit that moved a line reloads the screen, and that
  // is when the grouping is recomputed.
  const bloques = bloquesDeMoneda(items, undefined);
  const bloque = bloques.find((b) => b.moneda === moneda);

  // A CURRENCY THIS ORDER DOES NOT HAVE is not a 404 either: the order is
  // fine, the URL is stale — most likely because «Editar» moved the last line
  // out of that block. Back to the order, where the blocks that do exist are.
  if (!bloque || !tieneAlgoQueCobrar(bloque)) {
    redirect(`/productos/ordenes/${pedido.id}`);
  }

  const [productosPorId, rateContext, quitadas] = await Promise.all([
    readOrderProducts(supabase, user.id, items),
    getOwnerRateContext(supabase, user.id),
    quitadasPorMoneda(supabase, pedido.id),
  ]);
  const rates: BolivarRates | null = rateContext
    ? await getBolivarRates(rateContext.effectiveRate)
    : null;
  const prevista = rateContext?.prevista ?? null;

  return {
    pedido,
    items,
    bloques,
    bloque,
    rates,
    prevista,
    ownerId: user.id,
    productosPorId,
    quitadas,
  };
}
