"use client";

import { createContext, useContext, useState } from "react";
import Link from "next/link";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import {
  ClientFilterChips,
  useClientFilters,
  type ClientFilterState,
} from "@/components/dashboard/client-filters";
import type { OwnerRateContext } from "@/lib/exchange-rate/owner-rate";
import type { ClientSummary } from "@/lib/types";

// El buscador de clientes de toda la app.
//
// POR QUÉ HAY UN CONTEXTO Y NO SOLO UN COMPONENTE. En Cartera el campo de
// búsqueda va arriba del todo y la lista que filtra está al final de la
// pantalla, con las tarjetas de capital y la tira de tasas en medio. Son dos
// puntos lejanos del documento que tienen que compartir un mismo estado, y la
// página es un Server Component: no puede sostener un hook.
//
// La alternativa —dos buscadores independientes— deja al dueño mirando una
// lista filtrada de una manera y un buscador que dice otra. Un solo estado en
// contexto es lo que impide esa contradicción.
//
// EL ESTADO SIGUE SIENDO EL DE SIEMPRE: `useClientFilters`, el mismo que ya
// usan las cuatro pantallas. Aquí no se filtra nada nuevo; solo cambia dónde
// se toca.

// El estado completo, no solo la parte que pinta los controles: la tabla y la
// vista previa necesitan además `sortedRows` y `judgementBalance`.
export type SharedClientFilters = ReturnType<typeof useClientFilters<ClientSummary>>;

const FilterContext = createContext<SharedClientFilters | null>(null);

export function useSharedClientFilters() {
  return useContext(FilterContext);
}

// Cerrar la hoja viaja por contexto, NO como prop.
//
// La versión anterior pasaba `children` como funcion `(close) => ...` para que
// la vista previa pudiera cerrarse al abrir un cliente. Compila y revienta en
// ejecución: Cartera es un Server Component y React no puede serializar una
// función a través de esa frontera — "Functions are not valid as a child of
// Client Component", un 500 en la pantalla principal. El typecheck no lo ve
// porque no es un error de tipos.
const CloseContext = createContext<() => void>(() => {});

export function useCloseSearchSheet() {
  return useContext(CloseContext);
}

// El proveedor llama al hook él mismo, no lo recibe hecho. Cartera es un
// Server Component: no puede sostener estado, así que si el hook viviera
// fuera no habría dónde ponerlo. Envolviendo la pantalla entera, el buscador
// de arriba y la lista del final comparten uno solo.
export function ClientFilterProvider({
  rows,
  rateContext,
  children,
}: {
  rows: ClientSummary[];
  rateContext: OwnerRateContext | null;
  children: React.ReactNode;
}) {
  const filters = useClientFilters(rows, rateContext);
  return <FilterContext.Provider value={filters}>{children}</FilterContext.Provider>;
}

// Lo que el dueño ve cerrado: una caja que parece un campo y no lo es.
//
// No es un <Input> real a propósito. Un input de verdad aquí abriría el
// teclado del teléfono ANTES de que exista la hoja, y el navegador acabaría
// recolocando las dos cosas a destiempo — el mismo problema que la calculadora
// ya resolvió y que su comentario documenta.
function TriggerBox({ value, placeholder }: { value: string; placeholder: string }) {
  return (
    <div className="flex h-10 w-full cursor-pointer items-center justify-between gap-2 rounded-lg border bg-background px-3 text-sm">
      <span className={value ? "truncate" : "truncate text-muted-foreground"}>
        {value || placeholder}
      </span>
      <Search className="size-4 shrink-0 text-muted-foreground" />
    </div>
  );
}

