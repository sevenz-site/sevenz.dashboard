"use client";

import { useActionState, useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DialogoDeAccion } from "@/components/admin/cuenta-acciones";
import { Fila, Grupo } from "@/components/dashboard/detail-rows";
import { accionAsignarKam, accionCrearKam, accionEditarKam } from "@/app/admin/cuentas/kam-actions";
import type { AccionState } from "@/app/admin/cuentas/actions";
import { commissionFigures, type AccountPayment, type CommissionRow } from "@/lib/admin/commission";
import { usd } from "@/lib/admin/history";
import type { Kam } from "@/lib/admin/kam";
import { foldForSearch } from "@/lib/search/fold";

const inicial: AccionState = { error: null, ok: false };

const fullName = (k: Pick<Kam, "first_name" | "last_name">) => `${k.first_name} ${k.last_name}`;
const accountsText = (n: number) => (n === 1 ? "Atiende 1 cuenta." : `Atiende ${n} cuentas.`);

// «KAM» ON THE ACCOUNT'S PAGE: frames 2 to 7 of `2076:738`, approved on 2026-11-07.
// The owner marked the strip between the action buttons and the plan card.
//
// A KAM IS ONE RECORD WITH MANY ACCOUNTS (his decision that day), so the dialog picks
// one first and only creates when it is not there, and an edit warns how many accounts
// it reaches. Only a record: a KAM has no login, and giving them one is another scope.
export function CuentaKam({
  ownerId,
  businessName,
  kam,
  kams,
  running,
  payments,
  today,
}: {
  ownerId: string;
  businessName: string;
  kam: Kam | null;
  kams: Kam[];
  running: CommissionRow | null;
  payments: AccountPayment[];
  today: string;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col">
        <h2 className="text-lg font-semibold">KAM</h2>
        <p className="text-sm text-muted-foreground">
          Quién atiende esta cuenta. Es un registro interno: el KAM no entra a la app.
        </p>
      </div>

      <div className="flex flex-col gap-4 rounded-lg border p-4">
        {kam ? (
          <>
            <dl>
              <Grupo>
                <Fila nombre="Nombre">{fullName(kam)}</Fila>
                <Fila nombre="Correo">
                  <span className="break-all">{kam.email}</span>
                </Fila>
                <Fila nombre="Ciudad">{kam.city ?? "—"}</Fila>
                <Fila nombre="Teléfono">{kam.phone ?? "—"}</Fila>
              </Grupo>
            </dl>
            <div className="flex flex-wrap gap-2">
              <EditarKam ownerId={ownerId} kam={kam} />
              <CambiarKam
                ownerId={ownerId}
                businessName={businessName}
                kam={kam}
                kams={kams}
                running={running}
                payments={payments}
                today={today}
              />
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">Esta cuenta todavía no tiene KAM.</p>
            <div>
              <AsignarKam ownerId={ownerId} businessName={businessName} kams={kams} />
            </div>
          </>
        )}
      </div>
    </section>
  );
}

