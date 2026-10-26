"use client";

import { useRef, useSyncExternalStore } from "react";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { formatBs } from "@/lib/exchange-rate/format";
import {
  instantanea,
  suscribirseAlBorrador,
  type BorradorDeRegistro,
} from "@/lib/orders/borrador-de-registro";
import {
  currencyName,
  formatPriceAmount,
  priceIn,
  type BolivarRates,
  type PriceCurrency,
} from "@/lib/products/price";

// WHAT THIS ORDER WOULD BECOME, PER CURRENCY — frame `1564:11979`, the block
// that appears inside «Pedido» once at least one line has been registered.
//
// Five figures, and the order of them is the frame's: «Total en X», «Abonó en
// X», «Debe (esta venta)», «Deuda antigua», «Deuda total». The last one is
// the only figure a shopkeeper actually tells the customer out loud, which is
// why it is the one in bold with its bolívares underneath.
//
// ===========================================================================
// IT COUNTS ONLY THE LINES ALREADY REGISTERED
//
// Not the whole order: the owner's decision of 2026-10-24 is that products
// left unregistered do not enter the sale. So a card that summed everything
// would be promising a debt the sale is not going to write.
//
// AND IT COUNTS THEM IN THE EDITED CURRENCY, not the sealed one. «Editar» can
// move a line from dollars to euros, and totalling it under the currency the
// customer originally saw would make this card disagree with the sale by a
// whole ledger.
export type LineaDelPedido = {
  id: string;
  cantidad: number;
  precioUnitario: number;
  moneda: PriceCurrency;
};

// ── SE SUSCRIBE DE VERDAD DESDE EL 2026-10-26 ─────────────────────────
//
// Hasta ese día el primer argumento era un `() => () => {}`: un «no me avises
// nunca». Con eso, `getSnapshot` solo se vuelve a leer cuando React repinta
// el componente por otra razón, y editar una línea no es ninguna — la hoja se
// cierra, `router.refresh()` vuelve a pedir la pantalla al servidor, y el
// servidor no ve el borrador. La tarjeta se quedaba diciendo la cantidad
// vieja.
//
// Lo reportó el dueño con la captura: *«selecciono 4 > selecciono "Agregar" >
// Resultado: no se agregan»*. Se agregaba; no se contaba.
//
// `suscribirseAlBorrador` es el aviso que `sessionStorage` no da en la propia
// pestaña. Ver su comentario en `lib/orders/borrador-de-registro.ts`.
export function useBorrador(pedidoId: string): BorradorDeRegistro | null {
  const cache = useRef<BorradorDeRegistro | null | undefined>(undefined);
  return useSyncExternalStore(
    suscribirseAlBorrador,
    () => {
      cache.current = instantanea(pedidoId);
      return cache.current;
    },
    () => null,
  );
}

// THE PER-CURRENCY ROLL-UP, computed from the draft and the order's lines.
// Exportada desde que el «Continuar» del pie necesitaba esta misma cuenta.
// Ese botón se quitó el 2026-10-25 --el sitemap no lo dibuja--, pero la
// función se queda exportada: es la única cuenta de «qué hay resuelto» del
// flujo, y tenerla en un sitio es lo que impide que dos pantallas se
// contradigan sobre lo mismo.
export function resumirPorMoneda(
  lineas: LineaDelPedido[],
  borrador: BorradorDeRegistro | null,
): Map<PriceCurrency, { total: number; abonado: number }> {
  const porMoneda = new Map<
    PriceCurrency,
    { total: number; abonado: number }
  >();
  if (!borrador) return porMoneda;

  // ── EL ABONO ES DE LA MONEDA, NO DE LA LÍNEA — `CT-147` ─────────────
  //
  // Antes cada línea traía su propio abono y esto los sumaba. Desde el
  // 2026-10-25 el tendero teclea UNA cifra por moneda, así que el total se
  // sigue sumando línea a línea pero el abono se lee una sola vez por
  // bloque. Sumarlo por línea ahora multiplicaría el abono por el número de
  // productos de esa moneda -- y el tendero vería su deuda saldada con un
  // pago que no hizo.
  for (const linea of lineas) {
    const edicion = borrador.editadas?.[linea.id];
    const moneda =
      (edicion?.currency as PriceCurrency | undefined) ?? linea.moneda;
    // Una moneda que el tendero todavía no ha rellenado no entra: esta
    // tarjeta dice qué va a ser la venta, y eso aún no lo es.
    if (!borrador.monedas[moneda]) continue;
    const cantidad = edicion?.quantity ?? linea.cantidad;
    // EL PRECIO DE LA EDICIÓN MANDA, igual que en las otras tres cifras del
    // flujo: una línea que subió al mínimo de mayoreo cuesta menos por
    // unidad, y esta tarjeta dice en qué va a quedar la deuda del cliente.
    const total =
      Math.round(cantidad * (edicion?.unitPrice ?? linea.precioUnitario) * 100) / 100;

    const acc = porMoneda.get(moneda) ?? { total: 0, abonado: 0 };
    acc.total = Math.round((acc.total + total) * 100) / 100;
    porMoneda.set(moneda, acc);
  }
  // Y el abono, una vez por moneda, después de haber sumado los totales.
  for (const [moneda, acc] of porMoneda) {
    acc.abonado = Math.round((borrador.monedas[moneda]?.amount ?? 0) * 100) / 100;
  }
  return porMoneda;
}

