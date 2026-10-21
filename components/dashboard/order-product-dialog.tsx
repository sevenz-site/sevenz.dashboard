"use client";

import { forwardRef } from "react";
import Image from "next/image";
import { ChevronRight, ImageOff } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { getPublicProductPhotoUrl } from "@/lib/supabase/storage";
import {
  allPrices,
  currencyName,
  formatPercent,
  formatPriceAmount,
  type BolivarRates,
  type PriceCurrency,
  type PriceTier,
} from "@/lib/products/price";
import type { OrderProductRow } from "@/lib/orders/catalog-orders";
import { EmptyState } from "@/components/dashboard/empty-state";

// WHAT THEY ASKED FOR, IN DETAIL — frame 1371:7229, the owner's request of
// 2026-10-17. A line of an order opens and shows the product.
//
// ===========================================================================
// THE TWO HALVES OF THIS DIALOG ANSWER TWO DIFFERENT QUESTIONS, and keeping
// them apart is the whole design:
//
//   · THE «Pedido» CARD IS SEALED. How many, at what price, at which tier --
//     what the customer actually agreed to, stored in `catalog_order_items`
//     at the moment of ordering and never recomputed. Its bolívar line is the
//     exception and says so in the word "hoy": the figure is sealed, what it
//     is worth in bolívares today is not.
//
//   · EVERYTHING BELOW IS TODAY'S CATALOGUE. Stock, cost, supplier, margins
//     and prices are the shopkeeper's own numbers, and he is reading them to
//     decide whether to fulfil this order. A stock of "12" from last Tuesday
//     helps nobody; a frozen cost or margin would be actively misleading.
//
// The owner chose this on 2026-10-17 after the frame contradicted an earlier
// decision of his own to seal the descriptive fields too. Both are on the
// record: the earlier one was mine to propose, and his frame is more specific
// and more recent. WHAT IT COSTS is that changing a product's photo or
// description changes what an old order's dialog shows -- which is why the
// catalogue block carries its own heading rather than blending into the card.
//
// ===========================================================================
// A DELETED PRODUCT IS A REAL STATE, not an error. `catalog_order_items`
// keeps the name and the price, so the row in the list still reads and the
// sealed card still works. Only the catalogue half is missing, and the dialog
// says that in a sentence instead of opening half empty with blank rows.

function Fila({
  nombre,
  children,
  bandera,
}: {
  nombre: string;
  children: React.ReactNode;
  bandera?: PriceCurrency;
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-2">
      <span className="min-w-0 flex-1 text-xs break-words text-muted-foreground">{nombre}</span>
      <span className="flex shrink-0 items-center gap-1 text-sm tabular-nums">
        {children}
        {bandera ? <CurrencyFlagIcon currency={bandera} /> : null}
      </span>
    </div>
  );
}

// Los precios de un escalón en todas las monedas que el negocio maneja.
//
// SALE DE `allPrices`, la MISMA función que pinta el catálogo y la que valida
// la orden pública. Rehacer aquí la conversión sería una tercera opinión
// sobre el mismo número, y esta pantalla existe para comprobar un precio, no
// para discutirlo.
function BloqueDePrecios({
  titulo,
  margenLabel,
  margen,
  base,
  rates,
}: {
  titulo: string;
  margenLabel: string;
  margen: number | null;
  base: { amount: number; currency: PriceCurrency } | null;
  rates: BolivarRates | null;
}) {
  // Sin precio en ese escalón no hay bloque: una lista de huecos no dice
  // "todavía no lo has puesto", dice "algo se rompió".
  if (base == null) return null;

  const precios = rates ? allPrices(base, rates) : [{ ...base, origin: "base" as const }];

  return (
    <div className="flex flex-col gap-1 py-2">
      <span className="text-sm">{titulo}</span>
      <div className="flex flex-col">
        {margen != null ? <Fila nombre={margenLabel}>{formatPercent(margen)}</Fila> : null}
        {precios.map((p) =>
          // Bolívares no: es el equivalente de todo lo demás, y repetirlo en
          // cada escalón convierte la lista en aritmética.
          p.currency === "VES" ? null : (
            <Fila
              key={p.currency}
              // «Precio EN dólares», y el frame dice «Precio Dólar». Es la
              // misma etiqueta en español correcto: `currencyName` devuelve
              // el plural en minúscula porque está escrito para ir dentro de
              // una frase, y «Precio dólares» no es ninguna de las dos cosas.
              nombre={`Precio en ${currencyName(p.currency)}`}
              bandera={p.currency}
            >
              {p.amount == null ? "—" : formatPriceAmount(p.amount, p.currency)}
            </Fila>
          ),
        )}
      </div>
    </div>
  );
}

