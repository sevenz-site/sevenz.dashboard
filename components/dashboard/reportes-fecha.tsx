"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { es } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { aISO, textoDelRango, type Rango } from "@/lib/reports/rango";

// EL FILTRO «FECHA» DE REPORTES — frame `1502:10303`.
//
// Encargo del dueño el 2026-10-27: *«Cambiar filtros 7 días y 30 días por
// "Fecha". Al seleccionarlo abre date picker para filtrar por fecha»*.
//
// ───────────────────────────────────────────────────────────────────────
// UNA HOJA Y NO UN POPOVER
//
// Misma razón que la ficha de un producto y el buscador de cliente, ya
// escrita en sus archivos: un calendario de rango mide ~320px de alto, y un
// popover anclado a un chip que vive en la cabecera lo empuja contra el borde
// de un teléfono. Una hoja nace pegada abajo y crece hacia arriba.
//
// `max-h-[90svh]` Y NO `vh`: `vh` mide el viewport GRANDE --el que habría sin
// la barra del navegador-- así que en un teléfono con la barra a la vista ese
// porcentaje es más alto que la pantalla.
//
// ───────────────────────────────────────────────────────────────────────
// NO SE APLICA AL TOCAR UN DÍA
//
// Un calendario de rango necesita DOS toques, y aplicar en el primero mandaría
// al servidor un informe de un solo día que el tendero no pidió -- y lo vería
// parpadear antes de elegir el segundo. Así que el rango se elige aquí dentro
// y «Aplicar» es quien navega.
//
// LO QUE SE PIERDE frente a los chips de 7 y 30 días: aquello era un toque y
// esto son tres. Por eso quedan los dos atajos arriba, que cubren lo que el
// tendero mira casi siempre.

export function ReportesFechaFiltro({ rango }: { rango: Rango }) {
  const router = useRouter();
  const params = useSearchParams();
  const [abierta, setAbierta] = useState(false);
  const [, startTransition] = useTransition();
  const [elegido, setElegido] = useState<DateRange | undefined>({
    from: rango.desde,
    to: rango.hasta,
  });

  function aplicar(desde: Date, hasta: Date) {
    const next = new URLSearchParams(params.toString());
    next.set("desde", aISO(desde));
    next.set("hasta", aISO(hasta));
    // EL `?periodo=` VIEJO SE BORRA al elegir fechas. Si se quedara, una URL
    // llevaría dos respuestas a la misma pregunta y la de atrás ganaría el día
    // que alguien quitara una de las dos nuevas.
    next.delete("periodo");
    setAbierta(false);
    startTransition(() => router.replace(`/reportes?${next.toString()}`));
  }

  function atajo(dias: number) {
    const hasta = new Date();
    const desde = new Date(hasta.getTime() - (dias - 1) * 24 * 60 * 60 * 1000);
    setElegido({ from: desde, to: hasta });
    aplicar(desde, hasta);
  }

  return (
    <Sheet open={abierta} onOpenChange={setAbierta}>
      <SheetTrigger asChild>
        <button
          type="button"
          // La misma forma y el mismo borde que los chips que sustituye: el
          // relleno del chip es 1,91:1 contra esta cabecera, así que lo que lo
          // hace visible es el borde, no el fondo.
          // `self-start` Y `w-fit`: el chip vive dentro de una columna flex, que
          // estira a sus hijos a lo ancho por defecto. Sin esto ocupaba la
          // pantalla entera -- reportado por el dueño el 2026-10-27 con una
          // captura: *«debe apretar el contenido (hug), no ocupar toda la
          // pantalla»*.
          className="flex h-[38px] w-fit shrink-0 self-start items-center gap-2 rounded-[10px] border border-brand-field-border px-4 text-sm text-brand-muted transition-colors outline-none hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/40"
        >
          {/* EL CHIP DICE QUÉ RANGO HAY PUESTO, no solo «Fecha». Un filtro que
              no dice su valor obliga a abrirlo para saber qué se está mirando,
              y esta pantalla entera depende de esa respuesta. */}
          <span className="font-medium text-white">{textoDelRango(rango)}</span>
          <ChevronDown className="size-4" aria-hidden />
        </button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[90svh] overflow-y-auto rounded-t-xl">
        <SheetHeader>
          <SheetTitle>Fecha</SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 pb-6">
          {/* ── CUATRO ATAJOS, EN DOS FILAS — encargo del dueño el 2026-10-29
              *«debe mostrar opciones: Hoy; Últimos 7 días, Últimos 15 días;
              Últimos 30 días»*.

              `grid-cols-2` Y NO UNA FILA DE CUATRO: a 375px «Últimos 30 días»
              ya ocupa media pantalla él solo, así que cuatro en línea parten
              el texto en dos renglones cada uno. Dos y dos caben enteros.

              `atajo(1)` ES HOY: la cuenta es `hasta − (días − 1)`, así que con
              1 el desde y el hasta son el mismo día. No hace falta un caso
              aparte, y tenerlo sería un segundo sitio donde «hoy» se define. */}
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" onClick={() => atajo(1)}>
              Hoy
            </Button>
            <Button type="button" variant="outline" onClick={() => atajo(7)}>
              Últimos 7 días
            </Button>
            <Button type="button" variant="outline" onClick={() => atajo(15)}>
              Últimos 15 días
            </Button>
            <Button type="button" variant="outline" onClick={() => atajo(30)}>
              Últimos 30 días
            </Button>
          </div>

          <Calendar
            mode="range"
            locale={es}
            selected={elegido}
            onSelect={setElegido}
            numberOfMonths={1}
            // NO SE PUEDE ELEGIR EL FUTURO: un informe de mañana siempre sale
            // vacío, y un informe vacío se lee como «no vendiste nada».
            disabled={{ after: new Date() }}
            className="mx-auto"
          />

          <Button
            type="button"
            className="h-10 w-full"
            disabled={!elegido?.from}
            onClick={() => {
              if (!elegido?.from) return;
              // SIN SEGUNDA FECHA, EL RANGO ES ESE DÍA. Es lo que el tendero
              // acaba de decir con su único toque; pedirle un segundo toque
              // para ver un día suelto sería trabajo sin motivo.
              aplicar(elegido.from, elegido.to ?? elegido.from);
            }}
          >
            Aplicar
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
