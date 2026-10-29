"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ChevronRight, ImageOff } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { EmptyState } from "@/components/dashboard/empty-state";
import { SearchField } from "@/components/dashboard/client-search-sheet";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { getPublicProductPhotoUrl } from "@/lib/supabase/storage";
import { formatBs } from "@/lib/exchange-rate/format";
import { formatCantidad } from "@/lib/products/cantidad";
import { CLIENT_STATUS_BADGE_CLASS } from "@/lib/types";
import type { ProductoDeHoja } from "@/lib/reports/inventario";
import { esMonedaConocida, formatDinero, type Dinero } from "@/lib/reports/ganancia";

// ═══════════════════════════════════════════════════════════════════════
// LA HOJA DE UNA TARJETA DE INVENTARIO — frames `1673:22429`,
// `1748:14380` y `1673:22895`
//
// Encargo del dueño el 2026-10-28: *«les falta el botón "Ver más", al
// seleccionar esos botones deben abrir sheet con los productos acordes a cada
// card. Mismo patrón de las sheets que se abren desde las cards en el tab
// "Facturación"»*.
//
// UNA SOLA HOJA PARA LAS TRES, y para la de cada proveedor. Los cuatro frames
// dibujan la misma tarjeta de producto; cuatro copias de ella se separan en
// cuanto alguien retoca una, que es la razón escrita en `order-line-stepper`
// para reusar el «−» del carrito en vez de copiar sus clases.
//
// ───────────────────────────────────────────────────────────────────────
// EL RÓTULO ES «VER TODO» Y NO «VER MÁS»
//
// Él escribió «Ver más» en el encargo, y los frames --`1667:19350` y sus dos
// hermanas-- dibujan «Ver todo», que además es lo que ya dicen las cuatro
// tarjetas de Facturación a las que él mismo mandó parecerse. Dos rótulos
// para el mismo gesto en la misma pantalla se leen como dos cosas distintas.
//
// ───────────────────────────────────────────────────────────────────────
// LA FRANJA DE LA IZQUIERDA: `border-l-4`, NO LA CAJA DOBLE
//
// El frame la dibuja como `client-card.tsx`: una caja exterior con 4px de
// trazo SOLO a la izquierda y una interior blanca. Esa forma tiene una
// trampa ya documentada ahí --*«un `border-left: 4px` junto a un
// `border-top: 0` no puede doblar el radio (…) la franja termina en punta y
// por el hueco se ve el fondo»*-- y su arreglo es relleno + padding con dos
// cajas.
//
// AQUÍ SE USA LA OTRA FORMA, la que ya usa `reportes-facturacion.tsx` en esta
// misma pantalla: borde en los cuatro lados y el izquierdo más grueso. La
// trampa no aplica --no hay un lado con grosor cero del que degradar-- y
// evita meter una segunda caja en una tarjeta que no la necesita.
//
// ───────────────────────────────────────────────────────────────────────
// LOS CHIPS SALEN DE LA PALETA QUE YA EXISTE
//
// Verde `a_favor` para «Disponible», rojo `critico` para «Agotado». Los
// hexadecimales del frame (#fff2f2 / #c40003) no se copian, por la razón que
// `chip-de-estado.tsx` dejó escrita: *«SE IMPORTAN LAS CLASES, NO SE COPIAN
// LOS VALORES (…) aquí había tres hexadecimales escritos a mano con sus
// contrastes medidos al lado, todo correcto por separado y desalineado del
// resto de la app»*.
// ═══════════════════════════════════════════════════════════════════════

/** Una tarjeta de dinero de la cabecera de la hoja. */
export type TarjetaDeDinero = {
  rotulo: string;
  dinero: Dinero;
  /** La segunda línea, bajo un separador. Solo la hoja de «Disponibles». */
  extra?: { rotulo: string; dinero: Dinero | null };
};

