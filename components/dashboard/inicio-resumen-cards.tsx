"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, Eye, EyeOff } from "lucide-react";
import { PedidosIcon, VERDE_PEDIDOS } from "@/components/icons/pedidos";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { formatPriceAmount, type PriceCurrency } from "@/lib/products/price";
import { formatBs } from "@/lib/exchange-rate/format";
import { hrefDeSeccion } from "@/lib/reports/secciones";
import { cn } from "@/lib/utils";

// ═══════════════════════════════════════════════════════════════════════
// «VENTAS» Y «PEDIDOS», LADO A LADO EN EL INICIO — frame `1500:9981`
//
// Encargo del dueño el 2026-10-28: *«Ajustemos la card de "Pedidos" en el
// home y agreguemos una nueva a su lado izquierdo con el title "Ventas" (…) al
// seleccionar el card de "ventas" debe redirigir a la sección de "Cartera" en
// reportes»*.
//
// ───────────────────────────────────────────────────────────────────────
// EL `<h2>Pedidos</h2>` DE ENCIMA DESAPARECE, y hay que decirlo
//
// Hasta hoy el Inicio llevaba un encabezado «Pedidos» sobre la tarjeta, y la
// tarjeta NO repetía el título por eso. El frame nuevo pone el título DENTRO
// de cada tarjeta, que es la única forma que funciona con dos lado a lado: un
// encabezado no puede encabezar dos cosas distintas.
//
// ───────────────────────────────────────────────────────────────────────
// QUÉ PERIODO CUENTA «VENTAS», porque un importe sin periodo no dice nada
//
// **Los últimos 30 días**, decidido por el dueño ese mismo día preguntándole
// con el caso delante. Es el periodo con el que Reportes abre, o sea el mismo
// al que lleva esta tarjeta: cualquier otro habría hecho que la cifra CAMBIARA
// delante del tendero al tocarla, que es la forma más barata de que deje de
// creerse las dos pantallas.
//
// El frame no escribe el periodo en ningún sitio y la tarjeta no tiene dónde:
// su línea de abajo la ocupa la equivalencia en bolívares. Se resuelve
// haciendo que la cifra de destino sea la misma, no rotulándola.
//
// ───────────────────────────────────────────────────────────────────────
// EL OJO SOLO TAPA EL DINERO
//
// Lo dibuja el frame en «Ventas» y no en «Pedidos», y tiene sentido: lo que se
// esconde del cliente que está al otro lado del mostrador es cuánto factura el
// negocio, no cuántos pedidos tiene sin atender.
//
// ES SU PROPIO ESTADO y no el de la tarjeta de «Por cobrar» de arriba: son dos
// cifras distintas y el tendero puede querer tapar una y no la otra. No se
// guarda entre visitas a propósito — un ojo que recuerda deja el Inicio en
// blanco mañana y parece que la app no cargó.
// ═══════════════════════════════════════════════════════════════════════

/** El armazón que las dos comparten: título, icono, cifra, pie y chevron. */
function Tarjeta({
  titulo,
  icono,
  href,
  children,
  pie,
  insignia,
}: {
  titulo: string;
  icono: React.ReactNode;
  href: string;
  children: React.ReactNode;
  pie: React.ReactNode;
  insignia?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      // `min-w-0` y `flex-1`: las dos miden 162 en el frame, que es la mitad
      // justa de 338 con 14 de hueco. En vez de clavar los 162 se reparten a
      // partes iguales, para que a 320px --un iPhone SE-- se encojan en vez de
      // salirse.
      className="flex min-w-0 flex-1 flex-col gap-1 rounded-[10px] border py-2 pr-2 pl-3 drop-shadow-[0px_2px_1px_rgba(0,0,0,0.02)]"
      style={{
        backgroundImage: "linear-gradient(82.76deg, var(--accent) 0%, var(--background) 100%)",
      }}
    >
      <span className="flex items-center justify-between gap-1">
        <span className="truncate text-base font-medium">{titulo}</span>
        {icono}
      </span>
      {children}
      <span className="flex items-center justify-between gap-1">
        <span className="min-w-0 truncate text-xs leading-4 text-muted-foreground">{pie}</span>
        <span className="flex shrink-0 items-center gap-0.5">
          {insignia}
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
        </span>
      </span>
    </Link>
  );
}

