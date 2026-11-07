"use client";

import { useActionState, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DialogoDeAccion } from "@/components/admin/cuenta-acciones";
import { adjuntaComprobante, ComprobanteInput, useComprobante } from "@/components/admin/comprobante-input";
import { Fila, Grupo } from "@/components/dashboard/detail-rows";
import { accionGuardarComision, accionPagarKam } from "@/app/admin/cuentas/kam-actions";
import type { AccionState } from "@/app/admin/cuentas/actions";
import {
  commissionDrift,
  commissionFigures,
  countCharges,
  effectiveEnd,
  lastCoveredDay,
  proposeCommission,
  type AccountPayment,
  type CommissionRow,
  type Drift,
  type Periodicity,
  type Proposal,
} from "@/lib/admin/commission";
import { formatYmd, METODO, usd } from "@/lib/admin/history";
import type { AccountCommercial } from "@/lib/admin/kam";

const inicial: AccionState = { error: null, ok: false };

function driftText(d: Drift, c: CommissionRow): string {
  const ending = "No se movió sola: edítala si también cambió lo acordado.";
  return d.kind === "demo"
    ? `La demo de esta cuenta ahora termina el ${formatYmd(d.demoEndsOn)}, y esta comisión empieza el ${formatYmd(c.starts_on)}. ${ending}`
    : `El precio pactado ahora es ${usd(d.priceUsd)} ${d.periodicity}, y esta comisión se calculó sobre ${usd(c.base_price_usd)} ${c.periodicidad}. ${ending}`;
}

const START_HELP: Record<Proposal["startSource"], string> = {
  demo: "El día que termina la demo empieza a cobrarse.",
  paid_until: "El día después de «Pagado hasta».",
  today: "Esta cuenta no tiene demo ni periodo pagado: se propone hoy.",
  previous_agreement: "El día después de terminar el acuerdo anterior.",
};