// ═══════════════════════════════════════════════════════════════════════
// EL SUBTÍTULO DICE CÓMO SE CALCULA LA GANANCIA
//
// Encargo del dueño el 2026-10-28, con la captura de «Por agotarse» y el
// hueco rodeado en rojo: *«agrega descripción de como se calcula la ganancia
// de cada producto que se menciona en su card»*.
//
// POR QUÉ ESTA FRASE Y NO OTRA: «$672,00 de ganancia» es una cifra que el
// tendero no puede rehacer de cabeza. Podría ser lo que ganaría vendiendo lo
// que le queda, lo que ganó por unidad, o lo que ganó de verdad -- las tres
// son lecturas razonables, y de hecho fueron las tres opciones entre las que
// él eligió. Sin la frase, cada quien elige una distinta.
//
// EL TEXTO ES SUYO, PALABRA POR PALABRA, y lo dictó el 2026-10-29. Sustituye
// al que yo había escrito, que llevaba las fechas del periodo («lo que te
// dejó del 30 sep al 29 oct»).
//
// LO QUE SE PIERDE AL QUITARLAS, dicho para que conste y no para discutirlo:
// la frase ya no dice DE CUÁNDO es esa ganancia, así que la cifra no se puede
// contrastar contra nada sin mirar el selector de fechas de la cabecera. Sigue
// siendo del periodo elegido; simplemente la frase ya no lo repite.
export function ReportesProductosSheet({
  titulo,
  encabezado,
  tarjetas,
  productos,
  vacio,
  tasas,
  children,
}: {
  titulo: string;
  /** La banda gris bajo el buscador. Solo la dibuja «Productos disponibles». */
  encabezado?: { titulo: string; sub: string };
  tarjetas: TarjetaDeDinero[];
  productos: ProductoDeHoja[];
  /** Qué decir cuando la lista está vacía. */
  vacio: { titulo: string; sub: string };
  /** Bs por dólar y por euro, para la línea pequeña. `null` en Colombia. */
  tasas: { usd: number; eur: number } | null;
  /** La tarjeta que abre la hoja. */
  children: React.ReactNode;
}) {
  const [query, setQuery] = useState("");

  const visibles = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return productos;
    // `toLowerCase().includes()`, igual que el catálogo, la lista de clientes
    // y la hoja de plazos. No se "mejora" aquí: dos búsquedas distintas en la
    // misma app es un fallo que nadie atribuye a la búsqueda.
    return productos.filter((p) => p.nombre.toLowerCase().includes(q));
  }, [productos, query]);

  return (
    <Sheet>
      <SheetTrigger asChild>{children}</SheetTrigger>
      {/* `max-h-[90svh]` Y NO `vh`: `vh` mide el viewport GRANDE --el que
          habría sin la barra del navegador-- así que en un teléfono con la
          barra a la vista ese porcentaje es más alto que la pantalla. */}
      <SheetContent side="bottom" className="flex max-h-[90svh] flex-col rounded-t-xl">
        <SheetHeader>
          <SheetTitle>{titulo}</SheetTitle>
          {/* VA EN LA CABECERA Y NO EN EL CUERPO para que se quede quieto
              cuando la lista se desplaza: explica lo que se está mirando, así
              que irse de pantalla al tercer producto es justo cuando deja de
              servir. */}
          <p className="text-sm font-normal text-muted-foreground">
            La ganancia es la diferencia entre el precio de venta menos el precio de costo
            multiplicado por las unidades que vendiste
          </p>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-6">
          {/* EL BUSCADOR SOLO SI HAY A QUIÉN BUSCAR, con el mismo corte que
              `reportes-plazos-sheet.tsx`: *«con tres filas ocupa más de lo que
              ahorra, y con cero deja una hoja que pide filtrar una lista
              vacía»*. El frame lo dibuja siempre; esa decisión es de la misma
              pantalla y de la misma semana, así que manda. */}
          {productos.length > 5 ? (
            <SearchField value={query} onChange={setQuery} placeholder="Buscar producto" />
          ) : null}

          {encabezado ? (
            // `-mx-4 px-4` PARA QUE LA BANDA LLEGUE A LOS BORDES, como el
            // frame: su contenedor mide los 370 enteros, no los 338 del
            // contenido.
            <div className="-mx-4 flex flex-col gap-0.5 bg-muted/50 px-4 py-3">
              <p className="text-base font-medium">{encabezado.titulo}</p>
              <p className="text-sm text-muted-foreground">{encabezado.sub}</p>
            </div>
          ) : null}

          {tarjetas.length ? (
            <div className="flex gap-3">
              {tarjetas.map((t) => (
                <TarjetaDinero key={`${t.rotulo}-${t.dinero.currency}`} t={t} tasas={tasas} />
              ))}
            </div>
          ) : null}

          {visibles.length === 0 ? (
            query.trim() ? (
              // EL BUSCADOR NO ENCONTRÓ NADA. No vale el texto de «no hay
              // productos aquí»: la lista tiene productos y lo que falla es
              // el nombre escrito.
              <EmptyState
                title={`No encontramos «${query.trim()}»`}
                subtitle="Revisa el nombre del producto."
              />
            ) : (
              <EmptyState title={vacio.titulo} subtitle={vacio.sub} />
            )
          ) : (
            // LA LISTA SE DESPLAZA DENTRO DE LA HOJA, no la hoja entera: con
            // veinte productos el título y el buscador se quedan a la vista.
            <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
              {visibles.map((p) => (
                <li key={p.id}>
                  <FilaDeProducto p={p} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function TarjetaDinero({
  t,
  tasas,
}: {
  t: TarjetaDeDinero;
  tasas: { usd: number; eur: number } | null;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1 rounded-[10px] border p-3">
      <span className="truncate text-xs text-muted-foreground">{t.rotulo}</span>
      <Importe d={t.dinero} grande />
      <LineaEnBs d={t.dinero} tasas={tasas} />
      {t.extra ? (
        <>
          <span className="my-1 h-px bg-border" aria-hidden />
          <span className="text-xs text-muted-foreground">{t.extra.rotulo}</span>
          {t.extra.dinero ? (
            <Importe d={t.extra.dinero} />
          ) : (
            // «—» Y NO «$0,00»: sin precio de detal escrito no se proyecta
            // nada, y un cero ahí diría que vender el inventario no da dinero.
            <span className="text-sm text-muted-foreground">—</span>
          )}
        </>
      ) : null}
    </div>
  );
}

function Importe({ d, grande = false }: { d: Dinero; grande?: boolean }) {
  return (
    <span
      className={`flex items-center gap-1.5 ${grande ? "text-2xl leading-8" : "text-sm"} tabular-nums`}
    >
      {/* LA BANDERA SOLO SI EXISTE. Con una moneda libre --«pesos
          argentinos»-- `FLAG_SRC` da `undefined` y `next/image` pinta un
          `<img>` sin `src`, que su propia cabecera describe como el fallo que
          hace al navegador recargar la página entera. */}
      {esMonedaConocida(d.currency) ? (
        <CurrencyFlagIcon currency={d.currency} className="size-4 shrink-0" />
      ) : null}
      <span className="min-w-0 break-all">{formatDinero(d)}</span>
    </span>
  );
}

/**
 * La línea «Bs. 000.000.000» del frame.
 *
 * NO SE DIBUJA SIN TASA, en vez de salir en cero. Un negocio colombiano no
 * tiene bolívares, y uno venezolano con el BCV caído tampoco tiene una cifra
 * que enseñar -- `Bs. 0,00` sería un dato falso con pinta de dato, que es
 * exactamente lo que la tarjeta de «Referencias agotadas» ya evita no
 * dibujando su chip de dinero.
 */
function LineaEnBs({
  d,
  tasas,
}: {
  d: Dinero;
  tasas: { usd: number; eur: number } | null;
}) {
  if (!tasas) return null;
  const tasa = d.currency === "USD" ? tasas.usd : d.currency === "EUR" ? tasas.eur : null;
  if (tasa == null || !(tasa > 0)) return null;
  return (
    <span className="truncate text-xs text-muted-foreground tabular-nums">
      {formatBs(d.amount * tasa)}
    </span>
  );
}

function FilaDeProducto({ p }: { p: ProductoDeHoja }) {
  const foto = p.fotoPath ? getPublicProductPhotoUrl(p.fotoPath) : null;
  // TRES ESTADOS Y NO DOS. «Sin cantidad anotada» es gris y no rojo a
  // propósito: el rojo dice «no te queda», que es una afirmación sobre la
  // estantería; aquí lo que falta es el DATO, y confundirlos manda al tendero
  // a reponer algo que a lo mejor tiene de sobra.
  const sinContar = p.cantidad == null;
  const agotado = !sinContar && (p.cantidad as number) <= 0;

  return (
    <Link
      href={`/productos/${p.id}`}
      className="flex items-center gap-3 rounded-[10px] border border-l-4 border-l-foreground p-2 transition-colors active:bg-accent"
    >
      {/* `unoptimized` ES OBLIGATORIO. Sin él `next/image` exige el dominio de
          Supabase en `next.config.ts` y, como no está, LANZA al pintar: no
          sale una foto rota, se cae la pantalla entera. Pasó el 2026-10-28 en
          `reportes-aviso-sheet.tsx`. */}
      <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
        {foto ? (
          <Image src={foto} alt="" width={48} height={48} unoptimized className="size-12 object-cover" />
        ) : (
          <ImageOff className="size-5 text-muted-foreground" aria-hidden />
        )}
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-semibold">{p.nombre}</span>
        {p.ganancia ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
            {esMonedaConocida(p.ganancia.currency) ? (
              <CurrencyFlagIcon currency={p.ganancia.currency} className="size-3.5 shrink-0" />
            ) : null}
            <span className="truncate">{formatDinero(p.ganancia)} de ganancia</span>
          </span>
        ) : (
          // SE DICE POR QUÉ NO HAY CIFRA, y no se deja la línea en blanco ni
          // se escribe «$0,00 de ganancia», que sería afirmar que no dejó
          // nada. Las causas están en `ganancia.ts`: sin costo escrito, costo
          // en moneda «Otra», o sin tasa para cruzar las dos monedas.
          <span className="truncate text-xs text-muted-foreground">Sin ganancia calculable</span>
        )}
        <span
          className={`inline-flex w-fit shrink-0 items-center whitespace-nowrap rounded-full border px-1.5 py-px text-xs leading-4 ${
            sinContar
              ? CLIENT_STATUS_BADGE_CLASS.sin_deuda
              : agotado
                ? CLIENT_STATUS_BADGE_CLASS.critico
                : CLIENT_STATUS_BADGE_CLASS.a_favor
          }`}
        >
          {sinContar
            ? "Sin cantidad anotada"
            : agotado
              ? "Agotado"
              : `Disponible: ${formatCantidad(p.cantidad as number)}`}
        </span>
      </span>

      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}
