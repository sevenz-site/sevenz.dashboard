"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ChevronRight, ImageOff, Minus, Plus, Store, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SearchField } from "@/components/dashboard/client-search-sheet";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
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
import { formatPriceAmount, parseAmount, type BolivarRates, type PriceCurrency } from "@/lib/products/price";
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
}: {
  // La lista del buscador del paso 1, sin el mostrador: se elige con su propio
  // botón y no buscándolo por nombre.
  clientes: Cliente[];
  // Ya resuelto cuando se entra desde la ficha de un cliente (`?cliente=`).
  // `null` = se entró por «Agregar» de Inicio y hay que elegir.
  inicial: Elegido | null;
}) {
  const router = useRouter();
  const [paso, setPaso] = useState<1 | 2 | 3 | 4>(1);
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
          onClick={() => (paso === 1 ? router.back() : setPaso((p) => (p - 1) as 1 | 2 | 3))}
        >
          <ArrowLeft className="size-5" aria-hidden="true" />
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Nueva venta</h1>
        <p className="text-sm text-muted-foreground">
          {paso}/4 {["Información del cliente", "Producto", "Carrito", "Pago"][paso - 1]}
        </p>
        {/* LA BARRA DE PROGRESO del sitemap. `aria-hidden` porque la línea de
            arriba ya dice «2/4 Producto» con palabras: repetirlo en el lector
            de pantalla sería ruido, no accesibilidad. */}
        <div aria-hidden="true" className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-foreground transition-all" style={{ width: `${paso * 25}%` }} />
        </div>
      </div>

      {paso === 1 ? (
        <PasoCliente
          clientes={clientes}
          cliente={cliente}
          onElegir={setCliente}
          onContinuar={() => setPaso(2)}
        />
      ) : null}

      {paso === 2 ? (
        <PasoProducto
          catalogo={catalogo}
          onCatalogo={setCatalogo}
          lineas={lineas}
          onAgregar={(l) => setLineas((xs) => agregar(xs, l))}
          onIrAlCarrito={() => setPaso(3)}
        />
      ) : null}

      {paso === 3 ? (
        <PasoCarrito
          lineas={lineas}
          rates={catalogo?.rates ?? null}
          monedasDelLibro={catalogo?.monedasDelLibro ?? []}
          total={total}
          onCambiar={setLineas}
          onSeguirComprando={() => setPaso(2)}
          onIrAPago={() => setPaso(4)}
        />
      ) : null}

      {/* LOS PASOS 2 A 4 NO EXISTEN SIN CLIENTE. No puede pasar —al paso 2 solo
          se llega desde el 1, que exige elegir— pero escrito así el tipo lo
          garantiza en vez de obligar a un `!` que el día que cambie el flujo
          dejaría pasar un `undefined` a la acción que escribe la deuda. */}
      {paso === 4 && cliente ? (
        <PasoPago
          clienteId={cliente.id}
          nombreCliente={cliente.name}
          esMostrador={cliente.esMostrador}
          lineas={lineas}
          total={total}
          rates={catalogo?.rates ?? null}
          onVolver={() => setPaso(3)}
        />
      ) : null}
    </div>
  );
}