export function ClientSearchSheet({
  filters: filtersProp,
  placeholder = "Buscar cliente",
  verTodosHref,
  children,
}: {
  // Opcional: si no llega, se toma del contexto. Así el disparador se puede
  // poner en cualquier punto de la página sin volver a pasar el estado.
  filters?: ClientFilterState;
  placeholder?: string;
  // Cuando existe, la hoja ofrece salir a la lista completa. Cartera lo usa
  // para mandar a /clients; en /clients no tiene sentido y no se pasa.
  verTodosHref?: string;
  // Vista previa de la lista ya filtrada, opcional. La pinta quien llama, no
  // este componente: cada pantalla enseña sus filas a su manera —Papelera con
  // el saldo del día que se ocultó, por ejemplo— y duplicarlo aquí sería una
  // segunda verdad sobre el mismo dinero.
  //
  // Se omite cuando la lista que se filtra está justo detrás de la hoja: ahí
  // cerrarla ya enseña el resultado. Cartera sí la pasa, porque su lista está
  // al final de la pantalla y obligar a cerrar y bajar sería peor.
  //
  // Lo que se pinte aquí puede cerrar la hoja con `useCloseSearchSheet()`:
  // abrir un cliente desde la vista previa tiene que cerrarla, o quedaría
  // montada encima de la ficha que el dueño acaba de abrir.
  children?: React.ReactNode;
}) {
  const fromContext = useSharedClientFilters();
  const filters = filtersProp ?? fromContext;
  const isMobile = useIsMobile();
  const { inset: keyboardInset, visibleHeight } = useKeyboardInset();
  const [open, setOpen] = useState(false);

  // Sin estado de filtros no hay nada que buscar. Devolver null en vez de
  // reventar: un disparador montado fuera del proveedor es un error de
  // montaje, no algo que deba tumbar la pantalla del dueño.
  if (!filters) return null;

  const c = filters.controls;

  const body = (
    <CloseContext.Provider value={() => setOpen(false)}>
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4">
      <div className="relative">
        <Input
          autoFocus
          value={c.nameQuery}
          onChange={(e) => c.setNameQuery(e.target.value)}
          placeholder="Escribe nombre o documento"
          className="pr-9"
        />
        {c.nameQuery ? (
          <button
            type="button"
            onClick={() => c.setNameQuery("")}
            aria-label="Borrar búsqueda"
            className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        ) : (
          <Search className="absolute top-1/2 right-3 -translate-y-1/2 size-4 text-muted-foreground" />
        )}
      </div>

      <ClientFilterChips filters={filters} />

      {children ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium text-muted-foreground">Clientes</h3>
            {verTodosHref ? (
              <Link
                href={verTodosHref}
                onClick={() => setOpen(false)}
                className="text-sm font-medium underline underline-offset-4"
              >
                Ver todos
              </Link>
            ) : null}
          </div>
          {children}
        </>
      ) : null}
    </div>
    </CloseContext.Provider>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <button type="button" className="w-full text-left" aria-label={placeholder}>
            <TriggerBox value={c.nameQuery} placeholder={placeholder} />
          </button>
        </SheetTrigger>
        {/* Las mismas medidas que la calculadora, y por el mismo motivo: una
            hoja anclada a `bottom-0` vive en un viewport que no encoge cuando
            sube el teclado, así que se levanta por lo que el teclado tapa y se
            limita a lo que de verdad se ve. Aquí importa más todavía, porque
            el campo tiene autoFocus y el teclado sube solo. */}
        <SheetContent
          side="bottom"
          className="max-h-[90dvh] rounded-t-xl"
          style={{
            bottom: keyboardInset || undefined,
            maxHeight: visibleHeight ? Math.round(visibleHeight * 0.9) : undefined,
          }}
        >
          <SheetHeader className="pb-0">
            <SheetTitle>Buscar cliente</SheetTitle>
          </SheetHeader>
          {body}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="w-full text-left sm:max-w-sm" aria-label={placeholder}>
          <TriggerBox value={c.nameQuery} placeholder={placeholder} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex max-h-[70vh] w-[--radix-popover-trigger-width] min-w-sm flex-col p-0 pt-4">
        {body}
      </PopoverContent>
    </Popover>
  );
}
