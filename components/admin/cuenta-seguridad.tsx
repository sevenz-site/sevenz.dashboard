"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { KeyRound, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CodeInput } from "@/components/ui/code-input";
import { Fila, Grupo } from "@/components/dashboard/detail-rows";
import type { CuentaSeguridad } from "@/lib/admin/security";
import { auditDetail, auditTitle } from "@/lib/admin/history";
import { maskEmail, maskPhone } from "@/lib/security/code-text";
import {
  accionCambiarCorreo,
  accionEnviarCodigoAdmin,
  accionReenviarRecuperacion,
  accionVerificarCodigoAdmin,
  type AdminSecurityState,
} from "@/app/admin/cuentas/security-actions";

const idle: AdminSecurityState = { error: null, notice: null };

function fecha(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("es-VE", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Caracas" }).format(new Date(iso));
}

// «SEGURIDAD» ON THE ACCOUNT'S ADMIN PAGE (C1 of PL-22). Two buttons, and the one that
// changes the email is a checklist the server enforces again: code to the account's
// WhatsApp, typed back, then the new address twice. The owner's decision of 2026-11-05:
// the screen shows what to ask and in what order, so whoever takes the call follows it.
export function CuentaSeguridad({ ownerId, cuenta }: { ownerId: string; cuenta: CuentaSeguridad }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col">
        <h2 className="text-lg font-semibold">Seguridad</h2>
        <p className="text-sm text-muted-foreground">
          Cómo entra esta cuenta, y las dos cosas que Sevenz puede hacer por el dueño cuando se queda fuera.
        </p>
      </div>

      <dl className="flex flex-col gap-4 rounded-lg border p-4">
        <Grupo>
          <Fila nombre="Verificación en dos pasos">{cuenta.second_factor ? "Activa" : "Desactivada"}</Fila>
          <Fila nombre="Aparatos conocidos">{cuenta.known_devices}</Fila>
          <Fila nombre="Última ciudad vista">{cuenta.last_login_city ?? "—"}</Fila>
        </Grupo>
      </dl>

      <div className="flex flex-wrap gap-2">
        <ReenviarRecuperacion ownerId={ownerId} email={cuenta.email} />
        <CambiarCorreo ownerId={ownerId} cuenta={cuenta} />
      </div>

      {cuenta.audit.length > 0 ? (
        <ul className="flex flex-col divide-y rounded-lg border">
          {cuenta.audit.map((a, i) => (
            <li key={i} className="flex flex-col gap-0.5 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{auditTitle(a)}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{fecha(a.at)}</span>
              </div>
              <span className="text-xs text-muted-foreground">{auditDetail(a)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function ReenviarRecuperacion({ ownerId, email }: { ownerId: string; email: string }) {
  const [state, action, pending] = useActionState(accionReenviarRecuperacion, idle);
  useEffect(() => {
    if (state.notice) toast.success(state.notice);
    if (state.error) toast.error(state.error);
  }, [state]);
  return (
    <form action={action}>
      <input type="hidden" name="owner_id" value={ownerId} />
      <Button type="submit" variant="outline" size="sm" disabled={pending} title={`A ${maskEmail(email)}`}>
        <KeyRound className="size-4" />
        {pending ? "Enviando…" : "Reenviar correo para recuperar contraseña"}
      </Button>
    </form>
  );
}

function CambiarCorreo({ ownerId, cuenta }: { ownerId: string; cuenta: CuentaSeguridad }) {
  const [open, setOpen] = useState(false);
  const [sendState, sendAction, sending] = useActionState(accionEnviarCodigoAdmin, idle);
  const [checkState, checkAction, checking] = useActionState(accionVerificarCodigoAdmin, idle);
  const [changeState, changeAction, changing] = useActionState(accionCambiarCorreo, idle);
  const [round, setRound] = useState(0);
  const verified = checkState.verified === true;
  const sinWhatsapp = !cuenta.whatsapp;

  // Derived during render, the way DialogoDeAccion does it (no setState inside effects).
  const [seen, setSeen] = useState({ sendState, changeState });
  if (seen.sendState !== sendState || seen.changeState !== changeState) {
    setSeen({ sendState, changeState });
    if (sendState !== seen.sendState && sendState.notice) setRound((r) => r + 1);
    if (changeState !== seen.changeState && changeState.notice) setOpen(false);
  }
  useEffect(() => {
    if (changeState.notice) toast.success(changeState.notice);
  }, [changeState]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Mail className="size-4" />
          Cambiar correo
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cambiar el correo de {cuenta.business_name || "esta cuenta"}</DialogTitle>
          <DialogDescription>
            Es la llave de la cuenta: quien tenga el correo nuevo elige la contraseña. Sigue los pasos en orden; el botón de guardar no se activa hasta el paso 1 en verde.
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: the code to the WhatsApp the account already has. */}
        <section className="flex flex-col gap-2 rounded-lg border p-3">
          <p className="text-sm font-medium">1. Comprueba que es el dueño</p>
          {sinWhatsapp ? (
            <p className="text-xs text-muted-foreground">
              La cuenta no tiene WhatsApp. Pregúntale por los datos del paso 2 y escribe abajo cómo lo comprobaste: queda en el historial.
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Envía un código al WhatsApp {maskPhone(cuenta.whatsapp)} y pídele que te lo lea. Tú lo escribes aquí.
              </p>
              <form action={sendAction}>
                <input type="hidden" name="owner_id" value={ownerId} />
                <Button type="submit" variant="outline" size="sm" disabled={sending || verified}>
                  {sending ? "Enviando…" : sendState.notice ? "Enviar otro código" : "Enviar código al WhatsApp"}
                </Button>
              </form>
              {sendState.notice ? <p className="text-xs text-emerald-700 dark:text-emerald-400">{sendState.notice}</p> : null}
              {sendState.error ? <p className="text-xs text-destructive">{sendState.error}</p> : null}
              {sendState.notice && !verified ? (
                <form action={checkAction} className="flex flex-col gap-2">
                  <input type="hidden" name="owner_id" value={ownerId} />
                  <Label htmlFor="code">Lo que te leyó</Label>
                  <CodeInput key={round} autoSubmit={false} disabled={checking} invalid={Boolean(checkState.error)} />
                  <Button type="submit" size="sm" disabled={checking} className="w-fit">
                    {checking ? "Comprobando…" : "Comprobar"}
                  </Button>
                </form>
              ) : null}
              {checkState.error ? <p className="text-xs text-destructive">No coincide: {checkState.error}</p> : null}
              {verified ? <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">✓ {checkState.notice}</p> : null}
            </>
          )}
        </section>

        {/* Step 2: facts to ask about without reading them out. */}
        <section className="flex flex-col gap-2 rounded-lg border p-3">
          <p className="text-sm font-medium">2. Pregúntale cosas de aquí, sin leérselas</p>
          <dl className="flex flex-col gap-2">
            <Grupo>
              <Fila nombre="Nombre del negocio">{cuenta.business_name || "—"}</Fila>
              <Fila nombre="Nombre del dueño">{cuenta.first_name ?? "—"}</Fila>
              <Fila nombre="País">{cuenta.country}</Fila>
              <Fila nombre="Se registró">{fecha(cuenta.created_at)}</Fila>
              <Fila nombre="Clientes">{cuenta.clients}</Fila>
              <Fila nombre="Última venta">{fecha(cuenta.last_sale_at)}</Fila>
              <Fila nombre="Ventas en 30 días">{cuenta.sales_30d}</Fila>
              <Fila nombre="Correo actual">{maskEmail(cuenta.email)}</Fila>
            </Grupo>
          </dl>
        </section>

        {/* Step 3: the new address, twice. */}
        <form action={changeAction} className="flex flex-col gap-3 rounded-lg border p-3">
          <input type="hidden" name="owner_id" value={ownerId} />
          <p className="text-sm font-medium">3. El correo nuevo</p>
          <div className="flex flex-col gap-2">
            <Label htmlFor="admin_email">Correo nuevo</Label>
            <Input id="admin_email" name="email" type="email" autoComplete="off" required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="admin_email_again">Escríbelo otra vez</Label>
            <Input id="admin_email_again" name="email_again" type="email" autoComplete="off" required />
          </div>
          {sinWhatsapp ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="otra_via">Cómo comprobaste que es el dueño</Label>
              <Textarea id="otra_via" name="otra_via" rows={3} minLength={10} required placeholder="Me llamó desde el número de la tienda y supo su última venta…" />
            </div>
          ) : null}
          {changeState.error ? <p className="text-xs text-destructive">{changeState.error}</p> : null}
          <Button type="submit" disabled={changing || (!verified && !sinWhatsapp)}>
            {changing ? "Cambiando…" : "Cambiar el correo"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Al cambiarlo, el dueño recibe un WhatsApp con el aviso y un botón «No fui yo». Después, reenvíale el correo para recuperar contraseña.
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
}
