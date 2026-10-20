import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { SetupNotice } from "@/components/setup-notice";
import { getOwnerRateContextResult } from "@/lib/exchange-rate/owner-rate";
import { getBolivarRates } from "@/lib/products/catalog";
import { AbonoMonto } from "@/components/dashboard/abono-monto";
import type { BolivarRates, PriceCurrency } from "@/lib/products/price";

export const metadata = { title: "Monto a abonar — Sevenz" };

// PASO 3/3 DEL ABONO DIRIGIDO — frame `1389:9381`.
//
// El fiado ya está elegido y confirmado; aquí se escribe cuánto le pagó y se
// guarda. Es la pantalla donde el abono deja de ser una intención.
export default async function MontoDelAbonoPage({
  params,
}: {
  params: Promise<{ movementId: string }>;
}) {
  if (!isSupabaseConfigured()) return <SetupNotice />;

  const { movementId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: fiado } = await supabase
    .from("movements")
    .select("id, client_id, type, currency, created_at, clients!inner(id, name, owner_id)")
    .eq("id", movementId)
    .is("deleted_at", null)
    .maybeSingle();

  const cliente = fiado?.clients as unknown as { id: string; name: string; owner_id: string } | null;
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
  if (!abierto) redirect(`/abonos/nuevo?cliente=${cliente.id}`);

  // ── LA TASA Y LA PREVISTA ────────────────────────────────────────────
  const resultado = await getOwnerRateContextResult(supabase, user.id);
  let rates: BolivarRates | null = null;
  let prevista: string | null = null;
  if (resultado.kind === "ve") {
    rates = await getBolivarRates(resultado.context.effectiveRate);
    prevista = resultado.context.prevista?.fecha ?? null;
  }

  // ── ¿YA ACEPTA AVISOS? ───────────────────────────────────────────────
  //
  // El interruptor del pie solo tiene sentido si NO los tiene activados — son
  // las palabras del dueño: «para activar las notificaciones de WhatsApp en
  // caso que no las tenga activadas». Enseñárselo encendido a quien ya aceptó
  // es una pregunta sin respuesta posible.
  //
  // SE PREGUNTA A LA MISMA FUNCIÓN QUE USA LA PUERTA DE ENVÍO. Tener aquí una
  // consulta propia sería tener dos definiciones de «acepta», y la que decide
  // si sale un mensaje es la suya.
  const { data: acepta } = await supabase.rpc("client_accepts_whatsapp", {
    p_client_id: cliente.id,
  });

  return (
    <AbonoMonto
      ownerId={user.id}
      fiadoId={fiado.id}
      clienteId={cliente.id}
      clienteNombre={cliente.name}
      moneda={(fiado.currency ?? "COP") as PriceCurrency}
      esLibroDelPeso={fiado.currency == null}
      pendiente={Number(abierto.pending)}
      rates={rates}
      previstaFecha={prevista}
      yaAceptaAvisos={acepta === true}
    />
  );
}
