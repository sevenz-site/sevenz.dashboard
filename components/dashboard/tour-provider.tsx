"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { TourTooltip } from "@/components/dashboard/tour-tooltip";
import { completeOnboarding } from "@/app/(app)/actions";
import { TourContext, type TourStep } from "@/components/dashboard/tour-context";
import { useIsMobile } from "@/hooks/use-mobile";

const STEP_ORDER: TourStep[] = [0, 1, 2, 2.5, 3];
// On mobile the client-list and add-movement steps (2, 2.5) render on top of
// each other and are unreadable on a small screen. Quedan los dos que sí se
// pueden señalar en un teléfono: importar la libreta y agregar un cliente.
const MOBILE_STEP_ORDER: TourStep[] = [0, 1];

const STEP_CONTENT: Record<TourStep, { selector: string; title: string; body: string }> = {
  0: {
    selector: '[data-tour="import-button"]',
    title: "Importa tus cuentas del fiado",
    body: "Toma una foto de las cuentas de tu fiado y selecciona esta opción para subirlas de manera masiva.",
  },
  1: {
    selector: '[data-tour="new-client-button"]',
    title: "Agrega un cliente",
    body: "Toca aquí para buscar un cliente o agregar uno nuevo.",
  },
  2: {
    selector: '[data-tour="demo-client-row"]',
    title: "Abre el detalle de un cliente",
    body: "Toca cualquier cliente de la lista para ver su saldo completo. Prueba con este de ejemplo.",
  },
  2.5: {
    selector: '[data-tour="demo-add-movement-button"]',
    title: "Registra un abono o un fiado",
    body: "Dentro del detalle de cada cliente, este botón registra cada movimiento nuevo.",
  },
  3: {
    selector: '[data-tour="import-sidebar-link"]',
    title: "Importa tu libreta",
    body: "¿Ya llevas cuentas en papel? Sube fotos aquí y las convertimos en movimientos.",
  },
};

// On mobile the first step points at the bottom bar's "Agregar", which is the
// button that exists there — the page CTA is further down and may be off
// screen. Resolved per render rather than baked into STEP_CONTENT because
// rotating an iPhone crosses the breakpoint mid-tour: landscape is 812px wide
// and gets the desktop layout, so the target has to be able to change.
// querySelector returns whichever element matches first in the DOM, so the two
// buttons carry different markers and are chosen explicitly here.
function selectorForStep(step: TourStep, isMobile: boolean): string {
  if (step === 1 && isMobile) return '[data-tour="new-client-button-mobile"]';
  return STEP_CONTENT[step].selector;
}

type TooltipPos = { top: number; left: number };

const HIGHLIGHT_CLASSES = ["ring-2", "ring-primary", "ring-offset-2", "rounded-md", "relative", "z-50"];

export function TourProvider({ active, children }: { active: boolean; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isMobile = useIsMobile();
  const onDashboard = pathname === "/dashboard";
  const stepOrder = isMobile ? MOBILE_STEP_ORDER : STEP_ORDER;
  // 0 y no `stepOrder[0]`: `useIsMobile()` resuelve después de hidratar, así
  // que el orden todavía no es de fiar en el primer render. Da igual porque 0
  // encabeza los dos.
  const [step, setStep] = useState<TourStep | null>(active ? 0 : null);
  const [dismissed, setDismissed] = useState(false);
  const [pos, setPos] = useState<TooltipPos | null>(null);
  const highlightedEl = useRef<Element | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  // Landing back on the dashboard always brings the current step's tooltip
  // back into view, even if it was dismissed by an outside tap earlier.
  const [prevOnDashboard, setPrevOnDashboard] = useState(onDashboard);
  if (onDashboard !== prevOnDashboard) {
    setPrevOnDashboard(onDashboard);
    if (onDashboard) setDismissed(false);
  }

  const showing = step !== null && onDashboard && !dismissed && stepOrder.includes(step);

  useEffect(() => {
    function clearHighlight() {
      if (highlightedEl.current) {
        highlightedEl.current.classList.remove(...HIGHLIGHT_CLASSES);
        highlightedEl.current = null;
      }
    }

    if (!showing || step === null) {
      clearHighlight();
      return;
    }

    const selector = selectorForStep(step, isMobile);

    function measure() {
      clearHighlight();
      const el = document.querySelector(selector);
      if (!el) {
        setPos(null);
        return;
      }
      el.classList.add(...HIGHLIGHT_CLASSES);
      highlightedEl.current = el;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      const box = el.getBoundingClientRect();
      setPos({
        top: Math.min(box.top + box.height + 10, window.innerHeight - 220),
        left: Math.min(Math.max(box.left, 12), window.innerWidth - 300),
      });
    }

    // Demo elements only exist once ClientTable re-renders for this step; retry briefly.
    measure();
    const retry = setTimeout(measure, 150);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);

    return () => {
      clearTimeout(retry);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      clearHighlight();
    };
    // isMobile belongs here: crossing the breakpoint (an iPhone rotating to
    // landscape) changes which element step 1 points at, and without it the
    // tour would keep highlighting a target that is no longer on screen.
  }, [step, showing, isMobile]);

  // Tapping anything that isn't the tooltip itself or the element it's
  // pointing at hides the tooltip without ending the tour — the tap still
  // reaches its real target underneath (opening a dialog, a menu, etc.)
  // instead of the tooltip floating on top of whatever that opens.
  useEffect(() => {
    if (!showing) return;

    function handlePointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (tooltipRef.current?.contains(target)) return;
      if (highlightedEl.current?.contains(target)) return;
      setDismissed(true);
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [showing]);

  function finish() {
    setStep(null);
    void completeOnboarding();
  }

  function goNext() {
    if (step === null) return;
    setDismissed(false);
    const idx = stepOrder.indexOf(step);
    if (idx === -1 || idx === stepOrder.length - 1) {
      finish();
      return;
    }
    setStep(stepOrder[idx + 1]);
  }

  function goPrev() {
    if (step === null) return;
    const idx = stepOrder.indexOf(step);
    if (idx <= 0) return;
    setStep(stepOrder[idx - 1]);
  }

  function restart() {
    if (!onDashboard) router.push("/dashboard");
    setDismissed(false);
    setStep(0);
  }

  const content = showing && step !== null ? STEP_CONTENT[step] : null;
  const stepIndex = step !== null ? stepOrder.indexOf(step) : -1;

  return (
    <TourContext.Provider value={{ step, advance: goNext, restart }}>
      {children}
      {content ? (
        <TourTooltip
          ref={tooltipRef}
          style={pos ?? { top: 16, right: 16 }}
          stepLabel={`Paso ${stepIndex + 1} de ${stepOrder.length}`}
          title={content.title}
          body={content.body}
          nextLabel={stepIndex === stepOrder.length - 1 ? "Entendido" : "Siguiente"}
          onNext={goNext}
          onBack={stepIndex > 0 ? goPrev : undefined}
          onSkip={finish}
          onClose={finish}
        />
      ) : null}
    </TourContext.Provider>
  );
}
