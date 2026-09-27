"use client";

import { useEffect, useRef, useState, useTransition } from "react";
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
import { WhatsappIcon } from "@/components/icons/whatsapp";
import { guardarAvisosWhatsapp, registrarPreguntaAvisos } from "@/app/(app)/profile/actions";
import { TEXTO_AVISOS_WHATSAPP } from "@/lib/whatsapp-opt-in";

// "¿Te mandamos el resumen de tu cartera?" — la pregunta a los dueños que ya
// estaban cuando esto se construyó, y que por tanto nunca vieron nada.
//
// NO SE LES ENCIENDE POR MIGRACIÓN. Meta exige consentimiento afirmativo y
// poder demostrarlo, y "se lo activamos nosotros" no es demostrable. Con un
// solo número para toda la plataforma, tres dueños marcando el mensaje como no
// deseado bajan el quality rating de todos a la vez. Se pregunta.
//
// QUIÉN DECIDE SI SALE: `tocaPreguntarAvisos()` en lib/whatsapp-opt-in.ts, en
// el servidor. Aquí solo se pinta y se contesta.

export function PedirAvisosWhatsappDialog() {
  const [abierto, setAbierto] = useState(true);
  const [guardando, startTransition] = useTransition();
  const anotado = useRef(false);

  // Se anota que se enseñó EN CUANTO aparece, no al contestarlo: recargar
  // antes de responder volvería a sacarlo si no. `useRef` y no estado porque
  // React monta los efectos dos veces en desarrollo y serían dos cuentas.
  useEffect(() => {
    if (anotado.current) return;
    anotado.current = true;
    void registrarPreguntaAvisos();
  }, []);

  function activar() {
    startTransition(async () => {
      const r = await guardarAvisosWhatsapp(true, TEXTO_AVISOS_WHATSAPP);
      if (r.error) {
        toast.error(r.error);
        return;
      }
      setAbierto(false);
      toast.success("Listo. El lunes te llega el primero.");
    });
  }

  return (
    // onOpenChange sin más: cerrar con Escape o tocando fuera cuenta como
    // "Ahora no", nunca como un sí y nunca como un "no me preguntes más". La
    // cuenta ya subió al aparecer, así que el enfriamiento corre igual.
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Activa tu resumen de cartera</DialogTitle>
          <DialogDescription>
            Recibe resumen de tu cartera con cobros pendientes y plazos vencidos. Puedes
            desactivarlo cuando quieras en &quot;Mi negocio&quot;
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={guardando} onClick={() => setAbierto(false)}>
            Ahora no
          </Button>
          <Button type="button" disabled={guardando} onClick={activar}>
            {guardando ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Activando...
              </>
            ) : (
              <>
                Sí, activar
                <WhatsappIcon className="size-4" />
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
