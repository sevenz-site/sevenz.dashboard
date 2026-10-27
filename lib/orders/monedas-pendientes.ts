import type { SupabaseClient } from "@supabase/supabase-js";

// ── QUÉ MONEDAS DE UN PEDIDO SIGUEN SIN VENDER ────────────────────────
//
// WRITTEN ONCE BECAUSE THREE DOORS ASK IT, and if they answered differently
// the order would be sealed as done with a currency still to charge -- or
// never sealed at all. The three:
//
//   · `registrarPedidoComoVenta`, after writing a sale;
//   · `quitarMonedaDelPedido`, after taking a currency out (`PR-F6`);
//   · `eliminarVenta` and `restoreMovement`, which undo and redo a sale
//     (`PR-F7`, 2026-10-26).
//
// IT LIVES IN `lib/` AND NOT IN THE ORDERS' ACTION FILE, which is where it was
// born on 2026-10-26: the third caller is in `ventas/actions.ts`, and one
// server-action module importing another's internals is how two features end
// up welded together. The answer to «what is still pending» is not an action;
// it is a question about the data.
//
// IT ASKS THE DATABASE AND NOT THE BROWSER. The draft knows what the
// shopkeeper typed; only `sales` knows what got written, and calling an order
// finished on the strength of a draft is how one gets stamped with a whole
// currency missing.
//
// DEAD LINES DO NOT COUNT AS PENDING. A currency whose products all left the
// catalogue can never have a sale, so waiting for it would leave the order
// pending for ever -- which is the same broken-in-silence bell its second
// caller exists to fix.
//
// `hayVentas` IS THE OTHER HALF, and it is what `quitarMonedaDelPedido` needs:
// «no pending currencies» is true of an order whose only remaining currency is
// dead and which has NO sale at all. Sealing that one would mark as registered
// an order that produced nothing.

export type EdicionesDeLinea = Record<string, { quantity: number; currency: string }>;

// THE CURRENCY EACH LINE ACTUALLY BELONGS TO, which is not always the one the
// customer ordered in: «Editar» can move it. Written once and used twice --
// for the lines of a registration call, and for working out what is still
// pending -- so the two answers cannot drift apart.
export function monedaDeLinea(
  linea: { id: string; currency: string | null },
  editadas: EdicionesDeLinea,
): string {
  return String(editadas[linea.id]?.currency ?? linea.currency ?? "");
}

