import {
  registrarPedidoComoVenta,
  type RegistroDePedidoEntrada,
} from "@/app/(app)/productos/ordenes/actions";
import type { BorradorDeRegistro } from "@/lib/orders/borrador-de-registro";

// COMMITTING THE WHOLE ORDER: ONE CALL PER CURRENCY, IN ORDER.
//
// ===========================================================================
// WHY A LOOP AND NOT ONE CALL THAT DOES EVERYTHING
//
// The owner's decision of 2026-10-25 is that a two-currency order becomes
// **two sales**: *«dos ventas pero el cliente se guarda al final de la primera
// venta y se usa para la segunda venta»*. The server action registers one
// currency, which is what `qa/pedido-registro.mjs` tests end to end — so the
// honest shape here is the loop that drives it, not a second server function
// that would have to repeat its guards.
//
// THE FICHA TRAVELS FORWARD. The first call creates the client and returns
// its id; every later call is handed that id as `fichaId`. Without it the
// second call would try to open a second ficha with the same document and
// fail on the unique index — the customer's own order, refused halfway.
//
// ===========================================================================
// WHAT A FAILURE HALF WAY LEAVES, SAID OUT LOUD
//
// If the second currency fails after the first succeeded, the first sale is
// WRITTEN. That is not damage: the money the shopkeeper already took is
// recorded, the order is not stamped as finished, and its remaining block
// still offers «Registrar». What the caller must do is say which currency
// failed, because «no se pudo registrar» on a screen that half worked is the
// message that makes somebody try the whole thing again.
//
// Rolling the first sale back instead was the alternative and it is worse: it
// deletes a charge the customer has already been told about, to tidy up a
// screen.

export type ResultadoDeTodo =
  | { ok: true; primeraVentaId: string; excluidas: string[] }
  | { ok: false; error: string; monedasHechas: string[] };

export async function registrarTodoElPedido(
  pedidoId: string,
  borrador: BorradorDeRegistro,
  // In the order the screen drew them, so a failure message can name the
  // currency the shopkeeper was looking at.
  monedas: readonly string[],
): Promise<ResultadoDeTodo> {
  const cliente = borrador.cliente;
  if (!cliente) {
    return {
      ok: false,
      error: "Faltan los datos del cliente. Vuelve atrás y complétalos.",
      monedasHechas: [],
    };
  }

  // SOLO LAS MONEDAS QUE EL TENDERO RELLENÓ. Una que dejó sin tocar no entra
  // en la venta -- es la decisión del dueño del 2024-10-24 detrás del diálogo
  // «faltan X», y el botón «Continuar igual» ya se la enseñó.
  const porRegistrar = monedas.filter((m) => borrador.monedas[m] != null);
  if (porRegistrar.length === 0) {
    return {
      ok: false,
      error: "No has registrado ninguna moneda todavía.",
      monedasHechas: [],
    };
  }

  let fichaId = cliente.fichaId;
  let primeraVentaId: string | null = null;
  const excluidas: string[] = [];
  const monedasHechas: string[] = [];

  for (const moneda of porRegistrar) {
    const entrada: RegistroDePedidoEntrada = {
      pedidoId,
      moneda,
      pago: borrador.monedas[moneda],
      editadas: borrador.editadas ?? {},
      cliente: { ...cliente, fichaId },
    };
    const r = await registrarPedidoComoVenta(entrada);
    if (!r.ok) {
      return {
        ok: false,
        error:
          monedasHechas.length === 0
            ? r.error
            : // LO QUE YA SE GUARDÓ, DICHO EN EL MISMO MENSAJE. Sin esta
              // mitad el tendero vuelve a empezar y registra dos veces lo
              // que ya está escrito.
              `${r.error} Lo de ${monedasHechas.join(" y ")} sí quedó registrado.`,
        monedasHechas,
      };
    }
    fichaId = r.clientId;
    primeraVentaId = primeraVentaId ?? r.saleId;
    excluidas.push(...r.excluidas);
    monedasHechas.push(moneda);
  }

  // `primeraVentaId` is a string by now -- the loop ran at least once and
  // every path out of a failed call returns -- but the compiler cannot see it,
  // and an assertion would hide the day somebody adds a path that skips it.
  if (primeraVentaId == null) {
    return { ok: false, error: "No se registró ninguna venta.", monedasHechas };
  }
  return { ok: true, primeraVentaId, excluidas };
}
