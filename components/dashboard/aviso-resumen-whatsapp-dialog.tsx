"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { registrarAvisoDelResumen } from "@/app/(app)/profile/actions";

// THE WEEKLY WHATSAPP CHANGED, SAID ONCE (v0.6.0). Frames 1 and 2 of «v0.6.0 · Permiso de
// WhatsApp» in Figma (`2108:21609`), approved by the owner on 2026-11-12.
//
// The text is the owner's own, of 2026-11-06, word for word. It ASKS NOTHING: owners who
// accepted the old sentence are told, not asked again (his decision that day). So there is
// no switch here; whoever wants it off has «Ir a Mi negocio», where the switch lives.
//
// WHO SEES IT is decided on the server by `tocaAvisoDelResumen` (lib/whatsapp-opt-in.ts).
// Here it is only drawn, and marked as seen the moment it appears, like the dialog that asks
// for permission: reloading or closing with the X must not bring it back.
//
// BUTTON ORDER. `DialogFooter` is `flex-col-reverse` on a phone and a row from `sm`, so the
// two buttons are written «Ir a Mi negocio», «Entendido»: on a phone «Entendido» lands on top,
// on the web it lands on the right. Both as in the frames.
export function AvisoResumenWhatsappDialog() {
  const [abierto, setAbierto] = useState(true);
  const anotado = useRef(false);

  useEffect(() => {
    if (anotado.current) return;
    anotado.current = true;
    void registrarAvisoDelResumen();
  }, []);

  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tu resumen de WhatsApp cambia</DialogTitle>
          <DialogDescription>
            Tu resumen semanal ahora incluye ventas y productos. Puedes desactivarlo en Mi negocio.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <Link href="/profile" onClick={() => setAbierto(false)}>
              Ir a Mi negocio
            </Link>
          </Button>
          <Button type="button" className="w-full sm:w-auto" onClick={() => setAbierto(false)}>
            Entendido
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
