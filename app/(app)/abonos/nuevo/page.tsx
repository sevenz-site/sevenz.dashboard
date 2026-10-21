import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { SetupNotice } from "@/components/setup-notice";
import { getOwnerRateContextResult } from "@/lib/exchange-rate/owner-rate";
import { getBolivarRates } from "@/lib/products/catalog";
import { AbonoSeleccionarFiado, type FiadoAbierto } from "@/components/dashboard/abono-seleccionar-fiado";
import type { BolivarRates, PriceCurrency } from "@/lib/products/price";

export const metadata = { title: "Registrar abono — Sevenz" };

// PASO 1/3 DEL ABONO DIRIGIDO — sitemap `1457:16787`, frame `1457:16193`.
//
// Decisión del dueño el 2026-10-19: *«el abono debería SIEMPRE dirigirse»*.
// Registrar un pago deja de empezar por «¿cuánto?» y empieza por «¿a cuál de
// sus fiados?».
//
// ===========================================================================
// POR QUÉ `?cliente=` ES OBLIGATORIO AQUÍ, Y EN LA VENTA NO
//
// El asistente de venta se puede abrir sin cliente: una venta de contado no
// necesita a nadie, y por eso pregunta en el paso 3 y solo si algo queda
// fiado. Un abono es lo contrario — es dinero que ALGUIEN entrega contra SU
// deuda, así que sin cliente no hay nada que listar. Se entra desde su ficha y
// solo desde ahí.
export default async function NuevoAbonoPage({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string }>;
}) {
  if (!isSupabaseConfigured()) return <SetupNotice />;

  const { cliente: clienteId } = await searchParams;
  if (!clienteId) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // LA COMPROBACIÓN DE PROPIEDAD, EXPLÍCITA Y NO SOLO POR RLS. `clienteId`
  // llega de la barra de direcciones, así que es exactamente el caso de la
  // regla de `CLAUDE.md`: la política es el respaldo, esto es el candado.
  const { data: cliente } = await supabase
    .from("clients")
    .select("id, name")
    .eq("id", clienteId)
    .eq("owner_id", user.id)
    .is("trashed_at", null)
    .maybeSingle();
  if (!cliente) notFound();

  // LOS FIADOS ABIERTOS CON LO QUE TODAVÍA DEBEN — migración `126`. Esa cifra
  // no existía en ningún sitio hasta hoy: la cola FIFO solo devolvía su cabeza,
  // porque la única pregunta que se le hacía era «¿está este cliente en mora?».
  const { data: cargos, error: errorCargos } = await supabase.rpc("get_open_charges_for_client", {
    p_client_id: cliente.id,
  });
  if (errorCargos) {
    // El detalle real al log y nunca a la pantalla. Esta página está detrás de
    // sesión, así que la regla de enmascarar no la obliga — pero un error de
    // Postgres en la cara tampoco le dice nada útil al tendero.
    console.error("[abono] get_open_charges_for_client:", errorCargos.message);
  }

  type FilaCargo = {
    movement_id: string;
    sale_id: string | null;
    charge_at: string;
    currency: PriceCurrency | null;
    amount: number;
    pending: number;
    plazo_dias: number | null;
    cuotas: number | null;
    description: string | null;
  };
  const filas = (cargos ?? []) as FilaCargo[];

  // ── EL NOMBRE QUE VA EN LA TARJETA ───────────────────────────────────
  //
  // El frame escribe «Fiado · Nombre de producto», y esos nombres viven en
  // `sale_lines`. La función SQL devuelve `sale_id` a propósito y no los
  // resuelve: una etiqueta cambia más a menudo que el dinero, y atarla a la
  // migración obligaría a otra migración para renombrarla.
  //
  // UNA SOLA CONSULTA PARA TODA LA LISTA, no una por tarjeta.
  const saleIds = [...new Set(filas.map((f) => f.sale_id).filter((x): x is string => x != null))];
  const nombresPorVenta = new Map<string, string[]>();
  if (saleIds.length > 0) {
    const { data: lineas } = await supabase
      .from("sale_lines")
      .select("sale_id, name")
      .in("sale_id", saleIds);
    for (const l of lineas ?? []) {
      const lista = nombresPorVenta.get(l.sale_id as string) ?? [];
      lista.push(l.name as string);
      nombresPorVenta.set(l.sale_id as string, lista);
    }
  }

  // ── LA TASA, SOLO PARA CONVERTIR ─────────────────────────────────────
  //
  // Se pregunta por el PAÍS y no solo por la tasa, que es la trampa que
  // `CLAUDE.md` cuenta en su apartado 3: un `null` significa «este negocio es
  // colombiano» y también «es venezolano y ahora mismo no hay tasa», y
  // confundirlos archiva un fiado en el libro equivocado. Aquí no se archiva
  // nada —solo se convierte para enseñar «Bs. … hoy»— así que un `null` se
  // traduce en que esa línea no se dibuja, y ya.
  const resultado = await getOwnerRateContextResult(supabase, user.id);
  let rates: BolivarRates | null = null;
  if (resultado.kind === "ve") {
    rates = await getBolivarRates(resultado.context.effectiveRate);
  }

  const fiados: FiadoAbierto[] = filas.map((f) => ({
    movementId: f.movement_id,
    saleId: f.sale_id,
    fecha: f.charge_at,
    currency: f.currency,
    amount: Number(f.amount),
    pending: Number(f.pending),
    plazoDias: f.plazo_dias,
    cuotas: f.cuotas,
    // El nombre de la tarjeta, por orden de preferencia: los productos de la
    // venta, lo que el tendero escribió al registrarlo, y si no hay ninguno de
    // los dos la tarjeta se queda solo con «Fiado» — que sigue siendo cierto.
    // Los fiados de la libreta importada caen casi siempre en el segundo caso.
    productos: f.sale_id ? (nombresPorVenta.get(f.sale_id) ?? []) : [],
    descripcion: f.description,
  }));

  return (
    <AbonoSeleccionarFiado
      clienteId={cliente.id}
      clienteNombre={cliente.name as string}
      fiados={fiados}
      rates={rates}
    />
  );
}
