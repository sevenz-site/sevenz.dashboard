"use client";

import { useActionState, useEffect, useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { resetPassword, type ResetPasswordState } from "./actions";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { PasswordCriteriaChecklist } from "@/components/password-criteria-checklist";
import { useFieldErrors, useFormRef } from "@/hooks/use-field-errors";
import { newPassword, confirmPassword } from "@/lib/form-validation";

const initialState: ResetPasswordState = { error: null };

type SessionStatus = "checking" | "ready" | "invalid";

export default function ResetPasswordPage() {
  const [status, setStatus] = useState<SessionStatus>("checking");
  const [state, formAction, pending] = useActionState(resetPassword, initialState);
  const [password, setPassword] = useState("");
  const [formRef, setFormRef] = useFormRef();
  const { errors, validate, recheck } = useFieldErrors({
    new_password: newPassword,
    confirm_password: confirmPassword("new_password"),
  });

  // Supabase's recovery link lands here with a code/token in the URL. The
  // browser client auto-detects it, exchanges it for a real session, and
  // writes it to cookies (so the server action below can read it too) —
  // that's what we're waiting on before showing the form.
  useEffect(() => {
    const supabase = createClient();
    let settled = false;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session && !settled) {
        settled = true;
        setStatus("ready");
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === "PASSWORD_RECOVERY" || session) && !settled) {
        settled = true;
        setStatus("ready");
      }
    });

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        setStatus("invalid");
      }
    }, 4000);

    return () => {
      listener.subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <Image src="/logo.svg" alt="Sevenz" width={120} height={37} className="mb-2" />
          <CardDescription>Elige tu nueva contraseña.</CardDescription>
        </CardHeader>
        <CardContent>
          {status === "checking" ? (
            <p className="text-sm text-muted-foreground">Verificando tu link...</p>
          ) : status === "invalid" ? (
            <p className="text-sm text-destructive">
              El link expiró o ya se usó. Vuelve a la pantalla de inicio de sesión y solicita uno
              nuevo.
            </p>
          ) : (
            <form
              ref={setFormRef}
              action={formAction}
              onSubmit={(e) => {
                if (!validate(e.currentTarget)) e.preventDefault();
              }}
              className="flex flex-col gap-4"
            >
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
                    recheck("new_password", formRef.current);
                    // A confirm error is "doesn't match new_password" — it
                    // can go stale the moment new_password itself changes,
                    // not just when confirm_password does.
                    recheck("confirm_password", formRef.current);
                  }}
                  aria-invalid={Boolean(errors.new_password)}
                  aria-describedby="new-password-criteria"
                />
                <PasswordCriteriaChecklist id="new-password-criteria" password={password} />
                {errors.new_password ? (
                  <p className="text-xs text-destructive">{errors.new_password}</p>
                ) : null}
              </div>
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
              <Button type="submit" className="w-full" disabled={pending}>
                {pending ? "Guardando..." : "Guardar contraseña"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
