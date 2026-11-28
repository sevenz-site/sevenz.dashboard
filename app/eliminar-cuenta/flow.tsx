"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CodeInput } from "@/components/ui/code-input";
import { CODE_TTL_MINUTES } from "@/lib/security/code-text";
import { confirmWebDeletion, requestWebDeletionCode, type WebDeletionState } from "./actions";

const initial: WebDeletionState = { step: "email", error: null, masked: null, date: null };

// The three steps of the web door: the email, the code, and the date. ONE state, and each
// form says what it wants in `intent`: with two separate action states, the screen read the
// last one used and got stuck on an old error after «Usar otro correo». The bullets of what is
// deleted sit on the code step, right above the button that confirms, where the Mi negocio
// dialog puts them.
export function WebDeletionFlow() {
  const [state, action, pending] = useActionState(async (prev: WebDeletionState, formData: FormData) => {
    const intent = formData.get("intent");
    if (intent === "restart") return initial;
    if (intent === "confirm") return confirmWebDeletion(prev, formData);
    return requestWebDeletionCode(prev, formData);
  }, initial);

  if (state.step === "done") {
    return (
      <section className="flex flex-col gap-1 rounded-[10px] border border-destructive/30 bg-destructive/5 p-4">
        <p className="text-sm font-medium text-destructive">Tu cuenta se eliminará el {state.date}</p>
        <p className="text-sm text-muted-foreground">
          Hasta ese día puedes seguir usándola. Si cambias de opinión, entra a Sevenz, abre Mi negocio y toca «Cancelar
          eliminación». Te enviamos un correo con esta fecha.
        </p>
      </section>
    );
  }

  if (state.step === "code") {
    return (
      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold">Escribe el código</h2>
          <p className="text-sm text-muted-foreground">
            Si {state.masked} tiene una cuenta en Sevenz, te enviamos un código de 6 cifras. Vence en {CODE_TTL_MINUTES}{" "}
            minutos. Revisa también la carpeta de spam.
          </p>
        </div>
        <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
          <li>• Se borrarán tu negocio, tus clientes, tus productos y todo tu historial.</li>
          <li>• Los enlaces de saldo que les mandaste a tus clientes y tu catálogo dejarán de funcionar.</li>
          <li>• Tienes 30 días para arrepentirte. Después no se puede recuperar.</li>
        </ul>
        <form action={action} className="flex flex-col gap-3">
          <input type="hidden" name="intent" value="confirm" />
          <Label htmlFor="code">Código de 6 dígitos</Label>
          <CodeInput disabled={pending} invalid={Boolean(state.error)} />
          {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
          <Button type="submit" variant="destructive" disabled={pending} className="h-10 w-full text-base font-semibold md:w-fit">
            {pending ? "Comprobando..." : "Eliminar mi cuenta"}
          </Button>
        </form>
        <form action={action}>
          <input type="hidden" name="intent" value="restart" />
          <Button type="submit" variant="ghost" disabled={pending} className="w-full md:w-fit">
            Usar otro correo o pedir un código nuevo
          </Button>
        </form>
      </section>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="intent" value="request" />
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">Sin la app</h2>
        <p className="text-sm text-muted-foreground">Escribe el correo con el que entras. Te enviaremos un código para confirmarlo.</p>
      </div>
      <Label htmlFor="email">Correo</Label>
      {/* 16px text: under 16px, iPhone Safari zooms into the field on focus. */}
      <Input id="email" name="email" type="email" inputMode="email" autoComplete="email" required placeholder="tucorreo@ejemplo.com" className="h-11 text-base" />
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <Button type="submit" disabled={pending} className="h-10 w-full text-base font-semibold md:w-fit">
        {pending ? "Enviando..." : "Enviar código"}
      </Button>
    </form>
  );
}
