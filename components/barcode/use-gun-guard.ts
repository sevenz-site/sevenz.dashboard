"use client";

import { useEffect, useRef } from "react";
import { GAP_MS, IDLE_MS, emptyBurst, isCompleteScan, isScanSoFar, type BurstState } from "@/lib/barcodes/burst";
import { normalizeBarcode } from "@/lib/barcodes/normalize";

type Field = HTMLInputElement | HTMLTextAreaElement;

function asField(el: Element | null): Field | null {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el : null;
}

// A field that EXPECTS a code (the product's «Código de barras», «Escribir el código"): a
// burst typed there is what the shopkeeper wants, so it is left alone.
function wantsCodes(field: Field | null): boolean {
  return field?.dataset.barcodeInput !== undefined;
}

// Puts a field back to what it held before the burst, in a way React sees: the native
// setter plus an `input` event, so a controlled input's state follows.
function restore(field: Field, value: string) {
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

// THE GUN GUARD (CT-182). Mounted once for the whole app and ALWAYS ON, switch or no
// switch (owner's decision of 2026-11-23): see lib/barcodes/burst.ts for why. Every burst
// is taken out of the field it was heading to and its Enter never reaches a form. When the
// burst is a whole code, `onScan` gets it; what happens next is the caller's decision.
//
// Window, capture phase: it runs before React's own listeners and before the field, so a
// prevented key never lands and a page's own Enter handler never fires.
export function useGunGuard(onScan: (code: string) => void) {
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  });

  useEffect(() => {
    let run: BurstState = emptyBurst();
    let idle: number | undefined;

    const finish = () => {
      window.clearTimeout(idle);
      const ended = run;
      run = emptyBurst();
      if (!isScanSoFar(ended)) return;
      if (ended.target && !wantsCodes(ended.target)) restore(ended.target, ended.before);
      if (wantsCodes(ended.target) || !isCompleteScan(ended)) return;
      const code = normalizeBarcode(ended.chars);
      if (code) onScanRef.current(code);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      const gap = e.timeStamp - run.last;

      if (e.key.length === 1) {
        if (gap > GAP_MS) {
          window.clearTimeout(idle);
          const target = asField(document.activeElement);
          run = { chars: e.key, last: e.timeStamp, target, before: target?.value ?? "" };
        } else {
          run.chars += e.key;
          run.last = e.timeStamp;
          if (isScanSoFar(run) && !wantsCodes(run.target)) {
            e.preventDefault();
            e.stopImmediatePropagation();
          }
        }
        window.clearTimeout(idle);
        idle = window.setTimeout(finish, IDLE_MS);
        return;
      }

      // The gun's own Enter (or Tab): never submits a form, never moves the focus.
      if ((e.key === "Enter" || e.key === "Tab") && gap <= IDLE_MS && isScanSoFar(run)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        finish();
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.clearTimeout(idle);
    };
  }, []);
}
