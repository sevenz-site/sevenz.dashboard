"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, UserRoundSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { updateClient, type EditClientState } from "@/app/(app)/clients/[id]/actions";
import { WhatsappInput } from "@/components/whatsapp-input";
import type { Client, OwnerCountry } from "@/lib/types";
import { OWNER_COUNTRY_DIAL_CODE } from "@/lib/countries";
import { useFieldErrors, useFormRef } from "@/hooks/use-field-errors";
import { required } from "@/lib/form-validation";
import {
  useErrorDeCuentaPausada,
  useGuardiaDeCuentaPausada,
} from "@/components/dashboard/cuenta-pausada";
import { DocumentIdInput } from "@/components/dashboard/document-id-input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
// La misma ficha que usan la revision de la libreta y el emparejamiento. Vive
// en `components/import/` por donde nacio, no por a quien pertenece: es la
// forma en que Sevenz presenta "este cliente que ya tienes" en cualquier sitio
// donde haya que reconocerlo, y una segunda copia aqui se separaria de aquella
// en cuanto alguien retocara una.
import { FichaDeCliente, loQueDebe } from "@/components/import/emparejar-cliente";

const initialState: EditClientState = { error: null, success: false };

// ownerCountry only decides where the picker STARTS. A client who already
// has a number keeps whatever prefix it was saved with, since splitPhoneNumber
// wins over preferredDialCode — editing an address must never silently
// rewrite a genuinely foreign number.
export function EditClientDialog({
  client,
  ownerCountry,
  open: openProp,
  onOpenChange,
}: {
  client: Client;
  ownerCountry: OwnerCountry;
  // Modo controlado, para cuando "Editar" no es un lapiz al lado del nombre
  // sino una opción del menú de tres puntos. Un diálogo no puede vivir DENTRO
  // de ese menú —Radix lo desmonta al cerrarse y se lleva el diálogo con él—,
  // así que el menú solo enciende este interruptor y el diálogo vive fuera.
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const [openInterno, setOpenInterno] = useState(false);
  const controlado = onOpenChange !== undefined;
  const open = controlado ? Boolean(openProp) : openInterno;
  const setOpen = controlado ? onOpenChange! : setOpenInterno;
  const [state, formAction, pending] = useActionState(updateClient, initialState);
  // Cuenta pausada: lo dice el dialogo, no un parrafo rojo aqui debajo.
  const errorPausada = useErrorDeCuentaPausada(state.error);
  // Cuenta pausada: no se abre el formulario, sale el dialogo.
  const guardia = useGuardiaDeCuentaPausada();
  const [handledState, setHandledState] = useState(state);
  const [formRef, setFormRef] = useFormRef();
  // The document field is controlled now that it carries a prefix, so it needs
  // its own state — defaultValue cannot express "V-" plus digits. Radix does
  // not guarantee this content unmounts, so the value is re-seeded whenever the
  // dialog is opened for a DIFFERENT client; without that, opening the second
  // client's dialog would show the first one's document.
  const [documentIdValue, setDocumentIdValue] = useState(client.document_id ?? "");
  const [seenClientId, setSeenClientId] = useState(client.id);
  if (client.id !== seenClientId) {
    setSeenClientId(client.id);
    setDocumentIdValue(client.document_id ?? "");
  }
  // CT-28. Lee el formulario VIVO en vez de reusar el FormData de hace un
  // momento: el mismo motivo que `confirmDuplicateAndSubmit` en el alta — entre
  // que salta el aviso y se confirma, el dueño puede haber corregido un dígito,
  // y reenviar la foto vieja guardaría lo que ya no está en pantalla.
  function confirmarDuplicadoYGuardar() {
    if (!formRef.current) return;
    if (!validate(formRef.current)) return;
    const data = new FormData(formRef.current);
    data.set("confirm_duplicate", "true");
    formAction(data);
  }

  // Lo que el servidor devolvio: quienes llevan ya esa cedula. Vacio mientras
  // no haya choque, que es el caso normal.
  const duplicados = state.duplicados ?? [];

  const { errors, validate, recheck, reset } = useFieldErrors({
    name: required,
    document_id: required,
  });

  if (state !== handledState && state.success) {
    setHandledState(state);
    setOpen(false);
  }

  useEffect(() => {
    if (state === initialState || pending) return;
    if (state.success) {
      toast.success("Cliente actualizado");
      router.refresh();
    }
  }, [state, pending, router]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next && guardia()) return;
        setOpen(next);
        // Radix doesn't guarantee this content unmounts on close, so without
        // this a validation error from a previous open could still be
        // showing red the next time this dialog opens.
        if (!next) {
          reset();
          // Same reason: a half-typed document must not survive into the next
          // time this dialog opens.
          setDocumentIdValue(client.document_id ?? "");
        }
      }}
    >
      {controlado ? null : (
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm">
            <Pencil className="size-4" />
            Editar
          </Button>
        </DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar cliente</DialogTitle>
          <DialogDescription>Actualiza los datos de contacto.</DialogDescription>
        </DialogHeader>
        <form
          ref={setFormRef}
          action={formAction}
          onSubmit={(e) => {
            if (!validate(e.currentTarget)) e.preventDefault();
          }}
          className="flex flex-col gap-4"
        >
          <input type="hidden" name="client_id" value={client.id} />

          <div className="flex flex-col gap-2">
            <Label htmlFor="edit_name">Nombre del cliente</Label>
            <Input
              id="edit_name"
              name="name"
              defaultValue={client.name}
              required
              aria-invalid={Boolean(errors.name)}
              onChange={() => recheck("name", formRef.current)}
            />
            {errors.name ? <p className="text-xs text-destructive">{errors.name}</p> : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit_whatsapp">WhatsApp (opcional)</Label>
            {/* Sin `required` y sin regla en useFieldErrors: el número es
                opcional desde el 2026-09-21. Se quitó junto con el `required`
                del HTML, que era lo que quedaba contradiciendo a la etiqueta
                —y con él un cliente importado sin número no se podía editar
                ni para corregirle la dirección. */}
            <WhatsappInput
              id="edit_whatsapp"
              name="whatsapp"
              defaultValue={client.whatsapp}
              preferredDialCode={OWNER_COUNTRY_DIAL_CODE[ownerCountry]}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit_document_id">Cédula/documento</Label>
            <DocumentIdInput
              id="edit_document_id"
              country={ownerCountry}
              value={documentIdValue}
              onChange={(next) => {
                setDocumentIdValue(next);
                recheck("document_id", formRef.current);
              }}
              required
              invalid={Boolean(errors.document_id)}
            />
            {errors.document_id ? (
              <p className="text-xs text-destructive">{errors.document_id}</p>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit_address">Dirección (opcional)</Label>
            <Input id="edit_address" name="address" defaultValue={client.address ?? ""} />
          </div>

          {state.error && !errorPausada ? (

            <p className="text-sm text-destructive">{state.error}</p>

          ) : null}

          {/* ── CT-28: la cédula ya es de otro, y eso deja de ser un muro ──
              Era el ÚNICO de los tres sitios donde se teclea una cédula que no
              daba salida: el alta ofrece «Crear cuenta separada» desde la 034 y
              la importación lo ofrece desde CT-29b. Lo que esto rompía, medido
              el 2026-10-02: una ficha creada deprisa sin cédula a la que tres
              semanas después se le quiere poner la suya. No se podía, y la
              única salida visible era borrarla y rehacerla — perdiendo sus
              movimientos, que son deudas.

              LA FICHA ENTERA Y CON EL SALDO, no una frase con un nombre. Es lo
              que convierte esto en una decisión informada en vez de un botón que
              se pulsa sin leer: nadie confirma «es otra cuenta de la misma
              persona» viendo que la otra debe $3.016 y no la reconoce. */}
          {duplicados.length > 0 ? (
            <div className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/20 dark:bg-amber-500/10">
              <p className="flex items-start gap-1.5 text-sm">
                <UserRoundSearch className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" />
                <span>
                  {duplicados.length > 1
                    ? `Esa cédula ya es de ${duplicados.length} clientes tuyos.`
                    : `Esa cédula ya es de “${duplicados[0].name}”.`}
                  <span className="mt-1 block text-muted-foreground">
                    Revísala, o confirma que le estás abriendo una cuenta aparte a la misma
                    persona.
                  </span>
                </span>
              </p>

              <div className="flex flex-col gap-2">
                {duplicados.map((d) => (
                  <div key={d.id} className="flex flex-col gap-1.5">
                    <FichaDeCliente
                      nombre={d.name}
                      documento={d.document_id}
                      whatsapp={d.whatsapp}
                      debe={loQueDebe(d)}
                      oculto={d.hidden}
                    />
                    {/* Misma salida que ofrece el alta: poder ir a mirar la otra
                        ficha antes de decidir. */}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-fit"
                      onClick={() => {
                        setOpen(false);
                        router.push(`/clients/${d.id}`);
                      }}
                    >
                      Ver cuenta de {d.name}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <DialogFooter className={duplicados.length > 0 ? "flex-col gap-2 sm:flex-col" : undefined}>
            {duplicados.length > 0 ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" className="w-full" disabled={pending}>
                    Sí, es otra cuenta de la misma persona
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>¿Dos cuentas con la misma cédula?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {duplicados.length > 1
                        ? `Ya tienes ${duplicados.length} clientes con esta cédula.`
                        : `Ya tienes a ${duplicados[0].name} con esta cédula.`}{" "}
                      Solo continúa si es a propósito — por ejemplo, llevarle la cuenta personal
                      y la del negocio por separado a un mismo cliente.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={confirmarDuplicadoYGuardar}>
                      Sí, son cuentas separadas
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : null}
            <Button
              type="submit"
              disabled={pending}
              variant={duplicados.length > 0 ? "outline" : "default"}
              className={duplicados.length > 0 ? "w-full" : undefined}
            >
              {pending ? "Guardando..." : "Guardar cambios"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
