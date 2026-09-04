"use client";

import { Suspense, useActionState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { login, type AuthState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { useFieldErrors, useFormRef } from "@/hooks/use-field-errors";
import { email as emailRule, required } from "@/lib/form-validation";

const initialState: AuthState = { error: null };

function LinkExpiredNotice() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  if (!error) return null;
  return <p className="text-sm text-destructive">{error}</p>;
}

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, initialState);
  const [formRef, setFormRef] = useFormRef();
  // Login only checks that a password was typed, never the complexity
  // policy — an account created before that policy existed still has to be
  // able to sign in with its real (older) password.
  const { errors, validate, recheck } = useFieldErrors({ email: emailRule, password: required });

  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <Image src="/logo.svg" alt="Sevenz" width={120} height={37} className="mb-2" />
          <CardDescription>Entra a tu cuenta para ver tu cartera.</CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={null}>
            <LinkExpiredNotice />
          </Suspense>
          <form
            ref={setFormRef}
            action={formAction}
            onSubmit={(e) => {
              if (!validate(e.currentTarget)) e.preventDefault();
            }}
            className="mt-4 flex flex-col gap-4"
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Correo</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                defaultValue={state.email ?? ""}
                required
                aria-invalid={Boolean(errors.email)}
                onChange={() => recheck("email", formRef.current)}
              />
              {errors.email ? <p className="text-xs text-destructive">{errors.email}</p> : null}
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Contraseña</Label>
                <Link
                  href="/forgot-password"
                  className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
                >
                  ¿Olvidaste tu contraseña?
                </Link>
              </div>
              <PasswordInput
                id="password"
                name="password"
                autoComplete="current-password"
                required
                aria-invalid={Boolean(errors.password)}
                onChange={() => recheck("password", formRef.current)}
              />
              {errors.password ? <p className="text-xs text-destructive">{errors.password}</p> : null}
            </div>
            {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "Entrando..." : "Entrar"}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            ¿No tienes cuenta?{" "}
            <Link href="/signup" className="font-medium text-foreground underline underline-offset-4">
              Regístrate
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
