"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ImageOff, Plus } from "lucide-react";
import { toast } from "sonner";
import { track } from "@/lib/mixpanel";
import { useSearchEvent } from "@/lib/analytics/use-search-event";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/dashboard/client-search-sheet";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { CartPillButton } from "@/components/cart-pill-button";
import { ProductSheet } from "@/components/dashboard/product-sheet";
import { ProductThumbnail } from "@/components/product-thumbnail";
import { CategoryChips, type CategoriaConProductos } from "@/components/category-chips";
import { NumberedPagination } from "@/components/numbered-pagination";
import { EmptyState } from "@/components/dashboard/empty-state";
import { pageCount } from "@/lib/products/pagination";
import {
  buscarProductosParaVenta,
  productoParaVentaPorId,
  type ProductoParaVenta,
  type ProductosParaVenta,
} from "@/app/(app)/ventas/actions";
import {
  cantidadMinima,
  escalonParaCantidad,
  monedasDelBloque,
  precioEnMoneda,
  type ProductoPublico,
} from "@/lib/products/public-pricing";
import {
  formatPriceAmount,
  type BolivarRates,
  type PriceCurrency,
} from "@/lib/products/price";
import type { DatosRapidos } from "@/components/dashboard/quick-product-sheet";

const QuickProductSheet = dynamic(
  () => import("@/components/dashboard/quick-product-sheet").then((m) => m.QuickProductSheet),
  { ssr: false },
);

// THE «PRODUCTO» STEP OF A SALE, AS ITS OWN COMPONENT — moved out of
// `nueva-venta.tsx` on 2026-11-19 without changing what it does.
//
// It moved because a second screen mounts it: «Agregar producto» on step 1/3
// of registering a catalogue order (owner's request of 2026-11-19, «mismo
// patrón que Nueva venta 1/4 Producto»). The repo's rule is that a thing shown
// on two screens is written once; importing it from inside the 2,500-line sale
// wizard would have dragged that whole module into the order flow's bundle.
//
// WHAT THE ORDER SCREEN CHANGES, through props and nothing else:
//   · `monedaFija` -- prices on the cards and in the product sheet are shown
//     and taken in the order block's currency only, and the sheet says
//     «Moneda del pedido» instead of offering a choice (frame `2211:22392`).
//   · `pantalla` -- the analytics screen name, so a search in the order's
//     sheet is not counted as a search at the sale counter.
//   · no `onIrAlCarrito` -- there is no cart there, so no cart pill.

export type LineaVenta = {
  productId: string;
  name: string;
  unit: string | null;
  photoPath: string | null;
  // La ficha entera del producto viaja con la línea para poder recalcular:
  // subir la cantidad puede cruzar el mínimo del mayoreo y cambiar el precio,
  // y cambiar la moneda lo cambia también.
  producto: ProductoPublico;
  quantity: number;
  currency: PriceCurrency;
  // Set when the product was created in this sale with the quick sheet: its line gets
  // «Editar», which reopens that sheet (owner's request of 2026-11-16). What the sheet typed
  // and the product row does not carry back rides here.
  creadoEnVenta?: DatosRapidos;
};

