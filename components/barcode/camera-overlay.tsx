"use client";

import { useState } from "react";
import { CameraOff, Keyboard, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CameraFeed, scanFeedback, type CameraStatus } from "@/components/barcode/camera-feed";
import { hasValidCheckDigit, normalizeBarcode } from "@/lib/barcodes/normalize";

// THE FULL-SCREEN VIEWER (CT-182) -- frames 3, 4 and 5 of «Propuesta · Escáner de códigos:
// el flujo completo», approved by the owner on 2026-11-23.
//
// One read closes it: the caller decides what the code is (Home's sheets, a product form's
// field). The continuous mode of a sale is `CameraStrip`, not this.
//
// NOT A RADIX DIALOG, on purpose: a fixed layer above everything (z-60, over the z-50 of
// sheets and dialogs), mounted only while open. A Radix dialog stays mounted closed
// (DESIGN-SYSTEM.md), and a mounted camera is a camera on.
//
// NO TORCH. Safari on iPhone does not let a web page turn it on; the way out of a dark
// shop is «Escribir el código», which is always on screen.
export function CameraOverlay({
  onCode,
  onClose,
}: {
  onCode: (code: string) => void;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<CameraStatus>("starting");
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const [typedError, setTypedError] = useState<string | null>(null);
  const blocked = status === "denied" || status === "unavailable" || status === "failed";

  function read(code: string) {
    scanFeedback();
    onCode(code);
  }

  function submitTyped() {
    const code = normalizeBarcode(typed);
    // A WRONG CHECK DIGIT IS ALMOST ALWAYS A TYPO: searching it would answer «código nuevo»
    // and invite a duplicate product. So it is refused here, with the reason.
    if (!code || !hasValidCheckDigit(code)) {
      setTypedError("Ese código no es válido. Revisa los números.");
      return;
    }
    onCode(code);
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-neutral-950 text-white" role="dialog" aria-label="Escanear código">
      {!blocked && !typing ? (
        <CameraFeed onCode={read} onStatus={setStatus} className="absolute inset-0 size-full object-cover" />
      ) : null}

      <div className="relative z-10 flex items-center gap-3 px-4 py-4">
        <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-md p-1 outline-none focus-visible:ring-2 focus-visible:ring-white">
          <X className="size-6" aria-hidden="true" />
        </button>
        <span className="text-lg font-semibold">Escanear código</span>
      </div>

      {blocked ? (
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
          <CameraOff className="size-10" aria-hidden="true" />
          <p className="text-lg font-semibold">Sevenz no puede usar la cámara</p>
          <p className="text-sm">
            Dale permiso a la cámara en los ajustes de tu navegador, o escribe el código que sale debajo de las barras.
          </p>
        </div>
      ) : (
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-5 px-4">
          {/* The frame and the red line from frame 3: a target, not a crop -- the reader
              looks at the whole picture. */}
          <div className="relative h-[170px] w-[280px] max-w-full">
            <span className="absolute top-0 left-0 size-7 rounded-tl-xl border-t-4 border-l-4 border-white" />
            <span className="absolute top-0 right-0 size-7 rounded-tr-xl border-t-4 border-r-4 border-white" />
            <span className="absolute bottom-0 left-0 size-7 rounded-bl-xl border-b-4 border-l-4 border-white" />
            <span className="absolute right-0 bottom-0 size-7 rounded-br-xl border-r-4 border-b-4 border-white" />
            <span className="absolute top-1/2 right-5 left-5 h-0.5 bg-red-500" />
          </div>
          <p className="text-center text-sm">
            {status === "starting" ? "Abriendo la cámara…" : "Apunta al código de barras del producto"}
          </p>
        </div>
      )}

      <div className="relative z-10 px-4 pb-[calc(env(safe-area-inset-bottom)+2rem)]">
        <Button
          type="button"
          variant={blocked ? "secondary" : "outline"}
          className={blocked ? "h-10 w-full" : "h-10 w-full border-white/70 bg-transparent text-white hover:bg-white/10 hover:text-white"}
          onClick={() => setTyping(true)}
        >
          <Keyboard className="size-5" aria-hidden="true" />
          Escribir el código
        </Button>
      </div>

      {typing ? (
        <div className="absolute inset-x-0 bottom-0 z-20 flex flex-col gap-4 rounded-t-2xl bg-background px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] text-foreground">
          <div className="flex items-center justify-between">
            <span className="text-lg">Escribir el código</span>
            <button type="button" onClick={() => setTyping(false)} aria-label="Volver a la cámara" className="rounded-md p-1">
              <X className="size-5" aria-hidden="true" />
            </button>
          </div>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              submitTyped();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="codigo-escrito">Código de barras</Label>
              {/* `data-barcode-input`: a gun burst typed here is the code, so the guard that
                  takes bursts out of other fields leaves this one alone. */}
              <Input
                id="codigo-escrito"
                data-barcode-input=""
                inputMode="numeric"
                autoComplete="off"
                autoFocus
                className="h-11 text-base"
                value={typed}
                onChange={(e) => {
                  setTyped(e.target.value);
                  setTypedError(null);
                }}
              />
              {typedError ? (
                <p className="text-xs text-destructive">{typedError}</p>
              ) : (
                <p className="text-xs text-muted-foreground">Son los números que salen debajo de las barras.</p>
              )}
            </div>
            <Button type="submit" className="h-10 w-full" disabled={!typed.trim()}>
              Buscar
            </Button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
