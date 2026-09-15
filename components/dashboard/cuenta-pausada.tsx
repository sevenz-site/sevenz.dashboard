import { MessageCircle, PauseCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SUPPORT_WHATSAPP } from "@/lib/config";

// Lo que ve un tendero con la cuenta bloqueada.
//
// LA BASE ES LA CERRADURA, ESTO ES EL CARTEL. La política de la 061 impide
// escribir de verdad; sin este aviso, el tendero llenaría el formulario, daría
// a Guardar y recibiría "new row violates row-level security policy". Ya nos
// pasó con el plazo de pago hace tres días: la regla estaba bien y el mensaje
// era el texto crudo de Postgres.
//
// NO DICE POR QUÉ. El motivo del bloqueo se escribe para el historial —"no
// paga desde julio, avisado dos veces"— y es una nota interna. Enseñársela
// sería discutir con él desde la pantalla en vez de por WhatsApp, que es donde
// se arregla.
//
// "Pausada" y no "bloqueada" ni "suspendida": lo que tiene que entender es que
// esto se revierte hablando, no que le cerraron la puerta.
const MENSAJE = "Hola, mi cuenta de Sevenz aparece pausada y necesito reactivarla.";

export function CuentaPausada() {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
      <div className="flex items-start gap-2">
        <PauseCircle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-destructive">Tu cuenta está pausada</p>
          <p className="text-sm text-muted-foreground">
            Por ahora no puedes registrar fiados ni abonos. Tu cartera y el historial siguen aquí, y
            el enlace que les mandaste a tus clientes sigue funcionando.
          </p>
        </div>
      </div>
      <Button asChild variant="outline" className="w-fit">
        <a
          href={`https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(MENSAJE)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <MessageCircle className="size-4" />
          Escríbenos para reactivarla
        </a>
      </Button>
    </div>
  );
}
