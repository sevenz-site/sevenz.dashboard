"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { puedeEscribir } from "@/lib/cuenta-pausada-server";
import { MENSAJE_CUENTA_PAUSADA } from "@/lib/cuenta-pausada";
import { resolveMovementRateSnapshot } from "@/lib/exchange-rate/resolve-movement-rate";
import { convertirDesdeBolivares } from "@/lib/exchange-rate/monto-en-bolivares";
import { guardarPermisoDeclarado } from "@/lib/whatsapp/declared-consent";
import { formatPriceAmount, type PriceCurrency } from "@/lib/products/price";
import type { LedgerCurrency } from "@/lib/types";

// EL ABONO DIRIGIDO — paso 3/3 del flujo, frame `1389:9381`.
//
// Decisión del dueño el 2026-10-19: *«el abono debería SIEMPRE dirigirse»*. Lo
// que esta acción escribe y `addMovement` no es `applies_to_movement_id`: a qué
// fiado concreto va este pago.
//
// ===========================================================================
// POR QUÉ UNA ACCIÓN APARTE Y NO UN CAMPO MÁS EN `addMovement`
//
// Las dos escriben un `payment`, pero su TOPE es distinto y eso no es un
// parámetro, es otra regla:
//
//   · `addMovement` topa el abono contra **lo que el cliente debe en esa
//     moneda**, que es la suma de todos sus fiados.
//   · Esta topa contra **lo que ESE fiado todavía debe**, que es la regla que
//     el dueño pidió el 2026-10-19: *«no debe permitir abonar más de lo que
//     debe»* de ese fiado, *«pero sí puede abonar parcial»*.
//
// Meter las dos en la misma función obligaría a un `if` sobre el tope dentro
// del camino del dinero, y el día que alguien toque ese `if` mueve las dos.
//
// LO QUE SÍ SE COMPARTE ES LO QUE NO PUEDE DIVERGIR: la resolución de la tasa
// (`resolveMovementRateSnapshot`), la conversión desde bolívares
// (`convertirDesdeBolivares`) y el permiso de WhatsApp
// (`guardarPermisoDeclarado`) son los mismos helpers que usa `addMovement`. Lo
// copiado sería lo peligroso; esto es lo que queda.

export type AbonoDirigidoEntrada = {
  // El fiado al que va. Llega del navegador, así que se comprueba entero.
  fiadoId: string;
  // Lo que el tendero escribió, en la moneda que eligió.
  monto: number;
  monedaTecleada: "VES" | PriceCurrency;
  usarPrevista?: boolean;
  photoPath?: string | null;
  descripcion?: string | null;
  // El interruptor de encima del botón: enciende los avisos de WhatsApp para
  // este cliente si no los tenía.
  avisarPorWhatsapp?: boolean;
};

export type AbonoDirigidoResultado =
  | { ok: true; movementId: string; clientId: string }
  | { ok: false; error: string };

// Medio céntimo, el mismo que usa `registrarVenta` al comparar lo cobrado con
// el total. Sin él, un abono convertido desde bolívares que da 5,8399 contra un
// pendiente de 5,84 se rechazaría por una diezmilésima.
const HOLGURA = 0.005;

