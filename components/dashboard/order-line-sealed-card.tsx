import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { formatBs } from "@/lib/exchange-rate/format";
import { formatCantidad } from "@/lib/products/cantidad";
import {
  formatPriceAmount,
  priceIn,
  type BolivarRates,
  type PriceCurrency,
} from "@/lib/products/price";

// THE SEALED LINE OF A CATALOGUE ORDER — «Producto · Cantidad · Por pagar».
//
// Frames `1541:11232` (1/2 Confirma producto) and `1564:11028` (2/2 Abono)
// both open with this exact card, which is why it is a component and not two
// identical blocks: it carries three rules that each cost a decision, and a
// copy would only be found out the day one of them changes.
//
// ===========================================================================
// «POR PAGAR» IS THE LINE'S TOTAL, NOT THE UNIT PRICE
//
// The quantity is already its own column to the left, and the label asks what
// is owed for this line. A unit price under that heading would be the same
// figure as the order's card read two ways.
export function OrderLineSealedCard({
  nombre,
  cantidad,
  precioUnitario,
  moneda,
  // Today's catalogue price for this same quantity and tier, and its currency.
  // `null` whenever there is nothing to compare: the product was deleted, or
  // it has no price on this tier any more.
  totalHoy,
  monedaHoy,
  rates,
}: {
  nombre: string;
  cantidad: number;
  precioUnitario: number;
  moneda: PriceCurrency;
  totalHoy: number | null;
  monedaHoy: PriceCurrency | null;
  rates: BolivarRates | null;
}) {
  const porPagar = Math.round(cantidad * precioUnitario * 100) / 100;
  const enBs =
    rates && moneda !== "VES"
      ? (priceIn("VES", { amount: porPagar, currency: moneda }, rates)?.amount ?? null)
      : null;

  // ===========================================================================
  // TODAY'S PRICE, UNDERNEATH THE SEALED ONE — the owner's decision of
  // 2026-10-24: *«manda precio congelado + nuevo precio»*, and, asked where it
  // goes, *«correcto»* to putting it under the amount in small, like the
  // bolívar line.
  //
  // IT ONLY APPEARS WHEN IT DIFFERS. On every other line it would be the same
  // number twice — noise on each of them, which is how a warning stops being
  // read by the time it matters.
  //
  // A DIFFERENT CURRENCY COUNTS AS A DIFFERENCE. The owner can change a
  // product's base currency, and then «$57,00» and «57,00 €» are not the same
  // price even though the digits match.
  const cambioDePrecio =
    totalHoy != null &&
    monedaHoy != null &&
    (Math.abs(totalHoy - porPagar) >= 0.01 || monedaHoy !== moneda);

  return (
    <div className="flex flex-col justify-center rounded-[10px] border p-2.5">
      <div className="flex gap-1.5 text-xs leading-4">
        <p className="w-[124px] shrink-0">Producto</p>
        <p className="min-w-0 flex-1 text-right">Cantidad</p>
        <p className="w-[104px] shrink-0 text-right">Por pagar</p>
      </div>
      <div className="flex justify-center gap-1 pt-2">
        <p className="w-[124px] shrink-0 text-xs leading-4 text-muted-foreground">{nombre}</p>
        <p className="min-w-0 flex-1 text-right text-xs leading-4 text-muted-foreground tabular-nums">
          {formatCantidad(cantidad)}
        </p>
        <div className="flex w-[104px] shrink-0 flex-col items-end justify-center">
          {/* THE FLAG ON THE SIDE OF THE EDGE: this column is `items-end`, so
              it sits to the right of the figure, as the frame draws it. See
              `DESIGN-SYSTEM.md`, the owner's rule of 2026-10-24. */}
          <span className="flex items-center gap-1 text-sm tabular-nums">
            {formatPriceAmount(porPagar, moneda)}
            <CurrencyFlagIcon currency={moneda} className="size-4 shrink-0" />
          </span>
          {/* «HOY», WHICH THE FRAME DOES NOT WRITE. The owner's decision of
              2026-10-17, on the order's own detail: the amount is sealed and
              its value in bolívares is not, because the rate moves daily.
              Without the word, this figure reads as what was agreed, and the
              shopkeeper charges today's rate for last week's deal. */}
          {enBs != null ? (
            <span className="text-xs leading-4 text-muted-foreground tabular-nums">
              {formatBs(enBs)} hoy
            </span>
          ) : null}
          {/* It says «Hoy» and not «subió» on purpose — it can have gone down,
              and which of the two to charge is the shopkeeper's call, not the
              screen's. */}
          {cambioDePrecio ? (
            <span className="text-xs leading-4 text-amber-700 tabular-nums dark:text-amber-500">
              Hoy: {formatPriceAmount(totalHoy!, monedaHoy!)}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// TODAY'S PRICE FOR A SEALED LINE, at the SAME tier the customer bought at.
//
// The tier is not re-decided here: pricing today's figure at the other tier
// would invent a difference the catalogue never had.
export function totalDeHoy(
  producto: {
    price_retail: number | null;
    price_wholesale: number | null;
    base_currency_retail: string | null;
    base_currency_wholesale: string | null;
  } | null,
  tier: string,
  cantidad: number,
): { total: number | null; moneda: PriceCurrency | null } {
  if (producto == null) return { total: null, moneda: null };
  const alMayor = tier === "wholesale";
  const unidad = alMayor ? producto.price_wholesale : producto.price_retail;
  const moneda = (alMayor ? producto.base_currency_wholesale : producto.base_currency_retail) as
    | PriceCurrency
    | null;
  if (unidad == null || moneda == null) return { total: null, moneda: null };
  return { total: Math.round(cantidad * Number(unidad) * 100) / 100, moneda };
}
