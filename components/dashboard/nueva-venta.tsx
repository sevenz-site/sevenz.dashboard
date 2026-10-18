"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Banknote, ChevronRight, ImageOff, Minus, Plus, Store, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchField } from "@/components/dashboard/client-search-sheet";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { QuickProductSheet } from "@/components/dashboard/quick-product-sheet";
import { ProductSheet } from "@/components/dashboard/product-sheet";
import { CurrencySheet } from "@/components/dashboard/currency-sheet";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CuotasSelect } from "@/components/dashboard/cuotas-select";
import { PlazoPagoSelect } from "@/components/dashboard/plazo-pago-select";
import { getPublicProductPhotoUrl } from "@/lib/supabase/storage";
import {
  buscarProductosParaVenta,
  registrarVenta,
  resolverMostrador,
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
  formatAmountForInput,
  formatPriceAmount,
  parseAmount,
  type BolivarRates,
  type PriceCurrency,
} from "@/lib/products/price";
import { formatCantidad } from "@/lib/products/cantidad";
import { DEFAULT_PLAZO_PAGO } from "@/lib/types";

// EL ASISTENTE DE UNA VENTA — sitemap `1269:6051`, encargo del dueño del
// 2026-10-17.
//
// Cuatro pasos: cliente, producto, carrito y pago.
//
// LO QUE EL PASO 4 NO TIENE TODAVÍA es la foto del comprobante. La acción del
// servidor ya acepta `photoPath`, así que conectarla es una línea — pero el
// componente que sube la foto y devuelve su ruta vive dentro del diálogo de
// movimientos y no está extraído. Se deja fuera a propósito en vez de dejar un
// control que no sube nada: es la lección de `CT-92`.
//
// ===========================================================================
// EL PRECIO SALE DE LAS MISMAS FUNCIONES QUE VE EL CLIENTE
//
// `escalonParaCantidad`, `monedasDelBloque` y `precioEnMoneda` son las tres
// que usa el catálogo público en `/c/[token]`. No es comodidad: el precio que
// el tendero cobra en el mostrador y el que su cliente leyó en el catálogo
// tienen que salir del mismo sitio. Con dos caminos, el día que uno cambie
// —un escalón, un precio fijado a mano, una moneda desactivada— los dos
// empiezan a decir cifras distintas y nadie se entera hasta que un cliente lo
// reclama.
//
// Y de ahí sale gratis `CT-101`: cambiar la moneda de una línea RECALCULA el
// precio en vez de cambiarle la etiqueta. Si solo cambiara la etiqueta, se
// vendería 51,34 € a precio de 51,34 $ — un 8 % de diferencia, perfectamente
// creíble y sin un solo error en ninguna parte.

type LineaVenta = {
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
};

type Cliente = { id: string; name: string };
// El cliente elegido, con la única cosa que la pantalla necesita saber además
// de su nombre: si es el comodín, porque al mostrador no se le puede fiar.
type Elegido = Cliente & { esMostrador: boolean };

export function NuevaVenta({
  clientes,
  inicial,
  ownerId,
}: {
  // La lista del buscador del paso 3, sin el mostrador: se elige con su propio
  // botón y no buscándolo por nombre.
  clientes: Cliente[];
  // YA RESUELTO cuando se entra con `?cliente=` — desde la ficha de alguien, o
  // desde «Continuar con venta» de la pantalla de cliente nuevo. `null` = se
  // entró por «Fiado o venta» de la hoja de Registrar, y entonces NO se
  // pregunta todavía: ver el comentario de los tres pasos, abajo.
  inicial: Elegido | null;
  ownerId: string;
}) {
  const router = useRouter();
  const [paso, setPaso] = useState<1 | 2 | 3>(1);
  const [cliente, setCliente] = useState<Elegido | null>(inicial);
  const [lineas, setLineas] = useState<LineaVenta[]>([]);
  const [catalogo, setCatalogo] = useState<ProductosParaVenta | null>(null);

  const total = useMemo(() => totalesPorMoneda(lineas, catalogo?.rates ?? null), [lineas, catalogo]);

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-4">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Volver"
          onClick={() => (paso === 1 ? router.back() : setPaso((p) => (p - 1) as 1 | 2))}
        >
          <ArrowLeft className="size-5" aria-hidden="true" />
        </Button>
      </div>

      {/* ── TRES PASOS, Y EL CLIENTE NO ES UNO DE ELLOS ──────────────────
          Frame `1389:8329`, que dice «1/3 Producto». Hasta esta mañana eran
          cuatro y el primero preguntaba a quién se le vende.

          POR QUÉ SE CAE ESE PASO, decisión del dueño del 2026-10-18: **una
          venta de contado no necesita cliente**. Preguntarlo de entrada le
          cobraba un toque a todo el mundo para un dato que la mayoría de las
          ventas no usa. Ahora se pregunta en el paso 3, y SOLO si algo queda
          fiado — que es el único caso en que hace falta saber a quién cobrarle
          después.

          Quien entra con `?cliente=` —desde la ficha de alguien, o desde
          «Continuar con venta» de la pantalla de cliente nuevo— ya lo trae
          puesto y no ve la pregunta en ningún momento. */}
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-normal">Nueva venta</h1>
        <p className="text-sm text-muted-foreground">
          {paso}/3 {["Producto", "Carrito", "Pago"][paso - 1]}
        </p>
        {/* `aria-hidden` porque la línea de arriba ya dice «1/3 Producto» con
            palabras: repetirlo en el lector de pantalla sería ruido, no
            accesibilidad. */}
        <div aria-hidden="true" className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-foreground transition-all"
            style={{ width: `${(paso / 3) * 100}%` }}
          />
        </div>
      </div>

      {paso === 1 ? (
        <PasoProducto
          catalogo={catalogo}
          onCatalogo={setCatalogo}
          lineas={lineas}
          onAgregar={(l) => setLineas((xs) => agregar(xs, l))}
          onIrAlCarrito={() => setPaso(2)}
          ownerId={ownerId}
        />
      ) : null}

      {paso === 2 ? (
        <PasoCarrito
          lineas={lineas}
          rates={catalogo?.rates ?? null}
          monedasDelLibro={catalogo?.monedasDelLibro ?? []}
          onCambiar={setLineas}
          onSeguirComprando={() => setPaso(1)}
          onIrAPago={() => setPaso(3)}
        />
      ) : null}

      {paso === 3 ? (
        <PasoPago
          clientes={clientes}
          cliente={cliente}
          onElegirCliente={setCliente}
          lineas={lineas}
          total={total}
          rates={catalogo?.rates ?? null}
          onVolver={() => setPaso(2)}
        />
      ) : null}
    </div>
  );
}

