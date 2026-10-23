"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { enviarReciboAlCliente, enviarReciboDeGrupo } from "@/lib/whatsapp/recibo-cliente";
import { puedeEscribir } from "@/lib/cuenta-pausada-server";
import { MENSAJE_CUENTA_PAUSADA } from "@/lib/cuenta-pausada";
import {
  resolveMovementRateSnapshot,
  type MovementRateSnapshot,
} from "@/lib/exchange-rate/resolve-movement-rate";
import { convertirDesdeBolivares } from "@/lib/exchange-rate/monto-en-bolivares";
import { guardarPermisoDeclarado } from "@/lib/whatsapp/declared-consent";
import { formatPriceAmount, type PriceCurrency } from "@/lib/products/price";
import type { LedgerCurrency } from "@/lib/types";
import {
  repartir,
  deudaDelLibro,
  repartirEnBolivares,
  deudaEnBolivares,
  type FiadoParaRepartir,
  type FiadoParaRepartirMulti,
} from "@/lib/abonos/reparto";
import { formatBs } from "@/lib/exchange-rate/format";

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

// ===========================================================================
// EL ABONO REPARTIDO — «1/2 fiados», frame `1526:11182`.
//
// Un billete que cubre varios fiados se registra UNA vez. Encargo del dueño
// tras un reporte de producción: hoy el tendero tiene que registrar tres
// abonos, eligiendo un fiado cada vez.
//
// ===========================================================================
// EL REPARTO LO CALCULA ESTE SERVIDOR, NO EL NAVEGADOR
//
// La entrada trae lo que el tendero TECLEÓ y lo que ajustó a mano, nunca las
// líneas ya repartidas. Si viajaran repartidas, cualquiera podría mandar un
// reparto que no sigue la gravedad, o que le mete a un fiado más de lo que
// debe, y la pantalla no tendría forma de notarlo.
//
// La pantalla llama a `repartir()` también, para enseñarlo antes de guardar.
// Es la MISMA función con las MISMAS entradas, así que no pueden discrepar —
// que es distinto de copiarla, y es lo que permite que el tendero vea
// exactamente lo que se va a escribir.
//
// ===========================================================================
// UNA TASA, UN INSTANTE, PARA TODAS LAS LÍNEAS
//
// El sello se resuelve UNA vez y se repite en cada fila, y eso no es ahorro:
// es un solo pago. Sellar cada línea por separado abriría la puerta a que tres
// filas del mismo billete queden con tres tasas distintas si la del BCV cambia
// a mitad del guardado — y el tendero vería en el historial tres equivalencias
// que no suman lo que él recibió.
//
// Es lo contrario del bucle por moneda de `confirmImport`, y por la razón
// opuesta: allí son movimientos de días distintos que casualmente se guardan
// juntos; aquí es un movimiento que casualmente ocupa varias filas.

export type AbonoRepartidoEntrada = {
  clienteId: string;
  // El libro en el que se reparte. `null` es el de pesos: un negocio
  // colombiano. Una sola moneda por reparto — decisión del dueño del
  // 2026-10-22, y la migración `137` la vuelve a exigir al escribir.
  libro: LedgerCurrency | null;
  // ── ¿CRUZA LIBROS? ────────────────────────────────────────────────
  //
  // `true` cuando el tendero eligió «Bolívares» y el cliente debe en más de
  // un libro: el billete cae sobre los fiados más críticos sin importar la
  // moneda. Encargo del dueño del 2026-10-23, que desplaza la decisión del
  // 2026-10-22 de que un reparto no mezcla monedas; la migración `141` lo
  // acepta al escribir y `armarRepartoCruzandoLibros` lo arma.
  //
  // SOLO VALE CON `monedaTecleada === "VES"`, y se comprueba en el servidor:
  // cruzar libros exige una moneda que convierta a los dos, y unos dólares en
  // la mano no convierten a euros sin una tasa que nadie acordó.
  //
  // CON `false` O AUSENTE NADA CAMBIA: el camino de un solo libro es el mismo
  // de siempre, línea por línea.
  cruzaLibros?: boolean;
  // Lo que el tendero escribió, en la moneda que eligió para escribirlo.
  montoTecleado: number;
  monedaTecleada: "VES" | PriceCurrency;
  usarPrevista?: boolean;
  // Lo que ajustó a mano, por fiado. Lo que no está aquí lo decide la
  // gravedad.
  aMano?: Record<string, number>;
  // La misma pareja de banderas que mandan las otras puertas: un «no» también
  // se anota, o el cliente nunca queda marcado como preguntado.
  permisoMostrado?: boolean;
  avisarPorWhatsapp?: boolean;
};

