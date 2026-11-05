"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { FechaSheet, type FechaElegida } from "@/components/dashboard/fecha-sheet";
import { aISO, type Rango } from "@/lib/reports/rango";
import { track } from "@/lib/mixpanel";

// EL FILTRO «FECHA» DE REPORTES — frame `1502:10303`.
//
// Encargo del dueño el 2026-10-27: *«Cambiar filtros 7 días y 30 días por
// "Fecha". Al seleccionarlo abre date picker para filtrar por fecha»*.
//
// The sheet itself lives in `fecha-sheet.tsx` since 2026-11-04, shared with the
// transaction history. This file keeps the chip and what choosing a date does.

export function ReportesFechaFiltro({
  rango,
  // ── EL RÓTULO LLEGA ESCRITO DESDE EL SERVIDOR ─────────────────────
  //
  // Y no se recalcula aquí. El porqué entero está en `textoDelRango`: las dos
  // `Date` de `rango` se reviven en el navegador, así que calcular el texto a
  // este lado lo leía en la zona horaria del NAVEGADOR mientras el subtítulo
  // de la misma pantalla lo leía en la del SERVIDOR. Dos rótulos para un solo
  // rango.
  texto,
}: {
  rango: Rango;
  texto: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [abierta, setAbierta] = useState(false);
  const [aplicando, startTransition] = useTransition();

  function aplicar(desde: Date, hasta: Date) {
    const next = new URLSearchParams(params.toString());
    next.set("desde", aISO(desde));
    next.set("hasta", aISO(hasta));
    // EL `?periodo=` VIEJO SE BORRA al elegir fechas. Si se quedara, una URL
    // llevaría dos respuestas a la misma pregunta y la de atrás ganaría el día
    // que alguien quitara una de las dos nuevas.
    next.delete("periodo");
    // ── SE NAVEGA PRIMERO Y SE CIERRA DESPUÉS ───────────────────────
    //
    // Era al revés. Cerrar una hoja de Radix dispara su animación de salida y
    // la devolución del foco, y encadenar la navegación detrás de eso dejaba
    // un hueco en el que la pantalla seguía enseñando el rango ANTERIOR. El
    // dueño lo leyó como «"Hoy" sigue mostrando dos días» -- y yo mismo caí
    // en la misma lectura al probarlo, mirando antes de que llegara.
    //
    // `isPending` SE USA AHORA y antes se descartaba: el chip se apaga
    // mientras el informe viaja, así que un toque que tarda se ve que tardó
    // en vez de parecer que no hizo nada.
    startTransition(() => {
      router.replace(`/reportes?${next.toString()}`);
      setAbierta(false);
    });
  }

  /**
   * ¿MIRAN EL DÍA, LA SEMANA O EL MES?
   *
   * Encargo del dueño el 2026-10-29. QUÉ DECIDE: hoy el informe abre con 30
   * días **por suposición mía**, no por medición -- lo elegí porque es lo que
   * el subtítulo del frame prometía. Si resulta que el tendero mira sobre
   * todo los 7 días, cada visita empieza con dos toques de más; si mira
   * «Hoy», el gráfico de siete cubos no es la forma correcta de enseñárselo.
   *
   * `atajo` DISTINGUE EL PRESET DEL CALENDARIO, que es la mitad del valor: si
   * casi nadie usa el calendario, los cuatro atajos bastan y esa hoja puede
   * encogerse; si lo usan mucho, el rango libre es una necesidad real y no
   * una cortesía.
   */
  function registrarRango(atajo: string) {
    track("Report Range Changed", { atajo });
  }

  function elegir({ desde, hasta, atajo }: FechaElegida) {
    registrarRango(atajo);
    aplicar(desde, hasta);
  }

  return (
    <FechaSheet
      abierta={abierta}
      onAbiertaChange={setAbierta}
      inicial={{ from: rango.desde, to: rango.hasta }}
      onElegir={elegir}
      trigger={
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
          className={`flex h-[38px] w-fit shrink-0 self-start items-center gap-2 rounded-[10px] border border-brand-field-border px-4 text-sm text-brand-muted transition-colors outline-none hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-white/40 ${
            aplicando ? "opacity-60" : ""
          }`}
        >
          {/* EL CHIP DICE QUÉ RANGO HAY PUESTO, no solo «Fecha». Un filtro que
              no dice su valor obliga a abrirlo para saber qué se está mirando,
              y esta pantalla entera depende de esa respuesta. */}
          <span className="font-medium text-white">{texto}</span>
          <ChevronDown className="size-4" aria-hidden />
        </button>
      }
    />
  );
}
