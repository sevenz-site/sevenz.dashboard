"use client";

import { useActionState, useId, useState } from "react";
import { Ban, CalendarClock, CreditCard, Gift, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  accionBloquear,
  accionCambiarPlan,
  accionDarDemo,
  accionDesbloquear,
  accionRegistrarPago,
  type AccionState,
} from "@/app/admin/cuentas/actions";
import type { Cuenta } from "@/lib/admin/subscriptions";

const inicial: AccionState = { error: null, ok: false };

// Los tres botones de una cuenta.
//
// EL ORDEN NO ES CASUAL: "Registrar pago" va el primero. Cuando la Fase 3
// traiga "Bloquear", el botón que cobra tiene que estar antes que el que
// castiga — el peor escenario de todo este sistema es bloquear a alguien que
// sí pagó, y el orden de los botones empuja al orden correcto de los actos.
export function CuentaAcciones({ cuenta }: { cuenta: Cuenta }) {
  return (
    <div className="flex flex-wrap gap-2">
      <RegistrarPago cuenta={cuenta} />
      <DarDemo cuenta={cuenta} />
      <CambiarPlan cuenta={cuenta} />
      {cuenta.estado === "bloqueada" ? (
        <Desbloquear cuenta={cuenta} />
      ) : (
        <Bloquear cuenta={cuenta} />
      )}
    </div>
  );
}

function Bloquear({ cuenta }: { cuenta: Cuenta }) {
  const formId = useId();
  const [state, formAction, pending] = useActionState(accionBloquear, inicial);

  return (
    <DialogoDeAccion
      titulo={`Bloquear a ${cuenta.business_name}`}
      descripcion="Deja de poder fiar, abonar, crear clientes e importar. Sigue viendo su cartera y el enlace de sus clientes sigue funcionando."
      disparador={
        <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive">
          <Ban className="size-4" />
          Bloquear
        </Button>
      }
      state={state}
      pending={pending}
      formId={formId}
    >
      <form id={formId} action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="owner_id" value={cuenta.owner_id} />
        <div className="flex flex-col gap-2">
          <Label htmlFor={`motivo-${formId}`}>Por qué lo bloqueas</Label>
          <Input
            id={`motivo-${formId}`}
            name="motivo"
            placeholder="No paga desde julio; avisado dos veces"
            required
          />
          <p className="text-xs text-muted-foreground">
            Obligatorio, y queda en el historial. El día que diga que sí pagó, esta nota es la
            respuesta. Él no la ve.
          </p>
        </div>
        <p className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Al tendero le saldrá: «Tu cuenta está pausada. Escríbenos por WhatsApp para reactivarla.»
          Sin el motivo.
        </p>
      </form>
    </DialogoDeAccion>
  );
}

function Desbloquear({ cuenta }: { cuenta: Cuenta }) {
  const formId = useId();
  const [state, formAction, pending] = useActionState(accionDesbloquear, inicial);

  return (
    <DialogoDeAccion
      titulo={`Reactivar a ${cuenta.business_name}`}
      descripcion="Vuelve a poder registrar movimientos. Queda como activa, no como demo."
      disparador={
        <Button type="button" variant="outline" size="sm">
          <Undo2 className="size-4" />
          Reactivar
        </Button>
      }
      state={state}
      pending={pending}
      formId={formId}
    >
      <form id={formId} action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="owner_id" value={cuenta.owner_id} />
        <div className="flex flex-col gap-2">
          <Label htmlFor={`motivo-re-${formId}`}>Nota (opcional)</Label>
          <Input id={`motivo-re-${formId}`} name="motivo" placeholder="Pagó lo pendiente" />
        </div>
        {/* Si volvía de una demo, no vuelve a demo: una prueba que se bloqueó y
            se reactiva ya no es una prueba. Si hay que darle más días, se le da
            una demo nueva y queda dicho en el historial. */}
        {cuenta.demo_termina_el ? (
          <p className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Estaba en demo. Al reactivar queda como activa, no vuelve a la prueba. Si quieres darle
            más días, usa «Dar demo» después.
          </p>
        ) : null}
      </form>
    </DialogoDeAccion>
  );
}

