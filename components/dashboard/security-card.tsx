"use client";

import { useActionState, useEffect, useId, useState } from "react";
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
import { CodeInput } from "@/components/ui/code-input";
import { Badge } from "@/components/ui/badge";
import { CUENTA_BADGE_CLASS } from "@/lib/types";
import {
  confirmSecondFactorEnable,
  disableSecondFactor,
  startSecondFactorEnable,
  type SecurityState,
} from "@/app/(app)/profile/security-actions";

const idle: SecurityState = { error: null, notice: null, step: "idle" };

// «VERIFICACIÓN EN DOS PASOS» (C1 of PL-22), the card under «Seguridad de la cuenta» in
// Mi negocio. Optional, owner's decision of 2026-11-05. Turning it on is two steps in one
// dialog — send the test code to the account's WhatsApp, type it — and nothing is saved
// until the second passes. Turning it off asks for the password.
export function SecondFactorCard({ enabled, maskedWhatsapp }: { enabled: boolean; maskedWhatsapp: string | null }) {
  return (
    <section className="flex flex-col gap-3 rounded-[10px] border p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">Verificación en dos pasos</p>
          <p className="text-xs text-muted-foreground">
            {enabled
              ? `Al entrar desde un aparato nuevo te pedimos un código por WhatsApp (${maskedWhatsapp ?? "tu número"}), y también para cambiar tu contraseña.`
              : "Al entrar desde un aparato nuevo te pediremos un código por WhatsApp, además de tu contraseña. Si no te llega, lo enviamos a tu correo."}
          </p>
        </div>
        {/* Badge with the shared palette (lib/types), never classes by hand: the rule of chip-de-estado. */}
        <Badge variant="outline" className={enabled ? CUENTA_BADGE_CLASS.activa_free : CUENTA_BADGE_CLASS.cancelada}>
          {enabled ? "Activa" : "Desactivada"}
        </Badge>
      </div>
      {enabled ? <DisableDialog /> : <EnableDialog maskedWhatsapp={maskedWhatsapp} />}
    </section>
  );
}

function EnableDialog({ maskedWhatsapp }: { maskedWhatsapp: string | null }) {
  const [open, setOpen] = useState(false);
  const [startState, startAction, starting] = useActionState(() => startSecondFactorEnable(), idle);
  const [confirmState, confirmAction, confirming] = useActionState(confirmSecondFactorEnable, idle);
  const [round, setRound] = useState(0);
  const formId = useId();

  // The dialog follows the server: 'sent' shows the code field; 'done' closes with a toast.
  const step = confirmState.step === "done" ? "done" : confirmState.step === "sent" || startState.step === "sent" ? "sent" : "idle";

  // Derived during render, the way DialogoDeAccion does it (no setState inside effects).
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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="h-10 w-fit text-base font-semibold" disabled={!maskedWhatsapp}>
          Activar
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Activar la verificación en dos pasos</DialogTitle>
          <DialogDescription>
            {step === "sent"
              ? "Escribe el código que te llegó. Hasta que no lo escribas, no se activa nada."
              : `Te enviaremos un código de prueba al WhatsApp ${maskedWhatsapp ?? ""}. Al escribirlo aquí, la verificación queda activa.`}
          </DialogDescription>
        </DialogHeader>

        {step !== "sent" ? (
          <form action={startAction} className="flex flex-col gap-3">
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" disabled={starting} className="h-10 w-full text-base font-semibold">
              {starting ? "Enviando..." : "Enviar código de prueba"}
            </Button>
          </form>
        ) : (
          <div className="flex flex-col gap-4">
            {startState.notice ? <p className="text-sm text-emerald-700 dark:text-emerald-400">{startState.notice}</p> : null}
            <form id={formId} action={confirmAction} className="flex flex-col gap-2">
              <Label htmlFor="code">Código de 6 dígitos</Label>
              <CodeInput key={round} disabled={confirming} invalid={Boolean(confirmState.error)} />
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <Button type="submit" disabled={confirming} className="h-10 w-full text-base font-semibold">
                {confirming ? "Comprobando..." : "Activar"}
              </Button>
            </form>
            <form action={startAction}>
              <Button type="submit" variant="ghost" disabled={starting} className="w-full">
                {starting ? "Enviando..." : "Reenviar código"}
              </Button>
            </form>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DisableDialog() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(disableSecondFactor, idle);

  const [seen, setSeen] = useState(state);
  if (seen !== state) {
    setSeen(state);
    if (state.step === "done") setOpen(false);
  }
  useEffect(() => {
    if (state.step === "done" && state.notice) toast.success(state.notice);
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="h-10 w-fit text-base font-semibold">
          Desactivar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Desactivar la verificación en dos pasos</DialogTitle>
          <DialogDescription>
            Escribe tu contraseña para confirmar. Después, con la contraseña bastará para entrar desde cualquier aparato.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="flex flex-col gap-3">
          <Label htmlFor="disable_password">Contraseña</Label>
          <PasswordInput id="disable_password" name="password" autoComplete="current-password" required />
          {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
          <Button type="submit" variant="destructive" disabled={pending} className="h-10 w-full text-base font-semibold">
            {pending ? "Comprobando..." : "Desactivar"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
