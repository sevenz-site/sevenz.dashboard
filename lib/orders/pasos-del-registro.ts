import {
  tieneAlgoQueCobrar,
  type BloqueDeMoneda,
} from "@/lib/orders/bloques-de-moneda";
import type { PriceCurrency } from "@/lib/products/price";

// ¿SOBRA EL PASO «1/4 PEDIDO»?
//
// ═══════════════════════════════════════════════════════════════════════
// EL ENCARGO
//
// Del dueño, el 2026-10-25: *«si solo existe pedido en una moneda, la
// pantalla "Nuevo pedido 1/4 Pedido" es redundante, entonces en ese caso se
// elimina del flujo y el primer paso del flujo pasa a ser "Detalle del pedido
// 2/4 Confirmar pedido"»*.
//
// Y tiene razón por lo que ESA pantalla es: un selector. El frame
// `1652:12752` dibuja un bloque por moneda, cada uno con su «Registrar», para
// que el tendero elija cuál resuelve primero. Con una sola moneda no hay nada
// que elegir — es una lista de un elemento con un botón, delante de la
// pantalla a la que ese botón lleva.
//
// ═══════════════════════════════════════════════════════════════════════
// POR QUÉ ESTO ES UNA FUNCIÓN Y NO UN `bloques.length === 1` EN CADA SITIO
//
// La respuesta hace falta en SEIS lugares y los seis tienen que coincidir: el
// botón «Registrar pedido» del detalle (a dónde lleva), la propia `/registrar`
// (que si sobra, redirige), la flecha de atrás del 2/4 (a dónde vuelve), y el
// contador de los tres pasos que quedan.
//
// Si dos de ellos contestan distinto no sale un error: sale un BUCLE. El 2/4
// vuelve a `/registrar`, `/registrar` reenvía al 2/4, y el tendero se queda
// sin forma de retroceder. Es el fallo concreto que esta función existe para
// hacer imposible.
//
// ═══════════════════════════════════════════════════════════════════════
// LOS DOS BORDES QUE DECIDEN LA CONDICIÓN, Y NO SON EL MISMO
//
// 1. DOS MONEDAS DONDE UNA NO SE PUEDE COBRAR --todos sus productos salieron
//    del catálogo-- NO cuenta como «una sola moneda», aunque solo se pueda
//    registrar una. El `1/4` es el único sitio donde ese bloque muerto se ve;
//    saltárselo escondería que media compra del cliente no va a entrar en la
//    venta, y el tendero se enteraría cuando el cliente reclame. Por eso la
//    condición mira `bloques.length`, no cuántos son registrables.
//
// 2. UNA SOLA MONEDA QUE TAMPOCO SE PUEDE COBRAR sí se queda en el `1/4`, y
//    es el otro lado de lo mismo: saltar llevaría al `2/4`, cuyo propio
//    guardia (`cargarBloque`) rebota al detalle por no haber nada que vender.
//    El tendero daría a «Registrar pedido» y volvería al sitio del que salió,
//    sin una palabra. En el `1/4` ve su bloque, sin botón, con sus líneas.
//
// ───────────────────────────────────────────────────────────────────────
// LO QUE ESTA FUNCIÓN NO PUEDE SABER, DICHO EN VOZ ALTA
//
// Agrupa por la moneda SELLADA, porque quien la llama es el servidor y el
// servidor no ve el borrador. Si «Editar pedido» mueve una línea a otra
// moneda, el pedido pasa a tener dos bloques y esto sigue diciendo uno.
//
// Eso NO es nuevo ni lo empeora este cambio: `cargarBloque` ya agrupa igual,
// y el propio `1/4` también, así que una línea movida a una moneda que el
// pedido no tenía ya era un bloque que nadie ofrecía registrar. Queda anotado
// aquí porque es el sitio donde alguien lo va a buscar.
export function unicaMonedaDelPedido(
  bloques: readonly BloqueDeMoneda[],
  // ── Y TAMPOCO SE SALTA SI HAY ALGO QUITADO ────────────────────────
  //
  // Reportado por el dueño el 2026-10-26: quitar una de las dos monedas lo
  // echaba del `1/x` a «Detalle del pedido», y restaurar lo movía otra vez.
  // *«debe dejarme en la misma pantalla»*, las dos veces.
  //
  // LA CAUSA ERA UNA SOLA: al quitar una moneda el pedido se queda con una,
  // y con una sola esta función decía «sáltate el 1/x». Pero con algo quitado
  // ese paso SÍ tiene trabajo: es donde está la tarjeta de «Restaurar», o sea
  // la decisión de devolverlo. Saltárselo es sacar al tendero de la pantalla
  // en la que acaba de tocar un botón.
  //
  // `false` POR DEFECTO para que quien no lo sepa no cambie de
  // comportamiento: las pantallas que no leen las quitadas se comportan como
  // antes, y las que sí lo pasan.
  hayQuitadas = false,
): PriceCurrency | null {
  if (hayQuitadas) return null;
  if (bloques.length !== 1) return null;
  const unico = bloques[0];
  return tieneAlgoQueCobrar(unico) ? unico.moneda : null;
}

// ── LAS MONEDAS QUE EL TENDERO QUITÓ, CONTADAS ────────────────────────
//
// Migración `161`. Es la ÚNICA lectura del repo que pide las borradas, y por
// eso lleva su `.not(...)` explícito: `qa:lineas-borradas` lo reconoce como
// una decisión y no como un olvido.
//
// ESTÁ AQUÍ Y NO EN CADA PANTALLA porque la respuesta decide dos cosas que no
// pueden discrepar: si se dibuja la tarjeta de «Restaurar» y si el paso `1/x`
// sigue existiendo. Escrita en cinco sitios, basta con que uno la olvide para
// que el tendero quite una moneda y se quede sin forma de devolverla.
export async function quitadasPorMoneda(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  pedidoId: string,
): Promise<Map<string, number>> {
  const { data } = await supabase
    .from("catalog_order_items")
    .select("id, currency")
    .not("deleted_at", "is", null)
    .eq("order_id", pedidoId);
  const porMoneda = new Map<string, number>();
  for (const l of (data ?? []) as { currency: string | null }[]) {
    const m = String(l.currency ?? "");
    if (m === "") continue;
    porMoneda.set(m, (porMoneda.get(m) ?? 0) + 1);
  }
  return porMoneda;
}
