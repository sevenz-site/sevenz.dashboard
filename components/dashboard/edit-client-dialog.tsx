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
import type { Client } from "@/lib/types";

const initialState: EditClientState = { error: null, success: false };

export function EditClientDialog({ client }: { client: Client }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(updateClient, initialState);
  const [handledState, setHandledState] = useState(state);

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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Pencil className="size-4" />
          Editar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar cliente</DialogTitle>
          <DialogDescription>Actualiza los datos de contacto.</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="client_id" value={client.id} />

          <div className="flex flex-col gap-2">
            <Label htmlFor="edit_name">Nombre del cliente</Label>
            <Input id="edit_name" name="name" defaultValue={client.name} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit_whatsapp">WhatsApp (opcional)</Label>
            <WhatsappInput id="edit_whatsapp" name="whatsapp" defaultValue={client.whatsapp} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit_document_id">Cédula/documento (opcional)</Label>
            <Input id="edit_document_id" name="document_id" defaultValue={client.document_id ?? ""} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit_address">Dirección (opcional)</Label>
            <Input id="edit_address" name="address" defaultValue={client.address ?? ""} />
          </div>

          {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}

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