export type AbonoRepartidoResultado =
  | {
      ok: true;
      groupId: string;
      clientId: string;
      movementId: string | null;
      lineas: number;
      // EN BOLÍVARES CUANDO `totalEnBolivares` ES `true`. Ver el comentario
      // del `return`: un reparto que cruza libros no tiene un total en
      // ninguno de los dos.
      total: number;
      totalEnBolivares: boolean;
    }
  | { ok: false; error: string };

// Los códigos que devuelve `registrar_abono_repartido`, en cristiano. Un
// código crudo en pantalla no le dice nada a un tendero, y la regla de
// `CLAUDE.md` sobre no filtrar detalle interno vale igual aunque esta puerta
// exija sesión: «fiado_ajeno» no es un mensaje, es una pista.
function mensajeDelCodigo(
  code: string | undefined,
  pendiente?: number,
  libro?: LedgerCurrency | null,
): string {
  switch (code) {
    case "excede_el_fiado":
      return pendiente != null
        ? `Uno de los fiados solo debe ${formatPriceAmount(pendiente, (libro ?? "COP") as PriceCurrency)}. Ajusta el reparto.`
        : "Uno de los fiados recibe más de lo que debe. Ajusta el reparto.";
    case "fiado_saldado":
      return "Uno de los fiados que ibas a pagar ya está saldado. Vuelve a abrir la pantalla.";
    case "monedas_mezcladas":
      return "Un abono se reparte dentro de una sola moneda.";
    case "fiado_repetido":
      return "Un mismo fiado aparece dos veces en el reparto.";
    case "fiado_ajeno":
      return "No encontramos uno de esos fiados.";
    case "sin_sesion":
      return "Tu sesión se cerró. Vuelve a entrar.";
    default:
      return "No pudimos guardar el abono. Vuelve a intentarlo.";
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EL REPARTO QUE CRUZA LIBROS, ARMADO APARTE
//
// Encargo del dueño el 2026-10-23: con «Bolívares» elegido, el billete cae
// sobre los fiados más críticos SIN IMPORTAR LA MONEDA. La migración `141` lo
// acepta al escribir; esto es lo que decide qué se le manda.
//
// ===========================================================================
// UNA TASA POR LIBRO, UN SOLO INSTANTE
//
// La cabecera de `registrarAbonoRepartido` dice «una tasa, un instante, para
// todas las líneas», y esa frase se queda a medias aquí: un fiado en dólares y
// uno en euros NO pueden compartir tasa, porque son dos conversiones distintas
// del mismo billete.
//
// Lo que sí se conserva es lo que esa regla protegía: el INSTANTE. Los dos
// sellos se resuelven en la misma petición, antes de escribir nada, así que no
// puede pasar que la tasa del BCV cambie a mitad del guardado y tres filas del
// mismo billete queden con tasas de dos momentos.
//
// ===========================================================================
// SOLO CON BOLÍVARES, Y NO ES UNA RESTRICCIÓN ARBITRARIA
//
// Cruzar libros exige una moneda que convierta a los dos. Si el tendero teclea
// DÓLARES, lo que tiene en la mano son dólares: meterlos en un fiado en euros
// exigiría una tasa euro/dólar que nadie acordó — que es exactamente lo que la
// decisión del 2026-10-22 rechazaba, y lo que la del 2026-10-23 no cambia.
type ArmadoDelReparto =
  | { error: string }
  | {
      lineas: Record<string, unknown>[];
      // En bolívares, porque es la única moneda en la que este reparto tiene
      // un total. Ver el comentario de `totalEnBolivares` en el resultado.
      totalBs: number;
    };

async function armarRepartoCruzandoLibros(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ownerId: string,
  entrada: AbonoRepartidoEntrada,
  abiertos: Record<string, unknown>[],
): Promise<ArmadoDelReparto> {
  if (entrada.monedaTecleada !== "VES") {
    // No debería llegar: la pantalla solo ofrece cruzar libros con bolívares.
    // Se comprueba igual porque esto es un server action y la entrada viene
    // del navegador.
    return { error: "Para repartir entre varias monedas, escribe el monto en bolívares." };
  }

  const fiados: FiadoParaRepartirMulti[] = abiertos.map((c) => ({
    movementId: c.movement_id as string,
    createdAt: c.charge_at as string,
    plazoDias: (c.plazo_dias as number | null) ?? null,
    cuotas: (c.cuotas as number | null) ?? null,
    amount: Number(c.amount ?? 0),
    pendiente: Number(c.pending ?? 0),
    currency: ((c.currency as LedgerCurrency | null) ?? null) as LedgerCurrency | null,
  }));

  if (fiados.length === 0) return { error: "Este cliente no tiene fiados abiertos." };

  // UN SELLO POR CADA LIBRO QUE DE VERDAD APARECE, y no por cada libro que
  // existe: resolver la tasa del euro para un cliente que solo debe dólares
  // es una lectura de más y un modo de fallo de más.
  const libros = [...new Set(fiados.map((f) => f.currency))].filter(
    (l): l is LedgerCurrency => l != null,
  );
  if (libros.length === 0) {
    // Todos sin moneda = negocio colombiano, que no tiene bolívares. La
    // pantalla no le ofrece esta opción; si llegara, lo honesto es decirlo.
    return { error: "Este negocio no maneja bolívares." };
  }

  const sellos = new Map<LedgerCurrency, MovementRateSnapshot>();
  for (const libro of libros) {
    const r = await resolveMovementRateSnapshot(
      supabase,
      ownerId,
      libro,
      entrada.usarPrevista === true,
    );
    if (!r.ok) return { error: r.error };
    sellos.set(libro, r.snapshot);
  }

  // LAS DOS CONVERSIONES SALEN DEL SELLO, no de la tasa de hoy leída otra vez.
  // Es la misma cifra que se va a guardar en `exchange_rate_used` de cada
  // línea, así que lo que la pantalla sumó y lo que la base guarda no pueden
  // separarse.
  const tasaDe = (moneda: LedgerCurrency | null): number | null => {
    if (moneda == null) return null;
    const t = sellos.get(moneda)?.exchangeRateUsed ?? null;
    return t != null && t > 0 ? t : null;
  };
  const aBolivares = (monto: number, moneda: LedgerCurrency | null) => {
    const t = tasaDe(moneda);
    return t == null ? null : Math.round(monto * t * 100) / 100;
  };
  const desdeBolivares = (bs: number, moneda: LedgerCurrency | null) => {
    const t = tasaDe(moneda);
    return t == null ? null : Math.round((bs / t) * 100) / 100;
  };

  const montoBs = entrada.montoTecleado;
  if (!(montoBs > 0)) return { error: "Escribe cuánto te pagó." };

  // EL TOPE, EN BOLÍVARES Y DE LA MISMA LISTA QUE EL REPARTO. Decisión del
  // dueño del 2026-10-21: el abono no puede exceder lo que ese cliente debe.
  const deuda = deudaEnBolivares(fiados, aBolivares);
  if (montoBs - deuda > HOLGURA) {
    return { error: `Te debe ${formatBs(deuda)} en total. Escribe esa cantidad o menos.` };
  }

  const reparto = repartirEnBolivares({
    montoBs,
    fiados,
    aMano: entrada.aMano ?? {},
    aBolivares,
    desdeBolivares,
  });
  const conImporte = reparto.lineas.filter((l) => l.asignado > HOLGURA);
  if (conImporte.length === 0) return { error: "Escribe cuánto te pagó." };

  // No debería pasar: el tope de arriba lo impide. Se comprueba igual porque
  // si pasara se guardaría MENOS de lo que el tendero escribió y la pantalla
  // le diría que todo bien.
  if (reparto.sinAsignarBs > HOLGURA) {
    return { error: "No pudimos repartir todo el abono. Revisa las cantidades." };
  }

  return {
    totalBs: reparto.repartidoBs,
    lineas: conImporte.map((l) => {
      const sello = l.currency ? sellos.get(l.currency) : undefined;
      return {
        fiado_id: l.movementId,
        amount: l.asignado,
        rate_mode_used: sello?.rateModeUsed ?? null,
        // LA TASA DE SU LIBRO, no una común. Es la mitad del encargo que no se
        // ve en la pantalla y la que haría la cuenta falsa si se copiara.
        exchange_rate_used: sello?.exchangeRateUsed ?? null,
        official_bcv_rate_at_time: sello?.officialBcvRateAtTime ?? null,
        entry_currency: "VES",
        // LOS BOLÍVARES DE ESTA LÍNEA, CALCULADOS POR EL REPARTO y no
        // repartidos luego en proporción como en el camino de un solo libro.
        // Allí hace falta ese reparto proporcional porque las líneas salen en
        // la moneda del libro y los bolívares hay que volver a trocearlos;
        // aquí el reparto ya fue EN bolívares, así que cada línea trae los
        // suyos exactos y no hay nada que trocear ni céntimo que absorber.
        entry_amount: l.asignadoBs,
        rate_usd_at_time: sello?.rateUsdAtTime ?? null,
        rate_eur_at_time: sello?.rateEurAtTime ?? null,
      };
    }),
  };
}

export async function registrarAbonoRepartido(
  entrada: AbonoRepartidoEntrada,
): Promise<AbonoRepartidoResultado> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Tu sesión se cerró. Vuelve a entrar." };

  if (!(await puedeEscribir(supabase, user.id))) return { ok: false, error: MENSAJE_CUENTA_PAUSADA };

  // LA PROPIEDAD, EXPLÍCITA. El id llega del navegador; la regla de
  // `CLAUDE.md` es que la política es el respaldo y esto es el candado. La
  // `137` lo vuelve a comprobar por su cuenta, y las dos cosas están bien.
  const { data: cliente } = await supabase
    .from("clients")
    .select("id, name")
    .eq("id", entrada.clienteId)
    .eq("owner_id", user.id)
    .is("trashed_at", null)
    .maybeSingle();
  if (!cliente) return { ok: false, error: "No encontramos ese cliente." };

  // ── LOS FIADOS ABIERTOS, DE LA MISMA FUNCIÓN QUE LA PANTALLA ────────
  const { data: abiertos, error: errorAbiertos } = await supabase.rpc(
    "get_open_charges_for_client",
    { p_client_id: cliente.id },
  );
  if (errorAbiertos) {
    console.error("[abono repartido] get_open_charges_for_client:", errorAbiertos.message);
    return { ok: false, error: "No pudimos leer los fiados de este cliente." };
  }

  // ═══════════════════════════════════════════════════════════════════
  // DOS CAMINOS A PARTIR DE AQUÍ, Y EL DE SIEMPRE NO SE TOCA
  //
  // Lo que comparten es todo lo que ya pasó —sesión, cuenta pausada,
  // propiedad del cliente, los fiados abiertos— y todo lo que viene después:
  // la llamada a la `141`, el permiso de WhatsApp, el recibo y la
  // revalidación. Lo único que cambia es cómo se arman las líneas.
  //
  // Se separa así y no con un `if` dentro del cálculo porque las dos
  // aritméticas son distintas de verdad: una reparte en la moneda del libro,
  // la otra en bolívares y convierte. Mezclarlas habría metido una rama de
  // conversión en el camino que lleva meses en producción.
  let lineasRpc: Record<string, unknown>[];
  let totalDelResultado: number;
  let totalEnBolivares = false;

  if (entrada.cruzaLibros) {
    const armado = await armarRepartoCruzandoLibros(
      supabase,
      user.id,
      entrada,
      (abiertos ?? []) as Record<string, unknown>[],
    );
    if ("error" in armado) return { ok: false, error: armado.error };
    lineasRpc = armado.lineas;
    totalDelResultado = armado.totalBs;
    totalEnBolivares = true;
  } else {
  const delLibro: FiadoParaRepartir[] = (abiertos ?? [])
    .filter((c: Record<string, unknown>) => ((c.currency as string | null) ?? null) === entrada.libro)
    .map((c: Record<string, unknown>) => ({
      movementId: c.movement_id as string,
      createdAt: c.charge_at as string,
      plazoDias: (c.plazo_dias as number | null) ?? null,
      cuotas: (c.cuotas as number | null) ?? null,
      amount: Number(c.amount ?? 0),
      pendiente: Number(c.pending ?? 0),
    }));

  if (delLibro.length === 0) {
    return { ok: false, error: "Este cliente no tiene fiados abiertos en esa moneda." };
  }

  // ── LA TASA, SELLADA ANTES DE CONVERTIR NADA ────────────────────────
  const resolucion = await resolveMovementRateSnapshot(
    supabase,
    user.id,
    entrada.libro,
    entrada.usarPrevista === true,
  );
  if (!resolucion.ok) return { ok: false, error: resolucion.error };
  const sello = resolucion.snapshot;

  let total = entrada.montoTecleado;
  let tecleadoEnBs: number | null = null;
  let entryCurrency: "VES" | LedgerCurrency | null = sello.entryCurrency;
  if (entrada.monedaTecleada === "VES" && entrada.libro) {
    const convertido = convertirDesdeBolivares(total, entrada.libro, sello);
    if ("error" in convertido) return { ok: false, error: convertido.error };
    total = convertido.monto;
    tecleadoEnBs = convertido.entryAmount;
    entryCurrency = "VES";
  }

  if (!(total > 0)) return { ok: false, error: "Escribe cuánto te pagó." };

  // EL TOPE DEL TOTAL. Decisión del dueño del 2026-10-21: *«El abono no puede
  // exceder el saldo total de lo que ese cliente debe»*. Se comprueba DESPUÉS
  // de convertir, que es el único orden correcto: el tendero escribe bolívares
  // y los fiados deben dólares.
  const deuda = deudaDelLibro(delLibro);
  if (total - deuda > HOLGURA) {
    return {
      ok: false,
      error: `Te debe ${formatPriceAmount(deuda, (entrada.libro ?? "COP") as PriceCurrency)} en esta moneda. Escribe esa cantidad o menos.`,
    };
  }

  // ── EL REPARTO ──────────────────────────────────────────────────────
  const reparto = repartir({ monto: total, fiados: delLibro, aMano: entrada.aMano ?? {} });
  const lineas = reparto.lineas.filter((l) => l.asignado > HOLGURA);

  if (lineas.length === 0) return { ok: false, error: "Escribe cuánto te pagó." };

  // No debería pasar: el tope de arriba lo impide. Se comprueba igual porque
  // si pasara, se guardaría MENOS de lo que el tendero escribió y la pantalla
  // le diría que todo bien.
  if (reparto.sinAsignar > HOLGURA) {
    return { ok: false, error: "No pudimos repartir todo el abono. Revisa las cantidades." };
  }

  // LOS BOLÍVARES DE CADA LÍNEA, CON LA ÚLTIMA ABSORBIENDO EL RESTO.
  //
  // Es el mismo patrón que `calcularCuotas` usa para los importes, y por la
  // misma razón escrita allí: tres líneas redondeadas a la baja suman un
  // céntimo menos que lo tecleado y dejan al tendero buscando un bolívar que
  // nunca faltó. Repartirlos proporcionalmente es lo único honesto que se
  // puede hacer con una cifra que él escribió UNA vez.
  const bsPorLinea: number[] = [];
  if (tecleadoEnBs != null) {
    let acumulado = 0;
    lineas.forEach((l, i) => {
      if (i === lineas.length - 1) {
        bsPorLinea.push(Math.round((tecleadoEnBs - acumulado) * 100) / 100);
      } else {
        const v = Math.round(tecleadoEnBs * (l.asignado / total) * 100) / 100;
        bsPorLinea.push(v);
        acumulado = Math.round((acumulado + v) * 100) / 100;
      }
    });
  }

    lineasRpc = lineas.map((l, i) => ({
      fiado_id: l.movementId,
      amount: l.asignado,
      rate_mode_used: sello.rateModeUsed,
      exchange_rate_used: sello.exchangeRateUsed,
      official_bcv_rate_at_time: sello.officialBcvRateAtTime,
      entry_currency: entryCurrency,
      entry_amount: tecleadoEnBs != null ? bsPorLinea[i] : entryCurrency ? l.asignado : null,
      rate_usd_at_time: sello.rateUsdAtTime,
      rate_eur_at_time: sello.rateEurAtTime,
    }));
    totalDelResultado = reparto.repartido;
  }

  const { data: escrito, error: errorRpc } = await supabase.rpc("registrar_abono_repartido", {
    p_lineas: lineasRpc,
  });

  if (errorRpc) {
    console.error("[abono repartido] rpc:", errorRpc.message);
    return { ok: false, error: "No pudimos guardar el abono. Vuelve a intentarlo." };
  }

  const r = escrito as { ok?: boolean; code?: string; group_id?: string; pendiente?: number } | null;
  if (!r?.ok) {
    return { ok: false, error: mensajeDelCodigo(r?.code, r?.pendiente, entrada.libro) };
  }

  // ── EL PERMISO DE WHATSAPP, DESPUÉS Y SIN PODER TUMBAR EL PAGO ──────
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
      console.error("[abono repartido] permiso de whatsapp:", e instanceof Error ? e.message : e);
    }
  }

  // ── EL RECIBO: UNO, POR EL TOTAL ────────────────────────────────────
  //
  // `enviarReciboDeGrupo` y no `enviarReciboAlCliente` por línea: es la mitad
  // de la `137` que protege al cliente. Tres mensajes por un billete es lo
  // que esto existe para evitar.
  const grupo = r.group_id as string;
  after(async () => {
    const res = await enviarReciboDeGrupo(grupo);
    if (res.estado === "fallido") console.error("[recibo grupo]", grupo, res.error);
  });

  revalidatePath("/dashboard");
  revalidatePath(`/clients/${cliente.id}`);
  return {
    ok: true,
    groupId: grupo,
    clientId: cliente.id,
    // CUALQUIERA DE SUS LÍNEAS SIRVE PARA ABRIR EL RESUMEN: esa pantalla lee
    // el grupo y enseña el total, no la fila por la que se entró. Se devuelve
    // la primera porque es la del fiado más grave, la que el tendero vio
    // arriba del reparto.
    movementId: (r as { movement_ids?: string[] }).movement_ids?.[0] ?? null,
    lineas: lineasRpc.length,
    total: totalDelResultado,
    // EN QUÉ MONEDA ESTÁ `total`. Un reparto que cruza libros no tiene un
    // total en ninguno de los dos, así que el suyo va en bolívares, que es la
    // única moneda en la que ese billete existe entero. La bandera está aquí
    // para que nadie lo lea como dólares más adelante: hoy la pantalla solo
    // usa `movementId`, y ese «hoy» es justamente lo que caduca.
    totalEnBolivares,
  };
}
