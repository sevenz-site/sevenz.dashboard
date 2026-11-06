"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { WhatsappInput } from "@/components/whatsapp-input";
import { CodeInput } from "@/components/ui/code-input";
import { confirmNumberChange, startNumberChange, type SecurityState } from "@/app/(app)/profile/security-actions";

const idle: SecurityState = { error: null, notice: null, step: "idle" };

// CHANGING THE ACCOUNT'S WHATSAPP (C1 of PL-22). Two steps: the password and the new
// number, then the code that number received. The old number is told by WhatsApp when the
// alert template exists (`notifyAccountChange`). Owner's decision of 2026-11-05: *«para
// cambiar número pedimos contraseña»*.
export function ChangeWhatsappDialog({ current, preferredDialCode }: { current: string | null; preferredDialCode?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [startState, startAction, starting] = useActionState(startNumberChange, idle);
  const [confirmState, confirmAction, confirming] = useActionState(confirmNumberChange, idle);
  const [round, setRound] = useState(0);

  const step = confirmState.step === "done" ? "done" : confirmState.step === "idle" && confirmState.error ? "idle" : startState.step === "sent" ? "sent" : "idle";

  // Derived during render, the way DialogoDeAccion does it (no setState inside effects).
  const [seen, setSeen] = useState({ startState, confirmState });
  if (seen.startState !== startState || seen.confirmState !== confirmState) {
    setSeen({ startState, confirmState });
    if (startState !== seen.startState && startState.step === "sent") setRound((r) => r + 1);
    if (confirmState !== seen.confirmState && confirmState.step === "done") setOpen(false);
  }
  useEffect(() => {
    if (confirmState.step === "done" && confirmState.notice) {
      toast.success(confirmState.notice);
      router.refresh();
    }
  }, [confirmState, router]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="h-10 w-fit text-base font-semibold">
          {current ? "Cambiar" : "Agregar número"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{current ? "Cambiar el WhatsApp de tu cuenta" : "Agregar el WhatsApp de tu cuenta"}</DialogTitle>
          <DialogDescription>
            {step === "sent"
              ? "Escribe el código que llegó al número nuevo. Hasta que no lo escribas, el número no cambia."
              : "Escribe tu contraseña y el número nuevo. Le enviaremos un código para comprobar que es tuyo."}
          </DialogDescription>
        </DialogHeader>

        {step !== "sent" ? (
          <form action={startAction} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="number_password">Tu contraseña</Label>
              <PasswordInput id="number_password" name="password" autoComplete="current-password" required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="new_whatsapp">Número nuevo</Label>
              <WhatsappInput id="new_whatsapp" name="whatsapp" defaultValue={null} required preferredDialCode={preferredDialCode} />
            </div>
            {startState.error || confirmState.error ? (
              <p className="text-sm text-destructive">{startState.error ?? confirmState.error}</p>
            ) : null}
            <Button type="submit" disabled={starting} className="h-10 w-full text-base font-semibold">
              {starting ? "Enviando..." : "Enviar código al número nuevo"}
            </Button>
          </form>
        ) : (
          <div className="flex flex-col gap-4">
            {startState.notice ? <p className="text-sm text-emerald-700 dark:text-emerald-400">{startState.notice}</p> : null}
            <form action={confirmAction} className="flex flex-col gap-2">
              <Label htmlFor="code">Código de 6 dígitos</Label>
              <CodeInput key={round} disabled={confirming} invalid={Boolean(confirmState.error)} />
              {confirmState.error ? <p className="text-sm text-destructive">{confirmState.error}</p> : null}
              <Button type="submit" disabled={confirming} className="h-10 w-full text-base font-semibold">
                {confirming ? "Comprobando..." : "Guardar número"}
              </Button>
            </form>
            <p className="text-xs text-muted-foreground">
              ¿No llegó? Cierra esta ventana y vuelve a empezar: te pediremos la contraseña otra vez y enviaremos un código nuevo.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
