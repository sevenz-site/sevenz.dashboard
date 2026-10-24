"use client";

import { useLayoutEffect, useRef } from "react";
import { formatAmountWhileTyping } from "@/lib/products/price";

/**
 * A money field that groups thousands WHILE IT IS BEING TYPED: the shopkeeper
 * types 1000000 and reads «1.000.000».
 *
 * Asked for by the owner on 2026-10-24, for the whole app: *«al digitar se
 * debe ver "1.000.000" y no "1000000"»*.
 *
 * ── WHY THIS IS A HOOK AND NOT THREE COPIES ─────────────────────────────
 *
 * There were three fields doing this by hand before this hook existed
 * (`abono-monto`, `abono-reparto`, `nueva-venta`), each with its own ref, its
 * own `useLayoutEffect` and its own caret bookkeeping — identical code, so
 * identical that a diff between them showed nothing. That is the exact shape
 * of the `StickyActions` failure written down in CLAUDE.md: a screen whose
 * classes had been copied instead of mounting the component, invisible to the
 * eye and missing the one thing the original added. Nine more copies of a
 * money parser is nine chances to fix eight of them.
 *
 * ── THE CARET HAS TO BE PUT BACK BY HAND ────────────────────────────────
 *
 * The input is controlled, so React repaints its value on every keystroke and
 * leaves the caret at the end. Without this, each thousands mark that appears
 * pushes it along and correcting a digit in the middle is impossible. It goes
 * in a `useLayoutEffect` because when `onChange` runs, the new value is not in
 * the DOM yet.
 *
 * ── WHAT IT DOES NOT DO: READ THE VALUE ─────────────────────────────────
 *
 * The caller holds the text and the caller reads it, with `parseTypedAmount`
 * and never `parseAmount` — see that function for the 1000x error the wrong
 * reader produces on a grouped field. This hook does not hide that choice,
 * because a field that silently parsed its own value would make the dangerous
 * call the invisible one.
 */
export function useGroupedAmount(
  value: string,
  onChange: (texto: string) => void,
  maxDecimales = 4,
) {
  const ref = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<number | null>(null);

  useLayoutEffect(() => {
    const destino = pendingCaret.current;
    if (destino == null || ref.current == null) return;
    pendingCaret.current = null;
    ref.current.setSelectionRange(destino, destino);
  });

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { texto, cursor } = formatAmountWhileTyping(
      e.target.value,
      value,
      e.target.selectionStart ?? e.target.value.length,
      maxDecimales,
    );
    pendingCaret.current = cursor;
    onChange(texto);
  }

  return { ref, onChange: handleChange };
}
