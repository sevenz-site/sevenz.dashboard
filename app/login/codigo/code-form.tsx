"use client";

import { useActionState, useEffect, useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { CodeInput } from "@/components/ui/code-input";
import { AuthBackLink } from "@/components/auth-back-link";
import { CODE_TTL_MINUTES, RESEND_WAIT_SECONDS } from "@/lib/security/code-text";
import { abandonLoginCode, resendLoginCode, verifyLoginCode, type CodeState } from "./actions";

const initial: CodeState = { error: null, notice: null };

// Counts down from RESEND_WAIT_SECONDS and says when it is over. Restarts whenever `round`
// changes (a new code went out). The clock is read inside the effect, never during render.
function useCountdown(round: number): number {
  const [left, setLeft] = useState(RESEND_WAIT_SECONDS);
  useEffect(() => {
    const since = Date.now();
    const tick = () => setLeft(Math.max(0, RESEND_WAIT_SECONDS - Math.floor((Date.now() - since) / 1000)));
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [round]);
  return left;
}

// WHAT THE SHOPKEEPER SEES WHILE THE CODE IS ON ITS WAY. Every state has a sentence, owner's
// rule of 2026-11-05: where it went, how long it lasts, how many tries are left, that a new
// one was sent, and where else it can go. The email fallback appears after the first
// resend; before that the fix for «no me llega» is to wait the minute and resend.
export function CodeForm({
  channel,
  masked,
  resends,
  hasWhatsapp,
  maskedEmail,
}: {
  channel: "whatsapp" | "email";
  masked: string;
  resends: number;
  hasWhatsapp: boolean;
  maskedEmail: string;
}) {
  const [verifyState, verifyAction, verifying] = useActionState(verifyLoginCode, initial);
  const [resendState, resendAction, resending] = useActionState(resendLoginCode, initial);
  const [round, setRound] = useState(0);
  const left = useCountdown(round);

  // A resend (or an expired code replaced on the spot) restarts the minute and clears the
  // field. Derived during render from the action states, the way DialogoDeAccion does it.
  const [seen, setSeen] = useState({ resendState, verifyState });
  if (seen.resendState !== resendState || seen.verifyState !== verifyState) {
    setSeen({ resendState, verifyState });
    if (resendState.notice || verifyState.notice) setRound((r) => r + 1);
  }

  const notice = resendState.notice ?? verifyState.notice;
  const error = verifyState.error ?? resendState.error;
  const emailOffered = channel === "whatsapp" && resends >= 1;

  return (
    <div className="flex flex-1 flex-col">
      <AuthBackLink href="/login" label="Volver a entrar" />
      <div className="flex flex-1 items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <Image src="/logo-primary.svg" alt="Sevenz" width={120} height={44} className="mb-2" />
            <CardTitle className="text-xl">Escribe el código</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              {channel === "whatsapp"
                ? `Te enviamos un código al WhatsApp que termina en ${masked.replace("···· ", "")}.`
                : `Te enviamos un código al correo ${masked}.`}{" "}
              Vale {CODE_TTL_MINUTES} minutos.
            </p>

            <form action={verifyAction} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="code">Código de 6 dígitos</Label>
                <CodeInput key={round} disabled={verifying} invalid={Boolean(verifyState.error)} />
              </div>
              {notice ? <p className="text-sm text-emerald-700">{notice}</p> : null}
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <Button type="submit" className="w-full" disabled={verifying}>
                {verifying ? "Comprobando..." : "Confirmar"}
              </Button>
            </form>

            <form action={resendAction} className="flex flex-col gap-2">
              <input type="hidden" name="channel" value="same" />
              <Button type="submit" variant="outline" className="w-full" disabled={resending || left > 0}>
                {resending ? "Enviando..." : left > 0 ? `Reenviar código (${left} s)` : "Reenviar código"}
              </Button>
            </form>

            {emailOffered ? (
              <form action={resendAction} className="flex flex-col gap-1">
                <input type="hidden" name="channel" value="email" />
                <p className="text-sm text-muted-foreground">¿No te llega?</p>
                <Button type="submit" variant="ghost" className="w-full" disabled={resending}>
                  Enviarlo al correo {maskedEmail}
                </Button>
              </form>
            ) : null}

            {!hasWhatsapp && channel === "email" ? (
              <p className="text-xs text-muted-foreground">
                Tu cuenta no tiene número de WhatsApp, así que el código va al correo.
              </p>
            ) : null}

            <form action={abandonLoginCode}>
              <Button type="submit" variant="link" className="w-full text-muted-foreground">
                Entrar con otra cuenta
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