export function InicioResumenCards({
  ventas,
  libro,
  tasa,
  sinAtender,
}: {
  /** Lo vendido en los últimos 30 días, en el libro de abajo. */
  ventas: number;
  /** El libro en el que se enseña. `"COP"` en un negocio colombiano. */
  libro: PriceCurrency;
  /** Bs por unidad de ese libro. `null` en Colombia o sin tasa. */
  tasa: number | null;
  sinAtender: number;
}) {
  const [oculto, setOculto] = useState(false);

  return (
    <div className="flex gap-3.5">
      {/* ══ VENTAS ═══════════════════════════════════════════════════ */}
      <Tarjeta
        titulo="Ventas"
        icono={
          // UN BOTÓN DENTRO DE UN ENLACE ES HTML INVÁLIDO y, peor, en un
          // teléfono el toque navega igual. Así que el ojo no es un botón:
          // es un `<span>` con rol de botón que PARA el evento antes de que
          // el enlace lo vea.
          <span
            role="button"
            tabIndex={0}
            aria-label={oculto ? "Mostrar las ventas" : "Ocultar las ventas"}
            aria-pressed={oculto}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOculto((v) => !v);
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              e.stopPropagation();
              setOculto((v) => !v);
            }}
            className="-m-1 shrink-0 rounded p-1 text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {oculto ? (
              <Eye className="size-5" aria-hidden />
            ) : (
              <EyeOff className="size-5" aria-hidden />
            )}
          </span>
        }
        href={hrefDeSeccion("cartera")}
        pie={
          // SIN TASA NO SE INVENTA UNA EQUIVALENCIA. En un negocio colombiano
          // no hay segunda moneda, y en uno venezolano sin tasa del día
          // escribir unos bolívares calculados con una tasa vieja sería peor
          // que no escribir nada.
          oculto
            ? "Ventas ocultas"
            : tasa != null
              ? `${formatBs(ventas * tasa)} hoy`
              : "Últimos 30 días"
        }
      >
        <span className="flex items-center gap-1">
          <CurrencyFlagIcon currency={libro} className="size-5 shrink-0" />
          {/* `text-brand-sales` ES EL `#007956` DEL FRAME, el token que ya
              existe. Y `truncate` porque una cifra de siete dígitos en una
              tarjeta de media pantalla se sale: vale más recortarla que
              romper la fila. */}
          <span
            className={cn(
              "truncate text-xl leading-7 tabular-nums",
              oculto ? "text-muted-foreground" : "text-brand-sales",
            )}
          >
            {oculto ? "••••" : formatPriceAmount(ventas, libro)}
          </span>
        </span>
      </Tarjeta>

      {/* ══ PEDIDOS ══════════════════════════════════════════════════ */}
      <Tarjeta
        titulo="Pedidos"
        icono={
          <PedidosIcon className="size-6 shrink-0" style={{ color: VERDE_PEDIDOS }} />
        }
        href="/productos/ordenes"
        pie="Pedidos sin atender"
        insignia={
          sinAtender > 0 ? (
            // `min-w-4` y no `size-4`: con doce pedidos esperando, un círculo
            // de tamaño fijo recorta el segundo dígito.
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full border border-primary-foreground bg-destructive px-1 text-[10px] leading-4 text-primary-foreground">
              {sinAtender}
            </span>
          ) : null
        }
      >
        <span className="text-xl leading-7 tabular-nums">{sinAtender}</span>
      </Tarjeta>
    </div>
  );
}
