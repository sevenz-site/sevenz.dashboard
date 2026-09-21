"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { WhatsappInput } from "@/components/whatsapp-input";
import { OWNER_COUNTRY_DIAL_CODE } from "@/lib/countries";
import { guardarWhatsappDeCliente } from "@/app/(app)/dashboard/actions";
import type { OwnerCountry } from "@/lib/types";

// "Este cliente no tiene WhatsApp guardado" — y el campo para arreglarlo aquí
// mismo.
//
// Desde el 2026-09-21 el número es opcional al dar de alta, y eso crea un
// momento nuevo: el dueño pulsa "Compartir saldo vía WhatsApp" para un cliente
// que no tiene número. Mandarlo a "Editar cliente" le hace perder lo que
// estaba haciendo y volver a empezar; el campo va donde está el problema.
//
// POR QUÉ ESTE ES EL SITIO PARA PEDIRLO. Al dar de alta, el número es un
// trámite: el dueño está fiando, tiene al cliente delante y prisa. Aquí es
// distinto — quiere mandar el saldo AHORA, así que el número le sirve de
// inmediato. Pedir un dato cuando paga es lo que evita que se invente.
//
// Y se puede salir sin darlo: "Compartir de otra forma" sigue el camino de
// siempre, que es `wa.me` sin destinatario — WhatsApp pregunta a quién. El
// diálogo informa y ofrece, nunca bloquea.

export function PedirWhatsappDialog({
  open,
  onOpenChange,
  clientId,
  clientName,
  ownerCountry,
  onGuardado,
  onSeguirSinNumero,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  clientName: string;
  ownerCountry: OwnerCountry;
  // Se llama con el número ya guardado, para que quien abrió el diálogo
  // continúe con lo que iba a hacer sin esperar a que el servidor revalide.
  onGuardado: (whatsapp: string) => void;
  onSeguirSinNumero: () => void;
}) {
  const [numero, setNumero] = useState("");
  const [guardando, startTransition] = useTransition();

  function guardar() {
    const limpio = numero.trim();
    if (!limpio) {
      toast.error("Escribe el número de WhatsApp.");
      return;
    }
    startTransition(async () => {
      const r = await guardarWhatsappDeCliente(clientId, limpio);
      if ("error" in r) {
        toast.error(r.error);
        return;
      }
      toast.success(`Guardamos el WhatsApp de ${clientName}.`);
      onOpenChange(false);
      onGuardado(limpio);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{clientName} no tiene WhatsApp guardado</DialogTitle>
          <DialogDescription>
            Escríbelo aquí y lo guardamos en su ficha, para que la próxima vez el saldo salga
            directo a su chat.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pedir-whatsapp" className="text-xs">
            WhatsApp de {clientName}
          </Label>
          <WhatsappInput
            id="pedir-whatsapp"
            name="pedir-whatsapp"
            preferredDialCode={OWNER_COUNTRY_DIAL_CODE[ownerCountry]}
            onValueChange={setNumero}
          />
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={guardando}
            onClick={() => {
              onOpenChange(false);
              onSeguirSinNumero();
            }}
          >
            Compartir de otra forma
          </Button>
          <Button type="button" disabled={guardando} onClick={guardar}>
            {guardando ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Guardando...
              </>
            ) : (
              "Guardar y compartir"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
