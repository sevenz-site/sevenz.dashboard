"use client";

import { track } from "@/lib/mixpanel";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { TourTooltip } from "@/components/dashboard/tour-tooltip";
import { completeOnboarding } from "@/app/(app)/actions";
import { TourContext, type TourStep } from "@/components/dashboard/tour-context";
import { useIsMobile } from "@/hooks/use-mobile";

const STEP_ORDER: TourStep[] = [0, 1, 2];
// El paso 2 señala una fila de ejemplo de la tabla, que solo existe de md
// hacia arriba: en un teléfono la lista son tarjetas y no hay fila que
// resaltar. Quedan los dos que sí se pueden señalar ahí.
const MOBILE_STEP_ORDER: TourStep[] = [0, 1];

const STEP_CONTENT: Record<TourStep, { selector: string; title: string; body: string }> = {
  0: {
    selector: '[data-tour="import-button"]',
    title: "Sube tu libreta",
    body: "Toma una foto de tu libreta del fiado y toca aquí. Sevenz lee los nombres y los montos, y tú revisas antes de guardar.",
  },
  1: {
    selector: '[data-tour="new-client-button"]',
    // Owner's decision of 2026-11-09. It said «Agrega un cliente — Toca aquí
    // para buscar un cliente o agregar uno nuevo», from when this button opened
    // the client search; «Registrar» now opens the three-option sheet.
    title: "Registra lo que pasó",
    body: "Toca aquí para anotar una venta, un fiado, un abono o un cliente nuevo.",
  },
  2: {
    selector: '[data-tour="demo-client-row"]',
    title: "Abre el detalle de un cliente",
    body: "Toca cualquier cliente de la lista para ver su saldo completo. Prueba con este de ejemplo.",
  },
};

// On mobile step 1 points at the floating «Registrar» above the bottom bar,
// which is the button that exists there — the page CTA is `hidden md:block`. Resolved per render rather than baked into STEP_CONTENT because
// rotating an iPhone crosses the breakpoint mid-tour: landscape is 812px wide
// and gets the desktop layout, so the target has to be able to change.
// querySelector returns whichever element matches first in the DOM, so the two
// buttons carry different markers and are chosen explicitly here.
function selectorForStep(step: TourStep, isMobile: boolean): string {
  if (step === 1 && isMobile) return '[data-tour="new-client-button-mobile"]';
  return STEP_CONTENT[step].selector;
}

type TooltipPos = { top: number; left: number };

// THE RING IS ALWAYS ADDED; EVERYTHING ELSE ONLY WHEN THE TARGET LACKS IT.
//
// Until 2026-11-09 this was one fixed list that included `relative` and
// `rounded-md`. Step 1's phone target is the floating «Registrar», which is
// `fixed`: `relative` won the cascade, the button dropped into the page flow
// at full width with its `right-4` shifting it off the left edge, and the
// owner read it as the old «Agregar movimiento» button coming back (reported
// with a screenshot that day). `rounded-md` likewise squared off its pill.
const RING_CLASSES = ["ring-2", "ring-primary", "ring-offset-2"];

function highlightClassesFor(el: Element): string[] {
  const style = getComputedStyle(el);
  const classes = [...RING_CLASSES];
  // A positioned element already stacks; only a static one needs `relative`
  // for `z-50` to apply. A fixed one keeps its own position untouched.
  if (style.position === "static") classes.push("relative", "z-50");
  else classes.push("z-50");
  if (parseFloat(style.borderTopLeftRadius) === 0) classes.push("rounded-md");
  return classes;
}

// Room kept between the tooltip and the target, and the screen's edges.
const GAP = 10;
const EDGE = 8;

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
  // Exactly the classes this tour added, so clearing never strips one the
  // element had of its own (a `z-50` or `rounded-md` it was born with).
  const addedClasses = useRef<string[]>([]);
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
        highlightedEl.current.classList.remove(...addedClasses.current);
        highlightedEl.current = null;
        addedClasses.current = [];
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
      // Measured BEFORE adding anything, so the classes describe the element
      // as it is, not as a previous highlight left it.
      const classes = highlightClassesFor(el).filter((c) => !el.classList.contains(c));
      el.classList.add(...classes);
      addedClasses.current = classes;
      highlightedEl.current = el;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      const box = el.getBoundingClientRect();
      // BELOW THE TARGET WHEN IT FITS, ABOVE WHEN IT DOES NOT. The old rule
      // clamped to `innerHeight - 220`, which for a target near the bottom —
      // the floating «Registrar» on a phone — put the tooltip ON TOP of the
      // very button it was pointing at. The height is the tooltip's own once
      // it has rendered (the 150 ms retry re-measures with it), 200 before.
      const height = tooltipRef.current?.offsetHeight ?? 200;
      const below = box.bottom + GAP;
      const top =
        below + height <= window.innerHeight - EDGE
          ? below
          : Math.max(EDGE, box.top - GAP - height);
      setPos({
        top,
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
    // IS THE TOUR FINISHED OR SKIPPED, AND WHERE? It decides whether it gets shorter.
    // Filed under the owner.
    const ultimo = step === null ? -1 : stepOrder.indexOf(step);
    track("Tour Finished", {
      outcome: ultimo === stepOrder.length - 1 ? "completed" : "skipped",
      last_step: ultimo + 1,
      steps_total: stepOrder.length,
    });
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
