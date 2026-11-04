"use client";

import { useState, type ReactNode } from "react";
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

// THE DATE SHEET — frame `1502:10303`, shared by Reportes and the transaction
// history since 2026-11-04. Owner's request that day: *«al abrirlo muestra mismo
// sheet que el filtro de fecha de "Reportes"»*. One component, so the two cannot
// drift. Each screen brings its own chip and decides what choosing a date does.
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

export type FechaElegida = {
  desde: Date;
  hasta: Date;
  // Which control chose it: `hoy`, `7d`, `15d`, `30d` or `calendario`.
  atajo: string;
};

export function FechaSheet({
  abierta,
  onAbiertaChange,
  trigger,
  inicial,
  onElegir,
  onQuitar,
}: {
  abierta: boolean;
  onAbiertaChange: (abierta: boolean) => void;
  trigger: ReactNode;
  // What the calendar opens on. Nothing, in a history with no date chosen.
  inicial: DateRange | undefined;
  onElegir: (fecha: FechaElegida) => void;
  // Only a filter that can be empty has it. Reportes always has a range, so it
  // has no such button; a history would otherwise keep its date for good.
  onQuitar?: () => void;
}) {
  return (
    <Sheet open={abierta} onOpenChange={onAbiertaChange}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="bottom" className="max-h-[90svh] overflow-y-auto rounded-t-xl">
        <SheetHeader>
          <SheetTitle>Fecha</SheetTitle>
        </SheetHeader>
        {/* Its own component because Radix mounts this only while open: the
            calendar starts from `inicial` every time, with no effect to sync it. */}
        <Contenido inicial={inicial} onElegir={onElegir} onQuitar={onQuitar} />
      </SheetContent>
    </Sheet>
  );
}

function Contenido({
  inicial,
  onElegir,
  onQuitar,
}: {
  inicial: DateRange | undefined;
  onElegir: (fecha: FechaElegida) => void;
  onQuitar?: () => void;
}) {
  const [elegido, setElegido] = useState<DateRange | undefined>(inicial);

  function atajo(dias: number) {
    const hasta = new Date();
    const desde = new Date(hasta.getTime() - (dias - 1) * 24 * 60 * 60 * 1000);
    setElegido({ from: desde, to: hasta });
    onElegir({ desde, hasta, atajo: dias === 1 ? "hoy" : `${dias}d` });
  }

  return (
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
          onElegir({ desde: elegido.from, hasta: elegido.to ?? elegido.from, atajo: "calendario" });
        }}
      >
        Aplicar
      </Button>
      {onQuitar ? (
        <Button type="button" variant="outline" className="h-10 w-full" onClick={onQuitar}>
          Quitar fecha
        </Button>
      ) : null}
    </div>
  );
}
