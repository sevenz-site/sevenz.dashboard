"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { completeOnboarding } from "@/app/(app)/actions";
import { TourContext, type TourStep } from "@/components/dashboard/tour-context";
import { useIsMobile } from "@/hooks/use-mobile";

const STEP_ORDER: TourStep[] = [1, 2, 2.5, 3];
// On mobile the client-list and add-movement steps (2, 2.5) render on top of
// each other and are unreadable on a small screen — only the first step
// ("Agrega un cliente") is worth showing there.
const MOBILE_STEP_ORDER: TourStep[] = [1];

const STEP_CONTENT: Record<TourStep, { selector: string; title: string; body: string }> = {
  1: {
    selector: '[data-tour="new-client-button"]',
    title: "Agrega un cliente",
    body: "Toca aquí para buscar un cliente existente o registrar uno nuevo.",
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
  const [step, setStep] = useState<TourStep | null>(active ? 1 : null);
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
    setStep(1);
  }

  const content = showing && step !== null ? STEP_CONTENT[step] : null;
  const stepIndex = step !== null ? stepOrder.indexOf(step) : -1;

  return (
    <TourContext.Provider value={{ step, advance: goNext, restart }}>
      {children}
      {content ? (
        <div
          ref={tooltipRef}
          className="fixed z-[60] w-72 rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg"
          style={pos ?? { top: 16, right: 16 }}
        >
          <button
            type="button"
            onClick={finish}
            className="absolute right-2 top-2 text-muted-foreground hover:text-foreground"
            aria-label="Cerrar recorrido"
          >
            <X className="size-4" />
          </button>
          <p className="text-xs text-muted-foreground">
            Paso {stepIndex + 1} de {stepOrder.length}
          </p>
          <p className="mt-1 font-medium">{content.title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{content.body}</p>
          <div className="mt-3 flex items-center justify-between">
            <button
              type="button"
              onClick={finish}
              className="text-xs text-muted-foreground underline underline-offset-4"
            >
              Saltar
            </button>
            <div className="flex gap-2">
              {stepIndex > 0 ? (
                <Button type="button" size="sm" variant="outline" onClick={goPrev}>
                  Atrás
                </Button>
              ) : null}
              <Button type="button" size="sm" onClick={goNext}>
                {stepIndex === stepOrder.length - 1 ? "Entendido" : "Siguiente"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </TourContext.Provider>
  );
}