export async function registrarAbonoDirigido(
  entrada: AbonoDirigidoEntrada,
): Promise<AbonoDirigidoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Tu sesión se cerró. Vuelve a entrar." };

  // La cuenta pausada se para aquí, antes de tocar nada. Un insert rechazado
  // por la política vuelve como «new row violates row-level security policy»,
  // que no se le puede enseñar a nadie.
  if (!(await puedeEscribir(supabase, user.id))) return { ok: false, error: MENSAJE_CUENTA_PAUSADA };

  // ── EL FIADO, Y LA PROPIEDAD COMPROBADA A TRAVÉS DEL CLIENTE ────────
  const { data: fiado } = await supabase
    .from("movements")
    .select("id, client_id, type, currency, clients!inner(id, name, owner_id)")
    .eq("id", entrada.fiadoId)
    .is("deleted_at", null)
    .maybeSingle();

  const cliente = fiado?.clients as unknown as { id: string; name: string; owner_id: string } | null;
  if (!fiado || !cliente || cliente.owner_id !== user.id) {
    return { ok: false, error: "No encontramos ese fiado." };
  }
  // Un abono no tiene a qué abonar. Llegar aquí con el id de uno solo puede ser
  // una petición escrita a mano.
  if (fiado.type !== "charge") return { ok: false, error: "No encontramos ese fiado." };

  // ── CUÁNTO LE QUEDA A ESE FIADO ─────────────────────────────────────
  //
  // De la MISMA función que alimenta las pantallas 1/3 y 2/3. No se recalcula
  // aquí: el tope que rechaza el dinero y la cifra que la pantalla enseñó
  // tienen que salir del mismo sitio, o el tendero verá «Debe 70» y la acción
  // le dirá que son 50.
  const { data: abiertos } = await supabase.rpc("get_open_charges_for_client", {
    p_client_id: cliente.id,
  });
  const abierto = (abiertos ?? []).find(
    (c: { movement_id: string }) => c.movement_id === fiado.id,
  ) as { pending: number } | undefined;

  // REGLA DEL DUEÑO, 2026-10-19: *«se permite solo si ese fiado aún tiene saldo
  // pendiente por abonar, si no, no se permite»*.
  if (!abierto || Number(abierto.pending) <= HOLGURA) {
    return { ok: false, error: "Ese fiado ya está saldado." };
  }
  const pendiente = Number(abierto.pending);

  const libro = (fiado.currency ?? null) as LedgerCurrency | null;

  // ── LA TASA, SELLADA ANTES DE CONVERTIR NADA ────────────────────────
  const resolucion = await resolveMovementRateSnapshot(
    supabase,
    user.id,
    libro,
    entrada.usarPrevista === true,
  );
  if (!resolucion.ok) return { ok: false, error: resolucion.error };
  const sello = resolucion.snapshot;

  // Los bolívares se convierten con la MISMA tasa que se acaba de sellar —la
  // prevista incluida si el tendero marcó la casilla— para que el respaldo y la
  // cifra guardada no puedan discrepar.
  let monto = entrada.monto;
  let entryAmount: number | null = null;
  let entryCurrency: "VES" | LedgerCurrency | null = sello.entryCurrency;
  if (entrada.monedaTecleada === "VES" && libro) {
    const convertido = convertirDesdeBolivares(monto, libro, sello);
    if ("error" in convertido) return { ok: false, error: convertido.error };
    monto = convertido.monto;
    entryAmount = convertido.entryAmount;
    entryCurrency = "VES";
  }

  if (!(monto > 0)) return { ok: false, error: "Escribe cuánto te pagó." };

  // REGLA DEL DUEÑO, 2026-10-19: *«no debe permitir abonar más de lo que debe,
  // pero sí puede abonar parcial»*. El tope es ESE fiado, no la deuda total.
  //
  // SE COMPRUEBA DESPUÉS DE CONVERTIR, que es el único orden correcto: el
  // tendero escribe bolívares y el fiado debe dólares, así que comparar antes
  // sería comparar dos monedas.
  if (monto - pendiente > HOLGURA) {
    return {
      ok: false,
      error: `Ese fiado solo debe ${formatPriceAmount(pendiente, (libro ?? "COP") as PriceCurrency)}. Escribe esa cantidad o menos.`,
    };
  }

  const { data: creado, error: errorInsert } = await supabase
    .from("movements")
    .insert({
      client_id: cliente.id,
      created_by: user.id,
      type: "payment",
      amount: monto,
      currency: libro,
      description: entrada.descripcion?.trim() || null,
      source: "manual",
      photo_path: entrada.photoPath ?? null,
      // LO QUE HACE QUE ESTE ABONO SEA DIRIGIDO. Todo lo demás de esta fila es
      // igual que el de un abono normal.
      applies_to_movement_id: fiado.id,
      rate_mode_used: sello.rateModeUsed,
      exchange_rate_used: sello.exchangeRateUsed,
      official_bcv_rate_at_time: sello.officialBcvRateAtTime,
      entry_currency: entryCurrency,
      entry_amount: entryAmount ?? (entryCurrency ? monto : null),
      rate_usd_at_time: sello.rateUsdAtTime,
      rate_eur_at_time: sello.rateEurAtTime,
    })
    .select("id")
    .single();

  if (errorInsert || !creado) {
    console.error("[abono] insert:", errorInsert?.message);
    return { ok: false, error: "No pudimos guardar el abono. Vuelve a intentarlo." };
  }

  // ── EL PERMISO DE WHATSAPP, SI LO PIDIÓ ─────────────────────────────
  //
  // DESPUÉS DEL ABONO Y SIN PODER TUMBARLO: el permiso es un extra, y perder un
  // pago registrado porque una tabla de consentimientos falló sería cambiar un
  // problema pequeño por el peor que tiene esta app. `guardarPermisoDeclarado`
  // es append-only, así que volver a concederlo cuando ya estaba no rompe nada
  // — deja otra fila, que es justo el rastro que Meta pide.
  if (entrada.avisarPorWhatsapp) {
    try {
      await guardarPermisoDeclarado(supabase, {
        clientId: cliente.id,
        ownerId: user.id,
        clientName: cliente.name,
        source: "owner_movement_form",
        seMostro: true,
        acepta: true,
      });
    } catch (e) {
      console.error("[abono] permiso de whatsapp:", e instanceof Error ? e.message : e);
    }
  }

  revalidatePath("/dashboard");
  revalidatePath(`/clients/${cliente.id}`);

  return { ok: true, movementId: creado.id as string, clientId: cliente.id };
}
