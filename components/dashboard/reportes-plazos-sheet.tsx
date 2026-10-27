"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ChipDeEstado } from "@/components/dashboard/chip-de-estado";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { EmptyState } from "@/components/dashboard/empty-state";
import { SearchField } from "@/components/dashboard/client-search-sheet";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { formatPriceAmount, type PriceCurrency } from "@/lib/products/price";
import { MALA_PAGA_BADGE_CLASS } from "@/lib/types";
import type { ClavePlazo, ClienteDePlazo } from "@/lib/reports/facturacion";

// ═══════════════════════════════════════════════════════════════════════
// LAS CUATRO HOJAS DE «PLAZOS DE PAGO»
//
// Frames `1667:20645` (Por vencer), `1667:21438` (Plazo vencido),
// `1667:21230` (Críticos) y `1667:21622` (Malas pagas). Encargo del dueño el
// 2026-10-27: *«Al seleccionar las siguientes cards mostrarás su información
// en componentes sheets»*.
//
// ───────────────────────────────────────────────────────────────────────
// ANTES ESTO ERA UN ENLACE A LA LISTA DE CLIENTES FILTRADA
//
// Y era una decisión, no un atajo: lo escribí el 2026-10-27 porque la lista de
// Clientes ya es esa pantalla --mismo chip, mismo criterio, mismo buscador-- y
// duplicarla abre un segundo sitio donde el estado puede divergir.
//
// LO QUE LA DESPLAZA es que el dueño pidió hojas, y su frame las dibuja con
// título, subtítulo y buscador propios. LO QUE NO CAMBIA es de dónde sale el
// estado: estas filas las arma `estadoDeCliente`, el mismo juez que pinta el
// chip en Clientes. La hoja es otra ventana al mismo dato, no un segundo
// cálculo.
//
// `?estado=` SE QUEDA en `client-filters.tsx` aunque ya nadie lo enlace desde
// aquí: es una URL válida que alguien puede tener guardada, y quitarla rompería
// un enlace sin avisar.
//
// ───────────────────────────────────────────────────────────────────────
// EL SUBTÍTULO DE «CRÍTICOS» NO SE INVENTA
//
// Su frame lo deja escrito como `<Agregar descripción de lo que define a un
// cliente en estado crítico>`. La definición YA EXISTE en el repo, en
// `CLIENT_STATUS_DESCRIPTION.critico`: «Debe hace más de 30 días sin abonar».
// Se usa esa y no una frase nueva, porque es la que el resto de la app ya le
// enseña al tendero -- dos definiciones del mismo chip serían dos verdades.
// ═══════════════════════════════════════════════════════════════════════

const TITULO: Record<ClavePlazo, string> = {
  porVencer: "Plazos por vencer",
  vencido: "Plazo vencido",
  criticos: "Críticos",
  malasPagas: "Malas pagas",
  sinPlazo: "Sin plazo",
};

