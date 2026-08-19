"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { completeOnboarding } from "@/app/(app)/actions";
import { TourContext, type TourStep } from "@/components/dashboard/tour-context";

const STEP_ORDER: TourStep[] = [1, 2, 2.5, 3];

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

type TooltipPos = { top: number; left: number };

const HIGHLIGHT_CLASSES = ["ring-2", "ring-primary", "ring-offset-2", "rounded-md", "relative", "z-50"];

export function TourProvider({ active, children }: { active: boolean; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const onDashboard = pathname === "/dashboard";
  const [step, setStep] = useState<TourStep | null>(active ? 1 : null);
  const [pos, setPos] = useState<TooltipPos | null>(null);
  const highlightedEl = useRef<Element | null>(null);

  useEffect(() => {
    function clearHighlight() {
      if (highlightedEl.current) {
        highlightedEl.current.classList.remove(...HIGHLIGHT_CLASSES);
        highlightedEl.current = null;
      }
    }

    if (step === null || !onDashboard) {
      clearHighlight();
      return;
    }

    const { selector } = STEP_CONTENT[step];

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
  }, [step, onDashboard]);

  function finish() {
    setStep(null);
    void completeOnboarding();
  }

  function goNext() {
    if (step === null) return;
    const idx = STEP_ORDER.indexOf(step);
    if (idx === STEP_ORDER.length - 1) {
      finish();
      return;
    }
    setStep(STEP_ORDER[idx + 1]);
  }

  function goPrev() {
    if (step === null) return;
    const idx = STEP_ORDER.indexOf(step);
    if (idx <= 0) return;
    setStep(STEP_ORDER[idx - 1]);
  }

  function restart() {
    if (!onDashboard) router.push("/dashboard");
    setStep(1);
  }

  const content = step !== null && onDashboard ? STEP_CONTENT[step] : null;
  const stepIndex = step !== null ? STEP_ORDER.indexOf(step) : -1;

  return (
    <TourContext.Provider value={{ step, advance: goNext, restart }}>
      {children}
      {content ? (
        <div
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
            Paso {stepIndex + 1} de {STEP_ORDER.length}
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
                {stepIndex === STEP_ORDER.length - 1 ? "Entendido" : "Siguiente"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </TourContext.Provider>
  );
}
