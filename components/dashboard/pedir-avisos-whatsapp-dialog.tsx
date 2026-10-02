"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
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
import { Switch } from "@/components/ui/switch";
import { guardarAvisosWhatsapp, registrarPreguntaAvisos } from "@/app/(app)/profile/actions";
import { TEXTO_AVISOS_WHATSAPP } from "@/lib/whatsapp-opt-in";

// "Notificaciones por WhatsApp" — la pregunta a los dueños que ya estaban
// cuando esto se construyó, y que por tanto nunca vieron nada.
//
// NO SE LES ENCIENDE POR MIGRACIÓN. Meta exige consentimiento afirmativo y
// poder demostrarlo, y "se lo activamos nosotros" no es demostrable. Con un
// solo número para toda la plataforma, tres dueños marcando el mensaje como no
// deseado bajan el quality rating de todos a la vez. Se pregunta.
//
// QUIÉN DECIDE SI SALE: `tocaPreguntarAvisos()` en lib/whatsapp-opt-in.ts, en
// el servidor. Aquí solo se pinta y se contesta.
//
// UN INTERRUPTOR Y UN BOTÓN, desde el 2026-09-30. Antes eran dos botones
// ("Ahora no" / "Sí, activar"). La forma nueva iguala esta pantalla con la de
// Mi negocio, donde el consentimiento SIEMPRE ha sido un interruptor con esta
// misma frase al lado — que es justo la frase que se guarda como evidencia.
//
// EL INTERRUPTOR NACE ENCENDIDO, por decisión de producto del 2026-09-30. Lo
// que se guarda como consentimiento es entonces el toque en "Aceptar", no el
// gesto de encenderlo: quien no toca nada y acepta nunca movió el interruptor.
// Queda dicho aquí porque el comentario de `lib/whatsapp-opt-in.ts` describe el
// acto de consentir como "mover el interruptor a mano", y desde hoy eso solo es
// cierto en Mi negocio.

export function PedirAvisosWhatsappDialog({ whatsapp }: { whatsapp: string | null }) {
  const [abierto, setAbierto] = useState(true);
  // Encendido de salida. Aceptar sin tocarlo activa; apagarlo y aceptar es un
  // "no" explícito, no un aplazamiento — ver `responder()`.
  const [activo, setActivo] = useState(true);
  const [guardando, startTransition] = useTransition();
  const anotado = useRef(false);
  const switchId = useId();

  // Se anota que se enseñó EN CUANTO aparece, no al contestarlo: recargar
  // antes de responder volvería a sacarlo si no. `useRef` y no estado porque
  // React monta los efectos dos veces en desarrollo y serían dos cuentas.
  useEffect(() => {
    if (anotado.current) return;
    anotado.current = true;
    void registrarPreguntaAvisos();
  }, []);

  function responder() {
    startTransition(async () => {
      const r = await guardarAvisosWhatsapp(activo, TEXTO_AVISOS_WHATSAPP);
      if (r.error) {
        toast.error(r.error);
        return;
      }
      setAbierto(false);
      // APAGAR Y ACEPTAR ES DEFINITIVO, y el aviso lo dice en vez de dejarlo
      // descubrir. `guardarAvisosWhatsapp(false)` escribe `whatsapp_opt_out_at`,
      // y `tocaPreguntarAvisos()` corta en seco ante esa fecha: este diálogo no
      // vuelve nunca. Es lo correcto —contestar que no es una respuesta, no una
      // pregunta pendiente— pero deja Mi negocio como único camino de vuelta,
      // así que se nombra.
      toast.success(
        activo
          ? "Listo. El lunes te llega el primero."
          : "No te mandaremos nada. Puedes activarlo en Mi negocio.",
      );
    });
  }

  return (
    // onOpenChange sin más: cerrar con la X, con Escape o tocando fuera cuenta
    // como "ahora no" — no escribe nada, ni alta ni baja, así que el diálogo
    // puede volver cuando toque. La cuenta ya subió al aparecer, o sea que el
    // enfriamiento corre igual y cerrar tres veces lo agota como antes.
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Notificaciones por WhatsApp</DialogTitle>
          {/* El texto visible vive en el recuadro de abajo, pegado al
              interruptor que describe. Esta copia es solo para un lector de
              pantalla, que anuncia el diálogo antes de llegar al contenido. */}
          <DialogDescription className="sr-only">
            Elige si quieres recibir el resumen semanal de tu cartera por WhatsApp.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 rounded-lg border p-4">
          <div className="flex items-start justify-between gap-4">
            {/* EL MISMO STRING QUE SE GUARDA EN LA FICHA AL ACEPTAR. No es una
                paráfrasis del consentimiento: es el consentimiento. Si esta
                línea y `TEXTO_AVISOS_WHATSAPP` dejaran de coincidir, la
                evidencia que le enseñaríamos a Meta sería falsa. */}
            <Label htmlFor={switchId} className="text-sm leading-relaxed font-normal">
              {TEXTO_AVISOS_WHATSAPP}
            </Label>
            <div className="flex shrink-0 items-center gap-2">
              {guardando ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" /> : null}
              <Switch
                id={switchId}
                checked={activo}
                onCheckedChange={setActivo}
                disabled={guardando}
              />
            </div>
          </div>

          {/* `tocaPreguntarAvisos()` ya exige que haya número, así que esto no
              debería faltar nunca; se comprueba igual para no escribir "en el
              número: ." si algún día esa condición cambia. */}
          {whatsapp?.trim() ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              Lo recibirás en el número registrado en tu cuenta: {whatsapp}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          {/* `w-full` es la excepción que DESIGN-SYSTEM.md permite: ocupa una
              fila entera por diseño, no está estirado junto a otro botón. */}
          <Button type="button" className="w-full" disabled={guardando} onClick={responder}>
            {guardando ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Guardando...
              </>
            ) : (
              "Aceptar"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
