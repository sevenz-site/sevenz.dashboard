"use client";

import { useMemo, useState } from "react";
import { CircleCheck, Minus, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useCarrito } from "@/lib/cart/store";
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
import { formatCantidad } from "@/lib/products/cantidad";
import {
  cantidadMinima,
  escalonParaCantidad,
  monedasDelBloque,
  precioEnMoneda,
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
// So: **both prices are always shown**, so the customer sees what they save by
// ordering more; and **there is a single currency selector**.
//
//   3. 2026-10-15, later — «este producto tiene varias monedas seteadas en su
//   configuración, pero en el catálogo al cliente solo le aparece Dólar».
//
// WHAT THIS COMMENT SAID BEFORE WAS FALSE, and it is written down because it
// is the reason the previous decision came out the way it did. It claimed that
// offering every currency and converting «le enseñaría al cliente un importe
// en euros que el tendero nunca escribió», and the owner chose to offer only
// the hand-pinned ones on the strength of that sentence.
//
// It is untrue: the shopkeeper's own form -- `catalog-product-dialog.tsx`,
// where it paints every enabled currency -- already shows them exactly that
// conversion, computed with `priceIn` and marked with a chain icon. The euro
// amount is not a number behind anyone's back; it is the same number, under
// the same rule, that the shopkeeper sees and accepts when they enable the
// currency.
//
// So the selector offers **the currencies the shopkeeper enabled** on the
// product, and the tier only decides the amount. The rule lives in
// `lib/products/public-pricing.ts` and not here: it is the one part of this
// screen that can be wrong without anybody finding out -- a customer who sees
// the wrong price closes the page and that is that -- so it is a pure function
// with its own suite, `qa:precio-publico`.
//
// ===========================================================================
// «AGREGAR» YA GUARDA EN EL CARRITO (entregable C, 2026-10-15)
//
// Estuvo apagado desde el entregable B, con su motivo al lado: un botón que
// falta no se distingue de uno que no cargó.
//
// Lo que guarda es `{ producto, cantidad, moneda, comentario }` y NO el
// precio. La razón está en la cabecera de `lib/cart/cart.ts` y vale la pena no
// redescubrirla: el escalón depende de la cantidad TOTAL, así que añadir 3 y
// luego 3 más son 6 — y a 6 el precio cambia. Un precio congelado aquí sería
// el de detal para una cantidad que ya es de mayor.

const ETIQUETA_MONEDA: Record<string, string> = {
  USD: "Paga en USD",
  EUR: "Paga en EURO",
  USDT: "Paga en USDT",
  COP: "Paga en pesos",
  VES: "Paga en bolívares",
};

export function ProductDetail({
  token,
  productId,
  producto,
  rates,
  stock,
}: {
  token: string;
  productId: string;
  producto: ProductoPublico;
  // NO `baseCurrency` NOR `currencies` AS PROPS SINCE MIGRATION 114. Both
  // belong to the TIER now and travel inside each `BloquePrecio`, so this
  // screen cannot hold one base while showing two tiers' prices -- which is
  // the mistake that would quote a wholesale price in the retail currency and
  // look entirely plausible doing it.
  //
  // null en un negocio colombiano: no hay equivalencias que enseñar.
  rates: BolivarRates | null;
  stock: number | null;
}) {
  const { agregar } = useCarrito(token);
  const router = useRouter();
  const minimo = cantidadMinima(producto);
  const [cantidad, setCantidad] = useState(String(minimo));
  const [comentario, setComentario] = useState("");

  const n = Number(cantidad.replace(",", ".")) || 0;
  const escalon = escalonParaCantidad(producto, n);
  const bloque = escalon === "wholesale" ? producto.wholesale : producto.retail;
  const monedas = useMemo(() => monedasDelBloque(bloque, rates), [bloque, rates]);

  // LA MONEDA ELEGIDA NO ES UN ESTADO INDEPENDIENTE, y eso evita un fallo que
  // sí lo sería: si el cliente elige euros con 3 unidades y luego sube a 6, el
  // escalón cambia y puede que el de mayor no tenga euros. Guardar su elección
  // a secas dejaría seleccionada una moneda que ya no está en la lista.
  //
  // AND IT MATTERS MORE SINCE MIGRATION 114, not less. The two tiers now have
  // genuinely different currency lists -- that is the whole point of it -- so
  // crossing the wholesale threshold can drop the currency the customer had
  // chosen. Before 114 the lists only differed by which prices happened to
  // resolve; now they differ because the shopkeeper said so.
  //
  // Se guarda la PREFERENCIA y se resuelve contra lo que hay: si su moneda
  // sigue disponible, se respeta; si no, la primera del escalón nuevo.
  const [preferida, setPreferida] = useState<PriceCurrency | null>(null);
  const moneda = preferida != null && monedas.includes(preferida) ? preferida : monedas[0];


  const porDebajoDelMinimo = cantidad.trim() !== "" && n < minimo;

  // `exacto` TELLS A TYPED PRICE FROM A COMPUTED ONE, which is why it
  // travels. Since 2026-10-15 the chosen currency can be a computed one too
  // -- the selector now offers the enabled ones, not just the pinned ones --
  // so this marker went from being a detail of the other tier to being the
  // normal case. Showing both numbers alike would pass off as the
  // shopkeeper's a price that is not.
  //
  // NO 1:1 RATE FALLBACK. It used to pass `rates ?? { usd: 1, eur: 1, usdt:
  // null }`, which was harmless only because no computed currency was ever
  // offered: the base and the pinned ones do not read the rate. With
  // conversion as the main path, that fallback would have offered euros at
  // parity with the dollar -- EUR 45.50 for a USD 45.50 product -- to any
  // Venezuelan business missing its BCV rate, and it would have looked like a
  // real price. `precioEnMoneda` returns null in that case, and a currency
  // with no number is not offered.
  function precioEn(
    b: BloquePrecio | null,
    c: PriceCurrency,
  ): { texto: string; bs: string | null; exacto: boolean } | null {
    // `b.base` AND NOT A SHARED ONE (114). Each tier is priced in its own
    // currency, so asking this with the other tier's base is the silent
    // mispricing the block shape exists to prevent.
    const amount = precioEnMoneda(b, c, rates);
    if (amount == null || b == null) return null;
    const exacto = c === b.base || b.pinned[c] != null;
    const texto = formatPriceAmount(amount, c);
    if (rates == null || c === "VES") return { texto, bs: null, exacto };
    const enBs = priceIn("VES", { amount, currency: c }, rates);
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
    // ONE PLACE COMPUTES THE UNIT PRICE. This used to ask `priceIn` again
    // with its own rate fallback, so the button could state an amount the
    // price block above was not showing.
    const unidad = precioEnMoneda(bloque, moneda, rates);
    if (unidad == null) return null;
    return formatPriceAmount(unidad * Math.max(n, 0), moneda);
  })();

  const paso = (delta: number) =>
    setCantidad((prev) => {
      const actual = Number(String(prev).replace(",", ".")) || 0;
      return String(Math.max(minimo, actual + delta));
    });

  return (
    <div className="flex flex-col gap-5">
      {/* EL DISPONIBLE, SIN CIFRA, igual que la etiqueta del catálogo.
          Decisión del dueño el 2026-10-15: dice si hay o no hay, nunca cuánto.
          El porqué está en `app/c/[token]/page.tsx`, donde vive la etiqueta.

          Y DE PASO ARREGLA UN DESCUADRE que la cifra escondía: esto se pintaba
          con `stock != null`, así que un producto con CERO existencias decía
          «Disponible: 0» aquí mientras su tarjeta del catálogo decía «No
          disponible». Dos pantallas del mismo producto, una diciendo que hay y
          la otra que no, a un cliente que está decidiendo si pedirlo.

          Sigue sin bloquear: el número no lo mantiene nadie (`CT-59`), así que
          se deja pedir de más y solo se avisa. */}
      {stock != null ? (
        <p className="text-sm font-semibold">
          {stock === 0 ? "No disponible" : "Disponible"}
        </p>
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
                    className={`flex min-w-0 items-baseline gap-1.5 truncate text-sm ${
                      aplica ? "font-semibold" : "text-muted-foreground"
                    }`}
                  >
                    {/* EL CHECK VERDE MARCA EL PRECIO QUE SE ESTÁ APLICANDO.
                        Del frame, a petición del dueño el 2026-10-15.

                        NO ES SOLO ADORNO: hasta ahora la única diferencia
                        entre las dos líneas era la negrita y el gris, y eso
                        es una señal débil — en una pantalla al sol, o para
                        quien no distingue bien los contrastes, las dos líneas
                        se parecen demasiado para decidir cuánto va a pagar.

                        `aria-hidden` en el icono y la frase en un `sr-only`
                        al lado: un lector de pantalla no anuncia un SVG, así
                        que sin esa frase la información de cuál aplica
                        existiría solo en píxeles.

                        El verde no sale de un token semántico de tema, por lo
                        mismo que las etiquetas de inventario: esta página la
                        ve un cliente que no eligió el tema de nadie, y el
                        verde tiene que significar lo mismo en claro y en
                        oscuro. */}
                    {aplica ? (
                      <>
                        <CircleCheck
                          className="size-4 shrink-0 translate-y-0.5 text-emerald-600"
                          aria-hidden="true"
                        />
                        <span className="sr-only">Precio que se te aplica: </span>
                      </>
                    ) : null}
                    <span className="truncate">
                      {t === "wholesale" ? "Precio al mayor" : "Precio al detal"}
                      {t === "wholesale" && producto.wholesale_min_quantity != null ? (
                        <span className="text-xs font-normal text-muted-foreground">
                          {" "}
                          desde {producto.wholesale_min_quantity}
                        </span>
                      ) : null}
                    </span>
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
              elegir dos veces y solo se paga una.

              CON UNA SOLA MONEDA NO SE DIBUJA EL BOTÓN. Decisión del dueño el
              2026-10-15: si no hay nada que elegir, un radio marcado le pide
              al cliente que confirme algo que ya está decidido, y un control
              que no hace nada enseña que los controles de esta pantalla no
              hacen nada.

              LA FILA SÍ SE QUEDA, con su bandera y su importe. Es la que dice
              en qué moneda se paga, y esa información hace falta aunque no
              haya elección — sobre todo en un negocio venezolano, donde el
              cliente no puede dar por hecho cuál es.

              Y SIN `<label>` CUANDO NO HAY `<input>`: una etiqueta sin control
              al que apuntar es HTML roto, y un lector de pantalla la anuncia
              como si hubiera algo que activar. */}
          <div className="flex flex-col gap-0.5 border-t pt-2">
            {monedas.map((c) => {
              const p = precioEn(bloque, c);
              if (p == null) return null;
              const elegida = c === moneda;
              const hayQueElegir = monedas.length > 1;
              const Fila = hayQueElegir ? "label" : "div";
              return (
                <Fila
                  key={c}
                  className={`flex items-center justify-between gap-3 py-1.5 ${
                    hayQueElegir ? "cursor-pointer" : ""
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {hayQueElegir ? (
                      <input
                        type="radio"
                        name="moneda"
                        checked={elegida}
                        onChange={() => setPreferida(c)}
                        className="size-4 shrink-0 accent-foreground"
                      />
                    ) : null}
                    <CurrencyFlagIcon currency={c} />
                    <span className="truncate text-sm">{ETIQUETA_MONEDA[c] ?? `Paga en ${c}`}</span>
                  </span>
                  <span className="shrink-0 text-right text-sm tabular-nums">
                    {p.texto}
                    {p.bs ? (
                      <span className="block text-xs text-muted-foreground">{p.bs}</span>
                    ) : null}
                  </span>
                </Fila>
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

        <Button
          type="button"
          className="h-12 flex-1"
          /* NO SE PUEDE AÑADIR UNA CANTIDAD QUE NO VALE. Es el mismo criterio
             que el total: con un 3 escrito bajo un mínimo de 12, el botón no
             puede ofrecer meterlo en el carrito mientras un aviso en rojo dice
             que no se puede pedir. `total` ya es null en ese caso. */
          disabled={bloque == null || moneda == null || total == null}
          onClick={() => {
            if (bloque == null || moneda == null || total == null) return;
            agregar({
              productId,
              quantity: n,
              currency: moneda,
              comment: comentario.trim() === "" ? null : comentario.trim(),
            });
            toast.success("Agregado a tu carrito", {
              description: `${formatCantidad(n)} · ${total}`,
              // ARRIBA, Y SOLO ESTE AVISO. Abajo se solapaba con la píldora
              // «Ver carrito», que es fija y aparece justo al añadir — el
              // aviso tapaba el botón que acababa de ganarse su sitio.
              //
              // Se pone por aviso y no en el `Toaster` del layout raíz: ese
              // es el mismo para toda la app, y moverlo cambiaría de sitio
              // todos los avisos del tendero para arreglar uno del cliente.
              position: "top-center",
            });
            // SE VUELVE AL CATÁLOGO, a petición del dueño el 2026-10-15.
            //
            // Quien acaba de añadir algo no quiere seguir mirando lo que ya
            // añadió: quiere seguir comprando. Quedándose aquí, el único
            // camino de vuelta era la flecha de arriba, y la pantalla seguía
            // ofreciendo «Agregar» sobre un producto que ya está dentro — que
            // es como se añade lo mismo dos veces sin querer.
            //
            // EL CARRITO NO SE PIERDE Y NO HAY QUE HACER NADA PARA ELLO: vive
            // en `localStorage`, no en el estado de esta pantalla. Esa es
            // justamente la propiedad que hace que esto sea un `push` y no
            // haya que pasar nada por la URL.
            //
            // El aviso sobrevive al salto porque el `Toaster` está en el
            // layout raíz, así que el cliente lee «Agregado a tu carrito» ya
            // en el catálogo — que es donde le sirve de confirmación.
            router.push(`/c/${token}`);
          }}
        >
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

    </div>
  );
}
