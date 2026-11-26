"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { guardarCodigosDeBarras } from "@/app/(app)/profile/actions";

// MI NEGOCIO › «CÓDIGOS DE BARRAS» (CT-182). Frames 1 and 2 of «Propuesta · Escáner de
// códigos: el flujo completo», approved by the owner on 2026-11-23.
//
// ON BY DEFAULT since migration 221 (owner's request of 2026-11-26, «debe estar activada por
// defecto, tanto a los que crean su cuenta como los que ya están usando sevenz»). It was off by
// default from 2026-11-23 to then, so that a shop without codes saw no change; now that shop turns
// it off here. Off still means the app is exactly what it was: no scan button, no code
// field, no gun listener. The guard that keeps a gun burst out of money fields is NOT tied
// to this switch -- it runs always (owner's decision of 2026-11-23), because a gun plugged
// in before switching this on types into whatever field is focused.
//
// It saves on its own, like «Consejos de Sevenz», with an optimistic switch that goes back
// if the server refuses. Then the page refreshes, because the floating scan button and the
// product forms read the setting on the server.
export function CodigosDeBarrasCard({ initial }: { initial: boolean }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial);
  const [saving, startSaving] = useTransition();
  // Mi negocio renders its form twice (the phone and the desktop layout, one hidden), so the
  // copy that did not move follows the saved value when the page refreshes.
  const [savedInitial, setSavedInitial] = useState(initial);
  if (initial !== savedInitial) {
    setSavedInitial(initial);
    setEnabled(initial);
  }

  function change(next: boolean) {
    setEnabled(next);
    startSaving(async () => {
      const r = await guardarCodigosDeBarras(next);
      if (r.error) {
        setEnabled(!next);
        toast.error(r.error);
        return;
      }
      toast.success(next ? "Códigos de barras activados." : "Códigos de barras desactivados.");
      router.refresh();
    });
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-base font-semibold">Códigos de barras</h2>
      <div className="flex flex-col gap-3 rounded-[10px] border p-4">
        <div className="flex items-start justify-between gap-4">
          <Label htmlFor="codigos-de-barras" className="text-sm font-normal">
            Trabajar con códigos de barras
          </Label>
          <div className="flex shrink-0 items-center gap-2">
            {saving ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" /> : null}
            <Switch id="codigos-de-barras" checked={enabled} onCheckedChange={change} disabled={saving} />
          </div>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {enabled
            ? "Escanea tus productos con la cámara del teléfono o con una pistola lectora. Ya tienes el botón para escanear, el campo «Código de barras» en tus productos, y la pistola funciona en las pantallas donde está «Registrar»."
            : "Escanea tus productos con la cámara del teléfono o con una pistola lectora para venderlos más rápido. Si no trabajas con códigos, todo sigue igual."}
        </p>
      </div>
    </section>
  );
}
