"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
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
import { required, whatsapp as whatsappRule } from "@/lib/form-validation";
import {
  useErrorDeCuentaPausada,
  useGuardiaDeCuentaPausada,
} from "@/components/dashboard/cuenta-pausada";

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
  const { errors, validate, recheck, reset } = useFieldErrors({
    name: required,
    whatsapp: whatsappRule,
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
        if (!next) reset();
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
            <Label htmlFor="edit_whatsapp">WhatsApp</Label>
            <WhatsappInput
              id="edit_whatsapp"
              name="whatsapp"
              defaultValue={client.whatsapp}
              required
              preferredDialCode={OWNER_COUNTRY_DIAL_CODE[ownerCountry]}
              invalid={Boolean(errors.whatsapp)}
              onValueChange={() => recheck("whatsapp", formRef.current)}
            />
            {errors.whatsapp ? <p className="text-xs text-destructive">{errors.whatsapp}</p> : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit_document_id">Cédula/documento</Label>
            <Input
              id="edit_document_id"
              name="document_id"
              defaultValue={client.document_id ?? ""}
              required
              aria-invalid={Boolean(errors.document_id)}
              onChange={() => recheck("document_id", formRef.current)}
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

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Guardando..." : "Guardar cambios"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