// Searches by name or email and keeps the list bounded: an open list that grows with
// the team would push the buttons off a phone (DESIGN-SYSTEM.md, unbounded popovers).
function ElegirKam({
  kams,
  value,
  onChange,
  label = "KAM",
}: {
  kams: Kam[];
  value: string;
  onChange: (id: string) => void;
  label?: string;
}) {
  const id = useId();
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const folded = foldForSearch(q.trim());
    if (!folded) return kams;
    return kams.filter((k) => foldForSearch(fullName(k)).includes(folded) || foldForSearch(k.email).includes(folded));
  }, [kams, q]);

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Nombre o correo"
        autoComplete="off"
      />
      <ul className="flex max-h-44 flex-col divide-y overflow-y-auto rounded-lg border">
        {shown.length === 0 ? (
          <li className="p-3 text-xs text-muted-foreground">Ningún KAM con ese nombre o correo.</li>
        ) : (
          shown.map((k) => (
            <li key={k.id}>
              <button
                type="button"
                aria-pressed={value === k.id}
                onClick={() => onChange(k.id)}
                className={`flex w-full flex-col p-3 text-left ${value === k.id ? "bg-muted" : ""}`}
              >
                <span className="text-sm font-medium">{fullName(k)}</span>
                <span className="text-xs text-muted-foreground break-all">
                  {k.email} · {accountsText(k.accounts)}
                </span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

function CamposDeKam({ kam }: { kam?: Kam }) {
  const id = useId();
  const campos: [string, string, string, string, boolean][] = [
    ["first_name", "Nombre", kam?.first_name ?? "", "text", true],
    ["last_name", "Apellido", kam?.last_name ?? "", "text", true],
    ["email", "Correo", kam?.email ?? "", "email", true],
    ["city", "Ciudad", kam?.city ?? "", "text", false],
    ["phone", "Teléfono", kam?.phone ?? "", "tel", false],
  ];
  return (
    <>
      {campos.map(([name, label, value, type, required]) => (
        <div key={name} className="flex flex-col gap-2">
          <Label htmlFor={`${id}-${name}`}>{label}</Label>
          <Input id={`${id}-${name}`} name={name} type={type} defaultValue={value} required={required} autoComplete="off" />
        </div>
      ))}
    </>
  );
}

function AsignarKam({ ownerId, businessName, kams }: { ownerId: string; businessName: string; kams: Kam[] }) {
  const formId = useId();
  const [assignState, assignAction, assigning] = useActionState(accionAsignarKam, inicial);
  const [createState, createAction, creating] = useActionState(accionCrearKam, inicial);
  // With nobody on the list there is nothing to pick: straight to the form.
  const [nuevo, setNuevo] = useState(kams.length === 0);
  const [kamId, setKamId] = useState("");

  const trigger = (
    <Button type="button" size="sm">
      Asignar KAM
    </Button>
  );

  if (nuevo) {
    return (
      <DialogoDeAccion
        titulo="Nuevo KAM"
        descripcion="Queda disponible para cualquier otra cuenta."
        disparador={trigger}
        state={createState}
        pending={creating}
        formId={formId}
        confirmar="Crear y asignar"
        extra={
          kams.length > 0 ? (
            <Button type="button" variant="outline" onClick={() => setNuevo(false)}>
              Elegir uno que ya existe
            </Button>
          ) : null
        }
      >
        <form id={formId} action={createAction} className="flex flex-col gap-4">
          <input type="hidden" name="owner_id" value={ownerId} />
          <CamposDeKam />
        </form>
      </DialogoDeAccion>
    );
  }

  return (
    <DialogoDeAccion
      titulo={`Asignar KAM a ${businessName}`}
      descripcion="Busca por nombre o correo. Si no está, créalo."
      disparador={trigger}
      state={assignState}
      pending={assigning}
      formId={formId}
      confirmar="Asignar"
      extra={
        <Button type="button" variant="outline" onClick={() => setNuevo(true)}>
          Crear un KAM nuevo
        </Button>
      }
    >
      <form id={formId} action={assignAction} className="flex flex-col gap-4">
        <input type="hidden" name="owner_id" value={ownerId} />
        <input type="hidden" name="kam_id" value={kamId} />
        <ElegirKam kams={kams} value={kamId} onChange={setKamId} />
      </form>
    </DialogoDeAccion>
  );
}

function EditarKam({ ownerId, kam }: { ownerId: string; kam: Kam }) {
  const formId = useId();
  const [state, action, pending] = useActionState(accionEditarKam, inicial);
  return (
    <DialogoDeAccion
      titulo={`Editar a ${fullName(kam)}`}
      disparador={
        <Button type="button" variant="outline" size="sm">
          Editar datos
        </Button>
      }
      state={state}
      pending={pending}
      formId={formId}
      confirmar="Guardar"
    >
      <form id={formId} action={action} className="flex flex-col gap-4">
        <input type="hidden" name="owner_id" value={ownerId} />
        <input type="hidden" name="kam_id" value={kam.id} />
        {kam.accounts > 1 ? (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs">
            {kam.first_name} atiende {kam.accounts} cuentas. Lo que cambies aquí se verá en las {kam.accounts}.
          </p>
        ) : null}
        <CamposDeKam kam={kam} />
      </form>
    </DialogoDeAccion>
  );
}

function CambiarKam({
  ownerId,
  businessName,
  kam,
  kams,
  running,
  payments,
  today,
}: {
  ownerId: string;
  businessName: string;
  kam: Kam;
  kams: Kam[];
  running: CommissionRow | null;
  payments: AccountPayment[];
  today: string;
}) {
  const formId = useId();
  const [state, action, pending] = useActionState(accionAsignarKam, inicial);
  const [kamId, setKamId] = useState("");
  const next = kams.find((k) => k.id === kamId);
  const others = kams.filter((k) => k.id !== kam.id);

  // What the change does to the money, before it is done. Same function the section
  // uses, on the agreement as it would stand if closed today.
  let aviso: string | null = null;
  if (running) {
    const before = commissionFigures(running, payments).totalUsd;
    const after = commissionFigures({ ...running, closed_on: today }, payments).totalUsd;
    const total = before === after ? `Su total se queda en ${usd(after)}.` : `Su total baja de ${usd(before)} a ${usd(after)}, lo alcanzado hasta hoy.`;
    const nextText = next ? `${next.first_name} empieza sin acuerdo: regístralo después.` : "El KAM nuevo empieza sin acuerdo: regístralo después.";
    aviso = `La comisión de ${running.kam_name} termina hoy. ${total} Lo pendiente de pagarle no se pierde. ${nextText}`;
  }

  return (
    <DialogoDeAccion
      titulo={`Cambiar el KAM de ${businessName}`}
      disparador={
        <Button type="button" variant="outline" size="sm">
          Cambiar KAM
        </Button>
      }
      state={state}
      pending={pending}
      formId={formId}
      confirmar="Cambiar KAM"
      extra={
        <Button type="submit" form={formId} variant="outline" name="dejar_sin_kam" value="1" disabled={pending}>
          Dejar sin KAM
        </Button>
      }
    >
      <form id={formId} action={action} className="flex flex-col gap-4">
        <input type="hidden" name="owner_id" value={ownerId} />
        <input type="hidden" name="kam_id" value={kamId} />
        {others.length > 0 ? (
          <ElegirKam kams={others} value={kamId} onChange={setKamId} label="KAM nuevo" />
        ) : (
          <p className="text-xs text-muted-foreground">
            No hay otro KAM en la lista. Déjala sin KAM y asígnale uno nuevo desde aquí mismo.
          </p>
        )}
        {aviso ? <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs">{aviso}</p> : null}
      </form>
    </DialogoDeAccion>
  );
}
