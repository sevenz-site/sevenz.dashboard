import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, FileText, Paperclip } from "lucide-react";
import { requireSuperadmin } from "@/lib/admin/guard";
import {
  getCuentas,
  getHistorial,
  urlsDeComprobantes,
  type Cuenta,
} from "@/lib/admin/subscriptions";
import { CuentaAcciones } from "@/components/admin/cuenta-acciones";
import { CuentaComision } from "@/components/admin/cuenta-comision";
import { CuentaFeedback } from "@/components/admin/cuenta-feedback";
import { CuentaKam } from "@/components/admin/cuenta-kam";
import { CuentaSeguridad } from "@/components/admin/cuenta-seguridad";
import { mergeHistory } from "@/lib/admin/history";
import { getAccountCommercial, getKams, getSecurityLog } from "@/lib/admin/kam";
import { getCuentaSeguridad } from "@/lib/admin/security";
import { EstadoChip } from "@/components/admin/estado-chip";
import { Fila, Grupo } from "@/components/dashboard/detail-rows";
import { ScreenTitle } from "@/components/dashboard/screen-chrome";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ESTADO: Record<string, string> = {
  demo: "Demo",
  activa: "Activa",
  bloqueada: "Bloqueada",
  cancelada: "Cancelada",
};

function fechaHora(iso: string): string {
  return new Intl.DateTimeFormat("es-VE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/Caracas",
  }).format(new Date(iso));
}

function fecha(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("es-VE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "America/Caracas",
  }).format(new Date(iso));
}

