"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { flagClient, unflagClient, type FlagClientState } from "@/app/(app)/clients/[id]/actions";
import { useFieldErrors, useFormRef } from "@/hooks/use-field-errors";
import { required } from "@/lib/form-validation";

const initialState: FlagClientState = { error: null, success: false };

export function ClientFlagControl({
  clientId,
  clientName,
  isFlagged,
}: {
  clientId: string;
  clientName: string;
  isFlagged: boolean;
}) {
  const router = useRouter();
  const checkboxId = useId();
  const [markOpen, setMarkOpen] = useState(false);
  const [confirmUnmarkOpen, setConfirmUnmarkOpen] = useState(false);
  const [state, formAction, pending] = useActionState(flagClient, initialState);
  const [unflagging, setUnflagging] = useState(false);
  const [formRef, setFormRef] = useFormRef();
  const { errors, validate, recheck, reset: resetErrors } = useFieldErrors({ reason: required });

  const [handledState, setHandledState] = useState(state);
  if (state !== handledState && state.success) {
    setHandledState(state);
    setMarkOpen(false);
  }

  useEffect(() => {
    if (state === initialState || pending) return;
    if (state.success) {
      toast.success(`${clientName} marcado como mala paga`);
      router.refresh();
    }
  }, [state, pending, router, clientName]);

  function handleCheckedChange(checked: boolean) {
    if (checked) setMarkOpen(true);
    else setConfirmUnmarkOpen(true);
  }

  async function handleUnflag() {
    setUnflagging(true);
    const result = await unflagClient(clientId);
    setUnflagging(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success("Marca quitada");
    setConfirmUnmarkOpen(false);
    router.refresh();
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <Checkbox id={checkboxId} checked={isFlagged} onCheckedChange={(v) => handleCheckedChange(v === true)} />
        <Label htmlFor={checkboxId}>
          {isFlagged ? "Desmarcar como mala paga" : "Marcar como mala paga"}
        </Label>
      </div>

      <Dialog
        open={markOpen}
        onOpenChange={(next) => {
          setMarkOpen(next);
          // Radix doesn't guarantee this content unmounts on close, so
          // without this a validation error from a previous open could
          // still be showing red the next time this dialog opens.
          if (!next) resetErrors();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Marcar a {clientName} como mala paga</DialogTitle>
            <DialogDescription>
              Registrar un nuevo fiado para este cliente pedirá confirmación cada vez, hasta que
              quites la marca.
            </DialogDescription>
          </DialogHeader>
          <form
            ref={setFormRef}
            action={formAction}
            onSubmit={(e) => {
              if (!validate(e.currentTarget)) e.preventDefault();
            }}
            className="flex flex-col gap-4"
          >
            <input type="hidden" name="client_id" value={clientId} />
            <div className="flex flex-col gap-2">
              <Label htmlFor="reason">Motivo</Label>
              <Textarea
                id="reason"
                name="reason"
                required
                placeholder="¿Por qué ya no le vas a fiar?"
                aria-invalid={Boolean(errors.reason)}
                onChange={() => recheck("reason", formRef.current)}
              />
              {errors.reason ? <p className="text-xs text-destructive">{errors.reason}</p> : null}
            </div>
            {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
            <DialogFooter>
              <Button type="submit" variant="destructive" disabled={pending}>
                {pending ? "Marcando..." : "Marcar como mala paga"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmUnmarkOpen} onOpenChange={setConfirmUnmarkOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Quitar la marca de mala paga?</AlertDialogTitle>
            <AlertDialogDescription>
              {clientName} podrá volver a recibir fiado sin que el sistema te lo advierta. El
              motivo original queda en su historial.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleUnflag} disabled={unflagging}>
              {unflagging ? "Quitando..." : "Desmarcar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
