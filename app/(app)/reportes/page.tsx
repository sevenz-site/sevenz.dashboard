import { createClient } from "@/lib/supabase/server";
import { OwnerUnavailableDialog } from "@/components/owner-unavailable-dialog";
import { ScreenHeader } from "@/components/dashboard/screen-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import {
  ReportesClientSearch,
  ReportesPeriodChips,
} from "@/components/dashboard/reportes-controls";
import { ReportesTabs } from "@/components/dashboard/reportes-tabs";
import { apartadoDe } from "@/lib/reports/apartados";
import { ReportesFacturacion } from "@/components/dashboard/reportes-facturacion";
import { cargarFacturacion } from "@/lib/reports/facturacion";
import { getOwnerRateContext } from "@/lib/exchange-rate/owner-rate";
import { readOwnerCountry } from "@/lib/owner-country";
import type { LendingPeriod } from "@/lib/lending-charts";
import type { OwnerCountry } from "@/lib/types";

// ═══════════════════════════════════════════════════════════════════════
// REPORTES — reescrita al frame `1502:10283` el 2026-10-27
//
// Encargo del dueño: *«tendrá tres tabs en versión dark como la sección
// superior de reportes: Clientes, Inventario y Proveedores»*, con el primero
// renombrado a **Facturación** al pasar los frames.
//
// ───────────────────────────────────────────────────────────────────────
// QUÉ SE VA DE AQUÍ, DICHO EN VOZ ALTA
//
// La versión anterior (frame `1074:30167`, del 2026-10-04) era una tarjeta por
// libro con su gráfico de **Fiado contra Abono**. El frame nuevo no lo dibuja:
// en su lugar hay un gráfico de **Ventas** por moneda y otro de
// **Transacciones** por tipo. No es lo mismo, y conviene saber qué se pierde
// -- la comparación directa entre lo que se fía y lo que se cobra, que ahora
// hay que leer de las barras de Transacciones.
//
// ───────────────────────────────────────────────────────────────────────
// TRES CONTROLES EN LA URL, no en estado de cliente
//
// `?tab=`, `?periodo=` y `?cliente=`. Los dos últimos ya vivían ahí; el
// primero se suma por la misma razón que ellos: el servidor sabe qué pintar,
// así que no se cargan los datos de los tres apartados para enseñar uno.
//
// LO QUE EL FRAME DIBUJA Y AQUÍ NO ESTÁ, y se dice en vez de inventarlo:
//
//   · **«Descargar»** en la cabecera. Su nota suelta dice que manda .xlsx y
//     .pdf al correo y que hay un envío mensual por apartado. Eso es la parte
//     B de `REPORTES-PLAN.md` --generar ficheros, un proveedor de correo y un
//     cron--, no esta pantalla. Un botón que no hace nada se lee como que la
//     app está rota, que es lo que `CT-58` ya dejó escrito.
//   · **El desplegable «Fecha»**. Aquí siguen los chips de periodo que esta
//     pantalla ya tenía, que contestan lo mismo con un toque menos.
// ═══════════════════════════════════════════════════════════════════════

const PERIOD_LABEL: Record<LendingPeriod, string> = {
  "7d": "los últimos 7 días",
  "30d": "los últimos 30 días",
};

export default async function ReportesPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string; cliente?: string; tab?: string }>;
}) {
  const { periodo, cliente, tab } = await searchParams;
  // Cualquier valor desconocido cae en el de por defecto en vez de reventar:
  // estos parámetros van en una URL que el dueño puede compartir o teclear
  // mal, y un informe no vale una pantalla caída.
  const period: LendingPeriod = periodo === "30d" ? "30d" : "7d";
  const apartado = apartadoDe(tab);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: clients }, { data: owner }, ownerRate] = await Promise.all([
    supabase
      .from("clients")
      .select("id, name, document_id, document_type")
      .eq("owner_id", user!.id)
      .is("trashed_at", null)
      .is("deleted_at", null)
      .order("name"),
    supabase.from("owners").select("country").eq("id", user!.id).single(),
    getOwnerRateContext(supabase, user!.id),
  ]);

  // La misma guarda que Inicio, y por la misma razón: no saber el país no es
  // saber que es CO. Adivinar aquí le dibujaría a un negocio venezolano el
  // informe colombiano -- que no es un mensaje de error, es un informe vacío
  // que parece «tuviste una semana floja».
  const ownerCountry =
    (owner?.country as OwnerCountry | undefined) ?? (await readOwnerCountry(supabase, user!.id));
  if (!ownerCountry) return <OwnerUnavailableDialog />;

  // Un id desconocido u oculto es simplemente «sin filtro». En silencio y a
  // propósito: la alternativa es un 404 en una pantalla cuyo trabajo es
  // enseñar números, por un parámetro que pudo llegar en un enlace compartido.
  const selected = (clients ?? []).find((c) => c.id === cliente) ?? null;

  const facturacion =
    apartado === "facturacion"
      ? await cargarFacturacion({
          supabase,
          ownerId: user!.id,
          period,
          dosLibros: ownerRate !== null,
          clientId: selected?.id ?? null,
        })
      : null;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <ScreenHeader
        title="Reportes"
        subtitle={`Comportamiento de clientes y productos durante ${PERIOD_LABEL[period]}.`}
        search={
          <ReportesClientSearch clients={clients ?? []} selectedName={selected?.name ?? null} />
        }
        filters={
          // LOS DOS EN EL MISMO HUECO porque `ScreenHeader` tiene UNA ranura de
          // filtros, y el frame los dibuja juntos dentro del bloque oscuro: los
          // apartados arriba y el periodo debajo.
          <div className="flex flex-col gap-3">
            <ReportesTabs activo={apartado} />
            <ReportesPeriodChips period={period} />
          </div>
        }
      />

      {/* CON UN CLIENTE ELEGIDO, LA PANTALLA LO DICE. Sin esto el informe de
          una persona se lee como el del negocio entero, que es la clase de
          error que nadie detecta mirando. */}
      {selected ? (
        <p className="text-sm text-muted-foreground">
          Mostrando solo <span className="font-medium text-foreground">{selected.name}</span>.
        </p>
      ) : null}

      {apartado === "facturacion" && facturacion ? (
        <ReportesFacturacion datos={facturacion} periodoTexto={PERIOD_LABEL[period]} />
      ) : null}

      {/* LOS OTROS DOS APARTADOS DICEN QUÉ VAN A ENSEÑAR, y no se dibujan
          vacíos ni a medias. Sus frames existen (`1667:19321` y `1749:14583`)
          y varios de sus bloques dependen de datos que la app todavía no
          lleva -- existencias vivas y órdenes de compra--, así que pintarlos
          con lo que hay sería enseñar cifras que describen el día que se
          registró el producto. */}
      {apartado === "inventario" ? (
        <EmptyState
          title="Inventario, en camino"
          subtitle="Aquí irán el capital en inventario, lo que está por agotarse, el margen por producto y los más vendidos."
        />
      ) : null}
      {apartado === "proveedores" ? (
        <EmptyState
          title="Proveedores, en camino"
          subtitle="Aquí irá cada proveedor con cuántos productos le compras y el margen que te dejan."
        />
      ) : null}
    </div>
  );
}
