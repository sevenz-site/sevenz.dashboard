import { createClient } from "@/lib/supabase/server";
import { OwnerUnavailableDialog } from "@/components/owner-unavailable-dialog";
import { ScreenHeader } from "@/components/dashboard/screen-header";
import { MarcarPantallaVacia } from "@/components/dashboard/pantalla-vacia-marcador";
import { ReportesClientSearch } from "@/components/dashboard/reportes-controls";
import { ReportesAncla } from "@/components/dashboard/reportes-ancla";
import { ReportesDescargar } from "@/components/dashboard/reportes-descargar";
import { ReportesFechaFiltro } from "@/components/dashboard/reportes-fecha";
import { mensajeDelMotivo } from "@/lib/reports/exportar-movimientos";
import { ReportesTabs } from "@/components/dashboard/reportes-tabs";
import { apartadoDe } from "@/lib/reports/apartados";
import { rangoDe, textoDelRango } from "@/lib/reports/rango";
import { ReportesFacturacion } from "@/components/dashboard/reportes-facturacion";
import { cargarFacturacion } from "@/lib/reports/facturacion";
import { ReportesInventario } from "@/components/dashboard/reportes-inventario";
import { cargarInventario } from "@/lib/reports/inventario";
import { cargarProveedores } from "@/lib/reports/proveedores";
import { ReportesProveedores } from "@/components/dashboard/reportes-proveedores";
import { getOwnerRateContext } from "@/lib/exchange-rate/owner-rate";
import { readOwnerCountry } from "@/lib/owner-country";
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
// ───────────────────────────────────────────────────────────────────────
// «DESCARGAR» YA ESTÁ, Y A MEDIAS A PROPÓSITO
//
// Hasta el 2026-10-27 esta nota decía que el botón del frame `1502:10291` no
// estaba porque su nota suelta pide `.xlsx`, `.pdf` y envío por correo -- tres
// dependencias nuevas, cada una con `new-api-risk-review` obligatorio.
//
// LO QUE CAMBIÓ es una decisión del dueño ese mismo día: esta entrega es solo
// lo visible, con **descarga directa al teléfono en `.csv`** y sin correo. El
// envío, el `.xlsx`, el `.pdf` y el correo mensual por apartado quedan para
// una segunda entrega, con su propia reseña de dependencias.
//
// Y el menú dibuja **una sola fila**, no las dos del frame: Inventario y
// Proveedores son estado vacío, así que no hay nada que descargar de ellos.
// La razón entera está en `reportes-descargar.tsx`.
// ═══════════════════════════════════════════════════════════════════════

