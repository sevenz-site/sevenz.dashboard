import { requireSuperadmin } from "@/lib/admin/guard";
import { getCuentas, getIngresosPorMes, repartirPorUrgencia } from "@/lib/admin/subscriptions";
import { CuentasTabla } from "@/components/admin/cuentas-tabla";
import { CuentasGraficas } from "@/components/admin/cuentas-graficas";

// El layout ya llama a requireSuperadmin, pero esta página lo llama otra vez y
// ANTES de leer nada. Sin eso, la consulta que trae los datos de los 24
// negocios correría igual para alguien no autorizado, y solo después el
// notFound() del layout reemplazaría lo dibujado. No se filtraría nada, pero
// el trabajo se haría — y una pantalla futura con un efecto secundario lo
// ejecutaría para quien no debe.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CuentasPage() {
  await requireSuperadmin();

  const [cuentas, ingresos] = await Promise.all([getCuentas(), getIngresosPorMes(6)]);
  const { vencidas, porVencer } = repartirPorUrgencia(cuentas);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Cuentas</h1>
        <p className="text-sm text-muted-foreground">
          {cuentas.length} {cuentas.length === 1 ? "negocio" : "negocios"}. Los cambios quedan en el
          historial con tu correo.
        </p>
      </div>

      {/* Lo que hay que hacer HOY, antes de la tabla. Las demos no bajan solas
          —fue la decisión— así que una que venció y sigue andando no aparece
          por ninguna otra vía. Solo se dibuja cuando hay algo: un aviso que
          siempre está deja de leerse. */}
      {vencidas.length > 0 || porVencer.length > 0 ? (
        <div className="flex flex-wrap gap-3">
          {vencidas.length > 0 ? (
            <div className="flex flex-col rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
              <span className="text-2xl font-semibold text-destructive tabular-nums">
                {vencidas.length}
              </span>
              <span className="text-xs text-destructive">
                {vencidas.length === 1 ? "demo vencida" : "demos vencidas"} y sigue trabajando
              </span>
            </div>
          ) : null}
          {porVencer.length > 0 ? (
            <div className="flex flex-col rounded-lg border px-4 py-3">
              <span className="text-2xl font-semibold tabular-nums">{porVencer.length}</span>
              <span className="text-xs text-muted-foreground">vencen en 14 días</span>
            </div>
          ) : null}
        </div>
      ) : null}

      <CuentasGraficas cuentas={cuentas} ingresos={ingresos} />

      {/* Todavía no se puede bloquear, y decirlo es parte del trabajo: sin
          esta línea alguien daría por hecho que "Bloqueada" en la etiqueta
          significa que a ese tendero se le cortó el acceso. */}
      <p className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        El bloqueo todavía no existe: una cuenta marcada como bloqueada sigue pudiendo registrar
        movimientos. El botón llegará junto con la cerradura, no antes.
      </p>

      <CuentasTabla cuentas={cuentas} />
    </div>
  );
}
