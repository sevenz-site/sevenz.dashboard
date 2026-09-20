"use client";

import { useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import {
  ClientFilterChips,
  type ClientFilterState,
} from "@/components/dashboard/client-filters";
import {
  SearchSheetCloseProvider,
  useSharedClientFilters,
  type SharedClientFilters,
} from "@/components/dashboard/client-filter-context";
import { ClientSearchCombobox } from "@/components/dashboard/client-search-combobox";
import type { ClientSummary } from "@/lib/types";

// El buscador de clientes de toda la app, en dos formas.
//
// `ClientSearchInline` — Clientes, Malas pagas y Papelera. Campo de verdad y
// chips debajo, en la propia pantalla; la lista está justo debajo y se filtra
// a la vista. Es la forma por defecto: no hay nada que abrir ni que cerrar.
//
// `ClientSearchSheet` — SOLO Cartera. Ahí el campo va arriba del todo y la
// lista que filtra está al final, detrás de las tarjetas de capital y la tira
// de tasas. Escribir y no ver nada cambiar, porque lo que cambia está a una
// pantalla de distancia, se lee como que el buscador no funciona. Por eso
// Cartera abre una hoja que trae el resultado consigo.
//
// La diferencia es la distancia entre el campo y su lista, no el gusto: donde
// la lista se ve, un modal sobra.
//
// POR QUÉ HAY UN CONTEXTO. Esos dos puntos lejanos de Cartera tienen que
// compartir un mismo estado, y la página es un Server Component: no puede
// sostener un hook. Dos buscadores independientes dejarían al dueño con una
// lista filtrada de una manera y un buscador diciendo otra.
//
// EL ESTADO SIGUE SIENDO EL DE SIEMPRE: `useClientFilters`, el mismo que ya
// usan las cuatro pantallas. Aquí no se filtra nada nuevo; solo cambia dónde
// se toca.

// La forma por defecto: Clientes, Malas pagas y Papelera.
//
// Campo real en la propia pantalla —no un disparador— porque no hay nada que
// abrir: la lista está debajo y se filtra mientras se escribe. Los chips van
// justo debajo del campo, que es donde el dueño los busca después de escribir
// un nombre y ver demasiados resultados.
export function ClientSearchInline({
  filters: filtersProp,
  source,
  placeholder = "Buscar cliente",
  className,
}: {
  // Lo mínimo que el buscador necesita, NO `SharedClientFilters`. Ese tipo
  // fija las filas a `ClientSummary` y Papelera pasa `ClientSummaryAll`, que
  // lleva además el saldo del día en que se ocultó. Pedir de más aquí
  // dejaría fuera a la única pantalla con filas propias.
  filters?: ClientFilterState & { sortedRows: ClientSummary[] };
  source: "malas_pagas" | "clientes" | "papelera";
  placeholder?: string;
  className?: string;
}) {
  const fromContext = useSharedClientFilters();
  const filters = filtersProp ?? fromContext;
  if (!filters) return null;

  return (
    <div className={`flex flex-col gap-2 ${className ?? ""}`}>
      <ClientSearchCombobox filters={filters} source={source} placeholder={placeholder} />
      <ClientFilterChips filters={filters} />
    </div>
  );
}

// Lo que el dueño ve cerrado en Cartera: una caja que parece un campo y no lo
// es.
//
// No es un <Input> real a propósito. Un input de verdad aquí abriría el
// teclado del teléfono ANTES de que exista la hoja, y el navegador acabaría
// recolocando las dos cosas a destiempo — el mismo problema que la calculadora
// ya resolvió y que su comentario documenta. Esta es también la razón de que
// las otras tres pantallas NO usen este disparador: ahí no hay hoja, así que
// un campo de verdad es lo correcto y lo más simple.
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

  // QUÉ HACE SCROLL Y QUÉ NO, que es lo único delicado de este bloque.
  //
  // El contenedor NO hace scroll y sus tres primeras filas llevan `shrink-0`.
  // Scroll lo hace únicamente la lista de resultados.
  //
  // Sin eso, con el teclado del teléfono arriba la altura disponible se queda
  // en unos 300px y flex reparte el recorte entre TODOS los hijos: el campo de
  // búsqueda se aplasta por debajo de sus 40px, la fila de chips se corta por
  // la mitad y "Clientes / Ver todos" se le monta encima. Lo que se comprime
  // es justo lo que el dueño está usando —acaba de tocar el campo, por eso
  // subió el teclado— para dejarle sitio a una lista que además ya podía
  // desplazarse. Visto en un iPhone real el 2026-09-20.
  //
  // `shrink-0` en un hijo de flex es la parte que se olvida: `h-10` fija la
  // altura *preferida*, no la mínima, y un contenedor apretado la ignora.
  const body = (
    <SearchSheetCloseProvider close={() => setOpen(false)}>
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4">
      <ClientSearchCombobox
        autoFocus
        filters={filters as SharedClientFilters}
        source="cartera"
        placeholder="Escribe nombre o documento"
      />

      <ClientFilterChips filters={filters} className="shrink-0" />

      {children ? (
        <>
          <div className="flex shrink-0 items-center justify-between gap-3">
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
          {/* La única parte que se desplaza. `min-h-0` porque un hijo de flex
              tiene `min-height: auto` por defecto y crecería con su contenido
              en vez de hacer scroll dentro de su caja. */}
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </>
      ) : null}
    </div>
    </SearchSheetCloseProvider>
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
