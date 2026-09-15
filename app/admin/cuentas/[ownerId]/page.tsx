import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, FileText, Paperclip } from "lucide-react";
import { requireSuperadmin } from "@/lib/admin/guard";
import {
  getCuentas,
  getHistorial,
  urlsDeComprobantes,
  type Cuenta,
  type EventoCuenta,
} from "@/lib/admin/subscriptions";
import { CuentaAcciones } from "@/components/admin/cuenta-acciones";
import { EstadoChip } from "@/components/admin/estado-chip";
import { Fila, Grupo } from "@/components/dashboard/detail-rows";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const METODO: Record<string, string> = {
  pago_movil: "Pago Móvil",
  zelle: "Zelle",
  transferencia: "Transferencia",
  efectivo: "Efectivo",
  otro: "Otro",
};

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

// Un asiento del historial, contado como una frase y no como una fila de tabla.
//
// Una tabla con ocho columnas —desde_plan, hasta_plan, desde_estado, monto,
// método…— obliga a reconstruir mentalmente qué pasó. La frase ya lo dice, y
// debajo van los detalles que la respaldan. Esta pantalla se abre cuando
// alguien discute un cobro, y ahí lo que hace falta es leer, no interpretar.
function queDice(e: EventoCuenta): string {
  const cambioDePlan = e.desde_plan && e.hasta_plan && e.desde_plan !== e.hasta_plan;
  const cambioDeEstado = e.desde_estado && e.hasta_estado && e.desde_estado !== e.hasta_estado;

  if (e.monto_usd != null && e.metodo_pago) {
    return `Pagó $${e.monto_usd} por ${METODO[e.metodo_pago] ?? e.metodo_pago}`;
  }
  if (cambioDePlan) {
    return `Cambió de ${e.desde_plan === "pro" ? "Pro" : "Free"} a ${e.hasta_plan === "pro" ? "Pro" : "Free"}`;
  }
  if (cambioDeEstado) {
    return `Pasó de ${ESTADO[e.desde_estado!] ?? e.desde_estado} a ${ESTADO[e.hasta_estado!] ?? e.hasta_estado}`;
  }
  if (!e.desde_estado && e.hasta_estado) {
    return "Cuenta creada en el sistema de planes";
  }
  return "Cambio sin efecto visible";
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
  const [cuentas, historial] = await Promise.all([getCuentas(), getHistorial(ownerId)]);
  const cuenta: Cuenta | undefined = cuentas.find((c) => c.owner_id === ownerId);
  if (!cuenta) notFound();

  // Las URLs se firman aqui, todas de una vez, y caducan en una hora.
  //
  // El bucket es privado: sin firma no hay forma de ver un comprobante. Y
  // firmarlas al dibujar, en vez de una accion de servidor por cada click,
  // evita tener un endpoint al que se le pueda pedir cualquier ruta.
  const comprobantes = await urlsDeComprobantes(
    historial.map((e) => e.comprobante_path).filter((p): p is string => Boolean(p)),
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
          <h1 className="text-2xl font-semibold tracking-tight">
            {cuenta.business_name || "(sin nombre)"}
          </h1>
          <EstadoChip cuenta={cuenta} />
        </div>
        <p className="text-sm text-muted-foreground">
          {cuenta.email ?? "sin correo"}
          {cuenta.whatsapp ? ` · ${cuenta.whatsapp}` : ""} · {cuenta.country}
        </p>
      </div>

      <CuentaAcciones cuenta={cuenta} />

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

      <section className="flex flex-col gap-2">
        <div className="flex flex-col">
          <h2 className="text-lg font-semibold">Historial</h2>
          <p className="text-sm text-muted-foreground">
            Todo lo que le ha pasado a esta cuenta, lo más reciente arriba. Es lo que se consulta
            cuando alguien dice que pagó.
          </p>
        </div>

        {historial.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin movimientos todavía.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border">
            {historial.map((e) => (
              <li key={e.id} className="flex flex-col gap-1 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">{queDice(e)}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {fechaHora(e.ocurrido_el)}
                  </span>
                </div>
                {e.motivo ? <span className="text-xs text-muted-foreground">{e.motivo}</span> : null}
                {e.comprobante_path && comprobantes[e.comprobante_path] ? (
                  <a
                    href={comprobantes[e.comprobante_path]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex w-fit items-center gap-1.5 text-xs font-medium underline underline-offset-2"
                  >
                    {e.comprobante_path.endsWith(".pdf") ? (
                      <FileText className="size-3.5" />
                    ) : (
                      <Paperclip className="size-3.5" />
                    )}
                    Ver comprobante
                  </a>
                ) : null}
                <span className="text-xs text-muted-foreground">
                  {e.actor_email ?? "—"}
                  {e.desde_estado || e.hasta_estado
                    ? ` · ${ESTADO[e.desde_estado ?? ""] ?? e.desde_estado ?? "—"} → ${ESTADO[e.hasta_estado ?? ""] ?? e.hasta_estado ?? "—"}`
                    : ""}
                  {e.desde_plan !== e.hasta_plan
                    ? ` · ${e.desde_plan ?? "—"} → ${e.hasta_plan ?? "—"}`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