// ── 1/4 ────────────────────────────────────────────────────────────────
// A QUIÉN LE VENDE. Dos estados: elegir, y ya elegido.
//
// FUE UN PASO ENTERO DEL ASISTENTE DURANTE UNAS HORAS del 2026-10-18, el 1 de
// 4, y dejó de serlo esa misma tarde: el frame `1389:8329` numera «1/3
// Producto», y la razón es que **una venta de contado no necesita cliente**.
// Preguntarlo de entrada le cobraba un toque a todo el mundo por un dato que
// la mayoría de las ventas no usa.
//
// Ahora esto vive DENTRO del paso de pago y solo se pinta cuando algo queda
// fiado. Sigue siendo un componente propio y no código suelto ahí porque es
// exactamente la misma pregunta, con la misma lista y el mismo botón de
// mostrador — y el día que haga falta en una tercera pantalla no habrá que
// escribirla otra vez.
function SelectorDeCliente({
  clientes,
  cliente,
  onElegir,
  onContinuar,
  sinMostrador,
}: {
  clientes: Cliente[];
  cliente: Elegido | null;
  onElegir: (c: Elegido | null) => void;
  // Solo cuando esto es un paso con su propio botón de avanzar. Dentro del
  // pago no hay «continuar»: elegir ya es la respuesta.
  onContinuar?: () => void;
  // Esconde «Venta de mostrador». Lo pasa el pago: al comodín no se le puede
  // fiar, así que ofrecerlo ahí sería ofrecer lo que el servidor rechaza.
  sinMostrador?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [abriendoMostrador, setAbriendoMostrador] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── YA ELEGIDO ──────────────────────────────────────────────────────
  if (cliente) {
    return (
      <div className="flex flex-1 flex-col gap-4">
        <div className="flex flex-col gap-1 rounded-xl border p-4">
          <p className="text-xs text-muted-foreground">
            {cliente.esMostrador ? "Venta de mostrador" : "Le vendes a"}
          </p>
          <p className="text-lg font-semibold">{cliente.name}</p>
          {cliente.esMostrador ? (
            // LO QUE ESTO SIGNIFICA, DICHO AQUÍ Y NO EN UNA AYUDA: una venta de
            // mostrador no se le puede fiar a nadie, porque no hay a quién
            // cobrarle después. Enterarse de eso en el paso 4, con el cliente
            // delante, sería tarde.
            <p className="pt-1 text-xs leading-relaxed text-muted-foreground">
              No queda a nombre de ningún cliente, así que esta venta se cobra completa. Si vas a
              fiar, elige a la persona.
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          className="h-10 self-start px-2 text-sm"
          onClick={() => {
            onElegir(null);
            setQuery("");
          }}
        >
          Es para otra persona
        </Button>
        {onContinuar ? (
          <>
            <div className="flex-1" />
            <Button type="button" className="h-12 w-full" onClick={onContinuar}>
              Continuar
            </Button>
          </>
        ) : null}
      </div>
    );
  }

  // ── ELIGIENDO ───────────────────────────────────────────────────────
  //
  // SE FILTRA EN EL NAVEGADOR y no con una consulta por cada letra: la lista
  // llega entera con la pantalla, y es la misma que alimenta el buscador de
  // «agregar movimiento» de Inicio. Un negocio con 214 clientes —el mayor que
  // hay hoy— son unos pocos kilobytes.
  const texto = query.trim().toLowerCase();
  const encontrados = texto === "" ? clientes : clientes.filter((c) => c.name.toLowerCase().includes(texto));

  return (
    <div className="flex flex-1 flex-col gap-4">
      <SearchField value={query} onChange={setQuery} placeholder="Buscar cliente" />

      {/* EL MOSTRADOR, ARRIBA Y CON SU PROPIO BOTÓN. No sale en la lista de
          abajo a propósito: ahí parecería un cliente llamado «Mostrador» al que
          se le puede fiar, que es justo lo que el paso 4 prohíbe.

          Y la fila en la base NO EXISTE hasta que se pulsa esto — ver
          `resolverMostrador`. Crearla al abrir la pantalla le habría puesto un
          cliente «Mostrador» en la lista a todos los dueños al primer toque de
          «Agregar», con `CT-99` todavía sin cerrar. */}
      {sinMostrador ? null : (
      <button
        type="button"
        disabled={abriendoMostrador}
        onClick={async () => {
          setError(null);
          setAbriendoMostrador(true);
          const r = await resolverMostrador();
          if ("error" in r) {
            setError(r.error);
            setAbriendoMostrador(false);
            return;
          }
          onElegir({ ...r, esMostrador: true });
        }}
        className="flex items-center gap-3 rounded-xl border p-4 text-left disabled:opacity-60"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted">
          <Store className="size-5" aria-hidden="true" />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="text-sm font-medium">
            {abriendoMostrador ? "Abriendo…" : "Venta de mostrador"}
          </span>
          <span className="text-xs leading-relaxed text-muted-foreground">
            Sin cliente. Se cobra completa, no se puede fiar.
          </span>
        </span>
      </button>
      )}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {encontrados.length > 0 ? (
        <div className="flex flex-col overflow-hidden rounded-xl border">
          {encontrados.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onElegir({ ...c, esMostrador: false })}
              className={`flex items-center justify-between gap-3 p-4 text-left ${i > 0 ? "border-t" : ""}`}
            >
              <span className="truncate text-sm font-medium">{c.name}</span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </button>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed px-6 py-8 text-center">
          <p className="text-sm leading-relaxed text-muted-foreground">
            {clientes.length === 0
              ? "Todavía no tienes clientes registrados."
              : `Ningún cliente se llama «${query.trim()}».`}
          </p>
        </div>
      )}

      {onContinuar ? <div className="flex-1" /> : null}

      {/* CLIENTE NUEVO: VA AL ALTA QUE YA EXISTE, no a un formulario nuevo aquí.
          Esa pantalla pide el WhatsApp con su permiso (`MS-34`), avisa de
          nombres duplicados y guarda el primer movimiento con su plazo y sus
          cuotas. Rehacerla dentro del asistente sería duplicar el formulario
          más delicado de la app para ahorrar una navegación.

          LO QUE ESTO NO HACE, dicho porque se va a notar: el alta crea al
          cliente CON su primer movimiento, que es un fiado, no una venta con
          productos. Para que un cliente nuevo pueda nacer con una venta hay que
          dejar que `registrarVenta` lo cree — lo mismo que hace
          `createClientWithMovement`— y eso es trabajo propio, no un añadido a
          este botón. */}
      <Button asChild variant="outline" className="h-12 w-full">
        {/* A LA PANTALLA DE ALTA, y eso cierra el hueco que este mismo
            comentario describía esta mañana: el diálogo de siempre crea al
            cliente CON un fiado, así que desde aquí no había forma de que
            alguien nuevo naciera con una venta. Esa pantalla termina en
            «Continuar con venta», que vuelve justo aquí con el cliente ya
            puesto. */}
        <Link href="/clients/nuevo">
          <UserPlus className="size-4" aria-hidden="true" />
          Registrar cliente nuevo
        </Link>
      </Button>
    </div>
  );
}

// ── 2/4 ────────────────────────────────────────────────────────────────
function PasoProducto({
  catalogo,
  onCatalogo,
  lineas,
  onAgregar,
  onIrAlCarrito,
  ownerId,
}: {
  catalogo: ProductosParaVenta | null;
  onCatalogo: (c: ProductosParaVenta) => void;
  lineas: LineaVenta[];
  onAgregar: (l: LineaVenta) => void;
  onIrAlCarrito: () => void;
  // Para el diálogo de alta de producto, que lo pide.
  ownerId: string;
}) {
  const [query, setQuery] = useState("");
  const [cargando, setCargando] = useState(false);
  const [buscado, setBuscado] = useState(false);
  const [creando, setCreando] = useState(false);
  // El producto abierto, si hay uno. Es una VISTA DENTRO del paso y no una
  // ruta: el carrito del asistente vive en memoria, así que navegar a
  // `/c/<token>/<id>` —que es donde vive ese detalle para el cliente— lo
  // perdería entero.
  const [detalle, setDetalle] = useState<ProductoParaVenta | null>(null);
  // El producto que la hoja acaba de crear y que entra al carrito en cuanto la
  // cuadrícula vuelva con él (ver `onCreado`).
  //
  // UNA REF Y NO ESTADO: nadie lo pinta, así que guardarlo en `useState`
  // provocaría un render de más por cada producto creado y encima obligaría a
  // leerlo desde dentro de su propio actualizador para no quedarse con el
  // valor del render anterior.
  const pendiente = useRef<{ productId: string; cantidad: number } | null>(null);
  // Se incrementa al guardar un producto nuevo, y el efecto de abajo lo mira:
  // es lo que hace que la cuadrícula se vuelva a pedir sin tocar `query`, para
  // que el recién creado aparezca donde el tendero lo está esperando.
  const [recarga, setRecarga] = useState(0);

  // SE BUSCA AL ESCRIBIR, con el mismo retardo que el resto de los buscadores
  // de la app. La primera carga trae los doce primeros por orden alfabético
  // para que la pantalla no empiece vacía: el tendero suele vender lo mismo.
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
      const r = await buscarProductosParaVenta(query);
      if (!vivo) return;
      onCatalogo(r);
      setCargando(false);
      setBuscado(true);

      // EL PRODUCTO RECIÉN CREADO ENTRA AL CARRITO AQUÍ, cuando la lista ya
      // trae su ficha completa.
      //
      // PUEDE NO VENIR, y por eso se comprueba: la búsqueda devuelve doce por
      // orden alfabético, así que un producto nuevo que caiga más allá del
      // doce no está en esta respuesta. En ese caso se deja como está —el
      // tendero lo busca por su nombre— en vez de meter al carrito una línea
      // armada a mano que se comportaría distinto de las demás.
      const p = pendiente.current;
      // SE LIMPIA SIEMPRE, entre o no entre: dejarlo puesto haría que la
      // siguiente búsqueda —una letra más en el buscador— volviera a meterlo.
      pendiente.current = null;
      if (p) {
        const nuevo = r.productos.find((x) => x.id === p.productId);
        const minimo = nuevo ? cantidadMinima(nuevo.producto) : 0;
        const cantidad = Math.max(p.cantidad, minimo);
        const escalon = nuevo ? escalonParaCantidad(nuevo.producto, cantidad) : null;
        const bloque = escalon === "wholesale" ? nuevo!.producto.wholesale : nuevo?.producto.retail;
        const moneda = monedasDelBloque(bloque ?? null, r.rates).filter((c) =>
          r.monedasDelLibro.includes(c),
        )[0];
        if (nuevo && moneda) {
          onAgregar({
            productId: nuevo.id,
            name: nuevo.name,
            unit: nuevo.unit,
            photoPath: nuevo.photoPath,
            producto: nuevo.producto,
            quantity: cantidad,
            currency: moneda,
          });
        }
      }
    }, 250);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, recarga]);

  const enElCarrito = lineas.reduce((n, l) => n + l.quantity, 0);

  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* LOS DOS CONTROLES VAN A 8px ENTRE SÍ y no a los 16 del resto: en el
          frame forman un bloque —buscar o crear— frente a la cuadrícula de
          abajo, y esa distinta separación es lo que los agrupa. */}
      <div className="flex flex-col gap-2">
        <SearchField value={query} onChange={setQuery} placeholder="Buscar producto" />

      {/* «AGREGAR PRODUCTO» ABRE EL DIÁLOGO AQUÍ MISMO, no lleva al catálogo.
          Irse a `/productos?nuevo=1` habría sido una línea, y habría tirado el
          carrito: el asistente guarda sus líneas en memoria, así que salir de
          la pantalla pierde todo lo que el tendero llevara metido. Es el mismo
          diálogo del catálogo, montado aquí. */}
      <Button type="button" variant="outline" className="h-10 w-full" onClick={() => setCreando(true)}>
        <Plus className="size-5" aria-hidden="true" />
        Agregar producto
      </Button>
      </div>

      {catalogo && catalogo.productos.length === 0 && buscado && !cargando ? (
        <div className="rounded-xl border border-dashed px-6 py-10 text-center">
          <p className="text-sm leading-relaxed text-muted-foreground">
            {query.trim() === ""
              ? "Todavía no tienes productos en tu catálogo."
              : `No encontramos nada con «${query.trim()}».`}
          </p>
        </div>
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
            monedasDelLibro={catalogo?.monedasDelLibro ?? []}
            onAbrir={setDetalle}
          />
        ))}
      </ul>

      <div className="flex-1" />
      {enElCarrito > 0 ? (
        <Button type="button" className="h-12 w-full" onClick={onIrAlCarrito}>
          Ver carrito ({formatCantidad(enElCarrito)})
        </Button>
      ) : null}

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
          open
          onOpenChange={(abierto: boolean) => !abierto && setDetalle(null)}
          producto={detalle}
          rates={catalogo?.rates ?? null}
          monedasPermitidas={catalogo?.monedasDelLibro ?? []}
          onAgregar={({ quantity, currency }) => {
            onAgregar({
              productId: detalle.id,
              name: detalle.name,
              unit: detalle.unit,
              photoPath: detalle.photoPath,
              producto: detalle.producto,
              quantity,
              currency,
            });
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
          onCreado={(productId, cantidad) => {
            setCreando(false);
            // SE PIDE EL PRODUCTO RECIÉN CREADO ANTES DE METERLO AL CARRITO, y
            // no se arma aquí con lo que se acaba de teclear: el carrito
            // necesita la ficha ENTERA —escalones, monedas activas, precios
            // fijados— para recalcular el precio al cambiar de moneda o al
            // cruzar el mínimo de mayoreo. Montarla a mano daría una línea que
            // se comporta distinto de las demás hasta recargar la pantalla.
            pendiente.current = { productId, cantidad };
            setRecarga((n) => n + 1);
          }}
        />
      ) : null}
    </div>
  );
}