// ── 1/4 ────────────────────────────────────────────────────────────────
// ── 2/4 ────────────────────────────────────────────────────────────────
export function PasoProducto({
  catalogo,
  onCatalogo,
  lineas,
  onAgregar,
  onIrAlCarrito,
  ownerId,
  umbralDeStock,
  monedaFija,
  pantalla = "sale_products",
}: {
  catalogo: ProductosParaVenta | null;
  onCatalogo: (c: ProductosParaVenta) => void;
  lineas: LineaVenta[];
  onAgregar: (l: LineaVenta, via: "catalog" | "quick_create") => void;
  /** Absent where there is no cart (the order's «Agregar al pedido»): no pill. */
  onIrAlCarrito?: () => void;
  // Para el diálogo de alta de producto, que lo pide.
  ownerId: string;
  /** `owners.low_stock_threshold`, para el chip de existencias de la hoja. */
  umbralDeStock: number;
  /**
   * The only currency a product may enter in. Set by the order's step 1/3: the
   * added product joins the block being confirmed (owner's decision of
   * 2026-11-19). The NEW-product dialog still offers every ledger currency --
   * that product belongs to the catalogue, not to this order.
   */
  monedaFija?: PriceCurrency;
  /** The `screen` property of the search and filter events. */
  pantalla?: "sale_products" | "order_add_product";
}) {
  const [query, setQuery] = useState("");
  // WHICH CURRENCIES A CARD AND THE PRODUCT SHEET MAY OFFER. The ledger's, or the
  // order block's alone; a product with no price in it shows «Sin precio» and
  // cannot be picked, exactly like a product with no price at the counter.
  const monedasOfrecidas: PriceCurrency[] = monedaFija
    ? (catalogo?.monedasDelLibro ?? []).filter((m) => m === monedaFija)
    : (catalogo?.monedasDelLibro ?? []);
  // `total`, not the page's length: since the list pages by ten (2026-11-15) the rows on
  // screen are at most ten, and the search event asks how many products MATCHED. Until
  // that day the figure was capped at twelve, the old page size; the series changes there.
  useSearchEvent(pantalla, query, catalogo?.total ?? catalogo?.productos.length ?? 0);
  const [cargando, setCargando] = useState(false);
  const [buscado, setBuscado] = useState(false);
  const [creando, setCreando] = useState(false);
  // El producto abierto, si hay uno. Es una VISTA DENTRO del paso y no una
  // ruta: el carrito del asistente vive en memoria, así que navegar a
  // `/c/<token>/<id>` —que es donde vive ese detalle para el cliente— lo
  // perdería entero.
  const [detalle, setDetalle] = useState<ProductoParaVenta | null>(null);
  // Se incrementa al guardar un producto nuevo, y el efecto de abajo lo mira:
  // es lo que hace que la cuadrícula se vuelva a pedir sin tocar `query`, para
  // que el recién creado aparezca donde el tendero lo está esperando.
  const [recarga, setRecarga] = useState(0);
  // The last product search failed to reach the server.
  const [sinConexion, setSinConexion] = useState(false);
  // PAGES OF TEN AND A CATEGORY FILTER (owner's request of 2026-11-15). Both reset the
  // page to 1 when the search or the chip changes, in the handlers below and not in an
  // effect, so a new filter never asks the server for page 4 of a shorter list.
  const [pagina, setPagina] = useState(1);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [chips, setChips] = useState<{ categorias: CategoriaConProductos[]; total: number } | null>(null);
  // The chips are asked for once per visit to this step: they do not change while typing.
  const chipsPedidos = useRef(false);
  const arribaDeLaLista = useRef<HTMLDivElement>(null);
  const buscar = (texto: string) => {
    setQuery(texto);
    setPagina(1);
  };
  const filtrar = (id: string | null) => {
    // DOES THE SHOPKEEPER USE THE CATEGORIES AT THE COUNTER, OR DOES HE SEARCH? The owner
    // added them «para facilitar la búsqueda del producto» (2026-11-15). If nobody taps
    // them here, they take a row of a screen used with a customer waiting and should go;
    // if they are tapped more than the search box, the search is what is not working.
    // Compared with `Search Performed` on the same `screen`. The same event the owner's
    // catalogue sends for its chips, with this screen's name; no category name travels.
    // A gesture sent from the browser, so a floor, filed under the owner.
    track("List Filtered", { screen: pantalla, filter: "category" });
    setCategoryId(id);
    setPagina(1);
  };
  const irAPagina = (n: number) => {
    setPagina(n);
    // Back to the top of the grid: page 2 starts where page 1 started, not where the
    // thumb was when it tapped «Siguiente» at the bottom.
    arribaDeLaLista.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  // SE BUSCA AL ESCRIBIR, con el mismo retardo que el resto de los buscadores
  // de la app. La primera carga trae los doce primeros por orden alfabético
  // para que la pantalla no empiece vacía: el tendero suele vender lo mismo.
  // (Since 2026-11-15 it is pages of ten with numbered pages, see `pagina`.)
  //
  // `useEffect` Y NO `useMemo`. La primera versión de esto usaba `useMemo`
  // devolviendo una función de limpieza, y `useMemo` NO LAS EJECUTA: cada
  // tecla dejaba vivo su `setTimeout` y su petición, así que la respuesta más
  // lenta podía pisar a la más reciente y la lista acababa enseñando lo que
  // se buscó hace tres letras.
  //
  // Y `setCargando` VA DENTRO DEL TEMPORIZADOR, no en el cuerpo del efecto:
  // `react-hooks/set-state-in-effect` lo prohíbe con razón, y encima mejora
  // lo que se ve — encender «cargando» en cada tecla hacía parpadear la lista
  // durante los 250 ms de espera, cuando todavía no se había pedido nada.
  useEffect(() => {
    let vivo = true;
    const t = setTimeout(async () => {
      setCargando(true);
      setSinConexion(false);
      try {
        const withCategories = !chipsPedidos.current;
        const r = await buscarProductosParaVenta(query, { page: pagina, categoryId, withCategories });
        if (!vivo) return;
        onCatalogo(r);
        if (withCategories && r.categorias) {
          chipsPedidos.current = true;
          setChips({ categorias: r.categorias, total: r.totalProductos ?? 0 });
        }
        // The server may have served an earlier page (the list shrank under this one).
        if (r.page && r.page !== pagina) setPagina(r.page);
        setBuscado(true);
      } catch (e) {
        // A DROPPED REQUEST ON A WEAK SIGNAL used to leave this promise rejected
        // with nobody catching it: «cargando» stayed on and the grid stayed empty
        // with no way out but reloading the page, which throws away the cart.
        console.error("[PasoProducto] search:", e);
        if (vivo) setSinConexion(true);
      } finally {
        if (vivo) setCargando(false);
      }
    }, 250);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, recarga, pagina, categoryId]);

  const enElCarrito = lineas.reduce((n, l) => n + l.quantity, 0);
  const paginas = pageCount(catalogo?.total ?? 0);

  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* LOS DOS CONTROLES VAN A 8px ENTRE SÍ y no a los 16 del resto: en el
          frame forman un bloque —buscar o crear— frente a la cuadrícula de
          abajo, y esa distinta separación es lo que los agrupa. */}
      <div className="flex flex-col gap-2">
        <SearchField value={query} onChange={buscar} placeholder="Buscar producto" />

      {/* «AGREGAR PRODUCTO» ABRE EL DIÁLOGO AQUÍ MISMO, no lleva al catálogo.
          Irse a `/productos?nuevo=1` habría sido una línea, y habría tirado el
          carrito: el asistente guarda sus líneas en memoria, así que salir de
          la pantalla pierde todo lo que el tendero llevara metido. Es el mismo
          diálogo del catálogo, montado aquí. */}
      {/* DISABLED UNTIL THE CATALOGUE HAS LOADED: the sheet takes the business's
          currencies from it, and opened before that (a fast tap on a slow signal)
          it offered an empty currency list and saved the product in dollars. */}
      <Button
        type="button"
        variant="outline"
        className="h-10 w-full"
        disabled={!catalogo}
        onClick={() => setCreando(true)}
      >
        <Plus className="size-5" aria-hidden="true" />
        Agregar producto
      </Button>
      </div>

      {sinConexion ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm">
          <span className="text-muted-foreground">No pudimos cargar tus productos. Revisa tu conexión.</span>
          <Button type="button" variant="outline" size="sm" onClick={() => setRecarga((n) => n + 1)}>
            Reintentar
          </Button>
        </div>
      ) : null}

      {/* THE SAME CHIPS AS BOTH CATALOGUES (`CategoryChips`), under the same title as
          the customer's. Only categories with products: see `categoriasConProductos`. */}
      {chips && chips.categorias.length > 0 ? (
        <section aria-labelledby="venta-categorias" className="flex flex-col gap-1">
          <h2 id="venta-categorias" className="text-sm leading-5">
            Categorías
          </h2>
          <CategoryChips
            categorias={chips.categorias}
            total={chips.total}
            value={categoryId}
            onChange={filtrar}
          />
        </section>
      ) : null}

      <div ref={arribaDeLaLista} className="scroll-mt-4" aria-hidden="true" />

      {catalogo && catalogo.productos.length === 0 && buscado && !cargando ? (
        <EmptyState
          title={
            query.trim() !== ""
              ? `No encontramos nada con «${query.trim()}»`
              : categoryId
                ? "No hay productos en esta categoría"
                : "Todavía no tienes productos en tu catálogo"
          }
        />
      ) : null}

      {/* DOS COLUMNAS FIJAS, como el frame. `grid` y no `flex-wrap`: con
          envoltura, una fila con una sola tarjeta la deja a media anchura o
          estirada según el `flex`, y la cuadrícula del frame es regular pase lo
          que pase. `minmax(0,1fr)` y no `1fr` a secas — un hijo de grid tiene
          `min-width:auto` por defecto y un nombre largo lo ensancharía más allá
          de su columna, que es el desbordamiento horizontal que costó seis
          contenedores el 2026-10-17. */}
      <ul className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-4">
        {(catalogo?.productos ?? []).map((p) => (
          <TarjetaDeProducto
            key={p.id}
            producto={p}
            rates={catalogo?.rates ?? null}
            monedasDelLibro={monedasOfrecidas}
            monedaFija={monedaFija}
            onAbrir={setDetalle}
          />
        ))}
      </ul>

      <NumberedPagination page={pagina} pages={paginas} onChange={irAPagina} />

      {/* LA MISMA PÍLDORA FLOTANTE QUE EL CATÁLOGO DEL CLIENTE, a petición del
          dueño el 2026-10-18: «exactamente el mismo» componente.

          Lo que gana sobre el botón ancho que había: estaba al FINAL de la
          columna, así que con quince productos en la cuadrícula el tendero
          tenía que recorrerla entera para ver que ya llevaba seis cosas. La
          píldora flota y lleva la cuenta encima.

          Y el hueco de abajo lo pone ella, no esta columna: `flex-1` empujaba
          el botón contra el borde y ahora no hay nada que empujar. */}
      {onIrAlCarrito ? <CartPillButton total={enElCarrito} onClick={onIrAlCarrito} /> : null}

      {/* El aire que la píldora tapa. Sin esto, la última fila de la
          cuadrícula queda debajo de ella y no se puede tocar. */}
      {onIrAlCarrito && enElCarrito > 0 ? <div aria-hidden="true" className="h-16" /> : null}

      {/* LA HOJA DEL PRODUCTO — frame `1389:8949`. Es una HOJA y no una vista
          que reemplace la cuadrícula: así, al cerrarla el tendero sigue donde
          estaba, con su scroll y su búsqueda escrita. Quien vende abre tres o
          cuatro productos seguidos antes de cobrar.

          `key` CON EL ID: sin ella, abrir un segundo producto reutilizaría los
          `useState` del primero —la cantidad y la moneda elegidas— y el
          tendero vería «12» en un producto que acaba de abrir. Es la misma
          trampa que `catalog-table.tsx` documenta para su ficha. */}
      {detalle ? (
        <ProductSheet
          key={detalle.id}
          umbralDeStock={umbralDeStock}
          open
          onOpenChange={(abierto: boolean) => !abierto && setDetalle(null)}
          producto={detalle}
          rates={catalogo?.rates ?? null}
          monedasPermitidas={monedasOfrecidas}
          // «Paga en USD · Moneda del pedido», frame `2211:22392`: the row
          // stays, saying why there is nothing to choose.
          rotuloDeMonedaFija={monedaFija ? "Moneda del pedido" : undefined}
          monedaExtra={monedaFija}
          onAgregar={({ quantity, currency }) => {
            onAgregar({
              productId: detalle.id,
              name: detalle.name,
              unit: detalle.unit,
              photoPath: detalle.photoPath,
              producto: detalle.producto,
              quantity,
              currency,
            }, "catalog");
            setDetalle(null);
          }}
        />
      ) : null}

      {/* MONTADA SOLO MIENTRAS SE USA. Radix deja el nodo en el DOM al
          cerrarse, y esta hoja trae dentro un formulario entero con sus
          propios `useState`: dejarla montada haría que la segunda vez abriera
          con lo que se escribió la primera. */}
      {creando ? (
        <QuickProductSheet
          open
          onOpenChange={(next: boolean) => !next && setCreando(false)}
          ownerId={ownerId}
          monedas={catalogo?.monedasDelLibro ?? []}
          onCreado={async (productId, cantidad, datos) => {
            setCreando(false);
            // The grid is refreshed so the new product shows up where it sorts.
            setRecarga((n) => n + 1);
            // SE PIDE EL PRODUCTO RECIÉN CREADO ANTES DE METERLO AL CARRITO, y
            // no se arma aquí con lo que se acaba de teclear: el carrito
            // necesita la ficha ENTERA —escalones, monedas activas, precios
            // fijados— para recalcular el precio al cambiar de moneda o al
            // cruzar el mínimo de mayoreo. Montarla a mano daría una línea que
            // se comporta distinto de las demás hasta recargar la pantalla.
            //
            // IT IS FETCHED BY ITS ID, NOT PICKED OUT OF THE GRID'S SEARCH. Until
            // 2026-11-15 the line was taken from the grid's reload, which returns
            // the first twelve products in alphabetical order: a new product that
            // sorted past the twelfth (any owner with more than twelve products
            // creating «Zapato», say) was saved to the catalogue and silently left
            // out of the cart, so «Ver carrito» never appeared. Reported by the
            // owner on 2026-11-15 and reproduced in dev with a fast connection, so
            // it was never a connectivity problem. One retry covers a dropped
            // request on a weak signal; after that the shopkeeper is told, because
            // a product that vanishes between «Agregar» and the cart is the
            // failure he saw.
            const lineaNueva = (r: ProductosParaVenta) => {
              const nuevo = r.productos.find((x) => x.id === productId);
              if (!nuevo) return null;
              const unidades = Math.max(cantidad, cantidadMinima(nuevo.producto));
              const escalon = escalonParaCantidad(nuevo.producto, unidades);
              const bloque = escalon === "wholesale" ? nuevo.producto.wholesale : nuevo.producto.retail;
              // With `monedaFija`, only that one: a product priced in euros
              // alone, created from an order in dollars, has nothing to enter
              // the dollar block with and falls to the warning below.
              const moneda = monedaFija
                ? precioEnMoneda(bloque ?? null, monedaFija, r.rates) != null
                  ? monedaFija
                  : undefined
                : monedasDelBloque(bloque ?? null, r.rates).filter((c) =>
                    r.monedasDelLibro.includes(c),
                  )[0];
              if (!moneda) return null;
              return {
                productId: nuevo.id,
                name: nuevo.name,
                unit: nuevo.unit,
                photoPath: nuevo.photoPath,
                producto: nuevo.producto,
                quantity: unidades,
                currency: moneda,
                creadoEnVenta: datos,
              } satisfies LineaVenta;
            };
            for (let intento = 0; intento < 2; intento++) {
              try {
                const linea = lineaNueva(await productoParaVentaPorId(productId));
                if (linea) {
                  onAgregar(linea, "quick_create");
                  return;
                }
                // FROM AN ORDER, THE LIKELY REASON IS THE CURRENCY, and saying so
                // is what tells the shopkeeper the fix: give the product a price
                // in the order's currency.
                if (monedaFija) {
                  toast.error(
                    `Guardamos el producto, pero no tiene precio en ${monedaFija}, la moneda de este pedido.`,
                  );
                  return;
                }
                break;
              } catch (e) {
                console.error("[PasoProducto] new product:", e);
                if (intento === 0) await new Promise((ok) => setTimeout(ok, 1500));
              }
            }
            toast.error(
              monedaFija
                ? "Guardamos el producto, pero no pudimos agregarlo al pedido. Búscalo por su nombre y agrégalo."
                : "Guardamos el producto, pero no pudimos agregarlo a la venta. Búscalo por su nombre y agrégalo.",
            );
          }}
        />
      ) : null}
    </div>
  );
}

