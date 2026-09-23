"use client";

import { useState, useTransition } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { guardarAvisosWhatsapp } from "@/app/(app)/profile/actions";
import { TEXTO_AVISOS_WHATSAPP, aceptaAvisosWhatsapp } from "@/lib/whatsapp-opt-in";
import type { Owner } from "@/lib/types";

// "Notificaciones", plegado por defecto.
//
// Va plegado y al final de Mi negocio a propósito: es un ajuste que se toca
// una vez y no se vuelve a mirar, y arriba compite con los datos que el dueño
// sí viene a cambiar. La cabecera dice el estado —activados / desactivados—
// para que plegarlo no esconda la única información que importa de un vistazo.
//
// EL INTERRUPTOR GUARDA SOLO, no espera al botón "Guardar cambios" del
// formulario de arriba. Son dos cosas distintas: aquel guarda datos del
// negocio, éste registra un consentimiento con su fecha. Si viajaran juntos,
// cada vez que el dueño corrigiera su dirección se reescribiría la fecha en
// que aceptó recibir mensajes, y esa fecha es evidencia ante Meta.

export function NotificacionesAccordion({ owner }: { owner: Owner }) {
  const activoInicial = aceptaAvisosWhatsapp(owner);
  const [activo, setActivo] = useState(activoInicial);
  const [abierto, setAbierto] = useState(false);
  const [guardando, startTransition] = useTransition();

  function cambiar(siguiente: boolean) {
    // Optimista: el interruptor se mueve al instante y vuelve si el servidor
    // dice que no. Un switch que tarda medio segundo en responder se toca dos
    // veces, y dos toques aquí son un alta y una baja seguidas.
    setActivo(siguiente);
    startTransition(async () => {
      const r = await guardarAvisosWhatsapp(siguiente, TEXTO_AVISOS_WHATSAPP);
      if (r.error) {
        setActivo(!siguiente);
        toast.error(r.error);
        return;
      }
      toast.success(siguiente ? "Avisos por WhatsApp activados." : "Avisos por WhatsApp desactivados.");
    });
  }

  return (
    <section className="flex flex-col gap-4">
      <Collapsible open={abierto} onOpenChange={setAbierto}>
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left transition-colors hover:bg-muted">
          <div className="flex flex-col">
            <span className="text-sm font-medium">Notificaciones</span>
            <span className="text-xs text-muted-foreground">
              {activo ? "Avisos por WhatsApp activados" : "Avisos por WhatsApp desactivados"}
            </span>
          </div>
          <ChevronDown
            className={`size-4 shrink-0 text-muted-foreground transition-transform ${abierto ? "rotate-180" : ""}`}
          />
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="flex flex-col gap-3 rounded-lg border border-t-0 px-4 pt-4 pb-4">
            <div className="flex items-start justify-between gap-4">
              <Label htmlFor="avisos-whatsapp" className="text-sm font-normal">
                Avisos por WhatsApp
              </Label>
              <div className="flex shrink-0 items-center gap-2">
                {guardando ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" /> : null}
                <Switch
                  id="avisos-whatsapp"
                  checked={activo}
                  onCheckedChange={cambiar}
                  disabled={guardando}
                />
              </div>
            </div>

            {/* El mismo string que se guarda en la ficha al aceptar. No es una
                paráfrasis del consentimiento: es el consentimiento. */}
            <p className="text-xs leading-relaxed text-muted-foreground">{TEXTO_AVISOS_WHATSAPP}</p>

            <p className="text-xs text-muted-foreground">
              {owner.whatsapp?.trim()
                ? `Los recibirás en el ${owner.whatsapp}.`
                : "Escribe tu WhatsApp arriba y guarda antes de activarlos."}
            </p>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}
