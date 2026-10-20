"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { enviarReciboAlCliente } from "@/lib/whatsapp/recibo-cliente";
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
  // Si la casilla del permiso llegó a estar en pantalla. Va aparte de
  // `avisarPorWhatsapp` porque un «no» también se anota: sin eso, el cliente
  // nunca queda marcado como preguntado y la casilla reaparece en cada
  // movimiento. Es la misma pareja de banderas que manda `addMovement`.
  permisoMostrado?: boolean;
  // La casilla de encima del botón: enciende los avisos de WhatsApp para este
  // cliente si no los tenía.
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
  if (entrada.permisoMostrado || entrada.avisarPorWhatsapp) {
    try {
      await guardarPermisoDeclarado(supabase, {
        clientId: cliente.id,
        ownerId: user.id,
        clientName: cliente.name,
        source: "owner_movement_form",
        seMostro: entrada.permisoMostrado !== false,
        acepta: entrada.avisarPorWhatsapp === true,
      });
    } catch (e) {
      console.error("[abono] permiso de whatsapp:", e instanceof Error ? e.message : e);
    }
  }

  // ── EL RECIBO AL CLIENTE ────────────────────────────────────────────
  //
  // ESTO FALTABA, Y ES EL FALLO QUE ESTA PUERTA TRAÍA DE NACIMIENTO. El recibo
  // de WhatsApp lo disparaba solo `addMovement`, en `dashboard/actions.ts`. Con
  // la decisión del dueño del 2026-10-19 —*«el abono debería SIEMPRE
  // dirigirse»*— esta acción pasa a ser POR DONDE SE REGISTRAN LOS ABONOS, así
  // que sin esta llamada `abono_confirmation_v3` habría dejado de enviarse para
  // todos, cuatro días después de arreglarla (`MS-39`).
  //
  // Es el caso de la regla de `CLAUDE.md` «un campo nuevo entra por TODAS las
  // puertas de su acción», leída al revés: una puerta nueva hacia el mismo
  // resultado que se salta un efecto que la vieja sí tenía. Y no avisa — el
  // abono se guarda, la pantalla dice que todo bien, y el cliente simplemente
  // no recibe nada. Igual que los 12 de 12 rechazados de `MS-39`.
  //
  // DESPUÉS DE LA RESPUESTA Y SIN PODER TUMBARLA, por las razones que
  // `dispararRecibo` tiene escritas en `dashboard/actions.ts`: dentro va una
  // llamada a Kapso por internet, y el tendero vino a registrar un abono, no a
  // esperar a un proveedor externo. Si falla, el abono ya está guardado y el
  // error queda en `whatsapp_sends`.
  const idDelAbono = creado.id as string;
  after(async () => {
    const r = await enviarReciboAlCliente(idDelAbono);
    // Un «omitido» normal —sin permiso, sin número, desactivado— no es un error
    // y no ensucia el log. Un «fallido» sí: el cliente esperaba su comprobante.
    if (r.estado === "fallido") console.error("[recibo]", idDelAbono, r.error);
  });

  revalidatePath("/dashboard");
  revalidatePath(`/clients/${cliente.id}`);

  return { ok: true, movementId: idDelAbono, clientId: cliente.id };
}

// ===========================================================================
// EDITAR EL MONTO DE UN ABONO
// ===========================================================================
//
// Encargo del dueño el 2026-10-20, al pedir el «⋮» de cada abono dentro de su
// fiado (frame `1489:10209`): *«solo saldo, no toca fecha, se debe mandar
// notificación vía whatsapp que se editó un abono»*.
//
// ES LA PRIMERA EDICIÓN DE UN MOVIMIENTO QUE EXISTE EN ESTA APP. Hasta hoy un
// movimiento se creaba o se borraba, nunca se cambiaba, y eso no era un
// descuido: cada fila de `movements` lleva una tasa sellada, un saldo
// acumulado y un reparto de abonos que dependen de ella.
//
// ===========================================================================
// LA FECHA NO SE TOCA, Y POR ESO LA TASA TAMPOCO
//
// Son la misma decisión vista dos veces. La tasa que este abono selló es la
// del día en que se hizo; si la fecha no se mueve, resellarla sería cambiar el
// pasado. Así que `exchange_rate_used`, `rate_usd_at_time`, `rate_eur_at_time`
// y `created_at` se quedan exactamente como estaban.
//
// ===========================================================================
// SE EDITA EN LA MONEDA EN QUE SE TECLEÓ, no en la del libro
//
// Un abono escrito como «Bs. 900» guardó 900 en `entry_amount` y $1,08 en
// `amount`. Dejar editar solo el dólar convertiría ese respaldo en mentira: el
// tendero vería «Bs. 900» junto a una cifra que ya no sale de ahí. Así que el
// diálogo pide la misma moneda que se usó y la conversión la hace la tasa que
// el abono ya tiene sellada — la misma aritmética de `convertirDesdeBolivares`
// (`Math.round((bs / porUnidad) * 100) / 100`), escrita aquí porque aquí la
// tasa no se resuelve: se lee de la fila.
//
// ===========================================================================
// EL AVISO AL CLIENTE NO SALE TODAVÍA, Y SE DICE EN VOZ ALTA
//
// El dueño lo pidió, y hace falta una plantilla de Meta que no existe: es
// `CT-114`. Hasta que exista, esto edita y NO avisa, y la pantalla lo dice.
// Prometer un aviso que no sale es peor que no ofrecerlo.
export type EdicionDeAbono = {
  movementId: string;
  // En la moneda en que se tecleó el abono: bolívares si se escribió así, la
  // del libro si no. Lo que el diálogo enseña y lo que aquí se espera son la
  // misma cifra.
  monto: number;
};