// UNA TARJETA DE PRODUCTO — frame `1389:8364`, 2026-10-18.
//
// ===========================================================================
// ERA UN MOSAICO OSCURO Y AHORA ES UNA FICHA CLARA
//
// Hasta esta mañana la foto ocupaba la tarjeta entera, con el nombre y el
// precio en blanco encima de un degradado que bajaba a `#272727`. El frame
// nuevo la parte en dos: la foto en su propio recuadro arriba y el texto en
// tinta debajo, sobre fondo blanco y con borde.
//
// LO QUE SE GANA, y es lo que explica el cambio: el degradado existía para
// garantizar el contraste del texto pasara lo que pasara en la imagen. Era
// una defensa contra la foto, y costaba oscurecer la mitad de abajo de TODAS
// las fotos, tuvieran o no el problema. Separando los dos, el texto ya no
// depende de la imagen y la imagen se ve entera.
//
// ===========================================================================
// EL «+» NO ES UN BOTÓN, AUNQUE AHORA LO PAREZCA MÁS
//
// Sobre blanco el cuadrado oscuro destaca mucho más que antes, así que la
// pregunta se le hizo al dueño el 2026-10-18 y su respuesta fue dejarlo como
// estaba: **abre el detalle, igual que toda la tarjeta**. Un solo blanco que
// tocar, y la cantidad, la moneda y el escalón se eligen en la hoja, que es
// para lo que sirve.
//
// Por eso es un `<span aria-hidden>` dentro del botón y no un `<button>`: un
// botón dentro de otro no es HTML válido, y dos blancos para la misma acción
// solo añaden la duda de cuál de los dos hace qué.
function TarjetaDeProducto({
  producto,
  rates,
  monedasDelLibro,
  monedaFija,
  onAbrir,
}: {
  producto: ProductoParaVenta;
  rates: BolivarRates | null;
  monedasDelLibro: PriceCurrency[];
  /** From an order: the price shown is in this currency, converted if the
   *  product does not enable it (frame `2211:22307`: «el euro del aceite de
   *  oliva va convertido a dólares»). */
  monedaFija?: PriceCurrency;
  // ABRE EL DETALLE, no mete al carrito. Lo pidió el dueño el 2026-10-18: «al
  // seleccionar el producto redirigirás al mismo detalle del producto que se
  // muestra en el catálogo». Tocando la tarjeta se añadía una unidad al precio
  // de detal y ya — sin poder elegir cantidad ni moneda, que es justo lo que
  // esa pantalla sirve para decidir.
  onAbrir: (p: ProductoParaVenta) => void;
}) {
  const minimo = cantidadMinima(producto.producto);
  const escalon = escalonParaCantidad(producto.producto, minimo);
  const bloque = escalon === "wholesale" ? producto.producto.wholesale : producto.producto.retail;
  // SOLO LAS MONEDAS QUE EL LIBRO SABE GUARDAR. `monedasDelBloque` devuelve
  // también bolívares y USDT para un negocio venezolano; ninguna de las dos
  // es un libro (ver `buscarProductosParaVenta`).
  const monedas = monedasDelBloque(bloque, rates).filter((c) => monedasDelLibro.includes(c));
  // FROM AN ORDER THE CURRENCY IS THE BLOCK'S, enabled on the product or not:
  // the owner's approved frame converts a euro-only product to dollars, and
  // `registrarVenta` prices it the same way (`precioEnMoneda`, which does not
  // read the enabled list). No rate to convert with → «Sin precio», as always.
  const moneda = monedaFija
    ? precioEnMoneda(bloque, monedaFija, rates) != null
      ? monedaFija
      : null
    : (monedas[0] ?? null);
  const precio = moneda ? precioEnMoneda(bloque, moneda, rates) : null;
  const foto = producto.photoPath || null;
  const sinPrecio = precio == null || moneda == null;

  return (
    <li className="min-w-0">
      <button
        type="button"
        // SIN PRECIO NO SE PUEDE VENDER, y la tarjeta lo dice apagándose en vez
        // de dejar meter al carrito una línea que luego no se puede cobrar.
        disabled={sinPrecio}
        aria-label={`Ver ${producto.name}`}
        onClick={() => !sinPrecio && onAbrir(producto)}
        className="relative flex w-full flex-col gap-2.5 rounded-[10px] border p-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        {/* EL RECUADRO DE LA FOTO, 127px de alto en el frame. Es un `div` con
            la imagen dentro y no la imagen a secas: sin foto tiene que quedar
            el mismo hueco gris, o las tarjetas de una cuadrícula mixta se
            desalinean entre sí. */}
        <span className="relative block h-[127px] w-full overflow-hidden bg-muted">
          {foto ? (
            <ProductThumbnail
              path={foto}
              alt=""
              fill
              sizes="(max-width: 448px) 50vw, 161px"
            />
          ) : (
            // EL ICONO DE FOTO TACHADA SE QUEDA, decisión del dueño el
            // 2026-10-18. Un recuadro gris liso se lee como una imagen que
            // todavía está cargando; este dice que no hay ninguna.
            <span className="absolute inset-0 flex items-center justify-center">
              <ImageOff className="size-6 text-muted-foreground" aria-hidden="true" />
            </span>
          )}
        </span>

        {/* DOS LÍNEAS COMO MUCHO. El frame enseña «Nombre del producto»
            partido en dos; con tres, el precio se saldría de la tarjeta. */}
        <span className="line-clamp-2 text-base font-semibold">{producto.name}</span>

        {/* LA BANDERA SE QUEDA aunque el frame dibuje el precio pelado.
            Decisión del dueño el 2026-10-18: un negocio venezolano vende en
            dólares y en euros, y sin bandera «$10,00» y «€10,00» se distinguen
            solo por el símbolo — que es un carácter, al final de la línea, en
            una cuadrícula que se recorre de un vistazo.

            EL «· al mayor» SÍ SE VA, en la misma decisión: el escalón se ve
            entero en el detalle, con su cantidad mínima al lado, y ahí sí
            significa algo. */}
        {/* EL PRECIO EN 14/20 (`text-sm`) Y EL NOMBRE EN 16: decisión del dueño
            el 2026-10-19. *«Tanto título de producto como precio tienen la
            misma jerarquía»* — y la tenían, los dos en `text-base
            font-semibold`.

            ESTO REVIERTE A MEDIAS SU PROPIA DECISIÓN DEL 2026-10-18, y las dos
            quedan escritas. Ese día el precio SUBIÓ de 14px a 16 semibold
            justamente para igualarlo al nombre: los dos tamaños y pesos
            andaban descuadrados entre esta pantalla y el catálogo del cliente,
            y el dueño lo vio poniendo las dos una al lado de otra. La razón
            vieja no era el tamaño, era la IGUALDAD ENTRE LAS DOS PANTALLAS —
            así que se mantiene: el mismo cambio entra en la tarjeta de
            `app/c/[token]/page.tsx`. Lo que se corrige es la jerarquía DENTRO
            de la tarjeta, que es otra cosa.

            EL PESO NO SE TOCA. El dueño habló del tamaño, y con 14 frente a 16
            la jerarquía ya se lee; quitarle también el `font-semibold` sería
            una decisión que no pidió. */}
        <span className="flex items-center gap-1 pr-10 text-sm font-semibold text-muted-foreground">
          {moneda ? <CurrencyFlagIcon currency={moneda} className="size-4" /> : null}
          {precio != null && moneda ? formatPriceAmount(precio, moneda) : "Sin precio"}
        </span>

        <span
          aria-hidden="true"
          className="absolute bottom-2 right-2 flex size-8 items-center justify-center rounded-sm bg-brand-primary"
        >
          <Plus className="size-6 text-brand-secondary" />
        </span>
      </button>
    </li>
  );
}
