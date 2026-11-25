"use client";

import { Flashlight, FlashlightOff } from "lucide-react";
import type { Torch } from "@/components/barcode/camera-feed";

// «LINTERNA», over the camera of both viewers (owner's request of 2026-11-25: «Evalúa agregar
// botón para encender la linterna en la pantalla lectora del código de barras, si es viable
// agreguémoslo de una vez»).
//
// DRAWN ONLY WHEN THE OPEN CAMERA HAS ONE. A button that does nothing on half the phones would
// read as broken; where it is missing, «Escribir el código» is still the way out of a dark shop.
export function TorchButton({ torch, className = "" }: { torch: Torch | null; className?: string }) {
  if (!torch) return null;
  const Icon = torch.on ? FlashlightOff : Flashlight;
  return (
    <button
      type="button"
      aria-label={torch.on ? "Apagar la linterna" : "Encender la linterna"}
      aria-pressed={torch.on}
      onClick={torch.toggle}
      className={`flex size-11 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-white ${
        torch.on ? "bg-white text-neutral-900" : "bg-black/55 text-white"
      } ${className}`}
    >
      <Icon className="size-5" aria-hidden="true" />
    </button>
  );
}
