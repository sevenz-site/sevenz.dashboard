"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changePassword, type PasswordState } from "@/app/(app)/profile/actions";

const initialState: PasswordState = { error: null, success: false };

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState(changePassword, initialState);

  useEffect(() => {
    if (state === initialState || pending) return;
    if (state.success) toast.success("Contraseña actualizada");
  }, [state, pending]);

  return (
    <form
      action={formAction}
      key={state.success ? "reset" : "form"}
      className="flex max-w-sm flex-col gap-4"
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="new_password">Nueva contraseña</Label>
        <Input
          id="new_password"
          name="new_password"
          type="password"
          autoComplete="new-password"
          minLength={6}
          required
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="confirm_password">Confirmar contraseña</Label>
        <Input
          id="confirm_password"
          name="confirm_password"
          type="password"
          autoComplete="new-password"
          minLength={6}
          required
        />
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Actualizando..." : "Actualizar contraseña"}
      </Button>
    </form>
  );
}
