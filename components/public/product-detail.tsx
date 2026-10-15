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
  type BloquePrecio,
  type ProductoPublico,
} from "@/lib/products/public-pricing";

// EL DETALLE DE UN PRODUCTO, LO QUE VE EL CLIENTE FINAL. Frame 1192:4185,
// pantalla `1190:5833`.
//
// ===========================================================================
// LOS DOS PRECIOS SE VEN; UNA SOLA MONEDA SE ELIGE
//
// Dos correcciones del dueño sobre el frame, en dos días, y la segunda matiza
// a la primera. Las dos quedan escritas porque juntas son la regla:
//
//   2026-10-14 — «el frame muestra precio al mayor y al detal a verse en
//   conjunto pero está mal, se ve uno o el otro». Se construyó así.
//
//   2026-10-15 — «ve los dos precios a la vez pero puede seleccionar solo una
//   moneda de pago, no las dos, es un error del frame». O sea: el error del
//   frame no eran los dos bloques, era que cada uno traía su propia lista de
//   monedas y se podían elegir dos cosas a la vez.
//
// Así que: **los dos precios se enseñan siempre**, para que el cliente vea lo
// que se ahorra pidiendo más; y **hay un solo selector de moneda**, con las
// monedas del escalón que la cantidad hace aplicable. Con 3 unidades del caso
// del dueño solo se ofrece dólar, porque es lo único que tiene el precio al
// detal — confirmado por él el 2026-10-15 frente a la alternativa de ofrecer
// las tres y convertir, que le enseñaría al cliente un importe en euros que
// el tendero nunca escribió.
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

  // `exacto` DISTINGUE UN PRECIO ESCRITO DE UNO CALCULADO, y por eso viaja.
  // La moneda elegida siempre es exacta en el escalón que aplica —el selector
  // solo ofrece la base y las fijadas a mano—, pero el OTRO escalón puede no
  // tenerla, y entonces su línea sale de la tasa del día. Enseñar los dos
  // números igual haría pasar por precio del tendero uno que no lo es.
  function precioEn(
    b: BloquePrecio | null,
    c: PriceCurrency,
  ): { texto: string; bs: string | null; exacto: boolean } | null {
    if (b == null) return null;
    const base = { amount: b.price, currency: baseCurrency };
    const fila = priceIn(c, base, rates ?? { usd: 1, eur: 1, usdt: null }, b.pinned);
    if (fila.amount == null) return null;
    const exacto = c === baseCurrency || b.pinned[c] != null;
    const texto = formatPriceAmount(fila.amount, c);
    if (rates == null || c === "VES") return { texto, bs: null, exacto };
    const enBs = priceIn("VES", { amount: fila.amount, currency: c }, rates);
    return { texto, bs: enBs.amount == null ? null : formatBs(enBs.amount), exacto };
  }

  const total = (() => {
    // SIN TOTAL SI LA CANTIDAD NO VALE. Con el mínimo en 12 y un 3 escrito, la
    // pantalla decía «Agregar $12.00» debajo de un aviso en rojo que decía que
    // no se puede pedir 3 — dos mensajes contradictorios, y el que manda es el
    // que está en el botón. Importará más en el entregable C, cuando el botón
    // haga algo.
    if (porDebajoDelMinimo) return null;
    if (bloque == null || moneda == null) return null;
    const unidad = precioEn(bloque, moneda);
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
        <div className="flex flex-col gap-3 rounded-lg border p-3">
          {/* LOS DOS ESCALONES, SIEMPRE QUE EXISTAN. Lo pidió el dueño el
              2026-10-15: que el cliente vea lo que se ahorra pidiendo más, sin
              tener que descubrirlo subiendo la cantidad a ciegas. El que
              aplica ahora va en negrita; el otro, apagado. */}
          <div className="flex flex-col gap-1.5">
            {(["retail", "wholesale"] as const).map((t) => {
              const b = t === "retail" ? producto.retail : producto.wholesale;
              if (b == null) return null;
              const p = moneda == null ? null : precioEn(b, moneda);
              if (p == null) return null;
              const aplica = t === escalon;
              return (
                <div key={t} className="flex items-baseline justify-between gap-3">
                  <span
                    className={`truncate text-sm ${aplica ? "font-semibold" : "text-muted-foreground"}`}
                  >
                    {t === "wholesale" ? "Precio al mayor" : "Precio al detal"}
                    {t === "wholesale" && producto.wholesale_min_quantity != null ? (
                      <span className="text-xs font-normal text-muted-foreground">
                        {" "}
                        desde {producto.wholesale_min_quantity}
                      </span>
                    ) : null}
                  </span>
                  <span
                    className={`shrink-0 text-right text-sm tabular-nums ${aplica ? "font-semibold" : "text-muted-foreground"}`}
                  >
                    {/* «aprox.» SOLO EN EL ESCALON QUE NO APLICA, y solo si su
                        precio en esta moneda salió de la tasa y no de lo que
                        el tendero escribió. Sin esa palabra, un número
                        calculado se lee como un precio prometido. */}
                    {p.exacto ? null : <span className="text-xs">aprox. </span>}
                    {p.texto}
                    {p.bs ? (
                      <span className="block text-xs font-normal text-muted-foreground">
                        {p.bs}
                      </span>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>

          {/* UN SOLO SELECTOR, con las monedas del escalón que aplica. El
              error del frame era tener uno por bloque: dos listas invitan a
              elegir dos veces y solo se paga una. */}
          <div className="flex flex-col gap-0.5 border-t pt-2">
            {monedas.map((c) => {
              const p = precioEn(bloque, c);
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
