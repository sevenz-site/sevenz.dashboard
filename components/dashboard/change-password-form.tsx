"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { changePassword, type PasswordState } from "@/app/(app)/profile/actions";
import { PasswordCriteriaChecklist } from "@/components/password-criteria-checklist";

const initialState: PasswordState = { error: null, success: false };

// Its own component so the form's key-based remount on success (below) also
// resets this field's local state for free — no effect-driven setState needed.
function NewPasswordField() {
  const [password, setPassword] = useState("");
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="new_password">Nueva contraseña</Label>
      <PasswordInput
        id="new_password"
        name="new_password"
        autoComplete="new-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        aria-describedby="new-password-criteria"
      />
      <PasswordCriteriaChecklist id="new-password-criteria" password={password} />
    </div>
  );
}

export function ChangePasswordForm({ onSuccess }: { onSuccess?: () => void }) {
  const [state, formAction, pending] = useActionState(changePassword, initialState);

  useEffect(() => {
    if (state === initialState || pending) return;
    if (state.success) {
      toast.success("Contraseña actualizada");
      onSuccess?.();
    }
  }, [state, pending, onSuccess]);

  return (
    <form
      action={formAction}
      key={state.success ? "reset" : "form"}
      className="flex max-w-sm flex-col gap-4"
    >
      <NewPasswordField />
      <div className="flex flex-col gap-2">
        <Label htmlFor="confirm_password">Confirmar contraseña</Label>
        <PasswordInput
          id="confirm_password"
          name="confirm_password"
          autoComplete="new-password"
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
