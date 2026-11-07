"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { CodeInput } from "@/components/ui/code-input";
import { changePassword, type PasswordState } from "@/app/(app)/profile/actions";
import { startPasswordChangeCode, type SecurityState } from "@/app/(app)/profile/security-actions";
import { PasswordCriteriaChecklist } from "@/components/password-criteria-checklist";
import { useFieldErrors, useFormRef } from "@/hooks/use-field-errors";
import { newPassword, confirmPassword } from "@/lib/form-validation";

const initialState: PasswordState = { error: null, success: false };
const idle: SecurityState = { error: null, notice: null, step: "idle" };

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

// WITH THE FACTOR ON, A CODE COMES FIRST (C1 of PL-22, owner's decision of 2026-11-05). The
// form opens on «Enviar código»; once it is out, the code field appears above the new
// password and the server verifies it before looking at the password. Without the factor
// the form is the one of 2026-11-02, unchanged.
export function ChangePasswordForm({ secondFactor, onSuccess }: { secondFactor: boolean; onSuccess?: () => void }) {
  const [state, formAction, pending] = useActionState(changePassword, initialState);
  const [codeState, codeAction, sending] = useActionState(startPasswordChangeCode, idle);
  const [round, setRound] = useState(0);
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

  // A new code clears the field: derived during render (no setState inside effects).
  const [seenCode, setSeenCode] = useState(codeState);
  if (seenCode !== codeState) {
    setSeenCode(codeState);
    if (codeState.step === "sent") setRound((r) => r + 1);
  }

  const codeSent = !secondFactor || codeState.step === "sent";

  if (!codeSent) {
    return (
      <div className="flex max-w-sm flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Por seguridad, antes de cambiarla te enviamos un código a tu WhatsApp.
        </p>
        <form action={codeAction} className="flex flex-col gap-2">
          <input type="hidden" name="channel" value="whatsapp" />
          {codeState.error ? <p className="text-sm text-destructive">{codeState.error}</p> : null}
          <Button type="submit" disabled={sending} className="w-fit">
            {sending ? "Enviando..." : "Enviar código"}
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex max-w-sm flex-col gap-4">
    {/* THE RESEND BUTTONS LIVE OUTSIDE THE PASSWORD FORM. Inside it they were submit
        buttons of a form whose onSubmit validates the two password fields, so «Enviarlo al
        correo» with the fields still empty was silently blocked. Found on the owner's own
        test, 2026-11-05. The code field itself stays in the form: it travels with the
        password. */}
    {secondFactor ? (
      <div className="flex flex-col gap-2">
        {codeState.notice ? <p className="text-sm text-emerald-700 dark:text-emerald-400">{codeState.notice}</p> : null}
        {codeState.error ? <p className="text-sm text-destructive">{codeState.error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <form action={codeAction}>
            <input type="hidden" name="channel" value="whatsapp" />
            <Button type="submit" variant="ghost" size="sm" disabled={sending}>
              Reenviar al WhatsApp
            </Button>
          </form>
          <form action={codeAction}>
            <input type="hidden" name="channel" value="email" />
            <Button type="submit" variant="ghost" size="sm" disabled={sending}>
              Enviarlo al correo
            </Button>
          </form>
        </div>
      </div>
    ) : null}
    <form
      ref={setFormRef}
      action={formAction}
      key={state.success ? "reset" : "form"}
      onSubmit={(e) => {
        if (!validate(e.currentTarget)) e.preventDefault();
      }}
      className="flex flex-col gap-4"
    >
      {secondFactor ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="code">Código de 6 dígitos</Label>
          <CodeInput key={round} autoSubmit={false} disabled={pending} invalid={Boolean(state.error)} />
        </div>
      ) : null}
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
    </div>
  );
}
