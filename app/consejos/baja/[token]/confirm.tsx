"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { confirmUnsubscribe, type UnsubscribeState } from "./actions";

const initial: UnsubscribeState = { done: false, error: null };

// The heading, the copy and the button, all here: once the tap succeeds the whole screen is the
// answer, title included. With the title in the page, «¿Dejar de recibir consejos?» stayed on top
// of «Listo», which reads as if nothing had happened (seen in the capture of 2026-11-17). Unlike
// «No fui yo», the link stays valid after use, so a re-render of the page cannot say «done».
// See page.tsx for why the GET changes nothing.
export function ConfirmUnsubscribe({ token }: { token: string }) {
  const [state, action, pending] = useActionState(confirmUnsubscribe, initial);

  if (state.done) {
    return (
      <>
        <h1 className="text-xl font-semibold">Listo: ya no te enviaremos consejos</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Sigues recibiendo los avisos de tu negocio. Si cambias de idea, actívalos en Mi negocio, en Notificaciones.
        </p>
      </>
    );
  }

  return (
    <>
      <h1 className="text-xl font-semibold">¿Dejar de recibir consejos?</h1>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Dejarás de recibir por WhatsApp y por correo las ideas para sacarle provecho a Sevenz. Los avisos de tu negocio siguen llegando.
      </p>
      <form action={action} className="flex w-full flex-col gap-2">
        <input type="hidden" name="token" value={token} />
        <Button type="submit" className="h-10 w-full" disabled={pending}>
          {pending ? "Guardando…" : "Dejar de recibir consejos"}
        </Button>
        {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      </form>
    </>
  );
}
