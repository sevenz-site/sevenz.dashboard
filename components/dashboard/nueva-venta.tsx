"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronRight, ImageOff, Minus, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/dashboard/client-search-sheet";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { getPublicProductPhotoUrl } from "@/lib/supabase/storage";
import {
  buscarProductosParaVenta,
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
import { formatPriceAmount, type BolivarRates, type PriceCurrency } from "@/lib/products/price";
import { formatCantidad } from "@/lib/products/cantidad";

// EL ASISTENTE DE UNA VENTA — sitemap `1269:6051`, encargo del dueño del
// 2026-10-17.
//
// Cuatro pasos: cliente, producto, carrito y pago. Esta entrega cubre los
// TRES PRIMEROS y deja el cuarto marcado como lo que es, sin construir. Está
// dicho en pantalla y no solo aquí: un botón que promete lo que no hace es
// peor que un botón ausente, y eso ya costó una ficha hoy (`CT-92`).
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

export function NuevaVenta({
  cliente,
  esMostrador,
}: {
  cliente: Cliente;
  // La venta de mostrador apunta al cliente comodín del negocio. La pantalla
  // lo dice para que el tendero no crea que le está fiando a alguien.
  esMostrador: boolean;
}) {
  const router = useRouter();
  const [paso, setPaso] = useState<1 | 2 | 3 | 4>(1);
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
        <PasoCliente cliente={cliente} esMostrador={esMostrador} onContinuar={() => setPaso(2)} />
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

      {paso === 4 ? <PasoPagoSinConstruir total={total} onVolver={() => setPaso(3)} /> : null}
    </div>
  );
}

// ── 1/4 ────────────────────────────────────────────────────────────────
function PasoCliente({
  cliente,
  esMostrador,
  onContinuar,
}: {
  cliente: Cliente;
  esMostrador: boolean;
  onContinuar: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-col gap-1 rounded-xl border p-4">
        <p className="text-xs text-muted-foreground">
          {esMostrador ? "Venta de mostrador" : "Le vendes a"}
        </p>
        <p className="text-lg font-semibold">{cliente.name}</p>
        {esMostrador ? (
          // LO QUE ESTO SIGNIFICA, DICHO AQUÍ Y NO EN UNA AYUDA: una venta de
          // mostrador no se le puede fiar a nadie, porque no hay a quién
          // cobrarle después. Enterarse de eso en el paso 4, con el cliente
          // delante, sería tarde.
          <p className="pt-1 text-xs leading-relaxed text-muted-foreground">
            No queda a nombre de ningún cliente, así que esta venta se cobra completa. Si vas a
            fiar, vuelve y elige a la persona.
          </p>
        ) : null}
      </div>
      <div className="flex-1" />
      <Button type="button" className="h-12 w-full" onClick={onContinuar}>
        Continuar
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

// ── 4/4, todavía no ────────────────────────────────────────────────────
function PasoPagoSinConstruir({
  total,
  onVolver,
}: {
  total: { currency: PriceCurrency; amount: number }[];
  onVolver: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-xl border p-4">
        {total.map((t) => (
          <div key={t.currency} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-sm">
              <CurrencyFlagIcon currency={t.currency} className="size-4" />
              Total en {NOMBRE[t.currency] ?? t.currency}
            </span>
            <span className="text-base font-semibold tabular-nums">
              {formatPriceAmount(t.amount, t.currency)}
            </span>
          </div>
        ))}
      </div>

      {/* SE DICE QUE NO ESTÁ, en vez de poner un botón apagado que prometa lo
          que no hace. Es la lección de `CT-92` del mismo día: un control
          muerto en la pantalla del dinero se lee como app rota. */}
      <div className="rounded-xl border border-dashed p-4">
        <p className="text-sm leading-relaxed text-muted-foreground">
          El cobro todavía no está construido. Esta venta no se ha guardado: nada se ha cobrado y
          ningún saldo ha cambiado.
        </p>
      </div>

      <div className="flex-1" />
      <Button type="button" variant="outline" className="h-12 w-full" onClick={onVolver}>
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