function Fila({
  nombre,
  children,
  fuerte = false,
}: {
  nombre: React.ReactNode;
  children: React.ReactNode;
  fuerte?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-1">
      <span className={fuerte ? "text-base font-semibold" : "text-xs"}>
        {nombre}
      </span>
      <span className={fuerte ? "text-base font-semibold" : "text-xs"}>
        {children}
      </span>
    </div>
  );
}

export function OrderRegistrationSummary({
  pedidoId,
  lineas,
  // What this client already owed, per currency, BEFORE this sale. Empty when
  // the order matched no ficha or matched several: there is no single person
  // whose debt this is, and picking one would be a coin flip.
  deudaAntigua,
  rates,
}: {
  pedidoId: string;
  lineas: LineaDelPedido[];
  deudaAntigua: Partial<Record<PriceCurrency, number>>;
  rates: BolivarRates | null;
}) {
  const borrador = useBorrador(pedidoId);
  const porMoneda = resumirPorMoneda(lineas, borrador);
  if (porMoneda.size === 0) return null;

  return (
    <>
      {[...porMoneda.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([moneda, { total, abonado }]) => {
          const debeEstaVenta = Math.round((total - abonado) * 100) / 100;
          const antigua = deudaAntigua[moneda] ?? 0;
          const deudaTotal = Math.round((debeEstaVenta + antigua) * 100) / 100;
          const enBs =
            rates && moneda !== "VES"
              ? (priceIn("VES", { amount: total, currency: moneda }, rates)
                  ?.amount ?? null)
              : null;
          const totalEnBs =
            rates && moneda !== "VES"
              ? (priceIn("VES", { amount: deudaTotal, currency: moneda }, rates)
                  ?.amount ?? null)
              : null;
          const nombre = currencyName(moneda);

          return (
            <div
              key={moneda}
              className="flex flex-col rounded-[10px] border px-4 py-2"
            >
              <div className="flex items-start justify-between gap-2 py-2">
                <div className="flex min-w-0 flex-col gap-1">
                  {/* `capitalize` ONLY ON THE CURRENCY. It was on the card
                      and it title-cased every label inside it — «Debe (Esta
                      Venta)», «Deuda Antigua». `currencyName` returns a
                      lowercase word because it is written to sit inside a
                      sentence; here it is a proper noun at the end of one. */}
                  <span className="text-sm">
                    Total en <span className="capitalize">{nombre}</span>
                  </span>
                  <span className="flex items-center gap-1 text-base font-semibold tabular-nums">
                    <CurrencyFlagIcon
                      currency={moneda}
                      className="size-4 shrink-0"
                    />
                    {formatPriceAmount(total, moneda)}
                  </span>
                  {enBs != null ? (
                    <span className="pl-5 text-xs text-muted-foreground tabular-nums">
                      {formatBs(enBs)}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-col gap-2 border-t py-3 tabular-nums">
                <Fila
                  nombre={
                    <>
                      Abonó en <span className="capitalize">{nombre}</span>
                    </>
                  }
                >
                  {formatPriceAmount(abonado, moneda)}
                </Fila>
              </div>

              <div className="flex flex-col gap-2 border-t pt-3 tabular-nums">
                <Fila nombre="Debe (esta venta)">
                  {formatPriceAmount(debeEstaVenta, moneda)}
                </Fila>
                {/* A CREDIT IS NOT WRITTEN WITH A MINUS. The repo's rule of
                    2026-10-23: «Por cobrar −$178.00» does not read as «you are
                    178 ahead», it reads as a broken app or a debt with the
                    sign backwards. The absolute value, and the word carries
                    the sign. */}
                <Fila nombre="Deuda antigua">
                  {formatPriceAmount(Math.abs(antigua), moneda)}
                  {antigua < 0 ? (
                    <span className="text-money-in"> a favor</span>
                  ) : null}
                </Fila>
                <div className="flex items-start justify-between gap-1 pt-1">
                  <span className="text-base font-semibold">Deuda total</span>
                  <span className="flex flex-col items-end">
                    <span className="text-base font-semibold tabular-nums">
                      {formatPriceAmount(Math.abs(deudaTotal), moneda)}
                      {deudaTotal < 0 ? (
                        <span className="text-money-in"> a favor</span>
                      ) : null}
                    </span>
                    {totalEnBs != null ? (
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {formatBs(Math.abs(totalEnBs))}
                      </span>
                    ) : null}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
    </>
  );
}