// ── 1/4 ────────────────────────────────────────────────────────────────
// A QUIÉN LE VENDE. Dos estados en la misma pantalla: elegir, y ya elegido.
//
// SE ENTRA POR AQUÍ DESDE EL «AGREGAR» DE INICIO (2026-10-18). Antes este paso
// solo informaba de un cliente que ya venía resuelto en la URL, y sin ese
// parámetro la venta caía siempre en el mostrador — así que «Todo fiado» era
// **inalcanzable** entrando desde el panel, y el propio paso decía «vuelve y
// elige a la persona» sin que hubiera nada atrás a lo que volver.
function PasoCliente({
  clientes,
  cliente,
  onElegir,
  onContinuar,
}: {
  clientes: Cliente[];
  cliente: Elegido | null;
  onElegir: (c: Elegido | null) => void;
  onContinuar: () => void;
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
        <div className="flex-1" />
        <Button type="button" className="h-12 w-full" onClick={onContinuar}>
          Continuar
        </Button>
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

      <div className="flex-1" />

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
        <Link href="/dashboard?nuevo=1">
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
}: {
  catalogo: ProductosParaVenta | null;
  onCatalogo: (c: ProductosParaVenta) => void;
  lineas: LineaVenta[];
  onAgregar: (l: LineaVenta) => void;
  onIrAlCarrito: () => void;
}) {
  const [query, setQuery] = useState("");
  const [cargando, setCargando] = useState(false);
  const [buscado, setBuscado] = useState(false);

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
    }, 250);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const enElCarrito = lineas.reduce((n, l) => n + l.quantity, 0);

  return (
    <div className="flex flex-1 flex-col gap-4">
      <SearchField value={query} onChange={setQuery} placeholder="Buscar producto" />

      {catalogo && catalogo.productos.length === 0 && buscado && !cargando ? (
        <div className="rounded-xl border border-dashed px-6 py-10 text-center">
          <p className="text-sm leading-relaxed text-muted-foreground">
            {query.trim() === ""
              ? "Todavía no tienes productos en tu catálogo."
              : `No encontramos nada con «${query.trim()}».`}
          </p>
        </div>
      ) : null}

      <ul className="flex flex-col gap-2">
        {(catalogo?.productos ?? []).map((p) => (
          <FilaDeProducto
            key={p.id}
            producto={p}
            rates={catalogo?.rates ?? null}
            monedasDelLibro={catalogo?.monedasDelLibro ?? []}
            onAgregar={onAgregar}
          />
        ))}
      </ul>

      <div className="flex-1" />
      {enElCarrito > 0 ? (
        <Button type="button" className="h-12 w-full" onClick={onIrAlCarrito}>
          Ver carrito ({formatCantidad(enElCarrito)})
        </Button>
      ) : null}
    </div>
  );
}

