"use client";

import { useMemo, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { formatBs } from "@/lib/exchange-rate/format";
import {
  formatPriceAmount,
  priceIn,
  type BolivarRates,
  type PriceCurrency,
} from "@/lib/products/price";
import {
  cantidadMinima,
  escalonParaCantidad,
  monedasDelEscalon,
  type ProductoPublico,
} from "@/lib/products/public-pricing";

// EL DETALLE DE UN PRODUCTO, LO QUE VE EL CLIENTE FINAL. Frame 1192:4185,
// pantalla `1190:5833`.
//
// ===========================================================================
// UN SOLO BLOQUE DE PRECIO, Y LO ELIGE LA CANTIDAD
//
// El frame dibuja «Precio al detal» y «Precio al mayor» uno encima del otro,
// los dos a la vez. El dueño lo descartó el 2026-10-14 con su propio caso, y
// lo que hay aquí es su versión: la cantidad decide cuál de los dos se enseña,
// y las monedas que se ofrecen son las de ESE escalón. Nunca los dos.
//
// La regla vive en `lib/products/public-pricing.ts` y no aquí: es la única
// parte de esta pantalla que puede equivocarse sin que nadie se entere —un
// cliente que ve el precio equivocado cierra la página y ya está— así que es
// una función pura con su suite, `qa:precio-publico`.
//
// ===========================================================================
// «AGREGAR» TODAVÍA NO HACE NADA, Y SE DICE
//
// El carrito es el entregable C. Decisión del dueño: B termina en el detalle.
// El botón se pinta apagado con su motivo al lado en vez de esconderlo, porque
// un botón que falta no se distingue de uno que no cargó.

// UNA CANTIDAD NO ES UN PRECIO, y pasarla por el formateador de precios daba
// «Disponible: 40.00». Dos decimales fijos tienen sentido en dinero y ninguno
// en unidades: nadie tiene cuarenta coma cero cero aceites. Se permiten hasta
// tres por si el negocio vende a peso, que es para lo que la columna es
// `numeric(14,3)`, pero no se fuerzan.
const CANTIDAD = new Intl.NumberFormat("es-VE", { maximumFractionDigits: 3 });
const formatCantidad = (n: number) => CANTIDAD.format(n);

const ETIQUETA_MONEDA: Record<string, string> = {
  USD: "Paga en USD",
  EUR: "Paga en EURO",
  USDT: "Paga en USDT",
  COP: "Paga en pesos",
  VES: "Paga en bolívares",
};

export function ProductDetail({
  producto,
  baseCurrency,
  rates,
  stock,
}: {
  producto: ProductoPublico;
  baseCurrency: PriceCurrency;
  // null en un negocio colombiano: no hay equivalencias que enseñar.
  rates: BolivarRates | null;
  stock: number | null;
}) {
  const minimo = cantidadMinima(producto);
  const [cantidad, setCantidad] = useState(String(minimo));
  const [comentario, setComentario] = useState("");

  const n = Number(cantidad.replace(",", ".")) || 0;
  const escalon = escalonParaCantidad(producto, n);
  const bloque = escalon === "wholesale" ? producto.wholesale : producto.retail;
  const monedas = useMemo(
    () => monedasDelEscalon(bloque, baseCurrency),
    [bloque, baseCurrency],
  );

  // LA MONEDA ELEGIDA NO ES UN ESTADO INDEPENDIENTE, y eso evita un fallo que
  // sí lo sería: si el cliente elige euros con 3 unidades y luego sube a 6, el
  // escalón cambia y puede que el de mayor no tenga euros. Guardar su elección
  // a secas dejaría seleccionada una moneda que ya no está en la lista.
  //
  // Se guarda la PREFERENCIA y se resuelve contra lo que hay: si su moneda
  // sigue disponible, se respeta; si no, la primera del escalón nuevo.
  const [preferida, setPreferida] = useState<PriceCurrency | null>(null);
  const moneda = preferida != null && monedas.includes(preferida) ? preferida : monedas[0];


  const porDebajoDelMinimo = cantidad.trim() !== "" && n < minimo;

  function precioEn(c: PriceCurrency): { texto: string; bs: string | null } | null {
    if (bloque == null) return null;
    const base = { amount: bloque.price, currency: baseCurrency };
    const fila = priceIn(c, base, rates ?? { usd: 1, eur: 1, usdt: null }, bloque.pinned);
    if (fila.amount == null) return null;
    const texto = formatPriceAmount(fila.amount, c);
    if (rates == null || c === "VES") return { texto, bs: null };
    const enBs = priceIn("VES", { amount: fila.amount, currency: c }, rates);
    return { texto, bs: enBs.amount == null ? null : formatBs(enBs.amount) };
  }

  const total = (() => {
    // SIN TOTAL SI LA CANTIDAD NO VALE. Con el mínimo en 12 y un 3 escrito, la
    // pantalla decía «Agregar $12.00» debajo de un aviso en rojo que decía que
    // no se puede pedir 3 — dos mensajes contradictorios, y el que manda es el
    // que está en el botón. Importará más en el entregable C, cuando el botón
    // haga algo.
    if (porDebajoDelMinimo) return null;
    if (bloque == null || moneda == null) return null;
    const unidad = precioEn(moneda);
    if (unidad == null) return null;
    const fila = priceIn(moneda, { amount: bloque.price, currency: baseCurrency }, rates ?? { usd: 1, eur: 1, usdt: null }, bloque.pinned);
    if (fila.amount == null) return null;
    return formatPriceAmount(fila.amount * Math.max(n, 0), moneda);
  })();

  const paso = (delta: number) =>
    setCantidad((prev) => {
      const actual = Number(String(prev).replace(",", ".")) || 0;
      return String(Math.max(minimo, actual + delta));
    });

  return (
    <div className="flex flex-col gap-5">
      {/* EL DISPONIBLE. Sale del frame y el dueño lo confirmó sabiendo que
          publica su inventario a cualquiera con el enlace. Hoy es un número que
          nadie mueve (CT-59), así que no bloquea: se deja pedir de más. */}
      {stock != null ? (
        <p className="text-sm font-semibold">Disponible: {formatCantidad(stock)}</p>
      ) : null}

      {bloque == null ? (
        <p className="text-sm text-muted-foreground">
          Este producto no tiene precio publicado ahora mismo. Escríbele al negocio.
        </p>
      ) : (
        <div className="flex flex-col gap-2 rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">
            {escalon === "wholesale" ? "Precio al mayor" : "Precio al detal"}
          </p>

          {monedas.map((c) => {
            const p = precioEn(c);
            if (p == null) return null;
            const elegida = c === moneda;
            return (
              <label
                key={c}
                className="flex cursor-pointer items-center justify-between gap-3 py-1.5"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <input
                    type="radio"
                    name="moneda"
                    checked={elegida}
                    onChange={() => setPreferida(c)}
                    className="size-4 shrink-0 accent-foreground"
                  />
                  <CurrencyFlagIcon currency={c as "USD" | "EUR" | "USDT"} />
                  <span className="truncate text-sm">{ETIQUETA_MONEDA[c] ?? `Paga en ${c}`}</span>
                </span>
                <span className="shrink-0 text-right text-sm tabular-nums">
                  {p.texto}
                  {p.bs ? (
                    <span className="block text-xs text-muted-foreground">{p.bs}</span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="comentario">Comentarios</Label>
        <Textarea
          id="comentario"
          value={comentario}
          onChange={(e) => setComentario(e.target.value)}
          placeholder="Agrega comentarios al dueño"
          rows={3}
        />
      </div>

      {/* EL MÍNIMO DEL MAYOR, dicho antes de que estorbe. Solo aparece cuando
          el producto de verdad lo tiene y gobierna algo. */}
      {producto.wholesale != null && producto.wholesale_min_quantity != null ? (
        <p className="text-xs text-muted-foreground">
          Al mayor a partir de: {producto.wholesale_min_quantity}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-10 shrink-0"
            onClick={() => paso(-1)}
            aria-label="Quitar uno"
          >
            <Minus className="size-4" />
          </Button>
          <input
            inputMode="numeric"
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
            aria-label="Cantidad"
            aria-invalid={porDebajoDelMinimo}
            className={`h-10 w-16 rounded-md border bg-background text-center text-base tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              porDebajoDelMinimo ? "border-destructive" : ""
            }`}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-10 shrink-0"
            onClick={() => paso(1)}
            aria-label="Agregar uno"
          >
            <Plus className="size-4" />
          </Button>
        </div>

        <Button type="button" className="h-12 flex-1" disabled>
          <Plus className="size-4" /> Agregar {total ?? ""}
        </Button>
      </div>

      {/* EN ROJO Y SOLO CUANDO HAY UN NÚMERO POR DEBAJO. Lo pidió el dueño el
          2026-10-14 para el producto que solo se vende al mayor: ahí no hay
          otro precio al que caer, así que pedir menos no significa nada. */}
      {porDebajoDelMinimo ? (
        <p className="text-xs leading-relaxed text-destructive">
          Este producto se vende desde {minimo} unidades.
        </p>
      ) : null}

      <p className="text-xs leading-relaxed text-muted-foreground">
        Todavía no puedes enviar el pedido desde aquí: estamos terminándolo. Escríbele al
        negocio por WhatsApp y dile qué quieres.
      </p>
    </div>
  );
}