export async function editarAbonoDirigido(
  entrada: EdicionDeAbono,
): Promise<{ ok: true; movementId: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Tu sesión se cerró. Vuelve a entrar." };

  if (!(await puedeEscribir(supabase, user.id))) return { ok: false, error: MENSAJE_CUENTA_PAUSADA };

  // ── EL ABONO, Y LA PROPIEDAD COMPROBADA A TRAVÉS DEL CLIENTE ────────
  const { data: abono } = await supabase
    .from("movements")
    .select(
      "id, client_id, type, amount, currency, entry_currency, entry_amount, exchange_rate_used, applies_to_movement_id, clients!inner(id, owner_id)",
    )
    .eq("id", entrada.movementId)
    .is("deleted_at", null)
    .maybeSingle();

  const cliente = abono?.clients as unknown as { id: string; owner_id: string } | null;
  if (!abono || !cliente || cliente.owner_id !== user.id) {
    return { ok: false, error: "No encontramos ese abono." };
  }
  if (abono.type !== "payment") return { ok: false, error: "No encontramos ese abono." };

  if (!(entrada.monto > 0)) return { ok: false, error: "Escribe cuánto te pagó." };

  // ── LO QUE VA A QUEDAR GUARDADO EN EL LIBRO ─────────────────────────
  let monto = entrada.monto;
  let entryAmount: number | null = abono.entry_amount == null ? null : Number(abono.entry_amount);
  if (abono.entry_currency === "VES") {
    const porUnidad = abono.exchange_rate_used == null ? null : Number(abono.exchange_rate_used);
    if (!porUnidad || porUnidad <= 0) {
      // Un abono en bolívares sin tasa sellada no se puede reconvertir, y
      // adivinar una tasa para una fila vieja sería inventar dinero.
      return {
        ok: false,
        error: "Este abono no guardó la tasa del día, así que no se puede editar. Bórralo y regístralo de nuevo.",
      };
    }
    monto = Math.round((entrada.monto / porUnidad) * 100) / 100;
    entryAmount = entrada.monto;
    if (monto <= 0) {
      return { ok: false, error: "El monto es demasiado pequeño para registrarlo. Revisa la cifra." };
    }
  } else if (abono.entry_currency != null) {
    // Se tecleó en la moneda del libro: lo escrito ES lo que se guarda, y el
    // respaldo tiene que seguirlo.
    entryAmount = entrada.monto;
  }

  // ── EL TOPE: LO QUE ESE FIADO DEBE, CONTANDO ESTE ABONO ─────────────
  //
  // `pending` YA DESCUENTA el abono tal como está guardado hoy, así que el
  // techo de la cifra nueva es `pending + lo que este abono vale ahora`. Sin
  // ese `+`, subir un abono de 10 a 11 en un fiado saldado se rechazaría
  // aunque sobre sitio.
  //
  // Un abono SIN dirigir no tiene fiado contra el que topar: lo reparte la
  // cola FIFO sobre el saldo total. Se topa entonces contra lo que el cliente
  // debe en esa moneda, que es la regla de `addMovement`.
  if (abono.applies_to_movement_id) {
    const { data: abiertos } = await supabase.rpc("get_open_charges_for_client", {
      p_client_id: cliente.id,
    });
    const abierto = ((abiertos ?? []) as { movement_id: string; pending: number }[]).find(
      (c) => c.movement_id === abono.applies_to_movement_id,
    );
    const techo = Number(abierto?.pending ?? 0) + Number(abono.amount);
    if (monto - techo > HOLGURA) {
      return {
        ok: false,
        error: `Ese fiado solo admite ${formatPriceAmount(techo, (abono.currency ?? "COP") as PriceCurrency)}. Escribe esa cantidad o menos.`,
      };
    }
  }

  const { error: errorUpdate } = await supabase
    .from("movements")
    .update({ amount: monto, entry_amount: entryAmount })
    .eq("id", abono.id)
    .eq("client_id", cliente.id);

  if (errorUpdate) {
    console.error("[abono] editar:", errorUpdate.message);
    return { ok: false, error: "No pudimos guardar el cambio. Vuelve a intentarlo." };
  }

  // EL SALDO ACUMULADO SE REHACE, que es lo que de verdad cuesta de editar un
  // movimiento: `running_balance` de ESTE y de todos los posteriores depende
  // de su importe. Es la misma función que usa el borrado.
  const { error: errorRecalc } = await supabase.rpc("recalc_client_running_balance", {
    p_client_id: cliente.id,
  });
  if (errorRecalc) console.error("[abono] recalc:", errorRecalc.message);

  revalidatePath("/dashboard");
  revalidatePath(`/clients/${cliente.id}`);
  revalidatePath(`/transacciones/${abono.id}`);
  if (abono.applies_to_movement_id) revalidatePath(`/transacciones/${abono.applies_to_movement_id}`);

  return { ok: true, movementId: abono.id as string };
}
