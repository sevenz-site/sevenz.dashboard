"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { ScreenBackRow } from "@/components/dashboard/screen-back-row";
import { ScreenTitle } from "@/components/dashboard/screen-chrome";
import {
  registrarPedidoComoVenta,
  type PagoDeLineaEntrada,
} from "@/app/(app)/productos/ordenes/actions";
import {
  borrarBorrador,
  instantanea,
  type BorradorDeRegistro,
} from "@/lib/orders/borrador-de-registro";
import { formatCantidad } from "@/lib/products/cantidad";
import {
  currencyName,
  formatPriceAmount,
  type PriceCurrency,
} from "@/lib/products/price";

const sinSuscripcion = () => () => {};

export type LineaDelPedidoParaResumen = {
  id: string;
  nombre: string;
  cantidad: number;
  precioUnitario: number;
  moneda: PriceCurrency;
  // `false` when the product is no longer in the catalogue. The sale cannot
  // carry it — see the server action — and the summary says so before the
  // shopkeeper presses anything, rather than after.
  tieneProducto: boolean;
};

// THE LAST SCREEN BEFORE THE SALE IS WRITTEN.
//
// ===========================================================================
// IT SAYS WHAT THE CUSTOMER ASKED FOR WHEN IT DIFFERS
//
// The owner's decision of 2026-10-24: *«el resumen final debe decir "el
// cliente pidió 5" y lo que se está registrando cuando difiera»*.
//
// ONLY WHEN IT DIFFERS, and that is his wording. On a line nobody edited the
// two figures are the same number printed twice, and a notice that appears on
// every row is one nobody reads by the time it matters.
export function OrderRegisterConfirm({
  pedidoId,
  lineas,
}: {
  pedidoId: string;
  lineas: LineaDelPedidoParaResumen[];
}) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cache = useRef<BorradorDeRegistro | null | undefined>(undefined);
  const borrador = useSyncExternalStore(
    sinSuscripcion,
    () => {
      cache.current = instantanea(pedidoId);
      return cache.current;
    },
    () => null,
  );

  // REGISTERED LINES ONLY. What was left out never enters the sale — the
  // owner's decision behind the «faltan X productos» dialog.
  const registradas = lineas.filter((l) => borrador?.lineas[l.id]);
  const excluidas = registradas.filter((l) => !l.tieneProducto);
  const cliente = borrador?.cliente ?? null;

  async function registrar() {
    if (!borrador || !cliente) {
      setError(
        "Se perdió lo que llevabas registrado. Vuelve al pedido y empieza de nuevo.",
      );
      return;
    }
    setEnviando(true);
    setError(null);
    const pagos: PagoDeLineaEntrada[] = registradas.map((l) => ({
      lineaId: l.id,
      ...borrador.lineas[l.id],
    }));
    const r = await registrarPedidoComoVenta({
      pedidoId,
      pagos,
      editadas: borrador.editadas ?? {},
      cliente,
    });
    if (!r.ok) {
      setEnviando(false);
      setError(r.error);
      return;
    }
    // THE DRAFT GOES ONLY AFTER THE SALE LANDS. Clearing it first would, on a
    // failed write, leave the shopkeeper with an order that still says
    // «Registrar» and nothing of what they had typed.
    borrarBorrador();
    router.push(`/ventas/${r.saleId}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <ScreenBackRow
        href={`/productos/ordenes/${pedidoId}/registrar/cliente`}
        label="Volver"
        soloEnTelefono={false}
      />

      <div className="flex flex-col gap-2">
        <ScreenTitle>Revisa y registra</ScreenTitle>
        <p className="text-sm text-muted-foreground">
          Esto es lo que se va a guardar.
        </p>
      </div>

      {cliente ? (
        <div className="flex flex-col gap-1 rounded-[10px] border p-4">
          <span className="text-xs text-muted-foreground">Cliente</span>
          <span className="text-base font-semibold">{cliente.name}</span>
          {cliente.fichaId == null ? (
            <span className="text-xs text-muted-foreground">
              Se creará una ficha nueva con estos datos.
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        {registradas.map((l) => {
          const edicion = borrador?.editadas?.[l.id];
          const cantidad = edicion?.quantity ?? l.cantidad;
          const moneda =
            (edicion?.currency as PriceCurrency | undefined) ?? l.moneda;
          const cambioCantidad = cantidad !== l.cantidad;
          const cambioMoneda = moneda !== l.moneda;
          return (
            <div
              key={l.id}
              className="flex flex-col gap-1 rounded-[10px] border p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 text-base font-semibold">
                  {l.nombre}
                </span>
                <span className="flex shrink-0 items-center gap-1 text-base font-semibold tabular-nums">
                  <CurrencyFlagIcon
                    currency={moneda}
                    className="size-4 shrink-0"
                  />
                  {formatPriceAmount(
                    Math.round(cantidad * l.precioUnitario * 100) / 100,
                    moneda,
                  )}
                </span>
              </div>
              <span className="text-sm text-muted-foreground tabular-nums">
                Se registra: {formatCantidad(cantidad)} ×{" "}
                {formatPriceAmount(l.precioUnitario, moneda)}
              </span>
              {/* SEE THE HEADER: this line is the owner's decision, and it
                  only appears where the two actually disagree. */}
              {cambioCantidad || cambioMoneda ? (
                <span className="text-sm text-amber-700 tabular-nums dark:text-amber-500">
                  El cliente pidió {formatCantidad(l.cantidad)}
                  {cambioMoneda ? ` en ${currencyName(l.moneda)}` : ""}.
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* EXCLUDED LINES, NAMED. The owner's decision of 2026-10-24 about a
          product that is no longer in the catalogue: «se excluye esa línea y
          se avisa». It is said HERE, before the button, and not in a toast
          afterwards — afterwards is too late to go and fix it. */}
      {excluidas.length > 0 ? (
        <div className="flex flex-col gap-0.5 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-500">
          <p className="font-semibold">
            {excluidas.length === 1
              ? "Este producto no entrará en la venta:"
              : "Estos productos no entrarán en la venta:"}
          </p>
          <p>{excluidas.map((l) => l.nombre).join(", ")}</p>
          <p>
            Ya no están en tu catálogo, así que no hay precio que cobrar hoy.
          </p>
        </div>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="pb-10">
        <Button
          className="h-10 w-full"
          onClick={registrar}
          disabled={enviando || !cliente}
        >
          {enviando ? "Registrando…" : "Registrar y finalizar"}
        </Button>
      </div>
    </div>
  );
}
