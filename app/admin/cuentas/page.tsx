import Link from "next/link";
import { requireSuperadmin } from "@/lib/admin/guard";
import { getCuentas, repartirPorUrgencia, type Cuenta } from "@/lib/admin/subscriptions";
import { CuentaAcciones } from "@/components/admin/cuenta-acciones";

// El layout ya llama a requireSuperadmin, pero esta página lo llama otra vez y
// ANTES de leer nada. Sin eso, la consulta que trae los datos de los 24
// negocios correría igual para alguien no autorizado, y solo después el
// notFound() del layout reemplazaría lo dibujado. No se filtraría nada, pero
// el trabajo se haría — y una pantalla futura con un efecto secundario lo
// ejecutaría para quien no debe. Es la misma razón por la que /admin lo hace.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NOMBRE_ESTADO: Record<string, string> = {
  demo: "Demo",
  activa: "Activa",
  bloqueada: "Bloqueada",
  cancelada: "Cancelada",
};

function fecha(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("es-VE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "America/Caracas",
  }).format(new Date(iso));
}

function Etiqueta({ cuenta }: { cuenta: Cuenta }) {
  const vencida = cuenta.estado === "demo" && (cuenta.dias_restantes ?? 0) < 0;
  const color = vencida
    ? "border-destructive/40 bg-destructive/10 text-destructive"
    : cuenta.estado === "demo"
      ? "border-border bg-muted text-foreground"
      : cuenta.estado === "bloqueada"
        ? "border-destructive/40 bg-destructive/10 text-destructive"
        : "border-border bg-muted text-muted-foreground";

  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs ${color}`}>
      {NOMBRE_ESTADO[cuenta.estado] ?? cuenta.estado}
      {cuenta.plan_code === "pro" ? " · Pro" : cuenta.plan_code === "free" ? " · Free" : ""}
    </span>
  );
}

function Fila({ cuenta }: { cuenta: Cuenta }) {
  const dias = cuenta.dias_restantes;
  const cuandoVence =
    cuenta.estado === "demo" && dias !== null
      ? dias < 0
        ? `venció hace ${Math.abs(dias)} ${Math.abs(dias) === 1 ? "día" : "días"}`
        : dias === 0
          ? "vence hoy"
          : `quedan ${dias} ${dias === 1 ? "día" : "días"}`
      : cuenta.periodo_termina_el
        ? `pagado hasta ${fecha(cuenta.periodo_termina_el)}`
        : null;

  return (
    <li className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{cuenta.business_name || "(sin nombre)"}</span>
            <Etiqueta cuenta={cuenta} />
            <span className="text-xs text-muted-foreground">{cuenta.country}</span>
          </div>
          <span className="text-xs text-muted-foreground">
            {cuenta.email ?? "sin correo"} · {cuenta.clientes}{" "}
            {cuenta.clientes === 1 ? "cliente" : "clientes"}
            {cuandoVence ? ` · ${cuandoVence}` : ""}
            {cuenta.precio_pactado_usd != null && cuenta.plan_code === "pro"
              ? ` · $${cuenta.precio_pactado_usd}${cuenta.periodicidad ? "/" + cuenta.periodicidad : ""}`
              : ""}
          </span>
          {cuenta.notas ? (
            <span className="text-xs text-muted-foreground italic">{cuenta.notas}</span>
          ) : null}
          {/* Se registró después de la 057 y nadie lo ha tocado. La primera
              acción que hagas sobre él le crea la fila. */}
          {!cuenta.tiene_suscripcion ? (
            <span className="text-xs text-muted-foreground">Sin suscripción todavía</span>
          ) : null}
        </div>
      </div>
      <CuentaAcciones cuenta={cuenta} />
    </li>
  );
}

function Grupo({
  titulo,
  explica,
  cuentas,
  alerta = false,
}: {
  titulo: string;
  explica?: string;
  cuentas: Cuenta[];
  alerta?: boolean;
}) {
  if (cuentas.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-col">
        <h2 className={`text-lg font-semibold ${alerta ? "text-destructive" : ""}`}>
          {titulo} ({cuentas.length})
        </h2>
        {explica ? <p className="text-sm text-muted-foreground">{explica}</p> : null}
      </div>
      <ul className="flex flex-col divide-y rounded-lg border">
        {cuentas.map((c) => (
          <Fila key={c.owner_id} cuenta={c} />
        ))}
      </ul>
    </section>
  );
}

export default async function CuentasPage() {
  await requireSuperadmin();

  const cuentas = await getCuentas();
  const { vencidas, porVencer, resto } = repartirPorUrgencia(cuentas);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Cuentas</h1>
        <p className="text-sm text-muted-foreground">
          {cuentas.length} {cuentas.length === 1 ? "negocio" : "negocios"}. Los cambios quedan en el
          historial con tu correo.
        </p>
      </div>

      {/* Todavía no se puede bloquear, y decirlo es parte del trabajo: sin
          esta línea alguien daría por hecho que "Cancelada" o "Bloqueada" en
          la etiqueta significan que a ese tendero se le cortó el acceso. */}
      <p className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        El bloqueo todavía no existe: una cuenta marcada como bloqueada sigue pudiendo registrar
        movimientos. El botón llegará junto con la cerradura, no antes.
      </p>

      <Grupo
        titulo="Demos vencidas"
        explica="La demo terminó y el negocio sigue trabajando. Las demos no bajan solas, así que esto se queda aquí hasta que decidas."
        cuentas={vencidas}
        alerta
      />
      <Grupo
        titulo="Demos por vencer"
        explica="Vencen en los próximos 14 días."
        cuentas={porVencer}
      />
      <Grupo titulo="Todas las demás" cuentas={resto} />

      <Link href="/admin" className="text-xs text-muted-foreground underline underline-offset-4">
        Volver a Métricas
      </Link>
    </div>
  );
}
