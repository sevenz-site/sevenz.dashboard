"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { changePassword, type PasswordState } from "@/app/(app)/profile/actions";
import { PasswordCriteriaChecklist } from "@/components/password-criteria-checklist";
import { useFieldErrors, useFormRef } from "@/hooks/use-field-errors";
import { newPassword, confirmPassword } from "@/lib/form-validation";

const initialState: PasswordState = { error: null, success: false };

// Its own component so the form's key-based remount on success (below) also
// resets this field's local state for free — no effect-driven setState needed.
function NewPasswordField({
  error,
  onValueChange,
}: {
  error?: string;
  onValueChange: () => void;
}) {
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
        onChange={(e) => {
          setPassword(e.target.value);
          onValueChange();
        }}
        aria-invalid={Boolean(error)}
        aria-describedby="new-password-criteria"
      />
      <PasswordCriteriaChecklist id="new-password-criteria" password={password} />
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

export function ChangePasswordForm({ onSuccess }: { onSuccess?: () => void }) {
  const [state, formAction, pending] = useActionState(changePassword, initialState);
  const [formRef, setFormRef] = useFormRef();
  const { errors, validate, recheck } = useFieldErrors({
    new_password: newPassword,
    confirm_password: confirmPassword("new_password"),
  });

  useEffect(() => {
    if (state === initialState || pending) return;
    if (state.success) {
      toast.success("Contraseña actualizada");
      onSuccess?.();
    }
  }, [state, pending, onSuccess]);

  return (
    <form
      ref={setFormRef}
      action={formAction}
      key={state.success ? "reset" : "form"}
      onSubmit={(e) => {
        if (!validate(e.currentTarget)) e.preventDefault();
      }}
      className="flex max-w-sm flex-col gap-4"
    >
      <NewPasswordField
        error={errors.new_password}
        onValueChange={() => {
          recheck("new_password", formRef.current);
          // A confirm error is "doesn't match new_password" — it can go
          // stale the moment new_password itself changes, not just when
          // confirm_password does.
          recheck("confirm_password", formRef.current);
        }}
      />
      <div className="flex flex-col gap-2">
        <Label htmlFor="confirm_password">Confirmar contraseña</Label>
        <PasswordInput
          id="confirm_password"
          name="confirm_password"
          autoComplete="new-password"
          required
          aria-invalid={Boolean(errors.confirm_password)}
          onChange={() => recheck("confirm_password", formRef.current)}
        />
        {errors.confirm_password ? (
          <p className="text-xs text-destructive">{errors.confirm_password}</p>
        ) : null}
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Actualizando..." : "Actualizar contraseña"}
      </Button>
    </form>
  );
}
