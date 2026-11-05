"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { confirmNotMe, type NotMeState } from "./actions";

const initial: NotMeState = { done: false, error: null };

// One button, nothing to type. See page.tsx for why the GET never closes anything.
export function ConfirmNotMe({ token }: { token: string }) {
  const [state, action, pending] = useActionState(confirmNotMe, initial);

  if (state.done) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Listo. Cerramos todas las sesiones de tu cuenta.</p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Te enviamos un enlace al correo para elegir una contraseña nueva. Hasta que la cambies, nadie puede entrar con la anterior.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="flex w-full flex-col gap-2">
      <input type="hidden" name="token" value={token} />
      <Button type="submit" className="h-10 w-full" disabled={pending}>
        {pending ? "Cerrando sesiones…" : "Sí, cerrar todas las sesiones"}
      </Button>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
    </form>
  );
}