// UNA TARJETA, NO UNA FILA — frame `1389:8329`, 2026-10-18.
//
// La foto ocupa la tarjeta entera y el texto va encima, sobre un degradado que
// baja a `#272727`. Eso NO es decoración: el nombre y el precio van en blanco y
// una foto clara los dejaría ilegibles. El degradado es lo que garantiza el
// contraste pase lo que pase en la imagen, que es la razón de que esté en el
// frame y de que no se pueda quitar «porque se ve mejor sin él».
//
// SIN FOTO, FONDO OSCURO PLANO y el mismo texto encima. La alternativa —una
// tarjeta clara con texto oscuro cuando no hay imagen— daría dos tarjetas que
// se leen distinto en la misma cuadrícula.
function TarjetaDeProducto({
  producto,
  rates,
  monedasDelLibro,
  onAbrir,
}: {
  producto: ProductoParaVenta;
  rates: BolivarRates | null;
  monedasDelLibro: PriceCurrency[];
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
  const moneda = monedas[0] ?? null;
  const precio = moneda ? precioEnMoneda(bloque, moneda, rates) : null;
  const foto = producto.photoPath ? getPublicProductPhotoUrl(producto.photoPath) : null;
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
        className="relative flex h-[180px] w-full flex-col justify-end overflow-hidden rounded-lg bg-brand-primary p-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        {foto ? (
          <Image src={foto} alt="" fill unoptimized sizes="(max-width: 448px) 50vw, 161px" className="object-cover" />
        ) : (
          <span className="absolute right-2.5 top-2.5">
            <ImageOff className="size-4 text-white/40" aria-hidden="true" />
          </span>
        )}
        {/* EL DEGRADADO SOLO CUANDO HAY FOTO: sobre el fondo plano no añade
            nada y oscurecería de más la mitad de abajo. */}
        {foto ? (
          <span
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-b from-transparent from-25% to-[#272727] to-[65%]"
          />
        ) : null}

        <span className="relative flex flex-col gap-1 pr-10">
          {/* DOS LÍNEAS COMO MUCHO. El frame enseña «Nombre del producto»
              partido en dos; con tres, el precio se saldría de la tarjeta. */}
          <span className="line-clamp-2 text-base font-semibold text-brand-secondary">
            {producto.name}
          </span>
          <span className="flex items-center gap-1 text-xs text-brand-secondary">
            {moneda ? <CurrencyFlagIcon currency={moneda} className="size-3.5" /> : null}
            {precio != null && moneda ? formatPriceAmount(precio, moneda) : "Sin precio"}
            {escalon === "wholesale" ? " · al mayor" : ""}
          </span>
        </span>

        {/* EL CUADRO DEL «+» es parte de la tarjeta y no un botón aparte: toda
            la tarjeta agrega, y esto le dice al ojo qué pasa al tocarla. Un
            segundo botón dentro de un botón no es maquetable y además daría dos
            blancos para la misma acción. */}
        <span
          aria-hidden="true"
          className="absolute bottom-2.5 right-2.5 flex size-8 items-center justify-center rounded-sm bg-brand-primary"
        >
          <Plus className="size-6 text-brand-secondary" />
        </span>
      </button>
    </li>
  );
}

