"use client";

import { useActionState } from "react";
import Image from "next/image";
import Link from "next/link";
import { signup, type SignupState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { WhatsappInput } from "@/components/whatsapp-input";

const initialState: SignupState = { error: null, success: false };

export default function SignupPage() {
  const [state, formAction, pending] = useActionState(signup, initialState);

  if (state.success) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <Image src="/logo.svg" alt="Sevenz" width={120} height={37} className="mb-2" />
            <CardTitle className="text-xl">Revisa tu correo</CardTitle>
            <CardDescription>
              Te enviamos un enlace para confirmar tu cuenta antes de entrar.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button asChild className="w-full">
              <Link href="/login">Iniciar sesión</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <Image src="/logo.svg" alt="Sevenz" width={120} height={37} className="mb-2" />
          <CardTitle className="text-xl">Crea tu cuenta</CardTitle>
          <CardDescription>Empieza a compartir el saldo con tus clientes.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="business_name">Nombre del negocio</Label>
              <Input id="business_name" name="business_name" required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="first_name">Nombre</Label>
                <Input id="first_name" name="first_name" autoComplete="given-name" required />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="last_name">Apellido</Label>
                <Input id="last_name" name="last_name" autoComplete="family-name" required />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="whatsapp">WhatsApp</Label>
              <WhatsappInput id="whatsapp" name="whatsapp" required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Correo</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                name="password"
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
            {state.alreadyRegistered ? (
              <Button asChild variant="secondary" className="w-full">
                <Link href="/login">Ir a iniciar sesión</Link>
              </Button>
            ) : null}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "Creando..." : "Crear cuenta"}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            ¿Ya tienes cuenta?{" "}
            <Link href="/login" className="font-medium text-foreground underline underline-offset-4">
              Entra
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
