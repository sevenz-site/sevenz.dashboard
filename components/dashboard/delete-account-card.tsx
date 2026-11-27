"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Clock, Mail, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CodeInput } from "@/components/ui/code-input";
import { CODE_TTL_MINUTES } from "@/lib/security/code-text";
import {
  cancelAccountDeletion,
  confirmAccountDeletion,
  startAccountDeletion,
  type DeletionState,
} from "@/app/(app)/profile/delete-account-actions";

const idle: DeletionState = { error: null, notice: null, step: "idle" };

// «ELIMINAR MI CUENTA» (PL-48, step 1.3). Frames «Eliminar · 1-5», approved by the owner on
// 2026-11-20, in the Figma section «Propuesta · Play Store, fase 1». The last card of
// «Seguridad de la cuenta» in Mi negocio. While a request is open it becomes the 30-day card
// (`DeletionPendingCard`), which Inicio shows too.
//
// The button is a red OUTLINE, not a filled one: it is a way out, not the screen's action.
export function DeleteAccountCard({ maskedEmail, pendingUntil }: { maskedEmail: string | null; pendingUntil: string | null }) {
  if (pendingUntil) return <DeletionPendingCard until={pendingUntil} />;
  return (
    <section className="flex flex-col gap-2 rounded-[10px] border p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm">Eliminar mi cuenta</p>
        <DeleteDialog maskedEmail={maskedEmail} />
      </div>
      <p className="text-xs text-muted-foreground">
        Borra tu negocio, tus clientes, tus productos y todo tu historial. Tienes 30 días para arrepentirte.
      </p>
    </section>
  );
}

function DeleteDialog({ maskedEmail }: { maskedEmail: string | null }) {
  const [open, setOpen] = useState(false);
  const [startState, startAction, starting] = useActionState(() => startAccountDeletion(), idle);
  const [confirmState, confirmAction, confirming] = useActionState(confirmAccountDeletion, idle);
  const [round, setRound] = useState(0);
  const formId = useId();

  // The dialog follows the server: 'sent' shows the code step; 'done' closes with a toast.
  const step = confirmState.step === "done" ? "done" : confirmState.step === "sent" || startState.step === "sent" ? "sent" : "idle";

  // Derived during render, the way SecondFactorCard does it (no setState inside effects).
  const [seen, setSeen] = useState({ startState, confirmState });
  if (seen.startState !== startState || seen.confirmState !== confirmState) {
    setSeen({ startState, confirmState });
    if (startState !== seen.startState && startState.step === "sent") setRound((r) => r + 1);
    if (confirmState !== seen.confirmState && confirmState.step === "done") setOpen(false);
  }
  useEffect(() => {
    if (confirmState.step === "done" && confirmState.notice) toast.success(confirmState.notice);
  }, [confirmState]);

  const error = confirmState.error ?? startState.error;
  const email = maskedEmail ?? "tu correo";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="h-10 w-fit text-base font-semibold text-destructive hover:text-destructive">
          <Trash2 className="size-4" aria-hidden />
          Eliminar
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        {step !== "sent" ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Trash2 className="size-5 shrink-0 text-destructive" aria-hidden />
                ¿Eliminar tu cuenta?
              </DialogTitle>
              <DialogDescription asChild>
                <ul className="flex flex-col gap-1 text-left">
                  <li>• Se borrarán tu negocio, tus clientes, tus productos y todo tu historial.</li>
                  <li>• Los enlaces de saldo que les mandaste a tus clientes y tu catálogo dejarán de funcionar.</li>
                  <li>
                    • Tienes 30 días para arrepentirte: hasta entonces puedes cancelarlo desde Mi negocio. Después no se
                    puede recuperar.
                  </li>
                </ul>
              </DialogDescription>
            </DialogHeader>
            <p className="text-sm">Para confirmarlo te enviaremos un código a {email}.</p>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {/* Phone: the action first and full width. From md the pair sits in a row with
                the action on the right, like the other desktop dialogs (frame «Eliminar · 5»). */}
            <div className="flex flex-col gap-2 md:flex-row-reverse md:justify-start">
              <form action={startAction} className="md:contents">
                <Button type="submit" variant="destructive" disabled={starting} className="h-10 w-full text-base font-semibold md:w-fit">
                  {starting ? "Enviando..." : "Enviar código"}
                </Button>
              </form>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} className="h-10 w-full text-base font-semibold md:w-fit">
                Cancelar
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Mail className="size-5 shrink-0" aria-hidden />
                Escribe el código
              </DialogTitle>
              <DialogDescription>
                Te lo enviamos a {email}. Vence en {CODE_TTL_MINUTES} minutos.
              </DialogDescription>
            </DialogHeader>
            <form id={formId} action={confirmAction} className="flex flex-col gap-3">
              <CodeInput key={round} disabled={confirming} invalid={Boolean(confirmState.error)} />
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
            </form>
            <form action={startAction}>
              <button
                type="submit"
                disabled={starting}
                className="text-sm font-medium underline underline-offset-4 disabled:opacity-50"
              >
                {starting ? "Enviando..." : "Reenviar código"}
              </button>
            </form>
            <div className="flex flex-col gap-2 md:flex-row-reverse md:justify-start">
              <Button
                type="submit"
                form={formId}
                variant="destructive"
                disabled={confirming}
                className="h-10 w-full text-base font-semibold md:w-fit"
              >
                {confirming ? "Comprobando..." : "Eliminar mi cuenta"}
              </Button>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} className="h-10 w-full text-base font-semibold md:w-fit">
                Cancelar
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// The 30 days (frame «Eliminar · 4»). Also at the top of Inicio, so the owner who asked by
// mistake finds the way back without looking for it in Mi negocio. `until` comes formatted
// from the server, in the business's own zone.
export function DeletionPendingCard({ until }: { until: string }) {
  // The toast fires as the answer arrives, not from an effect: a successful cancel
  // revalidates the page, which removes this very card, and an effect waiting for the next
  // render of an unmounted card never runs. Found on the first walk, 2026-11-27: the request
  // was cancelled and the owner was told nothing.
  const [, action, pending] = useActionState(async () => {
    const result = await cancelAccountDeletion();
    if (result.error) toast.error(result.error);
    else if (result.notice) toast.success(result.notice);
    return result;
  }, idle);

  return (
    <section className="flex flex-col gap-3 rounded-[10px] border border-destructive/30 bg-destructive/5 p-4">
      <div className="flex items-start gap-2">
        <Clock className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-destructive">Tu cuenta se eliminará el {until}</p>
          <p className="text-xs text-muted-foreground">
            Hasta ese día puedes seguir usándola. Si cambias de opinión, cancélalo aquí.
          </p>
        </div>
      </div>
      <form action={action}>
        <Button type="submit" variant="outline" disabled={pending} className="h-10 w-fit text-base font-semibold">
          {pending ? "Cancelando..." : "Cancelar eliminación"}
        </Button>
      </form>
    </section>
  );
}
