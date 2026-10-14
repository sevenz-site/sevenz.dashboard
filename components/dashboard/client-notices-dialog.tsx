"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { setClientWhatsappNotices } from "@/app/(app)/clients/[id]/actions";

// LOS AVISOS DE WHATSAPP DE UN CLIENTE, DESDE SU FICHA (MS-35).
//
// Meta exige honrar la baja, y hasta ahora solo podía dársela el cliente desde
// su propio enlace. Pero quien recibe el «ya no me mandes más eso» es el
// tendero, en el mostrador, de viva voz.
//
// UN MODAL Y NO UNA PANTALLA DE CONFIGURACIÓN. Decisión del dueño el
// 2026-10-10, sobre la propuesta de replicar el patrón de ajustes: es un solo
// interruptor, y dos toques y una lectura para llegar a él sería más camino que
// decisión. El menú lo llama «Notificaciones» siempre, encendidas o apagadas —
// una entrada de menú que se renombra sola no se encuentra dos veces en el
// mismo sitio.
export function ClientNoticesDialog({
  open,
  onOpenChange,
  clientId,
  clientName,
  activo,
  hasWhatsapp,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientId: string;
  clientName: string;
  // Si el TELÉFONO de este cliente acepta hoy. Sale de
  // `client_accepts_whatsapp`, la misma función que usa la puerta de envío.
  activo: boolean;
  hasWhatsapp: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // El interruptor se deriva de la prop y solo se adelanta durante el viaje de
  // ida y vuelta. Es el mismo arreglo que la tarjeta del catálogo necesitó el
  // 2026-10-10: `useState(prop)` solo lee su argumento en el PRIMER render, así
  // que tras un `router.refresh()` la pantalla se quedaba contradiciendo a la
  // base sin que nada lo dijera.
  const [optimista, setOptimista] = useState<boolean | null>(null);
  const [realPrevio, setRealPrevio] = useState(activo);
  if (activo !== realPrevio) {
    setRealPrevio(activo);
    setOptimista(null);
  }
  const encendido = optimista ?? activo;

  function cambiar(siguiente: boolean) {
    setOptimista(siguiente);
    startTransition(async () => {
      const r = await setClientWhatsappNotices(clientId, siguiente);
      if (r.error) {
        setOptimista(null);
        toast.error(r.error);
        return;
      }
      router.refresh();
      toast.success(
        siguiente
          ? `${clientName} va a recibir avisos de su saldo.`
          : `${clientName} ya no recibirá avisos.`,
      );
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid-cols-[minmax(0,1fr)]">
        <DialogHeader>
          <DialogTitle>Notificaciones de {clientName}</DialogTitle>
          <DialogDescription>
            Si están encendidas, Sevenz le escribe por WhatsApp cuando pague y cuando se acerque su
            plazo.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-start justify-between gap-4 rounded-lg border bg-muted/30 p-3">
          <Label htmlFor="avisos-cliente" className="text-sm font-normal leading-relaxed">
            Avisos de su saldo por WhatsApp
          </Label>
          <Switch
            id="avisos-cliente"
            checked={encendido}
            disabled={pending || !hasWhatsapp}
            onCheckedChange={cambiar}
          />
        </div>

        {/* SIN NÚMERO, EL INTERRUPTOR NO SIRVE Y SE DICE. Apagado y sin
            explicación sería un control que no responde; la base rechaza el
            permiso de todas formas, porque `normalize_whatsapp_phone` no saca
            clave de un número que no lo es. */}
        {hasWhatsapp ? null : (
          <p className="text-xs leading-relaxed text-destructive">
            Falta registrar el WhatsApp de {clientName}. Sin número no podemos avisarle.
          </p>
        )}

        {/* LA BAJA VALE PARA TODAS LAS BODEGAS, y eso hay que decirlo donde se
            toca. El permiso se guarda con el teléfono como clave porque se le
            da a Sevenz, que es el remitente en todas — no a esta tienda. Un
            tendero que apague esto creyendo que solo afecta a su negocio se
            lleva una sorpresa que no podría haber previsto. */}
        {encendido ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Si lo apagas, {clientName} deja de recibir avisos de Sevenz en todos los negocios donde
            tenga cuenta, no solo en el tuyo.
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Listo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
