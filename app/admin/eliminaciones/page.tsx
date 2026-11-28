import { requireSuperadmin } from "@/lib/admin/guard";
import { listAccountDeletions } from "@/lib/admin/account-deletions";
import { ScreenTitle } from "@/components/dashboard/screen-chrome";
import { formatDateLong } from "@/lib/format";
import { BorrarCuentaDialog } from "./borrar-dialog";

export const dynamic = "force-dynamic";

// /admin/eliminaciones (PL-48 step 1.3): every request to delete an account, and the button
// that runs one once its 30 days are over. Owner's decision of 2026-11-27: the Sevenz owner
// runs each deletion himself from here, not a job. What a deletion keeps is written at the top
// of migration 229. Dates in Caracas time: this screen is read by the Sevenz owner.

const ZONA = "America/Caracas";

function diasHasta(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

export default async function EliminacionesPage() {
  await requireSuperadmin();
  const { rows, error } = await listAccountDeletions();

  return (
    <div className="flex flex-col gap-4">
      <ScreenTitle>Eliminaciones de cuenta</ScreenTitle>
      <p className="max-w-2xl text-sm text-muted-foreground">
        Cada cuenta se puede borrar 30 días después de pedirlo. Se borran el acceso, los clientes, el historial, los
        productos, el catálogo, los pedidos, las fotos y los archivos. Se quedan la ficha de la cuenta, su plan y sus
        pagos con comprobantes, su KAM y comisiones, comentarios, eventos comerciales, el registro de seguridad y el
        permiso de WhatsApp.
      </p>
      {error ? <p className="text-sm text-destructive">No se pudo leer la lista: {error}</p> : null}
      {!error && rows.length === 0 ? <p className="text-sm text-muted-foreground">Nadie ha pedido eliminar su cuenta.</p> : null}

      <ul className="flex flex-col gap-3">
        {rows.map((r) => {
          const abierta = !r.cancelled_at && !r.deleted_at;
          const faltan = diasHasta(r.scheduled_for);
          const vencida = abierta && faltan <= 0;
          return (
            <li key={r.request_id} className="flex flex-col gap-3 rounded-[10px] border p-4 md:flex-row md:items-center md:justify-between">
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-sm font-medium">{r.business_name ?? "Cuenta sin ficha"}</p>
                <p className="text-xs text-muted-foreground">
                  {r.email ?? "—"} · {r.country ?? "—"} · pedido {r.source === "web" ? "desde la web" : "desde la app"} el{" "}
                  {formatDateLong(r.requested_at, ZONA)}
                </p>
                <p className="text-xs">
                  {r.deleted_at
                    ? `Eliminada el ${formatDateLong(r.deleted_at, ZONA)}${r.deleted_by ? ` por ${r.deleted_by}` : ""}`
                    : r.cancelled_at
                      ? `Cancelada por el dueño el ${formatDateLong(r.cancelled_at, ZONA)}`
                      : vencida
                        ? `Vencida desde el ${formatDateLong(r.scheduled_for, ZONA)}: lista para borrar`
                        : `Se puede borrar el ${formatDateLong(r.scheduled_for, ZONA)} (faltan ${faltan} ${faltan === 1 ? "día" : "días"})`}
                </p>
              </div>
              {abierta ? (
                <BorrarCuentaDialog requestId={r.request_id} businessName={r.business_name ?? ""} disabled={!vencida} />
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