export default async function CuentaDetallePage({
  params,
}: {
  params: Promise<{ ownerId: string }>;
}) {
  await requireSuperadmin();
  const { ownerId } = await params;

  // La lista completa y se filtra aquí, en vez de una función nueva por un
  // negocio. Son 24 filas: una consulta más contra la base costaría más que
  // recorrer un array.
  const [cuentas, historial, seguridad, comercial, kams, bitacora] = await Promise.all([
    getCuentas(),
    getHistorial(ownerId),
    getCuentaSeguridad(ownerId),
    getAccountCommercial(ownerId),
    getKams(),
    getSecurityLog(ownerId),
  ]);
  const cuenta: Cuenta | undefined = cuentas.find((c) => c.owner_id === ownerId);
  if (!cuenta || !comercial) notFound();

  // Point 4 of the owner's request of 2026-11-07: everything done to the account, on
  // one line of time. The sentences live in `lib/admin/history.ts`.
  const lineas = mergeHistory(historial, bitacora, comercial.events);

  // Las URLs se firman aqui, todas de una vez, y caducan en una hora.
  //
  // El bucket es privado: sin firma no hay forma de ver un comprobante. Y
  // firmarlas al dibujar, en vez de una accion de servidor por cada click,
  // evita tener un endpoint al que se le pueda pedir cualquier ruta.
  const comprobantes = await urlsDeComprobantes(
    [...lineas.map((l) => l.proofPath), ...comercial.feedback.map((f) => f.attachment_path)].filter(
      (p): p is string => Boolean(p),
    ),
  );

  const dias = cuenta.dias_restantes;
  const cobroEmpieza =
    cuenta.estado === "demo" && cuenta.demo_termina_el
      ? new Date(new Date(cuenta.demo_termina_el).getTime() + 1000).toISOString()
      : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/admin/cuentas"
          className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          Cuentas
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <ScreenTitle>
            {cuenta.business_name || "(sin nombre)"}
          </ScreenTitle>
          <EstadoChip cuenta={cuenta} />
        </div>
        <p className="text-sm text-muted-foreground">
          {cuenta.email ?? "sin correo"}
          {cuenta.whatsapp ? ` · ${cuenta.whatsapp}` : ""} · {cuenta.country}
        </p>
      </div>

      <CuentaAcciones cuenta={cuenta} />

      {/* The strip the owner marked in his capture of 2026-11-07. */}
      <CuentaKam
        ownerId={ownerId}
        businessName={cuenta.business_name || "esta cuenta"}
        kam={comercial.kam}
        kams={kams}
        running={comercial.commissions.find((c) => !c.closed_on) ?? null}
        payments={comercial.account_payments}
        today={comercial.today}
      />

      <dl className="flex flex-col gap-4 rounded-lg border p-4">
        <Grupo>
          <Fila nombre="Plan">{cuenta.plan_code === "pro" ? "Pro" : "Free"}</Fila>
          <Fila nombre="Estado">{ESTADO[cuenta.estado] ?? cuenta.estado}</Fila>
          <Fila nombre="Clientes">{cuenta.clientes}</Fila>
        </Grupo>

        <Grupo>
          <Fila nombre="Precio pactado">
            {cuenta.precio_pactado_usd != null ? `$${cuenta.precio_pactado_usd}` : "—"}
          </Fila>
          <Fila nombre="Cada cuánto">{cuenta.periodicidad ?? "—"}</Fila>
          <Fila nombre="Último pago">{fecha(cuenta.ultimo_pago_el)}</Fila>
        </Grupo>

        <Grupo>
          <Fila nombre="Demo termina">
            {cuenta.demo_termina_el ? (
              // Rojo desde los 15 días, igual que en la tabla. Aquí importa
              // más: esta es la pantalla que abres justo antes de llamar.
              <span className={dias !== null && dias <= 15 ? "font-medium text-destructive" : ""}>
                {fecha(cuenta.demo_termina_el)}
                {dias !== null
                  ? dias < 0
                    ? ` · venció hace ${Math.abs(dias)} d.`
                    : dias === 0
                      ? " · vence hoy"
                      : ` · quedan ${dias} d.`
                  : ""}
              </span>
            ) : (
              "—"
            )}
          </Fila>
          {/* Derivado del fin de la demo, no guardado aparte. Dos fechas
              podrían contradecirse; una sola no. */}
          <Fila nombre="Empieza a cobrarse">{fecha(cobroEmpieza)}</Fila>
          <Fila nombre="Pagado hasta">{fecha(cuenta.periodo_termina_el)}</Fila>
        </Grupo>

        {cuenta.notas ? (
          <Grupo>
            <Fila nombre="Nota">
              <span className="break-words">{cuenta.notas}</span>
            </Fila>
          </Grupo>
        ) : null}
      </dl>

      <CuentaComision ownerId={ownerId} data={comercial} />

      <CuentaFeedback ownerId={ownerId} feedback={comercial.feedback} urls={comprobantes} />

      {/* C1 of PL-22: how the account signs in, and the admin's two doors (recovery mail,
          email change behind an identity check). */}
      {seguridad ? <CuentaSeguridad ownerId={ownerId} cuenta={seguridad} /> : null}

      <section className="flex flex-col gap-2">
        <div className="flex flex-col">
          <h2 className="text-lg font-semibold">Historial</h2>
          <p className="text-sm text-muted-foreground">
            Todo lo que le ha pasado a esta cuenta, lo más reciente arriba. Es lo que se consulta
            cuando alguien dice que pagó.
          </p>
        </div>

        {lineas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin transacciones todavía.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border">
            {lineas.map((l) => (
              <li key={l.key} className="flex flex-col gap-1 p-3">
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0 text-sm font-medium break-words">{l.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{fechaHora(l.at)}</span>
                </div>
                {l.proofPath && comprobantes[l.proofPath] ? (
                  <a
                    href={comprobantes[l.proofPath]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex w-fit items-center gap-1.5 text-xs font-medium underline underline-offset-2"
                  >
                    {l.proofPath.endsWith(".pdf") ? <FileText className="size-3.5" /> : <Paperclip className="size-3.5" />}
                    Ver comprobante
                  </a>
                ) : null}
                {l.detail ? (
                  <span className="text-xs break-words whitespace-pre-line text-muted-foreground">{l.detail}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
