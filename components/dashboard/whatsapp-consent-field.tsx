"use client";

import { useId } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { textoPermisoDeclarado } from "@/lib/whatsapp-opt-in";

// EL PERMISO DE WHATSAPP, DECLARADO POR EL TENDERO (MS-34).
//
// Dos piezas que viven juntas porque son una sola decisión partida en dos
// momentos: la casilla sobre "Guardar fiado/abono", y el diálogo que sale si
// guarda sin marcarla. Están aquí y no dentro de cada formulario porque los
// usan tres pantallas distintas -- alta de movimiento, alta de cliente con
// movimiento, y el detalle de la persona al subir libreta (pendiente) -- y
// tres copias de un texto de consentimiento es como acaban diciendo cosas
// distintas.
//
// POR QUÉ ESTO EXISTE, en una línea: Meta solo permite escribirle a quien haya
// dado permiso, y esperar a que el cliente abra su enlace y lo marque él mismo
// deja fuera a 43 de 214 clientes. El tendero tiene al cliente delante justo
// cuando le fía, y un permiso recogido en persona vale si queda registrado.

export function WhatsappConsentField({
  clientName,
  hasWhatsapp,
  yaTienePermiso,
  checked,
  onCheckedChange,
  disabled,
}: {
  clientName: string;
  // Si el TELEFONO de este cliente ya acepto -- no la ficha. Son cosas
  // distintas y la diferencia es grande: medido en dev el 2026-10-10, la
  // mitad de las fichas comparten numero con otra y una de ellas lo comparte
  // con ocho mas. Preguntar por ficha seria preguntar nueve veces por la misma
  // persona, y ocho de esas marcas no escribirian nada.
  //
  // Lo contesta `client_accepts_whatsapp`, la misma funcion que usa la puerta
  // de envio. Una segunda consulta que respondiera "casi" lo mismo acabaria
  // discrepando, y la discrepancia seria mensajes a quien no acepto, o
  // silencio hacia quien si.
  yaTienePermiso?: boolean;
  // Si el cliente no tiene número guardado. NO esconde la casilla: la deja
  // marcable y explica qué falta. Esconderla perdería el único momento en que
  // el tendero está pensando en esto -- propuesta del dueño el 2026-10-10,
  // sobre la de ocultarla, y es mejor por eso.
  hasWhatsapp: boolean;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();

  // YA ACEPTO: ni casilla ni pregunta, solo el estado. Se ensena en vez de
  // esconderse del todo porque el tendero si quiere saber si ese cliente esta
  // cubierto -- decision del dueno el 2026-10-10, sobre la alternativa de no
  // pintar nada. Quitarlo se hace desde la ficha del cliente (MS-35), no desde
  // aqui: este formulario es para registrar dinero, no para administrar
  // permisos.
  if (yaTienePermiso) {
    return (
      <p className="text-xs leading-relaxed text-muted-foreground">
        {clientName.trim() || "Este cliente"} ya tiene activada las notificaciones vía WhatsApp
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
      <div className="flex items-start gap-3">
        {/* APAGADA POR DEFECTO, SIEMPRE, y es lo contrario de casi todo lo
            demás de esta semana. Una casilla de consentimiento premarcada no
            es consentimiento en ningún marco, ni el de Meta ni el legal: el
            acto afirmativo tiene que ser del tendero, aquí y ahora. El estado
            lo trae el formulario, que lo inicializa en false. */}
        <Checkbox
          id={id}
          checked={checked}
          disabled={disabled}
          onCheckedChange={(v) => onCheckedChange(v === true)}
          className="mt-0.5"
        />
        <Label htmlFor={id} className="text-sm font-normal leading-relaxed">
          {/* El texto sale de lib/, no de aquí, porque es EXACTAMENTE lo que
              se guarda como evidencia. Dos cadenas -- una para enseñar y otra
              para guardar -- convierten la prueba en una reconstrucción. */}
          {textoPermisoDeclarado(clientName)}
        </Label>
      </div>

      {checked && !hasWhatsapp ? (
        <p className="text-xs leading-relaxed text-destructive">
          Falta registrar el WhatsApp de {clientName.trim() || "este cliente"}. Sin número no
          podemos avisarle.
        </p>
      ) : null}
    </div>
  );
}

export function WhatsappConsentDialog({
  open,
  onOpenChange,
  clientName,
  hasWhatsapp,
  checked,
  onCheckedChange,
  onContinue,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientName: string;
  hasWhatsapp: boolean;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  // Guarda el movimiento con el estado que tenga la casilla en este momento,
  // marcada o no.
  onContinue: () => void;
}) {
  const nombre = clientName.trim() || "este cliente";
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿{nombre} quiere avisos por WhatsApp?</AlertDialogTitle>
          <AlertDialogDescription>
            Si {nombre} acepta, le llega un mensaje cuando pague y cuando se acerque su plazo.
            Solo márcalo si se lo preguntaste.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {/* LA MISMA CASILLA OTRA VEZ, no un "¿seguro?" con dos botones. Un
            diálogo que solo pregunta se contesta sin leerlo; uno que trae la
            decisión dentro obliga a mirarla. Es la fricción que el dueño pidió
            el 2026-10-10, y es deliberada.

            Va FUERA de AlertDialogDescription: ese componente monta un <p> y
            esto son divs. Un <div> dentro de un <p> es HTML inválido -- el
            navegador cierra el párrafo solo y React se queja en hidratación.
            Mismo caso que el resumen de Subir libreta. */}
        <WhatsappConsentField
          clientName={clientName}
          hasWhatsapp={hasWhatsapp}
          checked={checked}
          onCheckedChange={onCheckedChange}
        />

        <AlertDialogFooter>
          {/* "Volver" y no "Cancelar": cancelar se lee como que se pierde el
              movimiento, que es lo que el tendero vino a hacer. */}
          <AlertDialogCancel>Volver</AlertDialogCancel>
          {/* EL BOTON NO PROMETE UN AVISO QUE NO VA A SALIR. Marcada la
              casilla pero sin numero guardado, decia "Guardar y avisarle"
              justo encima de un aviso rojo diciendo que falta el WhatsApp --
              dos frases contradictorias en la misma pantalla, vistas a 375px
              el 2026-10-10 antes de que esto saliera de dev. Sin numero, la
              propia funcion de la base rechaza el permiso, asi que "sin
              avisos" es ademas lo que de verdad ocurre. */}
          <AlertDialogAction onClick={onContinue}>
            {checked && hasWhatsapp ? "Guardar y avisarle" : "Guardar sin avisos"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