// Un diálogo con su formulario. Se cierra solo cuando la acción responde bien,
// y deja el error dentro cuando no — si se cerrara siempre, el error se iría
// con él.
function DialogoDeAccion({
  titulo,
  descripcion,
  disparador,
  state,
  children,
  pending,
  formId,
}: {
  titulo: string;
  descripcion: string;
  disparador: React.ReactNode;
  state: AccionState;
  children: React.ReactNode;
  pending: boolean;
  // ÚNICO por diálogo, y esto era un fallo de verdad. El botón de enviar vive
  // fuera del <form> —está en el pie del diálogo— así que los une el atributo
  // form="...". Con un id fijo, los 24 negocios × 3 diálogos daban 72
  // elementos con el MISMO id, y el navegador resuelve al primero del
  // documento: pulsar "Confirmar" en la fila 20 habría enviado el formulario
  // de la fila 1. Cambiarle el plan al negocio equivocado, en silencio.
  formId: string;
}) {
  const [open, setOpen] = useState(false);
  const [visto, setVisto] = useState(state);

  if (state !== visto) {
    setVisto(state);
    if (state.ok) setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{disparador}</DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>{descripcion}</DialogDescription>
        </DialogHeader>
        {children}
        {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
        <DialogFooter>
          <Button type="submit" form={formId} disabled={pending}>
            {pending ? "Guardando…" : "Confirmar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DarDemo({ cuenta }: { cuenta: Cuenta }) {
  const formId = useId();
  const [state, formAction, pending] = useActionState(accionDarDemo, inicial);
  // 60 días es el defecto acordado, pero se teclea: el trato real no cabe en
  // una lista de botones. Mismo razonamiento que "Otro plazo…" en el fiado.
  const [dias, setDias] = useState("60");

  return (
    <DialogoDeAccion
      titulo={`Dar demo a ${cuenta.business_name}`}
      descripcion="Acceso completo durante los días que acuerden, y el precio que pagará después. Al vencer NO se baja sola: aparece en la lista de vencidas para que decidas."
      disparador={
        <Button type="button" variant="outline" size="sm">
          <Gift className="size-4" />
          Dar demo
        </Button>
      }
      state={state}
      pending={pending}
      formId={formId}
    >
      <form id={formId} action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="owner_id" value={cuenta.owner_id} />
        <div className="flex flex-col gap-2">
          <Label htmlFor="dias">Días de demo</Label>
          <div className="flex flex-wrap gap-2">
            {["30", "60", "90"].map((d) => (
              <Button
                key={d}
                type="button"
                size="sm"
                variant={dias === d ? "default" : "outline"}
                className="rounded-full px-3.5"
                onClick={() => setDias(d)}
              >
                {d} días
              </Button>
            ))}
          </div>
          <Input
            id="dias"
            name="dias"
            type="number"
            min="1"
            max="365"
            inputMode="numeric"
            value={dias}
            onChange={(e) => setDias(e.target.value)}
            className="w-32"
          />
          <p className="text-xs text-muted-foreground">
            Termina al final de ese día, hora de Caracas. Se le empezaría a cobrar al día
            siguiente.
          </p>
        </div>
        {/* El precio se acuerda en la MISMA conversación que los días. Antes
            había que acordarse de abrir "Cambiar plan" semanas después, justo
            cuando ya nadie recuerda qué se dijo. */}
        <div className="flex flex-col gap-2">
          <Label htmlFor="precio-demo">Qué pagará al terminar (USD)</Label>
          <Input
            id="precio-demo"
            name="precio"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            placeholder="20"
            defaultValue={cuenta.precio_pactado_usd ?? ""}
            className="w-32"
          />
          <p className="text-xs text-muted-foreground">
            Déjalo vacío si todavía no hablaron de precio. Vacío no es gratis — para eso está el
            plan Free.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="periodicidad-demo">Cada cuánto pagará</Label>
          <Select name="periodicidad" defaultValue={cuenta.periodicidad ?? "mensual"}>
            <SelectTrigger id="periodicidad-demo" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mensual">Mensual</SelectItem>
              <SelectItem value="trimestral">Trimestral</SelectItem>
              <SelectItem value="anual">Anual</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="notas-demo">Nota (opcional)</Label>
          <Input id="notas-demo" name="notas" placeholder="Con quién se acordó, qué se prometió…" />
        </div>
      </form>
    </DialogoDeAccion>
  );
}

function CambiarPlan({ cuenta }: { cuenta: Cuenta }) {
  const formId = useId();
  const [state, formAction, pending] = useActionState(accionCambiarPlan, inicial);
  const [plan, setPlan] = useState(cuenta.plan_code === "pro" ? "pro" : "free");

  return (
    <DialogoDeAccion
      titulo={`Cambiar el plan de ${cuenta.business_name}`}
      descripcion="Free es un regalo: acceso indefinido, revocable cuando quieras. Pro es de pago."
      disparador={
        <Button type="button" variant="outline" size="sm">
          <CalendarClock className="size-4" />
          Cambiar plan
        </Button>
      }
      state={state}
      pending={pending}
      formId={formId}
    >
      <form id={formId} action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="owner_id" value={cuenta.owner_id} />
        <input type="hidden" name="plan" value={plan} />
        <div className="flex flex-col gap-2">
          <Label>Plan</Label>
          <div className="flex flex-wrap gap-2">
            {[
              { code: "free", label: "Free (regalo)" },
              { code: "pro", label: "Pro (de pago)" },
            ].map((p) => (
              <Button
                key={p.code}
                type="button"
                size="sm"
                variant={plan === p.code ? "default" : "outline"}
                className="rounded-full px-3.5"
                onClick={() => setPlan(p.code)}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </div>

        {plan === "pro" ? (
          <>
            <div className="flex flex-col gap-2">
              <Label htmlFor="periodicidad">Cada cuánto paga</Label>
              <Select name="periodicidad" defaultValue={cuenta.periodicidad ?? "mensual"}>
                <SelectTrigger id="periodicidad" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mensual">Mensual</SelectItem>
                  <SelectItem value="trimestral">Trimestral</SelectItem>
                  <SelectItem value="anual">Anual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="precio">Precio pactado (USD)</Label>
              <Input
                id="precio"
                name="precio"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                placeholder="20"
                defaultValue={cuenta.precio_pactado_usd ?? ""}
                className="w-32"
              />
              <p className="text-xs text-muted-foreground">
                Vacío usa el del catálogo. Lo que pongas aquí es lo que paga ESTE negocio, y no
                cambia si mañana subes el precio de Pro.
              </p>
            </div>
          </>
        ) : null}

        <div className="flex flex-col gap-2">
          <Label htmlFor="notas-plan">Nota (opcional)</Label>
          <Input id="notas-plan" name="notas" placeholder="Por qué se le da este plan" />
        </div>
      </form>
    </DialogoDeAccion>
  );
}

function RegistrarPago({ cuenta }: { cuenta: Cuenta }) {
  const formId = useId();
  const [state, formAction, pending] = useActionState(accionRegistrarPago, inicial);

  return (
    <DialogoDeAccion
      titulo={`Registrar un pago de ${cuenta.business_name}`}
      descripcion="Queda en el historial con la fecha, el monto y cómo pagó. La cuenta pasa a activa."
      disparador={
        <Button type="button" variant="outline" size="sm">
          <CreditCard className="size-4" />
          Registrar pago
        </Button>
      }
      state={state}
      pending={pending}
      formId={formId}
    >
      <form id={formId} action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="owner_id" value={cuenta.owner_id} />
        <div className="flex flex-col gap-2">
          <Label htmlFor="monto">Monto (USD)</Label>
          <Input
            id="monto"
            name="monto"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            placeholder="20"
            defaultValue={cuenta.precio_pactado_usd ?? ""}
            className="w-32"
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="metodo">Cómo pagó</Label>
          <Select name="metodo" defaultValue="pago_movil">
            <SelectTrigger id="metodo" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pago_movil">Pago Móvil</SelectItem>
              <SelectItem value="zelle">Zelle</SelectItem>
              <SelectItem value="transferencia">Transferencia</SelectItem>
              <SelectItem value="efectivo">Efectivo</SelectItem>
              <SelectItem value="otro">Otro</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="hasta">Cubre hasta</Label>
          <Input id="hasta" name="hasta" type="date" required />
          <p className="text-xs text-muted-foreground">
            Hasta el final de ese día, hora de Caracas. No se calcula solo: quién sabe hasta cuándo
            cubre este pago eres tú.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="notas-pago">Nota (opcional)</Label>
          <Input id="notas-pago" name="notas" placeholder="Referencia, quién lo confirmó…" />
        </div>
      </form>
    </DialogoDeAccion>
  );
}