export async function monedasPendientes(
  supabase: SupabaseClient,
  pedidoId: string,
  // Las líneas VIVAS, ya leídas por quien llama: las dos puertas las tienen.
  lineas: readonly { id: string; product_id: string | null; currency: string | null }[],
  // Las ediciones del borrador, cuando las haya: una línea movida de moneda
  // cuenta en la suya nueva. `quitarMonedaDelPedido` no ve el borrador y pasa
  // el objeto vacío, igual que agrupan su pantalla y su guardia.
  editadas: EdicionesDeLinea = {},
): Promise<{ pendientes: string[]; hayVentas: boolean }> {
  const delPedido = new Set<string>();
  for (const linea of lineas) {
    if (!linea.product_id) continue;
    const m = monedaDeLinea(linea, editadas);
    if (m !== "") delPedido.add(m);
  }

  const { data: ventasDelPedido } = await supabase
    .from("sales")
    .select("id, sale_lines(currency)")
    .eq("catalog_order_id", pedidoId)
    .is("deleted_at", null);
  const vendidas = new Set<string>();
  for (const v of (ventasDelPedido ?? []) as { sale_lines: { currency: string | null }[] }[]) {
    for (const l of v.sale_lines ?? []) {
      if (l.currency != null) vendidas.add(String(l.currency));
    }
  }

  return {
    pendientes: [...delPedido].filter((m) => !vendidas.has(m)),
    hayVentas: (ventasDelPedido ?? []).length > 0,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// EL SELLO DE UN PEDIDO SE VUELVE A CALCULAR, NUNCA SE DA POR HECHO
//
// `PR-F7`, medido en dev el 2026-10-26: borrar la venta de un pedido ya
// registrado dejaba el pedido sellado para siempre, apuntando a una venta que
// ya no existe, y el flujo se negaba a volver a entrar. El cliente quedaba con
// «Todavía no hay transacciones registradas» y el pedido diciendo «Registrado:
// 26 oct. 2026, 6:38 p. m.». Ninguna pantalla decía nada.
//
// LA CAUSA ERA QUE EL SELLO SOLO SE PONÍA, NUNCA SE REVISABA. `eliminarVenta`
// borraba la venta y no sabía que existían los pedidos, aunque el enlace está
// en las dos direcciones desde la migración `157`.
//
// ASÍ QUE ESTA FUNCIÓN NO «DESSELLA»: RECALCULA. Es la misma pregunta que ya
// contesta `monedasPendientes` --¿queda algo por cobrar?-- aplicada después de
// cada cambio, así que sirve igual para borrar una venta que para restaurarla.
// Un pedido de DOS monedas con una venta borrada tiene que volver pendiente de
// ESA moneda y de ninguna otra, y eso no se puede escribir a mano sin volver a
// preguntar.
//
// `sale_id` SE REPONE CON LA VENTA VIVA MÁS ANTIGUA. Esa columna guarda la
// PRIMERA venta del pedido (migración `158`) y se usa para abrirla desde el
// detalle: dejarla apuntando a una fila borrada es un enlace a ninguna parte.
//
// ───────────────────────────────────────────────────────────────────────
// Y LA MITAD QUE NO ES OPCIONAL: RESTAURAR TIENE QUE VOLVER A SELLAR
//
// `restoreMovement` revive la venta a propósito desde el 2026-10-20. Sin esta
// función llamada también desde allí, restaurar dejaría el pedido SIN sellar
// con su venta VIVA -- y el flujo lo dejaría registrar otra vez, cobrándole al
// cliente DOS veces por el mismo pedido.
//
// Ese sería un fallo peor que el que se está arreglando, creado por el propio
// arreglo. Por eso las dos llamadas entran en el mismo cambio y por eso esto
// es una sola función: la que borra y la que restaura hacen literalmente lo
// mismo --volver a preguntar-- y separarlas sería dejar que una se olvide.
export async function recalcularSelloDelPedido(
  supabase: SupabaseClient,
  pedidoId: string,
): Promise<void> {
  // Las líneas vivas, que son las que deciden qué monedas tiene el pedido.
  // `deleted_at` es la migración `161`: una moneda que el tendero quitó no
  // cuenta, igual que no cuenta en las otras dos puertas.
  const { data: lineas, error: errorLineas } = await supabase
    .from("catalog_order_items")
    .select("id, product_id, currency")
    .eq("order_id", pedidoId)
    .is("deleted_at", null);
  if (errorLineas) {
    console.error("[pedido] sello: no se pudieron leer las líneas:", errorLineas.message);
    return;
  }

  const { pendientes, hayVentas } = await monedasPendientes(supabase, pedidoId, lineas ?? []);

  // LAS VENTAS VIVAS, EN ORDEN. La PRIMERA es lo que `sale_id` significa; la
  // ÚLTIMA es cuándo se terminó de registrar el pedido.
  const { data: vivas } = await supabase
    .from("sales")
    .select("id, created_at")
    .eq("catalog_order_id", pedidoId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  const primeraViva = vivas?.[0]?.id ?? null;
  const ultimaVenta = vivas?.[vivas.length - 1]?.created_at ?? null;

  // SELLADO = no queda nada por cobrar Y existe al menos una venta. La segunda
  // mitad es la misma de `quitarMonedaDelPedido`: sin ninguna venta, «nada
  // pendiente» describe un pedido cuyas monedas están todas descatalogadas, y
  // sellarlo diría que produjo algo.
  const sellado = hayVentas && pendientes.length === 0;

  // ── `registered_at` SE REPONE, Y NO ES UN DETALLE ────────────────────
  //
  // La primera versión de esta función, escrita el 2026-10-26, sellaba
  // escribiendo solo `status` y `sale_id`. **Medido en el navegador esa misma
  // tarde**: al RESTAURAR la venta desde la campana, el pedido volvía a
  // `registered` con `registered_at` en NULO -- y los guardias de las seis
  // pantallas del flujo miran `registered_at`, no `status`. O sea que la
  // pantalla volvía a ofrecer «Registrar pedido» sobre un pedido ya cobrado.
  //
  // No habría cobrado dos veces --la parada dura de `registrarPedidoComoVenta`
  // rechaza una moneda ya vendida-- pero el tendero habría recorrido tres
  // pantallas para encontrarse un error al final. Y era un fallo CREADO por el
  // arreglo: el defecto que se estaba cerrando, entrando por la otra puerta.
  //
  // QUÉ FECHA SE PONE: la de la ÚLTIMA venta viva del pedido, que es cuando se
  // terminó de cobrar. La original se perdió al dessellar, y `now()` diría que
  // el pedido se registró en el momento de pulsar «Restaurar», que es falso.
  const { error } = await supabase
    .from("catalog_orders")
    .update(
      sellado
        ? { status: "registered", sale_id: primeraViva, registered_at: ultimaVenta }
        : // VUELVE A `new` Y NO A `seen`: es la decisión del dueño del
          // 2026-10-25 --*«si presiona "Registrar pedido" y no completa el
          // registro, el pedido vuelve a su estado original»*--. Un pedido con
          // una moneda otra vez por cobrar es exactamente eso, y volver a
          // contar en la campana es lo que hace que alguien lo mire.
          { status: "new", registered_at: null, sale_id: primeraViva },
    )
    .eq("id", pedidoId);

  // UN FALLO AQUÍ NO TUMBA EL BORRADO, que ya ocurrió y es lo que el tendero
  // pidió. Lo que queda es el estado viejo del pedido, que es justo el defecto
  // que esto arregla -- así que se registra para poder encontrarlo, y no se
  // convierte en un error que haga creer que la venta sigue ahí.
  if (error) console.error("[pedido] sello:", error.message);
}