const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function fecha(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MES[d.getMonth()]}. ${d.getFullYear()}`;
}

function diasDesde(iso: string, ahora: Date): number {
  return Math.floor((ahora.getTime() - new Date(iso).getTime()) / 86_400_000);
}

/**
 * La línea de debajo del nombre, que es distinta en cada hoja -- y así la
 * dibujan los cuatro frames:
 *
 *   · Por vencer   -> «Vence: 12 nov. 2026»
 *   · Vencido      -> «Venció: 2 oct. 2026, hace 25 días»
 *   · Críticos     -> igual que vencido
 *   · Malas pagas  -> «Debe: $120,00», porque la marca no habla de plazos y
 *                     un cliente marcado puede no tener ninguno
 */
function subtitulo(c: ClienteDePlazo, clave: ClavePlazo, ahora: Date): string {
  if (clave === "malasPagas") {
    // EL FRAME ESCRIBE «Debe: $00.00» AQUÍ Y REPITE EL IMPORTE A LA DERECHA.
    // En pantalla se leía «Debe: €500,00 … €500,00», dos veces la misma cifra
    // en una fila de cuatro datos. Se deja solo la de la derecha, que es donde
    // está en las otras tres hojas y donde el ojo ya la busca.
    //
    // LO QUE SE PIERDE es la palabra «Debe», que en esa hoja decía algo: un
    // cliente marcado puede no tener plazo ninguno. Lo recoge el chip «Mala
    // paga» de al lado, que es lo que de verdad distingue esa lista.
    return c.venceEl
      ? `Venció: ${fecha(c.venceEl)}`
      : "Sin plazo pactado";
  }
  if (!c.venceEl) return "Sin plazo pactado";
  if (clave === "porVencer") return `Vence: ${fecha(c.venceEl)}`;
  const d = diasDesde(c.venceEl, ahora);
  return `Venció: ${fecha(c.venceEl)}${d > 0 ? `, hace ${d} ${d === 1 ? "día" : "días"}` : ""}`;
}

export function PlazosSheet({
  clave,
  clientes,
  children,
}: {
  clave: ClavePlazo;
  clientes: ClienteDePlazo[];
  /** La tarjeta que abre la hoja. */
  children: React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  // SE CONGELA AL ABRIR, no en cada render: `new Date()` dentro del cuerpo
  // haría que «hace 25 días» se recalculara en cada tecla del buscador. No
  // cambiaría el número, pero sí es trabajo por nada en una lista larga.
  const [ahora] = useState(() => new Date());

  const visibles = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clientes;
    // `toLowerCase().includes()`, lo mismo que el catálogo y la lista de
    // clientes. No se "mejora" aquí con normalización de acentos: el día que
    // el tendero busque «jose» y le salga en una pantalla y no en otra, nadie
    // va a sospechar de dos funciones de búsqueda distintas.
    return clientes.filter((c) => c.nombre.toLowerCase().includes(q));
  }, [clientes, query]);

  return (
    <Sheet>
      <SheetTrigger asChild>{children}</SheetTrigger>
      {/* `max-h-[90svh]` Y NO `vh`: `vh` mide el viewport GRANDE --el que
          habría sin la barra del navegador-- así que en un teléfono con la
          barra a la vista ese porcentaje es más alto que la pantalla. Es el
          mismo problema del `100vh` que `CLAUDE.md` nombra para iPhone. */}
      <SheetContent side="bottom" className="flex max-h-[90svh] flex-col rounded-t-xl">
        <SheetHeader>
          <SheetTitle>{TITULO[clave]}</SheetTitle>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-6">
          <p className="text-sm text-muted-foreground">
            {clave === "criticos"
              ? "Debe hace más de 30 días sin abonar."
              : "Selecciona un cliente."}
          </p>

          {/* EL BUSCADOR SOLO SI HAY A QUIÉN BUSCAR. Con tres filas ocupa más
              de lo que ahorra, y con cero deja una hoja que pide filtrar una
              lista vacía. */}
          {clientes.length > 5 ? (
            <SearchField value={query} onChange={setQuery} placeholder="Buscar cliente" />
          ) : null}

          {visibles.length === 0 ? (
            <EmptyState
              title={query.trim() ? `No encontramos a «${query.trim()}»` : "Nadie por aquí"}
              subtitle={
                query.trim() ? "Revisa el nombre." : "Ningún cliente está en este estado ahora."
              }
            />
          ) : (
            // LA LISTA SE DESPLAZA DENTRO DE LA HOJA, no la hoja entera: con
            // cuarenta clientes el título y el buscador tienen que quedarse a
            // la vista mientras se baja.
            <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
              {visibles.map((c) => (
                <li key={c.clientId}>
                  <Link
                    href={`/clients/${c.clientId}`}
                    className="flex items-center gap-3 rounded-[10px] border px-3 py-2.5 transition-colors active:bg-accent"
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="truncate text-sm font-medium">{c.nombre}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {subtitulo(c, clave, ahora)}
                      </span>
                      {/* DOS CHIPS CUANDO HACE FALTA, igual que la lista de
                          clientes: «mala paga» es una MARCA y no un estado --
                          `CLAUDE.md` lo deja escrito, y por eso tiene su
                          propia paleta--. Un cliente marcado que además lleva
                          dos meses vencido es las dos cosas, y esconder una
                          cambia a quién se cobra primero. */}
                      <span className="flex flex-wrap items-center gap-1">
                        <ChipDeEstado estado={c.status} />
                        {c.marcado ? (
                          <Badge variant="outline" className={MALA_PAGA_BADGE_CLASS}>
                            Mala paga
                          </Badge>
                        ) : null}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-sm tabular-nums">
                      {formatPriceAmount(c.monto, c.libro as PriceCurrency)}
                      <CurrencyFlagIcon currency={c.libro as PriceCurrency} />
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
