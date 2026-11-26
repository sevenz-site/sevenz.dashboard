"use client";

import { useState } from "react";
import { CameraOff, Keyboard, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CameraFeed, scanFeedback, type CameraStatus, type Torch } from "@/components/barcode/camera-feed";
import { TorchButton } from "@/components/barcode/torch-button";
import { hasValidCheckDigit, normalizeBarcode } from "@/lib/barcodes/normalize";

// THE FULL-SCREEN VIEWER (CT-182) -- frames 3, 4 and 5 of «Propuesta · Escáner de códigos:
// el flujo completo», approved by the owner on 2026-11-23.
//
// One read closes it: the caller decides what the code is (Home's sheets, a product form's
// field). The continuous mode of a sale is `CameraStrip`, not this.
//
// A MODAL LAYER OF ITS OWN, AND MOUNTED ONLY WHILE OPEN, since 2026-11-25. It was a plain fixed
// layer until then, «not a Radix dialog, on purpose», because a Radix dialog that stays mounted
// closed is a camera on. That reason stands and is kept by its callers, which render this only
// while open. What the plain layer got wrong: opened over the quick product sheet (a modal), it
// inherited the sheet's `pointer-events: none` and lost the focus to it, so the X, the torch and
// «Escribir el código» could not be touched, and a tap landed on the sheet's backdrop, which
// closes it with everything typed. Radix stacks its layers; a layer of its own is the top one.
//
// Only its own buttons close it (and Escape): a tap outside does not exist, it covers the screen.
//
// THE TORCH, since 2026-11-25. This said «NO TORCH: Safari on iPhone does not let a web page turn
// it on», which stopped being true: WebKit took it in October 2023 and it is reported working
// from iOS 17.5 (bugs.webkit.org 243075). The button is always there while the camera is
// open; a phone that refuses says so, and «Escribir el código» stays as the way out.
export function CameraOverlay({
  onCode,
  onClose,
  aviso = null,
}: {
  onCode: (code: string) => void;
  onClose: () => void;
  // CONTINUOUS MODE (an order's «Detalle del pedido», 2026-11-23): the caller keeps the
  // viewer open after a read and passes what the last read did, shown over the camera.
  aviso?: string | null;
}) {
  const [status, setStatus] = useState<CameraStatus>("starting");
  const [torch, setTorch] = useState<Torch | null>(null);
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
    <DialogPrimitive.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onInteractOutside={(e) => e.preventDefault()}
          className="fixed inset-0 z-[60] flex flex-col bg-neutral-950 text-white outline-none"
        >
      {!blocked && !typing ? (
        <CameraFeed onCode={read} onStatus={setStatus} onTorch={setTorch} className="absolute inset-0 size-full object-cover" />
      ) : null}

      <div className="relative z-10 flex items-center gap-3 px-4 py-4">
        <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-md p-1 outline-none focus-visible:ring-2 focus-visible:ring-white">
          <X className="size-6" aria-hidden="true" />
        </button>
        <DialogPrimitive.Title className="text-lg font-semibold">Escanear código</DialogPrimitive.Title>
        {!blocked && !typing ? <TorchButton torch={torch} className="-my-2 ml-auto" /> : null}
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
            {/* Owner's report of 2026-11-25: the reflex with a small code is to bring the phone
                closer, and there no phone focuses. The zoom makes the distance worth it. */}
            {status === "scanning" ? <span className="block text-white/80">Aleja el teléfono un palmo para que enfoque.</span> : null}
          </p>
          {aviso ? (
            <p role="status" className="max-w-full truncate rounded-full bg-white px-4 py-2 text-sm font-medium text-neutral-900">
              {aviso}
            </p>
          ) : null}
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
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