// ── 3/4 ────────────────────────────────────────────────────────────────
function PasoCarrito({
  lineas,
  rates,
  monedasDelLibro,
  onCambiar,
  onSeguirComprando,
  onIrAPago,
}: {
  lineas: LineaVenta[];
  rates: BolivarRates | null;
  monedasDelLibro: PriceCurrency[];
  onCambiar: (l: LineaVenta[]) => void;
  onSeguirComprando: () => void;
  onIrAPago: () => void;
}) {
  if (lineas.length === 0) {
    return (
      <div className="flex flex-1 flex-col gap-4">
        <div className="rounded-xl border border-dashed px-6 py-12 text-center">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Todavía no has agregado nada.
          </p>
        </div>
        <div className="flex-1" />
        <Button type="button" variant="outline" className="h-10 w-full" onClick={onSeguirComprando}>
          Elegir productos
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      {lineas.map((l, i) => (
        <TarjetaDeLinea
          key={`${l.productId}-${l.currency}`}
          linea={l}
          rates={rates}
          monedasDelLibro={monedasDelLibro}
          onCantidad={(q) => onCambiar(lineas.map((x, j) => (j === i ? { ...x, quantity: q } : x)))}
          onMoneda={(c) => onCambiar(lineas.map((x, j) => (j === i ? { ...x, currency: c } : x)))}
          onQuitar={() => onCambiar(lineas.filter((_, j) => j !== i))}
        />
      ))}

      <div className="flex-1" />

      {/* EL TOTAL NO SALE EN EL FRAME, y no se añade: cada línea ya enseña su
          subtotal con su bandera, y la pantalla de pago abre con una tarjeta
          por moneda y su total. Ponerlo aquí además sería la misma cifra dicha
          dos veces, y la primera —sin el contexto del cobro— no decide nada. */}
      <Button type="button" className="h-10 w-full" onClick={onIrAPago}>
        <Banknote className="size-6" aria-hidden="true" />
        Ir a pago
      </Button>
    </div>
  );
}

// UNA LÍNEA DEL CARRITO — frame `1389:8379`.
function TarjetaDeLinea({
  linea,
  rates,
  monedasDelLibro,
  onCantidad,
  onMoneda,
  onQuitar,
}: {
  linea: LineaVenta;
  rates: BolivarRates | null;
  monedasDelLibro: PriceCurrency[];
  onCantidad: (q: number) => void;
  onMoneda: (c: PriceCurrency) => void;
  onQuitar: () => void;
}) {
  const [eligiendoMoneda, setEligiendoMoneda] = useState(false);

  // EL ESCALÓN SE DECIDE POR LA CANTIDAD, en cada render. Subir de 5 a 6
  // unidades puede cruzar el mínimo del mayoreo y bajar el precio unitario: si
  // esto se calculara una vez al agregar, el carrito cobraría el precio de
  // detal por una cantidad de mayoreo.
  const escalon = escalonParaCantidad(linea.producto, linea.quantity);
  const bloque = escalon === "wholesale" ? linea.producto.wholesale : linea.producto.retail;
  const minimo = cantidadMinima(linea.producto);
  const foto = linea.photoPath ? getPublicProductPhotoUrl(linea.photoPath) : null;
  const unitario = precioEnMoneda(bloque, linea.currency, rates);

  // LAS MONEDAS CON SU SUBTOTAL, que es lo que la hoja enseña. Cada cifra sale
  // de `precioEnMoneda` para SU moneda y no de convertir la primera, y eso es
  // lo que respeta un precio fijado a mano: un producto con 10 $ y 9 € escritos
  // por el tendero tiene que enseñar 9 €, no los 9,20 que daría la tasa.
  const opciones = monedasDelBloque(bloque, rates)
    .filter((c) => monedasDelLibro.includes(c))
    .map((c) => ({ currency: c, precio: precioEnMoneda(bloque, c, rates) }))
    .filter((o): o is { currency: PriceCurrency; precio: number } => o.precio != null)
    .map((o) => ({
      currency: o.currency,
      subtotal: Math.round(o.precio * linea.quantity * 100) / 100,
    }));

  return (
    <div className="flex flex-col gap-3 rounded-[10px] border p-2.5">
      <div className="flex items-center gap-2">
        <span className="relative size-12 shrink-0 overflow-hidden bg-muted">
          {foto ? (
            <Image src={foto} alt="" fill unoptimized sizes="48px" className="object-cover" />
          ) : (
            <span className="flex h-full items-center justify-center">
              <ImageOff className="size-4 text-muted-foreground" aria-hidden="true" />
            </span>
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-base leading-6 font-semibold">{linea.name}</span>
          {escalon === "wholesale" ? (
            <span className="text-xs text-muted-foreground">precio al mayor</span>
          ) : null}
        </span>

        {/* EL «−» EN EL MÍNIMO QUITA LA LÍNEA, y es la única salida del carrito:
            el frame no dibuja papelera, y sin una, un producto tocado por error
            se queda dentro para siempre. Bajar de uno es, en la cabeza del
            tendero, quitarlo — así que el icono cambia a una papelera para que
            nadie lo pulse creyendo que resta. */}
        <span className="flex shrink-0 items-start gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-10 rounded-xl"
            aria-label={linea.quantity <= minimo ? `Quitar ${linea.name}` : "Quitar uno"}
            onClick={() => (linea.quantity <= minimo ? onQuitar() : onCantidad(linea.quantity - 1))}
          >
            {linea.quantity <= minimo ? (
              <Trash2 className="size-4" aria-hidden="true" />
            ) : (
              <Minus className="size-4" aria-hidden="true" />
            )}
          </Button>
          <span className="flex size-10 items-center justify-center rounded-xl border text-base font-semibold tabular-nums">
            {formatCantidad(linea.quantity)}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-10 rounded-xl"
            aria-label="Agregar uno"
            onClick={() => onCantidad(linea.quantity + 1)}
          >
            <Plus className="size-4" aria-hidden="true" />
          </Button>
        </span>
      </div>

      <div className="flex items-center justify-between gap-2 p-2">
        <span className="text-sm">Subtotal</span>
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate text-sm tabular-nums">
            {unitario != null ? formatPriceAmount(unitario * linea.quantity, linea.currency) : "—"}
          </span>
          <CurrencyFlagIcon currency={linea.currency} className="size-4 shrink-0" />
        </span>
        {/* «CAMBIAR» ABRE LA HOJA CON LAS EQUIVALENCIAS, que es lo que el dueño
            pidió el 2026-10-18: la pregunta real no es «¿dólares o euros?», es
            «¿cuánto le cobro en cada uno?». Antes esto era un `select` nativo
            que solo listaba nombres.

            NO SE PINTA CON UNA SOLA MONEDA: un control que abre una hoja con
            una única opción ya marcada no cambia nada y hace dudar de si faltan
            precios. Pasa de verdad en un negocio colombiano, donde el libro es
            pesos y nada más. */}
        {opciones.length > 1 ? (
          <Button
            type="button"
            variant="ghost"
            className="h-auto shrink-0 px-1 py-1.5 text-sm font-normal"
            onClick={() => setEligiendoMoneda(true)}
          >
            Cambiar
            <ChevronRight className="size-5" aria-hidden="true" />
          </Button>
        ) : null}
      </div>

      {eligiendoMoneda ? (
        <CurrencySheet
          open
          onOpenChange={(abierto: boolean) => !abierto && setEligiendoMoneda(false)}
          opciones={opciones}
          seleccionada={linea.currency}
          onSeleccionar={onMoneda}
        />
      ) : null}
    </div>
  );
}

// ── 3/3 ────────────────────────────────────────────────────────────────
//
// EL COBRO, UNA TARJETA POR MONEDA — frame `1389:8451`.
//
// ===========================================================================
// LO QUE EL FRAME CAMBIÓ RESPECTO A LA PRIMERA VERSIÓN
//
// La construí el 2026-10-18 antes de tener este frame, con tres modos por
// moneda —«Pagó todo» / «Pagó una parte» / «Todo fiado»— y los campos abiertos
// en la propia tarjeta. El frame dice otra cosa y es mejor: cada moneda enseña
// su total y un botón **Pagar**, y lo que no se pague queda fiado al
// **Finalizar**. El tendero no clasifica la venta de antemano; cobra lo que le
// den y lo que sobre se fía solo.
//
// ===========================================================================
// LO QUE EL FRAME NO DIBUJA, Y AQUÍ ESTÁ PUESTO DE MI PARTE
//
// Dos cosas que la venta necesita y no aparecen en ningún sitio del frame:
//
// 1. QUÉ ABRE «Pagar». Aquí abre `PagoSheet`, que pide el monto, admite que
//    se lo hayan pagado en bolívares y deja una nota. Esa mecánica hace falta
//    sí o sí —es lo que `sale_payments` guarda— pero su MAQUETA es mía.
// 2. DÓNDE SE PIDEN EL PLAZO, LAS CUOTAS Y EL CLIENTE cuando algo queda
//    debiendo. Aquí se piden al pulsar «Finalizar», en `FiadoSheet`, porque es
//    el último momento en que se sabe cuánto queda — preguntarlo antes
//    obligaría a adivinar si va a haber fiado.
//
// Las dos están marcadas para que se vea qué es del frame y qué no.
type PagoRegistrado = {
  // Lo que entra en el libro de esa moneda.
  amount: number;
  // Lo que de verdad le entregaron, si fue en bolívares. Migración `022`.
  entryCurrency: "VES" | null;
  entryAmount: number | null;
  description: string;
};

type CreditoLocal = { plazo: string; cuotas: string };

function PasoPago({
  clientes,
  cliente,
  onElegirCliente,
  lineas,
  total,
  rates,
  onVolver,
}: {
  clientes: Cliente[];
  // `null` = se entró por «Fiado o venta» sin decir a quién. No se pregunta
  // hasta que haga falta — ver `FiadoSheet`.
  cliente: Elegido | null;
  onElegirCliente: (c: Elegido | null) => void;
  lineas: LineaVenta[];
  total: { currency: PriceCurrency; amount: number }[];
  rates: BolivarRates | null;
  onVolver: () => void;
}) {
  const router = useRouter();
  const [pagos, setPagos] = useState<Partial<Record<PriceCurrency, PagoRegistrado>>>({});
  const [cobrando, setCobrando] = useState<PriceCurrency | null>(null);
  const [finalizando, setFinalizando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // LO PAGADO Y LO QUE QUEDA, por moneda. Se calcula en el render y no se
  // guarda aparte: un total derivado que vive por su cuenta es un total que
  // algún día se queda viejo.
  const cuentas = total.map((t) => {
    const pago = pagos[t.currency] ?? null;
    const pagado = pago?.amount ?? 0;
    return { ...t, pago, pagado, resto: Math.round((t.amount - pagado) * 100) / 100 };
  });

  const hayFiado = cuentas.some((c) => c.resto > 0.005);

  // EL TOTAL EN BOLÍVARES es la primera tarjeta del frame, y SOLO existe
  // teniendo tasa — o sea, en un negocio venezolano.
  //
  // SUMA MONEDAS DISTINTAS, y conviene decir por qué aquí sí: lo que esta app
  // nunca suma son los SALDOS de un cliente, porque cinco dólares y tres euros
  // son dos deudas independientes que se cobran por separado. Esto es otra
  // cosa — es lo que cuesta esta cesta, hoy, si se pagara entera en efectivo —
  // y es una referencia para el que está cobrando, no un saldo que se guarde.
  // No se escribe en ninguna parte.
  const totalEnBolivares = rates
    ? cuentas.reduce(
        (acc, c) => acc + c.amount * (c.currency === "EUR" ? rates.eur : rates.usd),
        0,
      )
    : null;

  const enBolivares = (monto: number, moneda: PriceCurrency) =>
    rates ? monto * (moneda === "EUR" ? rates.eur : rates.usd) : null;

  async function guardar(credito: Partial<Record<PriceCurrency, CreditoLocal>>) {
    setError(null);
    setGuardando(true);

    // ── A NOMBRE DE QUIÉN QUEDA ESTA VENTA ──────────────────────────
    //
    // `sales.client_id` es `not null` y la RLS de `movements` deriva el dueño
    // ENTERAMENTE a través del cliente, así que no hay venta sin uno. Lo que
    // sí hay es una venta sin cliente CON NOMBRE: el mostrador existe para
    // eso, y se resuelve AL GUARDAR y no al entrar — crear la fila al abrir la
    // pantalla le pondría un cliente «Mostrador» en la lista a cualquiera que
    // solo mire el catálogo.
    let destino = cliente;
    if (!destino) {
      const r = await resolverMostrador();
      if ("error" in r) {
        setError(r.error);
        setGuardando(false);
        return;
      }
      destino = { ...r, esMostrador: true };
      onElegirCliente(destino);
    }

    const resultado = await registrarVenta({
      clientId: destino.id,
      lineas: lineas.map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
        currency: l.currency,
      })),
      pagos: cuentas
        .filter((c) => c.pagado > 0)
        .map((c) => ({
          currency: c.currency,
          amount: c.pagado,
          entryCurrency: c.pago?.entryCurrency ?? c.currency,
          entryAmount: c.pago?.entryAmount ?? null,
          description: c.pago?.description ?? "",
        })),
      credito: cuentas
        .filter((c) => c.resto > 0.005)
        .map((c) => {
          const k = credito[c.currency];
          const plazo = k?.plazo ?? "";
          return {
            currency: c.currency,
            // «Sin especificar» es una respuesta válida y se manda como null:
            // el fiado manual la admite desde siempre.
            plazoDias:
              plazo && plazo !== "sin_especificar" && Number.isFinite(Number(plazo))
                ? Number(plazo)
                : null,
            // Una sola cuota va como null: es lo mismo, y el `check` de la
            // migración `118` empieza en 2.
            cuotas: Number(k?.cuotas ?? "1") > 1 ? Number(k?.cuotas) : null,
          };
        }),
    });

    if (!resultado.ok) {
      setError(resultado.error);
      setGuardando(false);
      return;
    }

    // A LA FICHA DEL CLIENTE, que es donde el fiado se ve y se cobra. Para una
    // venta de mostrador no hay ficha que valga —el comodín no se visita— así
    // que vuelve al panel.
    router.push(destino.esMostrador ? "/dashboard" : `/clients/${destino.id}`);
  }

  return (
    <div className="flex flex-1 flex-col gap-2">
      {/* TOTAL EN BOLÍVARES — la primera tarjeta del frame. Sin botón: no se
          cobra en bolívares como libro propio, se cobra en dólares o en euros
          y se anota lo que de verdad entregaron. Esta cifra es para que el
          tendero sepa qué pedir. */}
      {totalEnBolivares != null ? (
        <div className="flex items-center justify-between gap-3 rounded-[10px] border px-4 py-2">
          <span className="text-sm">Total en Bolívares</span>
          <span className="flex items-center gap-1">
            <CurrencyFlagIcon currency="VES" className="size-4" />
            <span className="text-base font-semibold tabular-nums">
              {formatPriceAmount(totalEnBolivares, "VES")}
            </span>
          </span>
        </div>
      ) : null}

      {cuentas.map((c) => {
        const bs = enBolivares(c.amount, c.currency);
        return (
          <div key={c.currency} className="flex items-center gap-3 rounded-[10px] border px-4 py-2">
            <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
              <span className="text-sm">Total en {NOMBRE[c.currency] ?? c.currency}</span>
              <span className="flex items-center gap-1">
                <CurrencyFlagIcon currency={c.currency} className="size-4 shrink-0" />
                <span className="text-base font-semibold tabular-nums">
                  {formatPriceAmount(c.amount, c.currency)}
                </span>
              </span>
              {bs != null ? (
                <span className="pl-5 text-xs text-muted-foreground tabular-nums">
                  {formatPriceAmount(bs, "VES")}
                </span>
              ) : null}

              {/* LO YA COBRADO Y LO QUE QUEDA. No está en el frame —ahí las
                  tarjetas sólo tienen el total— pero sin esto el tendero pulsa
                  «Pagar», vuelve, y la pantalla está idéntica: no hay forma de
                  saber si el cobro se registró. */}
              {c.pagado > 0 ? (
                <span className="text-xs tabular-nums">
                  <span className="text-money-in">
                    Cobrado {formatPriceAmount(c.pagado, c.currency)}
                  </span>
                  {c.resto > 0.005 ? (
                    <span className="text-destructive">
                      {" "}
                      · queda {formatPriceAmount(c.resto, c.currency)}
                    </span>
                  ) : null}
                </span>
              ) : null}
            </div>

            <Button
              type="button"
              variant="outline"
              className="h-10 shrink-0"
              onClick={() => setCobrando(c.currency)}
            >
              {c.pagado > 0 ? "Cambiar" : "Pagar"}
            </Button>
          </div>
        );
      })}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex-1" />
      <Button
        type="button"
        className="h-10 w-full"
        disabled={guardando}
        onClick={() => {
          // CON TODO COBRADO SE GUARDA DIRECTO. La hoja del fiado sólo tiene
          // sentido cuando queda algo debiendo: abrirla para decir «no debe
          // nada» sería un paso que no decide nada.
          if (hayFiado) setFinalizando(true);
          else void guardar({});
        }}
      >
        {guardando ? "Guardando…" : "Finalizar"}
      </Button>
      <Button
        type="button"
        variant="outline"
        className="h-10 w-full"
        disabled={guardando}
        onClick={onVolver}
      >
        Volver al carrito
      </Button>

      {cobrando ? (
        <PagoSheet
          key={cobrando}
          open
          onOpenChange={(abierto: boolean) => !abierto && setCobrando(null)}
          moneda={cobrando}
          total={cuentas.find((c) => c.currency === cobrando)?.amount ?? 0}
          rates={rates}
          inicial={pagos[cobrando] ?? null}
          onGuardar={(p) => {
            setPagos((xs) => ({ ...xs, [cobrando]: p }));
            setCobrando(null);
          }}
          onQuitar={() => {
            setPagos((xs) => {
              const copia = { ...xs };
              delete copia[cobrando];
              return copia;
            });
            setCobrando(null);
          }}
        />
      ) : null}

      {finalizando ? (
        <FiadoSheet
          open
          onOpenChange={(abierto: boolean) => !abierto && setFinalizando(false)}
          restos={cuentas.filter((c) => c.resto > 0.005).map((c) => ({ currency: c.currency, amount: c.resto }))}
          clientes={clientes}
          cliente={cliente}
          onElegirCliente={onElegirCliente}
          guardando={guardando}
          onConfirmar={(credito) => void guardar(credito)}
        />
      ) : null}
    </div>
  );
}

// ── «PAGAR» ────────────────────────────────────────────────────────────
//
// SU MAQUETA ES MÍA: el frame `1389:8451` dibuja el botón y no lo que abre.
// Lo que sí es del dominio y no se inventa es qué se pregunta — `sale_payments`
// guarda el monto en el libro, lo que de verdad entregaron y la tasa.
function PagoSheet({
  open,
  onOpenChange,
  moneda,
  total,
  rates,
  inicial,
  onGuardar,
  onQuitar,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  moneda: PriceCurrency;
  total: number;
  rates: BolivarRates | null;
  inicial: PagoRegistrado | null;
  onGuardar: (p: PagoRegistrado) => void;
  onQuitar: () => void;
}) {
  // ARRANCA CON EL TOTAL PUESTO, que es el caso corriente: le pagan todo. Quien
  // reciba menos lo corrige, y eso es una tecla menos para la mayoría.
  const [monto, setMonto] = useState(
    inicial ? formatAmountForInput(inicial.amount) : formatAmountForInput(total),
  );
  const [enBolivares, setEnBolivares] = useState(inicial?.entryCurrency === "VES");
  const [montoBs, setMontoBs] = useState(
    inicial?.entryAmount != null ? formatAmountForInput(inicial.entryAmount) : "",
  );
  const [descripcion, setDescripcion] = useState(inicial?.description ?? "");

  const cantidad = parseAmount(monto) ?? 0;
  const bs = parseAmount(montoBs) ?? 0;
  const tasa = rates ? (moneda === "EUR" ? rates.eur : rates.usd) : null;
  const deMas = cantidad - total > 0.005;
  const listo = cantidad > 0 && !deMas && (!enBolivares || bs > 0);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto rounded-t-xl">
        <SheetHeader>
          <SheetTitle className="text-base font-medium">
            Cobrar en {NOMBRE[moneda] ?? moneda}
          </SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 pb-6">
          <div className="flex items-center justify-between gap-3 rounded-[10px] border px-4 py-2">
            <span className="text-sm">Total de la venta</span>
            <span className="text-base font-semibold tabular-nums">
              {formatPriceAmount(total, moneda)}
            </span>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="pago-monto">¿Cuánto te pagó?</Label>
            <Input
              id="pago-monto"
              inputMode="decimal"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              placeholder="0,00"
            />
            {/* MÁS DE LO QUE SUMA LA VENTA NO ES UN COBRO, es un error de
                tecleo. El servidor lo rechaza igual; decirlo aquí evita montar
                la venta entera para que falle al guardar. */}
            {deMas ? (
              <p className="text-xs text-destructive">
                No puedes cobrar más de {formatPriceAmount(total, moneda)}.
              </p>
            ) : null}
          </div>

          {/* LOS BOLÍVARES SOLO CUANDO HAY TASA. Se guarda lo que de verdad
              entregaron —migración `022`— y el monto del libro sigue siendo el
              de arriba: el servidor sella la tasa pero NO divide una cifra por
              la otra, porque eso convertía una venta pagada completa en un
              fiado de un céntimo. */}
          {tasa ? (
            <div className="flex flex-col gap-2 border-t pt-4">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={enBolivares}
                  onCheckedChange={(v) => setEnBolivares(v === true)}
                />
                Me pagó en bolívares
              </label>
              {enBolivares ? (
                <>
                  <Input
                    inputMode="decimal"
                    placeholder="0,00"
                    aria-label="Bolívares recibidos"
                    value={montoBs}
                    onChange={(e) => setMontoBs(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {formatPriceAmount(cantidad, moneda)} a la tasa de hoy son{" "}
                    {formatPriceAmount(cantidad * tasa, "VES")}
                  </p>
                </>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-col gap-1">
            <Label htmlFor="pago-nota">Nota (opcional)</Label>
            <Input
              id="pago-nota"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Pago móvil, efectivo…"
            />
          </div>

          <Button
            type="button"
            className="h-10 w-full"
            disabled={!listo}
            onClick={() =>
              onGuardar({
                amount: Math.round(cantidad * 100) / 100,
                entryCurrency: enBolivares ? "VES" : null,
                entryAmount: enBolivares ? bs : null,
                description: descripcion.trim(),
              })
            }
          >
            Guardar cobro
          </Button>
          {inicial ? (
            <Button type="button" variant="outline" className="h-10 w-full" onClick={onQuitar}>
              Quitar este cobro
            </Button>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── LO QUE QUEDA DEBIENDO ──────────────────────────────────────────────
//
// TAMPOCO ESTÁ EN EL FRAME, y hace falta: un fiado sin plazo ni dueño no se
// puede cobrar después. Se pregunta al pulsar «Finalizar» porque es el último
// momento en que se sabe cuánto queda — antes habría que adivinar si va a
// haber fiado, que es justo lo que el frame del paso 3 quitó de en medio.
function FiadoSheet({
  open,
  onOpenChange,
  restos,
  clientes,
  cliente,
  onElegirCliente,
  guardando,
  onConfirmar,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restos: { currency: PriceCurrency; amount: number }[];
  clientes: Cliente[];
  cliente: Elegido | null;
  onElegirCliente: (c: Elegido | null) => void;
  guardando: boolean;
  onConfirmar: (credito: Partial<Record<PriceCurrency, CreditoLocal>>) => void;
}) {
  const [credito, setCredito] = useState<Partial<Record<PriceCurrency, CreditoLocal>>>({});
  const de = (c: PriceCurrency) => credito[c] ?? { plazo: DEFAULT_PLAZO_PAGO, cuotas: "1" };
  const cambiar = (c: PriceCurrency, parche: Partial<CreditoLocal>) =>
    setCredito((xs) => ({ ...xs, [c]: { ...de(c), ...parche } }));

  const plazoDias = (c: PriceCurrency) => {
    const p = de(c).plazo;
    return p && p !== "sin_especificar" && Number.isFinite(Number(p)) ? Number(p) : null;
  };
  // Sólo bloquea el campo vacío de «Otro plazo…», no «Sin especificar»: esa es
  // una respuesta, y un fiado sin fecha es lo que el fiado manual ya permite.
  const faltaPlazo = restos.some((r) => de(r.currency).plazo === "");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto rounded-t-xl">
        <SheetHeader>
          <SheetTitle className="text-base font-medium">Lo que queda fiado</SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 pb-6">
          {restos.map((r) => (
            <div key={r.currency} className="flex flex-col gap-3 rounded-[10px] border p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1 text-sm">
                  <CurrencyFlagIcon currency={r.currency} className="size-4" />
                  {NOMBRE[r.currency] ?? r.currency}
                </span>
                <span className="text-base font-semibold tabular-nums text-destructive">
                  {formatPriceAmount(r.amount, r.currency)}
                </span>
              </div>
              <PlazoPagoSelect
                value={de(r.currency).plazo}
                onValueChange={(v) =>
                  cambiar(r.currency, {
                    plazo: v,
                    // Al quedarse sin plazo, las cuotas vuelven a pago único:
                    // el campo se esconde y un número dentro se guardaría sin
                    // que nadie lo haya decidido.
                    ...(v === "" || v === "sin_especificar" ? { cuotas: "1" } : {}),
                  })
                }
              />
              <CuotasSelect
                value={de(r.currency).cuotas}
                onValueChange={(v) => cambiar(r.currency, { cuotas: v })}
                plazoDias={plazoDias(r.currency)}
              />
            </div>
          ))}

          {/* EL CLIENTE, AQUÍ Y NO ANTES. Una venta de contado no necesita
              ninguno; sólo al fiar hace falta saber a quién cobrarle. */}
          <div className="flex flex-col gap-3 rounded-[10px] border p-4">
            <p className="text-sm font-medium">¿A quién le queda debiendo?</p>
            <SelectorDeCliente
              clientes={clientes}
              cliente={cliente}
              onElegir={onElegirCliente}
              // SIN MOSTRADOR: al comodín no se le puede fiar —es uno por
              // negocio, así que su deuda sería la de «todos los que pasaron
              // por la caja»— y ofrecerlo sería ofrecer lo que el servidor
              // rechaza.
              sinMostrador
            />
          </div>

          {faltaPlazo ? (
            <p className="text-sm text-destructive">
              Elige en cuánto tiempo te pagan lo que queda.
            </p>
          ) : null}

          <Button
            type="button"
            className="h-10 w-full"
            disabled={guardando || !cliente || faltaPlazo}
            onClick={() => onConfirmar(credito)}
          >
            {guardando ? "Guardando…" : cliente ? `Fiar a ${cliente.name}` : "Elige un cliente"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

const NOMBRE: Partial<Record<PriceCurrency, string>> = {
  USD: "Dólares",
  EUR: "Euros",
  COP: "Pesos",
};

// UNA LÍNEA MÁS, O UNA UNIDAD MÁS DE LA MISMA. La identidad de una línea es
// el producto Y SU MONEDA: el mismo producto cobrado en dólares y en euros
// son dos líneas, que es justo lo que el carrito del sitemap dibuja con dos
// banderas distintas.
function agregar(lineas: LineaVenta[], nueva: LineaVenta): LineaVenta[] {
  const i = lineas.findIndex((l) => l.productId === nueva.productId && l.currency === nueva.currency);
  if (i === -1) return [...lineas, nueva];
  return lineas.map((l, j) => (j === i ? { ...l, quantity: l.quantity + nueva.quantity } : l));
}

// UN TOTAL POR MONEDA, nunca uno solo. Sumar dólares con euros exigiría una
// tasa, y el resultado sería un número que el tendero no puede cobrar: el
// cliente paga en cada moneda lo suyo. Es la misma forma que tiene la
// pantalla de Pago del sitemap.
function totalesPorMoneda(
  lineas: LineaVenta[],
  rates: BolivarRates | null,
): { currency: PriceCurrency; amount: number }[] {
  const porMoneda = new Map<PriceCurrency, number>();
  for (const l of lineas) {
    const escalon = escalonParaCantidad(l.producto, l.quantity);
    const bloque = escalon === "wholesale" ? l.producto.wholesale : l.producto.retail;
    const unitario = precioEnMoneda(bloque, l.currency, rates);
    if (unitario == null) continue;
    porMoneda.set(l.currency, (porMoneda.get(l.currency) ?? 0) + unitario * l.quantity);
  }
  return [...porMoneda.entries()].map(([currency, amount]) => ({
    currency,
    amount: Math.round(amount * 100) / 100,
  }));
}
