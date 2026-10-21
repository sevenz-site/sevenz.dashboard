import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { SetupNotice } from "@/components/setup-notice";
import { getOwnerRateContextResult } from "@/lib/exchange-rate/owner-rate";
import { AbonoMonto } from "@/components/dashboard/abono-monto";
import type { MovementRateContext } from "@/lib/exchange-rate/convert";
import type { LedgerCurrency } from "@/lib/types";

export const metadata = { title: "Monto a abonar — Sevenz" };

// EL MONTO DEL ABONO — frame `1389:9381`. Paso 3/3 del flujo dirigido, o
// pantalla única cuando se llega desde la ficha del fiado (ver `desdeElDetalle`).
//
// El fiado ya está elegido y confirmado; aquí se escribe cuánto le pagó y se
// guarda. Es la pantalla donde el abono deja de ser una intención.
export default async function MontoDelAbonoPage({
  params,
  searchParams,
}: {
  params: Promise<{ movementId: string }>;
  // `?desde=detalle` LO PONE EL BOTÓN «Pagar» de la ficha del movimiento.
  // Ver abajo: cambia cómo se presenta la pantalla y adónde vuelve.
  searchParams: Promise<{ desde?: string }>;
}) {
  if (!isSupabaseConfigured()) return <SetupNotice />;

  const { movementId } = await params;
  const { desde } = await searchParams;

  // ── DE DÓNDE SE ENTRÓ, Y POR QUÉ IMPORTA ─────────────────────────────
  //
  // Esta pantalla tiene dos puertas y hasta el 2026-10-20 se comportaba como
  // si tuviera una:
  //
  //   · el «Confirmar» del paso 2/3 -> es el final de un flujo de tres
  //   · el «Pagar» de la ficha del fiado -> es una pantalla suelta
  //
  // Por la segunda se llegaba a algo rotulado «3/3» cuya flecha volvía al
  // paso 2/3, así que arrepentirse sacaba al tendero caminando hacia atrás
  // por dos pantallas que nunca vio. Lo reportó el dueño ese día.
  //
  // UN BOOLEANO Y NO UNA URL DE VUELTA. La tentación es `?volver=<ruta>`,
  // que sería más general -- y una dirección de vuelta que viene del
  // navegador es un redirector abierto si alguien la usa sin mirarla. Aquí
  // no hace falta ninguna: el destino es la ficha de ESTE fiado, y su id ya
  // está en la ruta.
  const desdeElDetalle = desde === "detalle";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: fiado } = await supabase
    .from("movements")
    .select("id, client_id, type, currency, created_at, clients!inner(id, name, whatsapp, owner_id)")
    .eq("id", movementId)
    .is("deleted_at", null)
    .maybeSingle();

  const cliente = fiado?.clients as unknown as {
    id: string;
    name: string;
    whatsapp: string | null;
    owner_id: string;
  } | null;
  if (!fiado || !cliente || cliente.owner_id !== user.id || fiado.type !== "charge") notFound();

  // EL PENDIENTE SALE DE LA MISMA FUNCIÓN QUE EL TOPE DE LA ACCIÓN. Si esta
  // pantalla lo calculara por su cuenta, el tendero podría ver «Debe 70» y
  // recibir un «ese fiado solo debe 50» al guardar.
  const { data: abiertos } = await supabase.rpc("get_open_charges_for_client", {
    p_client_id: cliente.id,
  });
  const abierto = (abiertos ?? []).find(
    (c: { movement_id: string }) => c.movement_id === fiado.id,
  ) as { pending: number } | undefined;
  // SALDADO MIENTRAS TANTO. Vuelve por donde se vino: mandar al buscador de
  // fiados a quien llegó desde la ficha es el mismo fallo que este cambio
  // arregla, entrando por la puerta del error en vez de por la del acierto.
  if (!abierto) {
    redirect(desdeElDetalle ? `/transacciones/${fiado.id}` : `/abonos/nuevo?cliente=${cliente.id}`);
  }

  // ── LA TASA ──────────────────────────────────────────────────────────
  //
  // El MISMO objeto que recibe el formulario de «Agregar», armado igual que en
  // `clients/[id]/page.tsx`. Los componentes de monto que esta pantalla reusa
  // lo esperan, y con ello viene gratis la ventana de la tasa prevista: la
  // casilla sale cuando toca y no cuando simplemente hay una guardada.
  const resultado = await getOwnerRateContextResult(supabase, user.id);
  const rateContext: MovementRateContext | null =
    resultado.kind === "ve"
      ? {
          rateMode: resultado.context.rateMode,
          effectiveRate: resultado.context.effectiveRate,
          officialRateUsd: resultado.context.officialRate.usd,
          prevista: resultado.context.prevista,
          rateDate: resultado.context.rateDate,
        }
      : null;

  // ── ¿YA ACEPTA AVISOS? ───────────────────────────────────────────────
  //
  // La casilla del pie solo tiene sentido si NO los tiene activados — son las
  // palabras del dueño: «para activar las notificaciones de WhatsApp en caso
  // que no las tenga activadas».
  //
  // SE PREGUNTA A LA MISMA FUNCIÓN QUE USA LA PUERTA DE ENVÍO. Una consulta
  // propia aquí serían dos definiciones de «acepta», y la que decide si sale un
  // mensaje es la suya. Pregunta por TELÉFONO y no por ficha, que es la
  // diferencia que importa: media docena de fichas comparten número.
  const { data: acepta } = await supabase.rpc("client_accepts_whatsapp", {
    p_client_id: cliente.id,
  });

  return (
    <AbonoMonto
      ownerId={user.id}
      fiadoId={fiado.id}
      clienteNombre={cliente.name}
      clienteTieneWhatsapp={Boolean(cliente.whatsapp?.trim())}
      libro={(fiado.currency ?? null) as LedgerCurrency | null}
      pendiente={Number(abierto.pending)}
      rateContext={rateContext}
      yaAceptaAvisos={acepta === true}
      pasoUnico={desdeElDetalle}
    />
  );
}
