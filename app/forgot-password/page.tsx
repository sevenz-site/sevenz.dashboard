"use client";

import { useActionState } from "react";
import Image from "next/image";
import Link from "next/link";
import { requestPasswordReset, type ForgotPasswordState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";

const initialState: ForgotPasswordState = { error: null, success: false };

export default function ForgotPasswordPage() {
  const [state, formAction, pending] = useActionState(requestPasswordReset, initialState);

  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <Image src="/logo.svg" alt="Sevenz" width={120} height={37} className="mb-2" />
          <CardDescription>
            {state.success
              ? "Revisa tu correo para continuar."
              : "Escribe tu correo y te enviamos un link para recuperar tu contraseña."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {state.success ? (
            <p className="text-sm text-muted-foreground">
              Si ese correo tiene una cuenta en Sevenz, te llegará un link para elegir una
              contraseña nueva.
            </p>
          ) : (
            <form action={formAction} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">Correo</Label>
                <Input id="email" name="email" type="email" autoComplete="email" required />
              </div>
              {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
              <Button type="submit" className="w-full" disabled={pending}>
                {pending ? "Enviando..." : "Enviar link"}
              </Button>
            </form>
          )}
          <p className="mt-4 text-center text-sm text-muted-foreground">
            <Link href="/login" className="font-medium text-foreground underline underline-offset-4">
              Volver a entrar
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
