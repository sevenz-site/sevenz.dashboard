"use client";

import Image from "next/image";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { logout } from "@/app/(app)/actions";
import { requestPasswordReset, type ForgotPasswordState } from "@/app/forgot-password/actions";

const initial: ForgotPasswordState = { error: null, success: false };

// THE SCREEN AN ACCOUNT SEES AFTER «NO FUI YO», UNTIL THE PASSWORD CHANGES (C2 of PL-22).
//
// Drawn by the app layout instead of a redirect: /login bounces a signed-in visitor to
// /dashboard, so redirecting there would loop. It replaces the whole app, so whoever holds a
// session that survived the purge (an access token has up to 60 minutes left) sees no screen
// and no data. The thief and the owner see the same thing; only the owner's mailbox has the
// way out.
export function ResetRequired({ email }: { email: string | null }) {
  const [state, resend, pending] = useActionState(requestPasswordReset, initial);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-4 px-4 py-10 text-center">
      <Image src="/fav-icon-primary.svg" alt="Sevenz" width={48} height={48} className="size-12" />
      <h1 className="text-xl font-semibold">Por seguridad, elige una contraseña nueva</h1>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Alguien indicó que un inicio de sesión en esta cuenta no fue suyo, así que cerramos todas las sesiones. Te enviamos un enlace al correo para elegir una contraseña nueva. Hasta entonces la app queda cerrada.
      </p>
      <form action={resend} className="flex w-full flex-col gap-2">
        <input type="hidden" name="email" value={email ?? ""} />
        <Button type="submit" variant="outline" className="h-10 w-full" disabled={pending || !email}>
          {pending ? "Enviando…" : "Volver a enviar el enlace"}
        </Button>
        {state.success ? <p className="text-sm text-muted-foreground">Enviado. Revisa tu correo.</p> : null}
      </form>
      <form
        action={async () => {
          await logout("global");
        }}
        className="w-full"
      >
        <Button type="submit" variant="ghost" className="h-10 w-full">
          Cerrar sesión
        </Button>
      </form>
    </main>
  );
}