export default async function ReportesPage({
  searchParams,
}: {
  searchParams: Promise<{
    periodo?: string;
    desde?: string;
    hasta?: string;
    cliente?: string;
    tab?: string;
    // Los pone la ruta de descarga al volver aquí tras un fallo. Ver
    // `app/api/reportes/movimientos/route.ts`.
    export?: string;
    motivo?: string;
  }>;
}) {
  const { periodo, desde, hasta, cliente, tab, export: exportado, motivo } = await searchParams;
  // Cualquier valor desconocido cae en el de por defecto en vez de reventar:
  // estos parámetros van en una URL que el dueño puede compartir o teclear
  // mal, y un informe no vale una pantalla caída.
  const rango = rangoDe({ desde, hasta, periodo });
  const apartado = apartadoDe(tab);
  const periodoTexto = textoDelRango(rango);

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

  // SOLO SE CARGA EL APARTADO QUE SE VA A PINTAR. Es la misma razón por la
  // que la pestaña vive en la URL: traer los datos de los tres para enseñar
  // uno es pagar tres consultas por pantalla.
  const facturacion =
    apartado === "facturacion"
      ? await cargarFacturacion({
          supabase,
          ownerId: user!.id,
          rango,
          dosLibros: ownerRate !== null,
          clientId: selected?.id ?? null,
        })
      : null;

  // EL FILTRO POR CLIENTE NO SE LE PASA, y no es un olvido: Inventario habla
  // de productos, no de clientes. «Cuántas referencias te quedan» no cambia
  // porque estés mirando a una persona, y filtrarlo daría la cifra de todo el
  // negocio con un rótulo que promete lo contrario.
  // ── LAS TASAS DEL DÍA ────────────────────────────────────────────────
  //
  // Hacen falta para restar un costo en dólares de una venta en euros, que
  // **en dev es más de la mitad de las líneas vendidas** -- medido el
  // 2026-10-28. Ver la cabecera de `lib/reports/ganancia.ts`.
  //
  // SE ARMAN A MANO EN VEZ DE LLAMAR A `getBolivarRates`, y a propósito: esa
  // función además sale a CriptoYa a buscar el precio del USDT, y aquí no se
  // usa ninguna cifra en USDT --`sale_lines.currency` solo admite USD, EUR y
  // COP--. Es el mismo `usdt: null` deliberado de `app/c/[token]/page.tsx`:
  // una llamada de red por un dato que nadie va a pintar.
  const rates = ownerRate
    ? { usd: ownerRate.effectiveRate.usd, eur: ownerRate.effectiveRate.eur, usdt: null }
    : null;
  const tasas = rates ? { usd: rates.usd, eur: rates.eur } : null;

  const inventario =
    apartado === "inventario"
      ? await cargarInventario({ supabase, ownerId: user!.id, rango, rates })
      : null;

  // EL FILTRO POR CLIENTE TAMPOCO SE LE PASA, por la misma razón que a
  // Inventario: un proveedor no cambia porque estés mirando a una persona.
  const proveedores =
    apartado === "proveedores"
      ? await cargarProveedores({ supabase, ownerId: user!.id, rango, rates })
      : null;

  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* UN ANCLA SOLA BASTA. Si la URL trae `#mas-vendidos` sin su
          `?tab=inventario`, esto corrige la pestaña -- el fragmento no llega
          al servidor, asi que no hay otra forma. Ver su propio fichero. */}
      <ReportesAncla apartado={apartado} />
      <ScreenHeader
        title="Reportes"
        subtitle={`Comportamiento de clientes y productos ${periodoTexto}.`}
        action={<ReportesDescargar />}
        search={
          // ── EL BUSCADOR SOLO EN FACTURACION ─────────────────────────
          //
          // Filtra por CLIENTE, y es el unico apartado al que eso le dice
          // algo. En Inventario la pregunta es «cuantas referencias me
          // quedan», que no cambia porque estes mirando a una persona: dejarlo
          // ahi ofrecia un filtro que la pantalla ignoraba en silencio, y
          // ademas pintaba el aviso «Mostrando solo <nombre>» sobre unas
          // cifras que eran las del negocio entero.
          //
          // EL FRAME DE INVENTARIO PIDE OTRA COSA: su barra dice «Buscar
          // producto». Es un buscador distinto, sobre otra tabla, y no entra
          // en esta entrega -- se dice en vez de dejar el de clientes
          // haciendose pasar por el.
          apartado === "facturacion" ? (
            <ReportesClientSearch clients={clients ?? []} selectedName={selected?.name ?? null} />
          ) : null
        }
        filters={
          // LOS DOS EN EL MISMO HUECO porque `ScreenHeader` tiene UNA ranura de
          // filtros, y el frame los dibuja juntos dentro del bloque oscuro: los
          // apartados arriba y el periodo debajo.
          <div className="flex flex-col gap-3">
            <ReportesTabs activo={apartado} />
            <ReportesFechaFiltro rango={rango} />
          </div>
        }
      />

      {/* LA DESCARGA QUE NO SALIÓ SE DICE AQUÍ, y en el sitio donde el tendero
          acaba de darle al botón. La ruta vuelve con `?export=error&motivo=`
          en vez de dejar un 500 pelado en una pestaña del teléfono, que no
          tiene reintento ni app alrededor. Los mensajes viven en un solo
          sitio -- `MENSAJE_DE_FALLO` -- para que la ruta y esta pantalla no
          puedan contar versiones distintas del mismo fallo. */}
      {exportado === "error" ? (
        <div
          role="alert"
          className="flex flex-col gap-1 rounded-lg border border-destructive/50 bg-destructive/5 px-3 py-2"
        >
          <p className="text-sm font-medium">No se pudo descargar</p>
          <p className="text-sm text-muted-foreground">{mensajeDelMotivo(motivo)}</p>
        </div>
      ) : null}

      {/* CON UN CLIENTE ELEGIDO, LA PANTALLA LO DICE. Sin esto el informe de
          una persona se lee como el del negocio entero, que es la clase de
          error que nadie detecta mirando. */}
      {selected && apartado === "facturacion" ? (
        <p className="text-sm text-muted-foreground">
          Mostrando solo <span className="font-medium text-foreground">{selected.name}</span>.
        </p>
      ) : null}

      {apartado === "facturacion" && facturacion ? (
        <ReportesFacturacion datos={facturacion} periodoTexto={periodoTexto} />
      ) : null}

      {/* LOS OTROS DOS APARTADOS DICEN QUÉ VAN A ENSEÑAR, y no se dibujan
          vacíos ni a medias. Sus frames existen (`1667:19321` y `1749:14583`)
          y varios de sus bloques dependen de datos que la app todavía no
          lleva -- existencias vivas y órdenes de compra--, así que pintarlos
          con lo que hay sería enseñar cifras que describen el día que se
          registró el producto. */}
      {/* LAS DOS PESTAÑAS EN CONSTRUCCIÓN SON ESTADO VACÍO, así que el
          flotante también se aparta en ellas -- la instrucción del dueño del
          2026-10-27 habla del estado vacío, no de una pantalla concreta. */}
      {/* EL FLOTANTE SOLO SE APARTA SI DE VERDAD NO HAY NADA. Desde que
          «Proveedores» pinta su lista ya no es una pantalla vacía, así que
          marcarla como tal escondería el botón de registrar en una pantalla
          con contenido. Se deja la marca para el caso que SÍ lo es: un
          negocio sin un solo producto. */}
      {apartado === "proveedores" && proveedores && proveedores.length === 0 ? (
        <MarcarPantallaVacia />
      ) : null}
      {apartado === "inventario" && inventario ? (
        <ReportesInventario datos={inventario} periodoTexto={periodoTexto} tasas={tasas} />
      ) : null}
      {apartado === "proveedores" && proveedores ? (
        <ReportesProveedores filas={proveedores} tasas={tasas} />
      ) : null}
    </div>
  );
}
