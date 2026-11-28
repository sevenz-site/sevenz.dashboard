"use client";

import { useActionState, useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { accionBorrarCuenta, type BorrarState } from "./actions";

const initial: BorrarState = { error: null, ok: false, resumen: null };

// «Borrar ahora». Owner's decision of 2026-11-28: to delete, the business name has to be typed
// as it is, so a wrong tap, or a tap on the row next to it, cannot erase a business. The button
// stays off until the name matches; the server checks it again (actions.ts).
export function BorrarCuentaDialog({ requestId, businessName, disabled }: { requestId: string; businessName: string; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  // The toast fires with the answer, not from an effect: the row's state changes on
  // revalidation and this dialog may already be gone (the same trap as «Cancelar eliminación»).
  const [state, action, pending] = useActionState(async (prev: BorrarState, formData: FormData) => {
    const r = await accionBorrarCuenta(prev, formData);
    if (r.ok) {
      toast.success(r.resumen ?? "Cuenta eliminada.");
      setOpen(false);
    }
    return r;
  }, initial);

  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLocaleLowerCase("es");
  const coincide = businessName !== "" && norm(typed) === norm(businessName);

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setTyped(""); }}>
      <DialogTrigger asChild>
        <Button variant="destructive" className="h-10 w-full md:w-fit" disabled={disabled}>
          <Trash2 className="size-4" aria-hidden />
          Borrar ahora
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Borrar «{businessName}»</DialogTitle>
          <DialogDescription>
            No se puede deshacer. Se cierra el acceso y se borran sus clientes, su historial, sus productos, su catálogo,
            sus pedidos y sus archivos. La ficha, los pagos, el KAM y el registro de seguridad se quedan en /admin.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="flex flex-col gap-3">
          <input type="hidden" name="request_id" value={requestId} />
          <Label htmlFor={`nombre-${requestId}`}>Escribe el nombre del negocio para confirmar</Label>
          <Input
            id={`nombre-${requestId}`}
            name="business_name"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            placeholder={businessName}
            className="h-11 text-base"
          />
          {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
          <Button type="submit" variant="destructive" disabled={!coincide || pending} className="h-10 w-full">
            {pending ? "Borrando..." : "Borrar la cuenta"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