export function OrderProductDialog({
  nombreEnElPedido,
  cantidad,
  precioUnitario,
  moneda,
  escalon,
  comentario,
  producto,
  rates,
  children,
}: {
  // Lo SELLADO. Llega de `catalog_order_items` y no se recalcula.
  nombreEnElPedido: string;
  cantidad: number;
  precioUnitario: number;
  moneda: PriceCurrency;
  escalon: PriceTier;
  comentario: string | null;
  // El catálogo de HOY. null = el producto ya no está.
  producto: OrderProductRow | null;
  rates: BolivarRates | null;
  children: React.ReactNode;
}) {
  const totalLinea = Math.round(cantidad * precioUnitario * 100) / 100;

  // EL EQUIVALENTE EN BOLÍVARES ES EL DE HOY, y la palabra «hoy» no es
  // decorado: el monto está sellado y su valor en bolívares no, porque la
  // tasa se mueve todos los días. Decisión del dueño el 2026-10-17, y el
  // frame lo escribe con esa misma palabra.
  const bsPorUnidad =
    rates == null
      ? null
      : moneda === "USD"
        ? rates.usd
        : moneda === "EUR"
          ? rates.eur
          : moneda === "USDT"
            ? rates.usdt
            : null;
  const enBolivares = bsPorUnidad == null ? null : totalLinea * bsPorUnidad;

  const fotoUrl = producto?.photo_path ? getPublicProductPhotoUrl(producto.photo_path) : null;

  const baseDetal =
    producto?.price_retail != null && producto.base_currency_retail
      ? { amount: Number(producto.price_retail), currency: producto.base_currency_retail as PriceCurrency }
      : null;
  const baseMayor =
    producto?.price_wholesale != null && producto.base_currency_wholesale
      ? { amount: Number(producto.price_wholesale), currency: producto.base_currency_wholesale as PriceCurrency }
      : null;

  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Detalle del producto</DialogTitle>
        </DialogHeader>

        {/* EL NOMBRE ES EL DEL PEDIDO, no el del catálogo. Si el tendero
            renombró el producto después, lo que el cliente pidió se llamaba
            así -- y ésa es la fila que tiene que poder reconocer. */}
        <h2 className="text-2xl leading-8">{nombreEnElPedido}</h2>

        {fotoUrl ? (
          <Image
            src={fotoUrl}
            alt={nombreEnElPedido}
            width={656}
            height={400}
            unoptimized
            className="h-50 w-full rounded-[10px] border object-cover"
          />
        ) : (
          // El hueco dibujado en vez de nada, igual que en la ficha de un
          // movimiento sin foto: dice que aquí cabe una foto y este producto
          // no la tiene.
          <div className="flex h-50 w-full flex-col items-center justify-center gap-1.5 rounded-[10px] border border-dashed bg-muted/40 text-muted-foreground">
            <ImageOff className="size-5" aria-hidden />
            <span className="text-xs">Sin foto</span>
          </div>
        )}

        {/* LO SELLADO, en su propia tarjeta y separado de todo lo demás. */}
        <div className="flex items-center gap-1.5 rounded-[10px] border px-4 py-2">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">Pedido</span>
            <span className="text-xl leading-7 text-money-in tabular-nums">
              {cantidad} × {formatPriceAmount(precioUnitario, moneda)}
            </span>
            <span className="text-xs font-medium text-muted-foreground">
              {escalon === "wholesale" ? "al mayor" : "al detal"}
            </span>
          </div>
          <div className="flex min-w-0 flex-1 flex-col items-end justify-center gap-0.5">
            <span className="flex items-center gap-1 text-sm tabular-nums">
              <CurrencyFlagIcon currency={moneda} />
              {formatPriceAmount(totalLinea, moneda)}
            </span>
            {enBolivares != null ? (
              <span className="w-full text-right text-xs text-muted-foreground tabular-nums">
                {formatPriceAmount(enBolivares, "VES")} hoy
              </span>
            ) : null}
          </div>
        </div>

        {/* EL COMENTARIO DEL CLIENTE, cuando lo escribió. No está en el frame
            porque el mock no tiene ninguno, pero la lista ya lo enseña y
            quitarlo del detalle lo escondería justo donde se mira de cerca.
            `whitespace-pre-line` por la misma razón que en la lista: sus
            saltos de línea son parte de lo que pidió. */}
        {comentario ? (
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">Comentario</span>
            <p className="text-sm leading-snug break-words whitespace-pre-line">{comentario}</p>
          </div>
        ) : null}

        {producto == null ? (
          <EmptyState
            title="Este producto ya no está en tu catálogo"
            subtitle="El pedido conserva lo que se acordó."
          />
        ) : (
          <>
            <div className="flex flex-col">
              <Fila nombre="Disponible en inventario">
                {producto.stock_opening == null ? "—" : producto.stock_opening}
              </Fila>
              <Fila
                nombre="Costo"
                bandera={
                  producto.cost != null && producto.cost_currency && producto.cost_currency !== "OTHER"
                    ? (producto.cost_currency as PriceCurrency)
                    : undefined
                }
              >
                {producto.cost == null
                  ? "—"
                  : producto.cost_currency === "OTHER"
                    ? // La moneda «Otro» se escribe a mano y no tiene bandera
                      // ni formato: se enseña tal cual la tecleó el tendero.
                      `${producto.cost} ${producto.cost_currency_other ?? ""}`.trim()
                    : formatPriceAmount(Number(producto.cost), producto.cost_currency as PriceCurrency)}
              </Fila>
              <Fila nombre="Proveedor">{producto.supplier?.trim() || "No registrado"}</Fila>
              {producto.unit?.trim() ? <Fila nombre="Unidad">{producto.unit}</Fila> : null}
              {producto.description?.trim() ? (
                <div className="flex flex-col gap-1 py-2">
                  <span className="text-xs text-muted-foreground">Descripción</span>
                  <p className="text-sm leading-5 break-words whitespace-pre-line">
                    {producto.description}
                  </p>
                </div>
              ) : null}
            </div>

            <BloqueDePrecios
              titulo="Venta al detal"
              margenLabel="Margen al detal"
              margen={producto.margin_retail_pct == null ? null : Number(producto.margin_retail_pct)}
              base={baseDetal}
              rates={rates}
            />
            {/* «Margen al mayor», y el frame dice «Margen al detal» en los dos
                bloques. Corregido a petición del dueño el 2026-10-17: repetir
                la etiqueta haría que los dos márgenes se leyeran como el
                mismo número puesto dos veces. */}
            <BloqueDePrecios
              titulo="Venta al mayor"
              margenLabel="Margen al mayor"
              margen={
                producto.margin_wholesale_pct == null ? null : Number(producto.margin_wholesale_pct)
              }
              base={baseMayor}
              rates={rates}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// LA FILA DE LA LISTA, que es lo que abre el diálogo. Vive aquí y no en la
// página porque las dos piezas son una sola cosa: una fila que no abre nada
// no necesitaría ni la miniatura ni el chevron.
//
// REENVÍA LA REF Y ESPARCE LAS PROPS, y las dos cosas son obligatorias aquí.
// `DialogTrigger asChild` no envuelve a su hijo: lo CLONA y le cuelga sus
// manejadores y su ref. Un componente que no los acepta se renderiza
// perfectamente y no abre nada -- que es exactamente lo que pasó la primera
// vez que se probó esta fila: ni error en consola, ni aviso, solo un botón
// que no hacía nada al tocarlo.
export const OrderProductRowButton = forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<"button"> & {
    nombre: string;
    cantidad: number;
    precioUnitario: number;
    moneda: PriceCurrency;
    escalon: PriceTier;
    fotoPath: string | null;
  }
>(function OrderProductRowButton(
  { nombre, cantidad, precioUnitario, moneda, escalon, fotoPath, ...props },
  ref,
) {
  const total = Math.round(cantidad * precioUnitario * 100) / 100;
  const fotoUrl = fotoPath ? getPublicProductPhotoUrl(fotoPath) : null;

  return (
    <button
      {...props}
      ref={ref}
      type="button"
      className="flex w-full items-center justify-between gap-2 rounded-[10px] border p-2 text-left hover:bg-muted/40"
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">
        {fotoUrl ? (
          <Image
            src={fotoUrl}
            alt=""
            width={80}
            height={80}
            unoptimized
            className="size-10 shrink-0 rounded border object-cover"
          />
        ) : (
          <span className="flex size-10 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground">
            <ImageOff className="size-4" aria-hidden />
          </span>
        )}
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-base font-semibold">{nombre}</span>
          <span className="truncate text-xs text-muted-foreground">
            {cantidad} × {formatPriceAmount(precioUnitario, moneda)} ·{" "}
            {escalon === "wholesale" ? "al mayor" : "al detal"}
          </span>
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <span className="flex items-center gap-1 text-sm tabular-nums">
          <CurrencyFlagIcon currency={moneda} />
          {formatPriceAmount(total, moneda)}
        </span>
        <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
      </span>
    </button>
  );
});
