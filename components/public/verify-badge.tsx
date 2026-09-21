"use client";

import { useState } from "react";
import { ShieldCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { WhatsappIcon } from "@/components/icons/whatsapp";

// "¿Es tu cuenta?" — la única forma que tiene un cliente de confirmar que el
// enlace que le llegó es suyo y no el de otra persona.
//
// Compara los últimos 4 dígitos de su WhatsApp CONTRA EL NAVEGADOR, nunca
// contra el servidor: la página ya trae `whatsapp_last4`, así que lo que el
// cliente teclea no sale de su teléfono. Cuatro dígitos tampoco identifican a
// nadie por sí solos.
//
// ─────────────────────────────────────────────────────────────────────────
// DESDE EL 2026-09-21 PUEDE NO HABER NÚMERO. El WhatsApp del cliente pasó a
// ser opcional, así que esta pieza tiene ahora dos estados de partida:
//
//   con número  -> lo de siempre: teclea los 4 y se verifica.
//   sin número  -> no hay nada contra qué comparar. Antes el enlace sencillamente
//                  no ofrecía verificarse; eso dejaba al cliente sin saber
//                  siquiera que la opción existía. Ahora se ofrece igual y, al
//                  tocarla, se explica por qué no se puede y qué hacer: pedirle
//                  al negocio que anote su número.
//
// El botón de contactar usa el WhatsApp DEL NEGOCIO, que la página ya tiene.
// Sin él no se pinta: mandar a alguien a "escríbele" sin decirle a dónde es
// peor que no decir nada.

export function VerifyBadge({
  expectedLast4,
  businessName,
  ownerWhatsapp,
}: {
  // Cadena vacía cuando el cliente no tiene número guardado.
  expectedLast4: string;
  businessName: string;
  ownerWhatsapp: string | null;
}) {
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [avisoSinNumero, setAvisoSinNumero] = useState(false);
  const verified = value.length === 4 && expectedLast4 !== "" && value === expectedLast4;

  if (verified) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
        <ShieldCheck className="size-3.5" /> Verificado con tu WhatsApp
      </p>
    );
  }

  // Sin número guardado: el mismo enlace de siempre, pero lleva a la
  // explicación en vez de a un campo que no podría acertar nunca.
  if (!expectedLast4) {
    const mensaje = `Hola, soy tu cliente. Vi mi saldo en el enlace que me mandaste y quiero que anotes mi WhatsApp en mi ficha.`;
    return (
      <>
        <button
          type="button"
          onClick={() => setAvisoSinNumero(true)}
          className="w-fit text-xs text-muted-foreground underline underline-offset-4"
        >
          ¿Es tu cuenta? Verifica con tu WhatsApp
        </button>

        <Dialog open={avisoSinNumero} onOpenChange={setAvisoSinNumero}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <TriangleAlert className="size-5 shrink-0 text-amber-600 dark:text-amber-500" />
                Tu WhatsApp no está registrado
              </DialogTitle>
              <DialogDescription>
                {businessName} todavía no anotó tu número, así que no podemos confirmar que esta
                cuenta es tuya. Escríbele para que lo agregue y la próxima vez podrás verificarte
                aquí mismo.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              {ownerWhatsapp ? (
                <Button asChild>
                  <a
                    href={`https://wa.me/${ownerWhatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(mensaje)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Contactar vía WhatsApp
                    <WhatsappIcon className="size-4" />
                  </a>
                </Button>
              ) : null}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-fit text-xs text-muted-foreground underline underline-offset-4"
      >
        ¿Es tu cuenta? Verifica con tu WhatsApp
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        inputMode="numeric"
        maxLength={4}
        placeholder="Últimos 4 dígitos"
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/\D/g, "").slice(0, 4))}
        className="h-8 w-36 text-sm"
      />
      {value.length === 4 ? (
        <span className="text-xs text-muted-foreground">No coincide, pero puedes seguir viendo el saldo.</span>
      ) : null}
    </div>
  );
}
