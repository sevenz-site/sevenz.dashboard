"use client";

import { useActionState } from "react";
import Image from "next/image";
import { resetPassword, type ResetPasswordState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";

const initialState: ResetPasswordState = { error: null };

export default function ResetPasswordPage() {
  const [state, formAction, pending] = useActionState(resetPassword, initialState);

  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <Image src="/logo.svg" alt="Sevenz" width={120} height={37} className="mb-2" />
          <CardDescription>Elige tu nueva contraseña.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="flex flex-col gap-4">
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
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "Guardando..." : "Guardar contraseña"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
