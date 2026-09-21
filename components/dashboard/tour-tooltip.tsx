"use client";

import { X } from "lucide-react";

// El globo del recorrido de bienvenida. SOLO PARA ONBOARDING.
//
// No es un tooltip de uso general y no debe reutilizarse como tal: es una
// tarjeta oscura fija, y una pieza oscura suelta en medio de una pantalla
// clara solo tiene sentido cuando está diciendo "esto de aquí es lo nuevo,
// mírame". Para una ayuda contextual normal está el popover del sistema.
//
// ─────────────────────────────────────────────────────────────────────────
// OSCURA EN LOS DOS TEMAS, a propósito.
//
// `bg-[#272727]` literal y no un token: es el mismo fondo que la tarjeta de
// "Instala Sevenz en tu teléfono" (`components/install-app.tsx`), que también
// es oscura pase lo que pase con el tema. Si esto usara `bg-popover`, en tema
// claro el globo sería blanco sobre blanco y dejaría de resaltar — que es lo
// único que tiene que hacer.
//
// Por eso también los colores del texto son `white/N` y no tokens: sobre un
// fondo fijo, un token que cambia con el tema es justo lo que rompe el
// contraste sin que nadie se entere.
//
// Medido sobre #272727 el 2026-09-20, con el piso de 4.5:1 de
// DESIGN-SYSTEM.md:
//
//   blanco (título)                14,94:1
//   white/70 (cuerpo)               8,04:1
//   white/60 (paso, Saltar)         6,36:1
//   --brand #F66B02 (acción)        5,00:1
//
// El naranja es el que va más justo. Si alguien aclara el fondo, es el primero
// que cae: vuelve a medirlo antes de tocarlo.

export function TourTooltip({
  ref,
  style,
  stepLabel,
  title,
  body,
  nextLabel,
  onNext,
  onBack,
  onSkip,
  onClose,
}: {
  ref?: React.Ref<HTMLDivElement>;
  style?: React.CSSProperties;
  stepLabel: string;
  title: string;
  body: string;
  nextLabel: string;
  onNext: () => void;
  // Ausente en el primer paso: no hay a dónde volver.
  onBack?: () => void;
  onSkip: () => void;
  onClose: () => void;
}) {
  return (
    <div
      ref={ref}
      style={style}
      className="fixed z-[60] w-72 rounded-2xl bg-[#272727] p-4 pr-11 text-white shadow-lg"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Cerrar recorrido"
        className="absolute top-3 right-3 text-white/70 transition-colors hover:text-white focus-visible:ring-3 focus-visible:ring-white/40 focus-visible:outline-none"
      >
        <X className="size-4" />
      </button>

      <p className="text-xs text-white/60">{stepLabel}</p>
      <p className="mt-1 text-base leading-tight font-semibold text-white">{title}</p>
      <p className="mt-1.5 text-sm text-white/70">{body}</p>

      <div className="mt-4 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onSkip}
          className="text-sm text-white/60 transition-colors hover:text-white focus-visible:ring-3 focus-visible:ring-white/40 focus-visible:outline-none"
        >
          Saltar
        </button>
        <div className="flex items-center gap-4">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="text-sm text-white/60 transition-colors hover:text-white focus-visible:ring-3 focus-visible:ring-white/40 focus-visible:outline-none"
            >
              Atrás
            </button>
          ) : null}
          {/* La acción principal es texto, no un botón relleno: sobre un fondo
              oscuro un botón blanco pesa más que el propio mensaje. El naranja
              de marca ya la distingue de "Saltar" sin necesidad de caja. */}
          <button
            type="button"
            onClick={onNext}
            className="text-sm font-semibold text-brand transition-opacity hover:opacity-80 focus-visible:ring-3 focus-visible:ring-brand focus-visible:outline-none"
          >
            {nextLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
