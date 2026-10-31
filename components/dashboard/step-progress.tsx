// «N/M Nombre del paso» and the bar that fills, as every multi-step flow of the
// app draws it (frames `1465:18582`, `1868:15815`, `1868:16119`).
//
// BORN AS A COMPONENT on 2026-10-30 with the two-step «Nuevo cliente». The
// same markup already lives written by hand in `producto-flujo.tsx` and
// `nueva-venta.tsx`, and `OrderStepCounter` draws it for orders; those are not
// migrated here (CLAUDE.md: a visual value on two screens is born in one
// component — this one is, and the old copies move to it the day they are
// touched).
//
// THE BAR FILLS UP TO THE CURRENT STEP INCLUDED, so the last step shows it
// full -- the reading the owner chose for the order flow. The frame of step
// 2/2 shows three of five segments, copied from a five-step flow; with two
// steps «full» is the only fill that matches the text.
//
// `aria-hidden` ON THE BAR: the text already says it, and announcing the bar
// too would say the same thing twice.
export function StepProgress({
  step,
  total,
  label,
}: {
  step: number;
  total: number;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-2 pt-2 pb-4">
      <p className="truncate text-sm text-muted-foreground">
        {step}/{total} {label}
      </p>
      <div aria-hidden="true" className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-foreground transition-all"
          style={{ width: `${(Math.min(step, total) / total) * 100}%` }}
        />
      </div>
    </div>
  );
}
