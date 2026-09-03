"use client";

import { useActionState, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { signup, type SignupState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WhatsappInput } from "@/components/whatsapp-input";
import { PasswordCriteriaChecklist } from "@/components/password-criteria-checklist";
import { getPasswordCriteria } from "@/lib/password";
import { OWNER_COUNTRY_DIAL_CODE } from "@/lib/countries";
import type { OwnerCountry } from "@/lib/types";
import { useFieldErrors, useFormRef } from "@/hooks/use-field-errors";
import { required, email as emailRule, whatsapp as whatsappRule, confirmPassword } from "@/lib/form-validation";

const initialState: SignupState = { error: null, success: false };

// Dial code each country's WhatsApp field jumps to the moment "País" changes
// — the owner can still pick a different code afterward, this just saves
// the common case of it matching their own country.

export default function SignupPage() {
  const [state, formAction, pending] = useActionState(signup, initialState);
  // Defaults to VE — most signups right now are Venezuelan business owners.
  // This is the only place an owner ever sets their country: it can't be
  // changed later from "Mi negocio" since currency and future DIAN/SENIAT
  // rules key off of it. If a slow connection meant this page's JS hadn't
  // hydrated yet when the owner tapped submit, the browser falls back to a
  // real form POST — a genuine page reload that would otherwise silently
  // wipe every field. state.values (echoed back by the action on any
  // failure) is what this initial value and every defaultValue below
  // restore from, so that reload doesn't lose what was already typed.
  const [country, setCountry] = useState<OwnerCountry>(
    () => (state.values?.country as OwnerCountry) || "VE",
  );
  const [password, setPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [formRef, setFormRef] = useFormRef();
  // Password itself isn't in here: the checklist above already shows exactly
  // what's unmet per-criterion, richer than one general message, and the
  // submit button stays disabled until it's satisfied — a redundant red
  // error would just repeat what the checklist already says.
  const { errors, validate, recheck } = useFieldErrors({
    business_name: required,
    first_name: required,
    last_name: required,
    whatsapp: whatsappRule,
    email: emailRule,
    confirm_password: confirmPassword("password"),
  });

  const passwordMeetsCriteria = getPasswordCriteria(password).every((c) => c.met);

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
          <form
            ref={setFormRef}
            action={formAction}
            onSubmit={(e) => {
              if (!validate(e.currentTarget)) e.preventDefault();
            }}
            className="flex flex-col gap-4"
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="business_name">Nombre del negocio</Label>
              <Input
                id="business_name"
                name="business_name"
                defaultValue={state.values?.business_name ?? ""}
                required
                aria-invalid={Boolean(errors.business_name)}
                onChange={() => recheck("business_name", formRef.current)}
              />
              {errors.business_name ? (
                <p className="text-xs text-destructive">{errors.business_name}</p>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="first_name">Nombre</Label>
                <Input
                  id="first_name"
                  name="first_name"
                  autoComplete="given-name"
                  defaultValue={state.values?.first_name ?? ""}
                  required
                  aria-invalid={Boolean(errors.first_name)}
                  onChange={() => recheck("first_name", formRef.current)}
                />
                {errors.first_name ? (
                  <p className="text-xs text-destructive">{errors.first_name}</p>
                ) : null}
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="last_name">Apellido</Label>
                <Input
                  id="last_name"
                  name="last_name"
                  autoComplete="family-name"
                  defaultValue={state.values?.last_name ?? ""}
                  required
                  aria-invalid={Boolean(errors.last_name)}
                  onChange={() => recheck("last_name", formRef.current)}
                />
                {errors.last_name ? (
                  <p className="text-xs text-destructive">{errors.last_name}</p>
                ) : null}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="country">País</Label>
              <Select
                name="country"
                value={country}
                onValueChange={(v) => setCountry(v as OwnerCountry)}
              >
                <SelectTrigger id="country" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CO">Colombia (COP)</SelectItem>
                  <SelectItem value="VE">Venezuela (Bs)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                No podrás cambiarlo después — contáctanos si necesitas hacerlo.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="whatsapp">WhatsApp</Label>
              <WhatsappInput
                id="whatsapp"
                name="whatsapp"
                required
                defaultValue={state.values?.whatsapp}
                preferredDialCode={OWNER_COUNTRY_DIAL_CODE[country]}
                invalid={Boolean(errors.whatsapp)}
                onValueChange={() => recheck("whatsapp", formRef.current)}
              />
              {errors.whatsapp ? <p className="text-xs text-destructive">{errors.whatsapp}</p> : null}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Correo</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                defaultValue={state.values?.email ?? ""}
                required
                aria-invalid={Boolean(errors.email)}
                onChange={() => recheck("email", formRef.current)}
              />
              {errors.email ? <p className="text-xs text-destructive">{errors.email}</p> : null}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Contraseña</Label>
              <PasswordInput
                id="password"
                name="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  // A confirm error is "doesn't match password" — it can go
                  // stale the moment password itself changes, not just when
                  // confirm_password does.
                  recheck("confirm_password", formRef.current);
                }}
                aria-describedby="password-criteria"
              />
              <PasswordCriteriaChecklist id="password-criteria" password={password} />
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
            <div className="flex items-start gap-2">
              <Checkbox
                id="accepted_terms"
                name="accepted_terms"
                required
                checked={acceptedTerms}
                onCheckedChange={(checked) => setAcceptedTerms(checked === true)}
                className="mt-0.5"
              />
              <Label htmlFor="accepted_terms" className="text-sm font-normal">
                Acepto los{" "}
                <a
                  href="https://sevenz.site/terminos-y-condiciones"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-foreground underline underline-offset-4"
                >
                  Términos y condiciones
                </a>
              </Label>
            </div>
            {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
            {state.alreadyRegistered ? (
              <Button asChild variant="secondary" className="w-full">
                <Link href="/login">Ir a iniciar sesión</Link>
              </Button>
            ) : null}
            <Button
              type="submit"
              className="w-full"
              disabled={pending || !acceptedTerms || !passwordMeetsCriteria}
            >
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
