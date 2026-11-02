import { requireSuperadmin } from "@/lib/admin/guard";
import { getCuentas, getIngresosPorMes, repartirPorUrgencia } from "@/lib/admin/subscriptions";
import { CuentasTabla } from "@/components/admin/cuentas-tabla";
import { CuentasGraficas } from "@/components/admin/cuentas-graficas";
import { ScreenTitle } from "@/components/dashboard/screen-chrome";

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
  const { bloqueadas, porBloquearse } = repartirPorUrgencia(cuentas);
  const finDePrueba = bloqueadas.filter((c) => c.motivo_de_bloqueo === "prueba_vencida").length;
  const pagoVencido = bloqueadas.filter((c) => c.motivo_de_bloqueo === "pago_vencido").length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <ScreenTitle>Cuentas</ScreenTitle>
        <p className="text-sm text-muted-foreground">
          {cuentas.length} {cuentas.length === 1 ? "negocio" : "negocios"}. Los cambios quedan en el
          historial con tu correo.
        </p>
      </div>

      {/* WHAT TO LOOK AT TODAY, before the table -- rewritten on 2026-10-31
          (migration 171). Accounts now block by themselves, so the first card
          is the one that can still be prevented: who blocks within 14 days.
          That is where a payment you forgot to register shows up. Drawn only
          when there is something: a notice that is always there stops being
          read. */}
      {porBloquearse.length > 0 || bloqueadas.length > 0 ? (
        <div className="flex flex-wrap gap-3">
          {porBloquearse.length > 0 ? (
            <div className="flex flex-col rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3">
              <span className="text-2xl font-semibold tabular-nums">{porBloquearse.length}</span>
              <span className="text-xs text-muted-foreground">
                {porBloquearse.length === 1 ? "se bloquea sola" : "se bloquean solas"} en 14 días
              </span>
            </div>
          ) : null}
          {bloqueadas.length > 0 ? (
            <div className="flex flex-col rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
              <span className="text-2xl font-semibold text-destructive tabular-nums">
                {bloqueadas.length}
              </span>
              <span className="text-xs text-destructive">
                {bloqueadas.length === 1 ? "bloqueada" : "bloqueadas"}
                {finDePrueba || pagoVencido
                  ? ` · ${[finDePrueba ? `${finDePrueba} por fin de prueba` : "", pagoVencido ? `${pagoVencido} por pago vencido` : ""].filter(Boolean).join(", ")}`
                  : ""}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      <CuentasGraficas cuentas={cuentas} ingresos={ingresos} />

      {/* «El bloqueo todavía no existe» stood here until 2026-10-31. It was
          false since migration 061 and, with the automatic block of 171,
          dangerously so: it told you a blocked account could still write. */}
      <CuentasTabla cuentas={cuentas} />
    </div>
  );
}