// «COMISIÓN» ON THE ACCOUNT'S PAGE: frames 2, 3 and 8 to 12 of `2076:738`, approved
// on 2026-11-07. Every figure comes from `lib/admin/commission.ts`; this file draws.
export function CuentaComision({ ownerId, data }: { ownerId: string; data: AccountCommercial }) {
  const running = data.commissions.find((c) => !c.closed_on) ?? null;
  const closed = data.commissions.filter((c) => c.closed_on);
  const proposal = proposeCommission({
    today: data.today,
    demoEndsOn: data.demo_ends_on,
    paidUntilOn: data.paid_until_on,
    priceUsd: data.price_usd,
    periodicity: data.periodicidad,
    catalogProUsd: data.catalog_pro_usd,
    lastEndOn: lastCoveredDay(data.commissions),
  });

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col">
        <h2 className="text-lg font-semibold">Comisión</h2>
        <p className="text-sm text-muted-foreground">
          Lo acordado con el KAM por conseguir y atender esta cuenta. En dólares.
        </p>
      </div>

      {running ? (
        <>
          {commissionDrift(running, {
            demoEndsOn: data.demo_ends_on,
            priceUsd: data.price_usd,
            periodicity: data.periodicidad,
          }).map((d) => (
            <p key={d.kind} className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs">
              {driftText(d, running)}
            </p>
          ))}
          <TarjetaDeComision commission={running} payments={data.account_payments} ownerId={ownerId}>
            <GuardarComision ownerId={ownerId} kamName={running.kam_name} proposal={proposal} commission={running} />
          </TarjetaDeComision>
        </>
      ) : data.kam ? (
        <div className="flex flex-col gap-4 rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Esta cuenta todavía no tiene comisión registrada.</p>
          <div>
            <GuardarComision
              ownerId={ownerId}
              kamName={`${data.kam.first_name} ${data.kam.last_name}`}
              proposal={proposal}
              commission={null}
            />
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Asigna un KAM para registrar su comisión.</p>
      )}

      {closed.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Acuerdos anteriores</h3>
          {closed.map((c) => (
            <AcuerdoAnterior key={c.id} commission={c} payments={data.account_payments} ownerId={ownerId} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function TarjetaDeComision({
  commission: c,
  payments,
  ownerId,
  children,
}: {
  commission: CommissionRow;
  payments: AccountPayment[];
  ownerId: string;
  children: React.ReactNode;
}) {
  const f = commissionFigures(c, payments);
  return (
    <div className="flex flex-col gap-4 rounded-lg border p-4">
      <dl className="flex flex-col gap-4">
        <Grupo>
          <Fila nombre="KAM">{c.kam_name}</Fila>
          <Fila nombre="Empieza a recibirla">{formatYmd(c.starts_on)}</Fila>
          <Fila nombre="Hasta">{formatYmd(c.ends_on)}</Fila>
        </Grupo>
        <Grupo>
          <Fila nombre="Monto por cobro">
            {usd(c.amount_usd)} {c.periodicidad}
          </Fila>
          <Fila nombre="Cobros en el periodo">{f.charges}</Fila>
          <Fila nombre="Comisión total al término">
            <span className="font-medium">{usd(f.totalUsd)}</span>
          </Fila>
        </Grupo>
        <Grupo>
          <Fila nombre="Generada por pagos del negocio">{usd(f.generatedUsd)}</Fila>
          <Fila nombre="Pagada al KAM">{usd(f.paidUsd)}</Fila>
          <Saldo pendingUsd={f.pendingUsd} advanceUsd={f.advanceUsd} />
        </Grupo>
      </dl>
      <div className="flex flex-wrap gap-2">
        <PagarKam ownerId={ownerId} commission={c} pendingUsd={f.pendingUsd} prominent />
        {children}
      </div>
    </div>
  );
}

// Pending or advanced, never a negative number under «Pendiente».
function Saldo({ pendingUsd, advanceUsd }: { pendingUsd: number; advanceUsd: number }) {
  return advanceUsd > 0 ? (
    <Fila nombre="Adelantado al KAM">
      <span className="font-medium">{usd(advanceUsd)}</span>
    </Fila>
  ) : (
    <Fila nombre="Pendiente de pagarle">
      <span className="font-medium">{usd(pendingUsd)}</span>
    </Fila>
  );
}

function AcuerdoAnterior({
  commission: c,
  payments,
  ownerId,
}: {
  commission: CommissionRow;
  payments: AccountPayment[];
  ownerId: string;
}) {
  const f = commissionFigures(c, payments);
  return (
    <div className="flex flex-col gap-4 rounded-lg border p-4">
      <dl>
        <Grupo>
          <Fila nombre="KAM">{c.kam_name}</Fila>
          <Fila nombre="Vigente">
            {formatYmd(c.starts_on)} al {formatYmd(effectiveEnd(c))}
          </Fila>
          <Fila nombre="Comisión total">{usd(f.totalUsd)}</Fila>
          <Fila nombre="Pagada al KAM">{usd(f.paidUsd)}</Fila>
          <Saldo pendingUsd={f.pendingUsd} advanceUsd={f.advanceUsd} />
        </Grupo>
      </dl>
      <div>
        <PagarKam ownerId={ownerId} commission={c} pendingUsd={f.pendingUsd} />
      </div>
    </div>
  );
}

function GuardarComision({
  ownerId,
  kamName,
  proposal,
  commission,
}: {
  ownerId: string;
  kamName: string;
  proposal: Proposal;
  commission: CommissionRow | null;
}) {
  const formId = useId();
  const [state, action, pending] = useActionState(accionGuardarComision, inicial);
  const [startsOn, setStartsOn] = useState(commission?.starts_on ?? proposal.startsOn);
  const [endsOn, setEndsOn] = useState(commission?.ends_on ?? proposal.endsOn);
  const [amount, setAmount] = useState(String(commission?.amount_usd ?? proposal.amountUsd));

  const value = Number(amount);
  const period: Periodicity = proposal.periodicity;
  const charges = startsOn && endsOn ? countCharges(startsOn, endsOn, period) : 0;
  const total = Number.isFinite(value) && value > 0 ? Math.round(value * 100) * charges : null;

  return (
    <DialogoDeAccion
      titulo={commission ? `Editar la comisión de ${kamName}` : `Comisión de ${kamName}`}
      descripcion={
        commission
          ? "El acuerdo entero cambia, también lo ya generado. Queda en el historial."
          : "Los valores salen de la cuenta y puedes cambiarlos. Al guardar quedan fijos."
      }
      disparador={
        <Button type="button" size="sm" variant={commission ? "outline" : "default"}>
          {commission ? "Editar acuerdo" : "Registrar comisión"}
        </Button>
      }
      state={state}
      pending={pending}
      formId={formId}
      confirmar="Guardar comisión"
    >
      <form id={formId} action={action} className="flex flex-col gap-4">
        <input type="hidden" name="owner_id" value={ownerId} />
        {commission ? <input type="hidden" name="commission_id" value={commission.id} /> : null}
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${formId}-s`}>Empieza a recibirla</Label>
          <Input id={`${formId}-s`} name="starts_on" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} required />
          <p className="text-xs text-muted-foreground">{START_HELP[proposal.startSource]}</p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${formId}-a`}>Monto por cobro</Label>
          <Input
            id={`${formId}-a`}
            name="amount"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
          <p className="text-xs text-muted-foreground">
            {proposal.baseSource === "agreed"
              ? `50% de ${usd(proposal.basePriceUsd)} ${period}.`
              : `Esta cuenta no tiene precio pactado. Se propone el 50% del precio Pro: ${usd(proposal.basePriceUsd)} ${period}.`}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${formId}-e`}>Hasta</Label>
          <Input id={`${formId}-e`} name="ends_on" type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} required />
          <p className="text-xs text-muted-foreground">6 meses desde el inicio.</p>
        </div>
        <dl className="rounded-lg border p-3">
          <Fila nombre="Comisión total al término">
            <span className="font-medium">
              {total === null ? "—" : `${charges} × ${usd(value)} = ${usd(total / 100)}`}
            </span>
          </Fila>
        </dl>
      </form>
    </DialogoDeAccion>
  );
}

function PagarKam({
  ownerId,
  commission,
  pendingUsd,
  prominent = false,
}: {
  ownerId: string;
  commission: CommissionRow;
  pendingUsd: number;
  prominent?: boolean;
}) {
  const formId = useId();
  const [state, action, pending] = useActionState(accionPagarKam, inicial);
  const [comprobante, setComprobante] = useComprobante(state);
  // Local date, not UTC: `toISOString` says tomorrow after 8 p.m. in Caracas.
  const [today] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });

  return (
    <DialogoDeAccion
      titulo={`Pago a ${commission.kam_name}`}
      descripcion={`Pendiente de pagarle: ${usd(pendingUsd)}.`}
      disparador={
        <Button type="button" size="sm" variant={prominent ? "default" : "outline"}>
          Registrar pago al KAM
        </Button>
      }
      state={state}
      pending={pending}
      formId={formId}
      confirmar="Registrar pago"
    >
      <form id={formId} action={(fd) => action(adjuntaComprobante(fd, comprobante))} className="flex flex-col gap-4">
        <input type="hidden" name="owner_id" value={ownerId} />
        <input type="hidden" name="commission_id" value={commission.id} />
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${formId}-a`}>Monto en dólares</Label>
          <Input
            id={`${formId}-a`}
            name="amount"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            defaultValue={pendingUsd > 0 ? pendingUsd : ""}
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${formId}-d`}>Fecha</Label>
          <Input id={`${formId}-d`} name="paid_on" type="date" defaultValue={today} required />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${formId}-m`}>Cómo se pagó</Label>
          <Select name="method" defaultValue="zelle">
            <SelectTrigger id={`${formId}-m`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(METODO).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${formId}-n`}>Nota (opcional)</Label>
          <Textarea id={`${formId}-n`} name="note" rows={2} maxLength={500} />
        </div>
        <ComprobanteInput value={comprobante} onChange={setComprobante} ayuda="La captura del pago, si la tienes." />
      </form>
    </DialogoDeAccion>
  );
}