function FilaDeProducto({
  producto,
  rates,
  monedasDelLibro,
  onAgregar,
}: {
  producto: ProductoParaVenta;
  rates: BolivarRates | null;
  monedasDelLibro: PriceCurrency[];
  onAgregar: (l: LineaVenta) => void;
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

  return (
    <li>
      <button
        type="button"
        // SIN PRECIO NO SE PUEDE VENDER, y el botón lo dice apagándose en vez
        // de dejar meter al carrito una línea que luego no se puede cobrar.
        disabled={precio == null || moneda == null}
        onClick={() => {
          if (precio == null || moneda == null) return;
          onAgregar({
            productId: producto.id,
            name: producto.name,
            unit: producto.unit,
            photoPath: producto.photoPath,
            producto: producto.producto,
            quantity: minimo,
            currency: moneda,
          });
        }}
        className="flex w-full items-center gap-3 rounded-xl border p-3 text-left outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        <span className="relative size-12 shrink-0 overflow-hidden rounded-lg bg-muted">
          {foto ? (
            <Image src={foto} alt="" fill unoptimized sizes="48px" className="object-cover" />
          ) : (
            <span className="flex h-full items-center justify-center">
              <ImageOff className="size-4 text-muted-foreground" aria-hidden="true" />
            </span>
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{producto.name}</span>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            {moneda ? <CurrencyFlagIcon currency={moneda} className="size-3.5" /> : null}
            {precio != null && moneda ? formatPriceAmount(precio, moneda) : "Sin precio"}
            {escalon === "wholesale" ? " · al mayor" : ""}
          </span>
        </span>
        <Plus className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
    </li>
  );
}

// ── 3/4 ────────────────────────────────────────────────────────────────
function PasoCarrito({
  lineas,
  rates,
  monedasDelLibro,
  total,
  onCambiar,
  onSeguirComprando,
  onIrAPago,
}: {
  lineas: LineaVenta[];
  rates: BolivarRates | null;
  monedasDelLibro: PriceCurrency[];
  total: { currency: PriceCurrency; amount: number }[];
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
        <Button type="button" variant="outline" className="h-12 w-full" onClick={onSeguirComprando}>
          Elegir productos
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-3">
      {lineas.map((l, i) => (
        <TarjetaDeLinea
          key={`${l.productId}-${l.currency}`}
          linea={l}
          rates={rates}
          monedasDelLibro={monedasDelLibro}
          onCantidad={(q) =>
            onCambiar(lineas.map((x, j) => (j === i ? { ...x, quantity: q } : x)))
          }
          onMoneda={(c) => onCambiar(lineas.map((x, j) => (j === i ? { ...x, currency: c } : x)))}
          onQuitar={() => onCambiar(lineas.filter((_, j) => j !== i))}
        />
      ))}

      <div className="flex flex-col gap-1 rounded-xl border p-4">
        {total.map((t) => (
          <div key={t.currency} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-sm">
              <CurrencyFlagIcon currency={t.currency} className="size-4" />
              Total
            </span>
            <span className="text-base font-semibold tabular-nums">
              {formatPriceAmount(t.amount, t.currency)}
            </span>
          </div>
        ))}
      </div>

      <div className="flex-1" />
      <Button type="button" variant="outline" className="h-12 w-full" onClick={onSeguirComprando}>
        Agregar más productos
      </Button>
      <Button type="button" className="h-12 w-full" onClick={onIrAPago}>
        Ir a pago
      </Button>
    </div>
  );
}

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
  // EL ESCALÓN SE DECIDE POR LA CANTIDAD, en cada render. Subir de 5 a 6
  // unidades puede cruzar el mínimo del mayoreo y bajar el precio unitario:
  // si esto se calculara una vez al agregar, el carrito cobraría el precio de
  // detal por una cantidad de mayoreo.
  const escalon = escalonParaCantidad(linea.producto, linea.quantity);
  const bloque = escalon === "wholesale" ? linea.producto.wholesale : linea.producto.retail;
  const monedas = monedasDelBloque(bloque, rates).filter((c) => monedasDelLibro.includes(c));
  const unitario = precioEnMoneda(bloque, linea.currency, rates);
  const minimo = cantidadMinima(linea.producto);
  const foto = linea.photoPath ? getPublicProductPhotoUrl(linea.photoPath) : null;

  return (
    <div className="flex flex-col gap-3 rounded-xl border p-3">
      <div className="flex items-center gap-3">
        <span className="relative size-12 shrink-0 overflow-hidden rounded-lg bg-muted">
          {foto ? (
            <Image src={foto} alt="" fill unoptimized sizes="48px" className="object-cover" />
          ) : (
            <span className="flex h-full items-center justify-center">
              <ImageOff className="size-4 text-muted-foreground" aria-hidden="true" />
            </span>
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{linea.name}</span>
          {escalon === "wholesale" ? (
            <span className="text-xs text-muted-foreground">precio al mayor</span>
          ) : null}
        </span>
        <Button type="button" variant="ghost" size="icon" aria-label={`Quitar ${linea.name}`} onClick={onQuitar}>
          <Trash2 className="size-4" aria-hidden="true" />
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-10 shrink-0"
          aria-label="Quitar uno"
          disabled={linea.quantity <= minimo}
          onClick={() => onCantidad(Math.max(minimo, linea.quantity - 1))}
        >
          <Minus className="size-4" aria-hidden="true" />
        </Button>
        <span className="w-12 text-center text-base tabular-nums">{formatCantidad(linea.quantity)}</span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-10 shrink-0"
          aria-label="Agregar uno"
          onClick={() => onCantidad(linea.quantity + 1)}
        >
          <Plus className="size-4" aria-hidden="true" />
        </Button>

        <span className="flex-1" />

        <span className="text-right text-sm tabular-nums">
          {unitario != null ? formatPriceAmount(unitario * linea.quantity, linea.currency) : "—"}
        </span>
      </div>

      {/* «CAMBIAR» — la moneda de ESTA línea, que es lo que el sitemap pide.
          Un `select` nativo y no una hoja: en un teléfono abre la rueda del
          sistema, que es más rápida de usar con una mano y no hay que
          construirla. El precio se recalcula solo porque sale de
          `precioEnMoneda` arriba — ver `CT-101`. */}
      <div className="flex items-center justify-between gap-2 border-t pt-3">
        <span className="text-xs text-muted-foreground">Cobrar en</span>
        <span className="flex items-center gap-2">
          <CurrencyFlagIcon currency={linea.currency} className="size-4" />
          <select
            value={linea.currency}
            onChange={(e) => onMoneda(e.target.value as PriceCurrency)}
            aria-label={`Moneda de ${linea.name}`}
            className="h-9 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {monedas.map((c) => (
              <option key={c} value={c}>
                {NOMBRE[c] ?? c}
              </option>
            ))}
          </select>
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
        </span>
      </div>
    </div>
  );
}

// ── 4/4 ────────────────────────────────────────────────────────────────
//
// EL COBRO, UNA TARJETA POR MONEDA. Va por moneda y no una vez para toda la
// venta porque los libros no se suman: un carrito con cinco dólares y tres
// euros son DOS cuentas, y el cliente puede pagar una entera y dejar la otra
// a deber. Es la misma razón por la que `recalc_client_running_balance` nunca
// mezcla `balance_usd` con `balance_eur`.
//
// TRES MODOS Y NO UN CAMPO DE MONTO SUELTO: «pagó todo», «pagó una parte» y
// «todo fiado». El tendero no piensa en montos, piensa en esas tres
// situaciones, y las dos de los extremos son las corrientes. Un campo vacío
// obligaría a teclear el total exacto en el caso más frecuente de todos.
type Modo = "todo" | "parte" | "fiado";

type Cobro = {
  modo: Modo;
  // Lo que entregó, cuando pagó una parte. Texto y no número: es lo que hay en
  // el input, y `parseAmount` ya sabe leer «1.234,56» y «1234.56».
  monto: string;
  enBolivares: boolean;
  montoBs: string;
  descripcion: string;
  plazo: string;
  cuotas: string;
};

const COBRO_NUEVO: Cobro = {
  modo: "todo",
  monto: "",
  enBolivares: false,
  montoBs: "",
  descripcion: "",
  plazo: DEFAULT_PLAZO_PAGO,
  cuotas: "1",
};

function PasoPago({
  clienteId,
  nombreCliente,
  esMostrador,
  lineas,
  total,
  rates,
  onVolver,
}: {
  clienteId: string;
  nombreCliente: string;
  esMostrador: boolean;
  lineas: LineaVenta[];
  total: { currency: PriceCurrency; amount: number }[];
  rates: BolivarRates | null;
  onVolver: () => void;
}) {
  const router = useRouter();
  const [cobros, setCobros] = useState<Partial<Record<PriceCurrency, Cobro>>>({});
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cobroDe = (c: PriceCurrency) => cobros[c] ?? COBRO_NUEVO;
  const cambiar = (c: PriceCurrency, parche: Partial<Cobro>) =>
    setCobros((xs) => ({ ...xs, [c]: { ...(xs[c] ?? COBRO_NUEVO), ...parche } }));

  // LO PAGADO Y LO QUE QUEDA, por moneda. Se calcula en el render y no se
  // guarda en el estado: un total derivado que vive aparte es un total que
  // algún día se queda viejo.
  const cuentas = total.map((t) => {
    const cobro = cobroDe(t.currency);
    const tecleado = parseAmount(cobro.monto) ?? 0;
    const pagado =
      cobro.modo === "todo" ? t.amount : cobro.modo === "fiado" ? 0 : Math.min(tecleado, t.amount);
    // EL PLAZO EN DÍAS, O NULL. «Sin especificar» es una de las cinco opciones
    // de `PLAZO_PAGO_OPTIONS` y vale como respuesta: el fiado manual la admite
    // desde siempre. Pasarla tal cual como texto hacía que el servidor leyera
    // `Number("sin_especificar")` y devolviera un error de plazo por una
    // elección correcta.
    const plazoDias =
      cobro.plazo && cobro.plazo !== "sin_especificar" && Number.isFinite(Number(cobro.plazo))
        ? Number(cobro.plazo)
        : null;
    return { ...t, cobro, pagado, plazoDias, resto: Math.round((t.amount - pagado) * 100) / 100 };
  });

  const hayFiado = cuentas.some((c) => c.resto > 0);
  // Un parcial de cero no es «pagó una parte», es «todo fiado» con un campo
  // vacío. Se pide antes de guardar para que el tendero no crea que registró
  // un abono que no existe.
  const parcialSinMonto = cuentas.some((c) => c.cobro.modo === "parte" && c.pagado <= 0);
  // SOLO BLOQUEA EL CAMPO VACÍO de «Otro plazo…», no «Sin especificar»: esa es
  // una respuesta, y un fiado sin fecha es lo que el fiado manual ya permite.
  const faltaPlazo = cuentas.some((c) => c.resto > 0 && c.cobro.plazo === "");
  const bolivaresSinMonto = cuentas.some(
    (c) => c.pagado > 0 && c.cobro.enBolivares && (parseAmount(c.cobro.montoBs) ?? 0) <= 0,
  );

  async function guardar() {
    setError(null);
    setGuardando(true);
    const resultado = await registrarVenta({
      clientId: clienteId,
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
          entryCurrency: c.cobro.enBolivares ? ("VES" as const) : c.currency,
          entryAmount: c.cobro.enBolivares ? parseAmount(c.cobro.montoBs) : null,
          description: c.cobro.descripcion,
        })),
      credito: cuentas
        .filter((c) => c.resto > 0)
        .map((c) => ({
          currency: c.currency,
          plazoDias: c.plazoDias,
          // Una sola cuota se manda como null: es lo mismo y es el
          // comportamiento de siempre. El `check` de la `118` empieza en 2.
          cuotas: Number(c.cobro.cuotas) > 1 ? Number(c.cobro.cuotas) : null,
        })),
    });

    if (!resultado.ok) {
      setError(resultado.error);
      setGuardando(false);
      return;
    }

    // A LA FICHA DEL CLIENTE, que es donde el fiado se ve y se cobra. Para una
    // venta de mostrador no hay ficha que valga —el comodín no se visita— así
    // que vuelve al panel.
    router.push(esMostrador ? "/dashboard" : `/clients/${clienteId}`);
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      {cuentas.map((c) => (
        <div key={c.currency} className="flex flex-col gap-3 rounded-xl border p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-sm font-medium">
              <CurrencyFlagIcon currency={c.currency} className="size-4" />
              {NOMBRE[c.currency] ?? c.currency}
            </span>
            <span className="text-base font-semibold tabular-nums">
              {formatPriceAmount(c.amount, c.currency)}
            </span>
          </div>

          <RadioGroup
            value={c.cobro.modo}
            onValueChange={(v) => cambiar(c.currency, { modo: v as Modo })}
            className="flex flex-row flex-wrap gap-2"
          >
            {(
              [
                { value: "todo", nombre: "Pagó todo" },
                { value: "parte", nombre: "Pagó una parte" },
                { value: "fiado", nombre: "Todo fiado" },
              ] as const
            ).map((o) => (
              <label
                key={o.value}
                className={`flex h-10 items-center gap-2 rounded-full border border-border bg-background px-3.5 text-sm ${
                  o.value !== "todo" && esMostrador ? "cursor-not-allowed opacity-50" : "cursor-pointer"
                }`}
              >
                <RadioGroupItem value={o.value} disabled={o.value !== "todo" && esMostrador} />
                <span className="whitespace-nowrap">{o.nombre}</span>
              </label>
            ))}
          </RadioGroup>

          {/* EL MOSTRADOR NO PUEDE FIAR, y se explica en vez de dejar dos
              botones apagados sin motivo. El cliente comodín es UNO por
              negocio: una deuda suya sería la de «todos los que pasaron por la
              caja», y nadie podría cobrar eso. */}
          {esMostrador ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              Una venta de mostrador se cobra completa. Para dejar algo fiado, vuelve atrás y elige
              o crea un cliente.
            </p>
          ) : null}

          {c.cobro.modo === "parte" ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor={`monto-${c.currency}`}>Cuánto entregó</Label>
              <Input
                id={`monto-${c.currency}`}
                inputMode="decimal"
                placeholder="0,00"
                value={c.cobro.monto}
                onChange={(e) => cambiar(c.currency, { monto: e.target.value })}
              />
            </div>
          ) : null}

          {/* LOS BOLÍVARES SOLO CUANDO HAY TASA Y HAY ALGO QUE COBRAR. Se
              guarda lo que de verdad entregó —migración `022`— y el monto del
              libro sigue siendo el de arriba: el servidor sella la tasa pero no
              divide una cifra por la otra, porque eso convertía una venta
              pagada completa en un fiado de un céntimo. */}
          {rates && c.pagado > 0 ? (
            <div className="flex flex-col gap-2 border-t pt-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={c.cobro.enBolivares}
                  onCheckedChange={(v) => cambiar(c.currency, { enBolivares: v === true })}
                />
                Me pagó en bolívares
              </label>
              {c.cobro.enBolivares ? (
                <>
                  <Input
                    inputMode="decimal"
                    placeholder="0,00"
                    aria-label={`Bolívares recibidos por los ${NOMBRE[c.currency] ?? c.currency}`}
                    value={c.cobro.montoBs}
                    onChange={(e) => cambiar(c.currency, { montoBs: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {formatPriceAmount(c.pagado, c.currency)} a la tasa de hoy son{" "}
                    {formatPriceAmount(
                      c.pagado * (c.currency === "EUR" ? rates.eur : rates.usd),
                      "VES",
                    )}
                  </p>
                </>
              ) : null}
            </div>
          ) : null}

          {c.resto > 0 ? (
            <div className="flex flex-col gap-3 border-t pt-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm">Queda fiado</span>
                <span className="text-base font-semibold tabular-nums text-destructive">
                  {formatPriceAmount(c.resto, c.currency)}
                </span>
              </div>
              <PlazoPagoSelect
                value={c.cobro.plazo}
                onValueChange={(v) =>
                  cambiar(c.currency, {
                    plazo: v,
                    // Al quedarse sin plazo, las cuotas vuelven a pago único:
                    // el campo se esconde y un número dentro se guardaría sin
                    // que nadie lo haya decidido. Mismo motivo que en
                    // `add-movement-dialog`.
                    ...(v === "" || v === "sin_especificar" ? { cuotas: "1" } : {}),
                  })
                }
              />
              <CuotasSelect
                value={c.cobro.cuotas}
                onValueChange={(v) => cambiar(c.currency, { cuotas: v })}
                plazoDias={c.plazoDias}
              />
            </div>
          ) : null}

          {c.pagado > 0 ? (
            <div className="flex flex-col gap-2 border-t pt-3">
              <Label htmlFor={`nota-${c.currency}`}>Nota del pago (opcional)</Label>
              <Input
                id={`nota-${c.currency}`}
                placeholder="Pago móvil, efectivo…"
                value={c.cobro.descripcion}
                onChange={(e) => cambiar(c.currency, { descripcion: e.target.value })}
              />
            </div>
          ) : null}
        </div>
      ))}

      {/* UN PLAZO SIN ELEGIR ES LO ÚNICO QUE BLOQUEA DE VERDAD: las cuotas
          necesitan plazo para dividirlo, y es el `check` de la `118`. Se dice
          aquí y no al pulsar, para que el botón apagado tenga una razón
          visible al lado. */}
      {faltaPlazo ? (
        <p className="text-sm text-destructive">Elige en cuánto tiempo te pagan lo que queda fiado.</p>
      ) : null}
      {parcialSinMonto ? (
        <p className="text-sm text-destructive">Escribe cuánto te entregó, o marca «Todo fiado».</p>
      ) : null}
      {bolivaresSinMonto ? (
        <p className="text-sm text-destructive">Escribe cuántos bolívares te entregó.</p>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex-1" />
      <Button
        type="button"
        className="h-12 w-full"
        disabled={guardando || faltaPlazo || parcialSinMonto || bolivaresSinMonto}
        onClick={guardar}
      >
        {guardando
          ? "Guardando…"
          : hayFiado
            ? `Guardar venta y fiar a ${nombreCliente}`
            : "Guardar venta"}
      </Button>
      <Button
        type="button"
        variant="outline"
        className="h-12 w-full"
        disabled={guardando}
        onClick={onVolver}
      >
        Volver al carrito
      </Button>
    </div>
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
