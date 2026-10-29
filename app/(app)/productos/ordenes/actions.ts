"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
// LAS DOS SALEN DE `lib/` DESDE EL 2026-10-26, cuando `eliminarVenta` --que
// vive en otro fichero de acciones-- pasó a necesitar la misma cuenta. Un
// módulo de acciones importando lo de dentro de otro es cómo dos funciones
// acaban soldadas; «qué queda por cobrar» no es una acción, es una pregunta
// sobre los datos.
import { monedaDeLinea, monedasPendientes } from "@/lib/orders/monedas-pendientes";
import { puedeEscribir } from "@/lib/cuenta-pausada-server";
import { MENSAJE_CUENTA_PAUSADA } from "@/lib/cuenta-pausada";
import { readOwnerCountry } from "@/lib/owner-country";
import { isDocumentTypeFor } from "@/lib/document-id";
import { DOCUMENT_SOURCE } from "@/lib/types";
import { trackServer } from "@/lib/mixpanel-server";
import { estaDescartado } from "@/lib/orders/catalog-orders";
import { registrarVenta, type VentaEntrada } from "@/app/(app)/ventas/actions";

// THE ONE WRITE IN D's READING HALF, and it is here for a reason worth
// stating: without it the counter can only ever go up.
//
// The owner decided on 2026-10-16 that the bell counts orders that still need
// attention (CT-71). A screen that lists them and offers no way to say "done
// with this one" leaves a red number that never drops, and a badge that is
// always on is a badge nobody reads -- the same failure the ledger parity rule
// warns about, in a different place.
//
// What it does NOT do, deliberately: it does not edit the customer's name,
// document or phone (that is CT-69's decision about the consent), and it does
// not register the order as a fiado or a sale (that is CT-70, and the plan of
// 2026-10-16 puts it after the product selector exists).

export type OrderActionResult = { error: string | null };

// REGISTERING A CATALOGUE ORDER AS A SALE — ONE CURRENCY PER CALL.
//
// ===========================================================================
// IT DOES NOT WRITE THE SALE ITSELF. `registrarVenta` DOES.
//
// That action already holds every rule this needs — the paused account, the
// per-currency totals, the ceiling on what can be collected, the sealed rate
// for bolívares, the charge for whatever is left owing, the instalments. A
// second copy of four hundred lines of money logic is the failure this repo
// has paid for twice already, and here the thing being duplicated is the
// arithmetic of a real shopkeeper's debt.
//
// So what lives here is the TRANSLATION: a draft filled in the browser,
// turned into the one shape that action takes.
//
// ===========================================================================
// ONE CURRENCY PER CALL, AND THAT IS `CT-147`
//
// It used to take one payment PER LINE and fold them into a per-currency
// credit afterwards. Two lines in dollars with different terms meant one of
// the two terms was silently dropped — the app kept a deadline the shopkeeper
// never agreed to, and the status chip then failed to warn about an overdue
// fiado. The owner called it what it was on 2026-10-24: *«un error de
// conceptualización de producto (…) no puede salir a producción así»*.
//
// The flow's own frames answer it: `1/4 Pedido` draws one block per currency,
// each with its own «Registrar», and `3/4 Pago` asks for the term ONCE for
// that block. So there is nothing to fold any more — the term arrives already
// belonging to the currency it governs.
//
// TWO CURRENCIES ARE TWO SALES, the owner's decision of 2026-10-25: *«dos
// ventas pero el cliente se guarda al final de la primera venta y se usa para
// la segunda venta»*. Which is why `cliente.fichaId` carries the id the first
// call created — the second call must not open a second ficha for the same
// person.
//
// ===========================================================================
// THE PRICE IS THE SEALED ONE, AND THAT IS WHY `pedidoId` TRAVELS
//
// The owner's decision of 2026-10-24, asked whether to charge what the
// customer saw or today's catalogue: *«al congelado»*. The browser still
// sends no price — it sends the order's id, and the server reads the sealed
// figure out of `catalog_order_items`.

export type PagoDeMonedaEntrada = {
  // What goes into this currency's ledger today.
  amount: number;
  // What was actually handed over, and in what. `null` = the ledger's own
  // currency. The pair CLAUDE.md calls «el monto que tecleó el tendero»: kept
  // verbatim, never recomputed from `amount`.
  entryCurrency: "VES" | null;
  entryAmount: number | null;
  plazo: string;
  cuotas: string;
  usarPrevista: boolean;
  photoPath: string | null;
  description: string;
};

export type RegistroDePedidoEntrada = {
  pedidoId: string;
  // WHICH BLOCK IS BEING REGISTERED. Everything else in the order is left
  // alone, including lines the shopkeeper has not got to yet.
  moneda: string;
  pago: PagoDeMonedaEntrada;
  // Still keyed by `catalog_order_items.id`: «Editar» changes a line, not a
  // currency block. It is what decides WHICH currency a line belongs to in
  // this call, so a line moved to euros stops counting towards dollars.
  editadas: Record<string, { quantity: number; currency: string }>;
  cliente: {
    fichaId: string | null;
    name: string;
    documentId: string;
    documentType: string | null;
    whatsapp: string;
    address: string;
    consienteWhatsapp: boolean;
  };
};

export type ResultadoRegistroDePedido =
  | {
      ok: true;
      saleId: string;
      // THE CLIENT THIS SALE WENT TO. The second currency's call sends it back
      // as `cliente.fichaId` — the owner's decision of 2026-10-25 that the
      // ficha created at the end of the first sale is reused, not remade.
      clientId: string;
      // LINES LEFT OUT, NAMED. The owner's decision of 2026-10-24 about a
      // product that is no longer in the catalogue: *«se excluye esa línea y
      // se avisa»*. Returning the names is the «y se avisa» half — a count
      // would tell the shopkeeper something was dropped without telling them
      // what, which is worse than silence because it cannot be acted on.
      excluidas: string[];
      // CURRENCIES STILL TO REGISTER, after this one. Empty means the order is
      // finished, and this call is the one that stamped it.
      pendientes: string[];
    }
  | { ok: false; error: string };

export async function registrarPedidoComoVenta(
  entrada: RegistroDePedidoEntrada,
): Promise<ResultadoRegistroDePedido> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return {
      ok: false,
      error: "Tu sesión se cerró. Vuelve a entrar y repite el registro.",
    };

  // THE PAUSED ACCOUNT DOES NOT WRITE, asked here as well as inside
  // `registrarVenta`: this one can create a CLIENT before ever reaching it,
  // and a paused account that cannot sell should not be able to leave a new
  // person in its list either.
  if (!(await puedeEscribir(supabase, user.id))) {
    return { ok: false, error: MENSAJE_CUENTA_PAUSADA };
  }

  const moneda = String(entrada.moneda ?? "");
  if (moneda === "") return { ok: false, error: "No sabemos qué moneda cobrar." };

  // `.eq("owner_id")` EXPLICITLY — the id comes from the browser.
  const { data: pedido, error: errorPedido } = await supabase
    .from("catalog_orders")
    // `status` SE LEE desde el 2026-10-26: es lo que dice si el pedido está
    // descartado, y hasta ese día esta consulta no lo pedía.
    .select("id, created_at, status")
    .eq("id", entrada.pedidoId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (errorPedido) {
    console.error("registrarPedidoComoVenta pedido:", errorPedido.message);
    return {
      ok: false,
      error: "No pudimos leer el pedido. Vuelve a intentarlo.",
    };
  }
  if (!pedido) return { ok: false, error: "No encontramos ese pedido." };

  // ── UN PEDIDO DESCARTADO NO SE COBRA ──────────────────────────────
  //
  // LA PARADA DURA de lo que las seis pantallas ya rechazan, y hace falta
  // igual: una pestaña abierta antes de descartarlo llega aquí sin pasar por
  // ninguna de ellas, y lo que se escribe es la deuda de una persona.
  //
  // AQUÍ Y NO EN `registrarVenta`: esta función es la ÚNICA que le pasa un
  // `pedidoId` (comprobado con `grep`), así que el candado está en su puerta y
  // no repartido en dos sitios que pueden separarse.
  //
  // EL MENSAJE DICE LA SALIDA. «No se puede» dejaría al tendero sin saber qué
  // hacer con un pedido que tiene delante; esto le dice dónde está el botón.
  if (estaDescartado(pedido)) {
    return {
      ok: false,
      error: "Descartaste este pedido. Restáuralo desde tus notificaciones si quieres cobrarlo.",
    };
  }

  const { data: lineasDelPedido, error: errorLineas } = await supabase
    .from("catalog_order_items")
    .select("id, product_id, product_name, quantity, currency")
    // ── SOLO LAS VIVAS, Y AQUÍ ES DONDE MÁS IMPORTA ──────────────────
    //
    // Migración `161`. Esta es la consulta que decide QUÉ SE COBRA. Sin el
    // filtro, una moneda que el tendero acaba de quitar entraría en la venta
    // igual, con el cliente delante y sin que nada lo dijera.
    .is("deleted_at", null)
    .eq("order_id", pedido.id);
  if (errorLineas) {
    console.error("registrarPedidoComoVenta lineas:", errorLineas.message);
    return {
      ok: false,
      error: "No pudimos leer el pedido. Vuelve a intentarlo.",
    };
  }

  // ── LAS LÍNEAS DE ESTA MONEDA, Y SOLO ESAS ──────────────────────────
  const lineas: VentaEntrada["lineas"] = [];
  const excluidas: string[] = [];
  for (const linea of lineasDelPedido ?? []) {
    if (monedaDeLinea(linea, entrada.editadas) !== moneda) continue;
    // THE PRODUCT IS GONE FROM THE CATALOGUE. `registrarVenta` prices from
    // `products`, so a line with no product cannot become a `sale_line` and
    // would take the WHOLE sale down with it. The owner's decision: leave it
    // out and say so.
    if (!linea.product_id) {
      excluidas.push(linea.product_name);
      continue;
    }
    lineas.push({
      productId: linea.product_id,
      quantity: entrada.editadas[linea.id]?.quantity ?? Number(linea.quantity),
      currency: moneda as VentaEntrada["lineas"][number]["currency"],
      orderItemId: linea.id,
    });
  }

  if (lineas.length === 0) {
    return {
      ok: false,
      error:
        excluidas.length > 0
          ? "Ninguno de los productos de esa moneda sigue en tu catálogo, así que no hay nada que cobrar."
          : "Ese pedido no tiene nada que cobrar en esa moneda.",
    };
  }

  // ONE PAYMENT, NOT ONE PER LINE. What the shopkeeper typed on `3/4 Pago` is
  // a single figure for the whole block, with its own photo and its own note.
  const pagos: VentaEntrada["pagos"] =
    entrada.pago.amount > 0
      ? [
          {
            currency: moneda as VentaEntrada["pagos"][number]["currency"],
            amount: entrada.pago.amount,
            entryCurrency: entrada.pago.entryCurrency,
            entryAmount: entrada.pago.entryAmount,
            photoPath: entrada.pago.photoPath,
            description: entrada.pago.description || null,
          },
        ]
      : [];

  // AND ONE CREDIT BLOCK, which is the whole point of `CT-147`: the term and
  // the instalments arrive already belonging to this currency, so there is
  // nothing to reconcile and nothing to lose.
  const plazoDias = entrada.pago.plazo === "" ? null : Number(entrada.pago.plazo);
  // ── «PAGO ÚNICO» ES `null`, NO ES UNA CUOTA ─────────────────────────
  //
  // `PagoCampos` manda `"1"` cuando el tendero deja «Pago único», que es el
  // valor POR DEFECTO del desplegable. `registrarVenta` exige que las cuotas
  // vayan de 2 a 36 --una sola cuota no es un plan de pagos, es el fiado
  // entero-- así que mandarle el 1 tal cual rechaza la venta con «Las cuotas
  // van de 2 a 36» al final del flujo, cuando ya está todo tecleado.
  //
  // `nueva-venta.tsx` lo convierte desde el primer día; esta acción no, y se
  // vio el 2026-10-25 probando la pantalla en el navegador. Las pruebas no lo
  // cazaron porque mandaban la cadena vacía, que es el otro camino.
  const cuotasCrudas = Number(entrada.pago.cuotas || "1");
  const cuotas = cuotasCrudas > 1 ? cuotasCrudas : null;
  const credito: VentaEntrada["credito"] = [
    {
      currency: moneda as VentaEntrada["credito"][number]["currency"],
      plazoDias: plazoDias != null && Number.isFinite(plazoDias) ? plazoDias : null,
      cuotas: cuotas != null && Number.isFinite(cuotas) ? cuotas : null,
      usarPrevista: entrada.pago.usarPrevista,
      photoPath: entrada.pago.photoPath,
      description: entrada.pago.description || null,
    },
  ];

  // ── EL CLIENTE: LA FICHA QUE HAY, O UNA NUEVA ───────────────────────
  //
  // SE CREA AQUÍ Y NO EN LA PANTALLA, que es lo que evita dejar una persona
  // huérfana en la lista del tendero cada vez que alguien se sale del flujo.
  //
  // Y EN LA SEGUNDA MONEDA YA VIENE DADA: la pantalla manda el `fichaId` que
  // devolvió la primera llamada, así que esta rama no vuelve a entrar.
  // SI LA VENTA SE CAE, LA FICHA RECIÉN CREADA SE VA CON ELLA.
  //
  // ENCONTRADO EL 2026-10-25 por `qa/pedido-registro.mjs`, y **venía de
  // antes del rediseño**: su comprobación de limpieza dejó un cliente vivo
  // después del intento de registrar dos veces. El cliente se crea unas
  // líneas más abajo, ANTES de `registrarVenta`, así que cualquier rechazo
  // de esa función --el pedido ya registrado, un abono mayor que el total,
  // un producto sin precio en esa moneda-- dejaba una persona nueva en la
  // lista del tendero que nunca compró nada.
  //
  // ES EXACTAMENTE LO QUE EL COMENTARIO DE ABAJO DICE QUE EVITA. Y lo evita
  // a medias: la ficha no se crea cuando alguien ABANDONA el flujo, que es
  // el caso que se tuvo en mente, pero sí cuando el flujo llega al final y
  // el final falla.
  //
  // NO SE PUEDE ARREGLAR CREÁNDOLA DESPUÉS, porque `registrarVenta` necesita
  // el `clientId` para escribir la venta. Así que se deshace: sólo la que
  // hemos creado nosotros en esta llamada, nunca una ficha que ya existía.
  let fichaReciencreada: string | null = null;
  let clientId = entrada.cliente.fichaId;
  if (clientId == null) {
    const country = await readOwnerCountry(supabase, user.id);
    const nombre = entrada.cliente.name.trim();
    if (nombre === "")
      return { ok: false, error: "Escribe el nombre del cliente." };
    const documentId = entrada.cliente.documentId.replace(/\D/g, "");
    const tipo = (entrada.cliente.documentType ?? "").trim().toUpperCase();

    const { data: nuevo, error: errorCliente } = await supabase
      .from("clients")
      .insert({
        owner_id: user.id,
        name: nombre,
        // `null`, never `""`: an empty string would pass as «has a number» in
        // the `.is("whatsapp", null)` the import uses to fill the gap, and
        // that client would never get one again.
        whatsapp: entrada.cliente.whatsapp || null,
        address: entrada.cliente.address.trim() || null,
        document_id: documentId || null,
        // Migration 125: a type that does not belong to the country is
        // dropped rather than stored.
        document_type: isDocumentTypeFor(country, tipo) ? tipo : null,
        // THE SHOPKEEPER CONFIRMED IT, so it is theirs and not the
        // customer's own typing — even though the digits came from the cart.
        // See supabase/063.
        document_source: DOCUMENT_SOURCE.OWNER,
        document_country: country,
      })
      .select("id")
      .single();

    if (errorCliente || !nuevo) {
      console.error("registrarPedidoComoVenta cliente:", errorCliente?.message);
      // THE RAW ERROR DOES NOT TRAVEL. A duplicate document comes back as a
      // constraint name, which says nothing to a shopkeeper and leaks a
      // schema detail.
      return {
        ok: false,
        error:
          errorCliente?.code === "23505"
            ? "Ya tienes un cliente con ese documento. Vuelve atrás y elígelo."
            : "No pudimos crear el cliente. Vuelve a intentarlo.",
      };
    }
    clientId = nuevo.id;
    fichaReciencreada = nuevo.id;
  }

  // `clientId` IS A STRING BY NOW — either the matched ficha's or the one
  // just inserted — but the compiler cannot see it through the branch above,
  // and a non-null assertion would hide the day somebody adds a path that
  // leaves it null.
  if (clientId == null)
    return { ok: false, error: "No pudimos resolver el cliente." };

  const resultado = await registrarVenta({
    clientId,
    lineas,
    pagos,
    credito,
    pedidoId: pedido.id,
  });

  if (!resultado.ok) {
    if (fichaReciencreada != null) {
      // `.eq("owner_id")` aunque el id salga de esta misma función: si algún
      // día este borrado se mueve de sitio, el candado viaja con él.
      const { error: errorDeshacer } = await supabase
        .from("clients")
        .delete()
        .eq("id", fichaReciencreada)
        .eq("owner_id", user.id);
      // UN FALLO AL DESHACER NO CAMBIA LO QUE SE LE DICE AL TENDERO: lo que
      // le importa es que la venta no se guardó. Queda en el log una ficha
      // de más, que es molesta y no es dinero.
      if (errorDeshacer) {
        console.error("registrarPedidoComoVenta deshacer ficha:", errorDeshacer.message, {
          clientId: fichaReciencreada,
        });
      }
    }
    return { ok: false, error: resultado.error };
  }

  // ── ¿QUEDA ALGUNA MONEDA? ───────────────────────────────────────────
  //
  // SE PREGUNTA A LA BASE Y NO AL NAVEGADOR. El borrador sabe lo que el
  // tendero tecleó; sólo `sales` sabe lo que llegó a escribirse, y dar por
  // terminado un pedido por lo que dice un borrador es cómo se marca como
  // registrado uno al que le falta una moneda entera.
  //
  // SE CUENTAN SÓLO LAS LÍNEAS VIVAS: una moneda cuyos productos ya no están
  // en el catálogo nunca va a tener venta, así que esperarla dejaría el
  // pedido pendiente para siempre.
  const { pendientes } = await monedasPendientes(
    supabase,
    pedido.id,
    lineasDelPedido ?? [],
    entrada.editadas,
  );

  // EL PEDIDO SE DA POR REGISTRADO CUANDO NO QUEDA NINGUNA, y ni un momento
  // antes: con una moneda sin cobrar, un pedido marcado «registrado» le dice
  // al tendero que ya no tiene nada que hacer con él. No pierde dinero —la
  // venta de la otra moneda existe— pero deja de reclamar el que falta, que
  // es la misma avería en silencio que `CT-83` describe para «atendido».
  //
  // UN FALLO AQUÍ NO TUMBA LA VENTA, que ya está escrita. Lo que queda es un
  // pedido que sigue ofreciendo «Registrar» en una moneda ya vendida, y la
  // parada dura de `registrarVenta` lo rechaza al segundo intento.
  // ── UN PEDIDO SOLO TIENE DOS ESTADOS: RECIBIDO Y REGISTRADO ─────────
  //
  // Decisión del dueño el 2026-10-25: *«eliminemos el concepto de pedido
  // atendido, el pedido se recibe (cuando el cliente lo registra desde el
  // carrito) y en el app el pedido se registra (cuando el cliente completa el
  // registro del pedido en el botón "Registrar pedido"), si presiona el botón
  // "Registrar pedido" y no completa el registro, el pedido vuelve a su
  // estado original como sin atender»*.
  //
  // ESTO DESHACE UN SELLO QUE PUSE HORAS ANTES, y las dos razones quedan
  // escritas. Ese día añadí un `seen` con la PRIMERA moneda, razonando que el
  // tendero ya estaba trabajando el pedido y no debía seguir sonando en la
  // campana. El dueño decidió lo contrario, y su regla es más simple: mientras
  // el registro no esté COMPLETO, el pedido sigue pendiente. Un pedido de dos
  // monedas con una cobrada tiene trabajo sin terminar, y la campana es justo
  // lo que se lo recuerda.
  //
  // ASÍ QUE AQUÍ SOLO SE SELLA EL FINAL. `seen` y `seen_at` dejan de
  // escribirse en toda la app; las filas viejas que los tengan siguen
  // contando como pendientes, porque `isUnregistered` pregunta por
  // «registered» y no por «new».
  if (pendientes.length === 0) {
    const registradoEl = new Date().toISOString();
    const { error: errorSello } = await supabase
      .from("catalog_orders")
      .update({ registered_at: registradoEl, status: "registered" })
      .eq("id", pedido.id)
      .eq("owner_id", user.id);
    if (errorSello) {
      console.error("registrarPedidoComoVenta sello:", errorSello.message, {
        pedidoId: pedido.id,
        saleId: resultado.saleId,
      });
    }

    await registrarAnalitica(supabase, user.id, user.email ?? null, {
      pedidoId: pedido.id,
      recibidoEl: String(pedido.created_at),
      registradoEl,
      excluidas: excluidas.length,
    });
  }

  // La campana y el enlace de Catálogo llevan la cuenta de los sin atender,
  // así que los dos se quedan viejos.
  revalidatePath("/productos");
  revalidatePath("/notificaciones");

  revalidatePath(`/productos/ordenes/${pedido.id}`);
  revalidatePath("/productos/ordenes");

  return { ok: true, saleId: resultado.saleId, clientId, excluidas, pendientes };
}

// ══ ANALÍTICA: «Catalog Order Registered» ═════════════════════════════
//
// PREGUNTAS DE NEGOCIO, del dueño el 2026-10-25. Cinco de las ocho que pidió
// salen de este único evento, y van juntas porque se contestan mirando el
// mismo instante:
//
//   · *«¿cuántas órdenes se registran?»* — el recuento del evento. Contra
//     «Catalog Order Received» da la tasa de conversión del catálogo, que es
//     la pregunta que de verdad decide dónde trabajar: muchos pedidos y pocos
//     registros señalan al flujo de registro, no al catálogo.
//   · *«¿cuántas se registran de contado y cuántas fiado?»* — `forma`.
//   · *«¿cuánto tarda de media desde que se recibe hasta que se registra?»* —
//     `horas_hasta_registro`, que es el mismo número que la pantalla enseña
//     como «Tiempo de respuesta».
//   · *«¿cuál es el monto total de las órdenes procesadas (eur, usd)?»* —
//     `total_usd`, `total_eur`, `total_cop`.
//   · *«¿cuántos productos en promedio se procesan en una orden?»* — `lineas`
//     y `unidades`.
//
// Y DOS DE SUS OCHO NO SON EVENTOS, lo que se dice aquí porque es donde se
// va a buscar: *«¿cuántos productos publicados y no publicados promedia el
// catálogo?»* y *«¿cuál es el precio promedio del producto en catálogo?»* son
// ESTADO, no acciones. Preguntadas como evento contarían cuántas veces se
// miró el catálogo, no cuánto mide. Van al PERFIL del dueño, que es lo que
// Mixpanel sabe promediar entre negocios, y se refrescan cada vez que se
// registra un pedido. Es una foto, no un dato vivo, y para una media entre
// negocios eso basta.
//
// BAJO QUÉ PERFIL SE ARCHIVA: el del dueño, que aquí sí tiene sesión.
//
// SE PUEDE PERDER: todo esto va dentro de un `try` y después de que la venta
// esté escrita. Un fallo aquí cuesta una fila en Mixpanel, nunca un registro.
async function registrarAnalitica(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ownerId: string,
  ownerEmail: string | null,
  datos: {
    pedidoId: string;
    recibidoEl: string;
    registradoEl: string;
    excluidas: number;
  },
): Promise<void> {
  try {
    const { data: ventas } = await supabase
      .from("sales")
      .select("id")
      .eq("catalog_order_id", datos.pedidoId)
      .is("deleted_at", null);
    const ids = (ventas ?? []).map((v) => v.id as string);
    if (ids.length === 0) return;

    const [{ data: lineas }, { data: pagos }, { data: cargos }, { data: productos }] =
      await Promise.all([
        supabase.from("sale_lines").select("currency, quantity, unit_price").in("sale_id", ids),
        supabase.from("sale_payments").select("currency, amount").in("sale_id", ids),
        supabase.from("movements").select("id").in("sale_id", ids).eq("type", "charge"),
        supabase
          .from("products")
          .select("base_currency, price_retail, published_retail")
          .eq("owner_id", ownerId)
          .is("deleted_at", null),
      ]);

    const porMoneda = (filas: { currency: string | null; valor: number }[]) => {
      const m = new Map<string, number>();
      for (const f of filas) {
        const k = String(f.currency ?? "COP");
        m.set(k, Math.round(((m.get(k) ?? 0) + f.valor) * 100) / 100);
      }
      return m;
    };

    const totales = porMoneda(
      (lineas ?? []).map((l) => ({
        currency: l.currency as string | null,
        valor: Number(l.quantity) * Number(l.unit_price),
      })),
    );
    const cobrado = porMoneda(
      (pagos ?? []).map((p) => ({
        currency: p.currency as string | null,
        valor: Number(p.amount),
      })),
    );

    // CONTADO, FIADO O MIXTO — y la tercera opción no sobra: un pedido de dos
    // monedas puede cobrarse entero en una y fiarse en la otra, que es
    // exactamente el caso que `CT-147` vino a arreglar. Meterlo en «fiado»
    // escondería que el tendero sí cobró algo ese día.
    const hayCargo = (cargos ?? []).length > 0;
    const hayCobro = [...cobrado.values()].some((v) => v > 0);
    const forma = hayCargo && hayCobro ? "mixto" : hayCargo ? "fiado" : "contado";

    const minutos = Math.max(
      0,
      Math.floor(
        (new Date(datos.registradoEl).getTime() - new Date(datos.recibidoEl).getTime()) / 60_000,
      ),
    );

    const vivos = productos ?? [];
    const precios = new Map<string, { suma: number; n: number }>();
    for (const p of vivos) {
      if (p.price_retail == null) continue;
      const k = String(p.base_currency ?? "COP");
      const a = precios.get(k) ?? { suma: 0, n: 0 };
      a.suma += Number(p.price_retail);
      a.n += 1;
      precios.set(k, a);
    }
    const medio = (k: string) => {
      const a = precios.get(k);
      return a && a.n > 0 ? Math.round((a.suma / a.n) * 100) / 100 : null;
    };

    trackServer(
      "Catalog Order Registered",
      ownerId,
      {
        order_id: datos.pedidoId,
        ventas: ids.length,
        monedas: totales.size,
        forma,
        lineas: (lineas ?? []).length,
        unidades: (lineas ?? []).reduce((s, l) => s + Number(l.quantity), 0),
        lineas_excluidas: datos.excluidas,
        total_usd: totales.get("USD") ?? 0,
        total_eur: totales.get("EUR") ?? 0,
        total_cop: totales.get("COP") ?? 0,
        // EN MINUTOS Y EN HORAS: los minutos para que una media no pierda los
        // pedidos que se atienden en el acto, las horas para leer la cifra sin
        // dividir.
        minutos_hasta_registro: minutos,
        horas_hasta_registro: Math.round((minutos / 60) * 10) / 10,
      },
      ownerEmail,
      {
        catalogo_productos: vivos.length,
        catalogo_publicados: vivos.filter((p) => p.published_retail).length,
        catalogo_sin_publicar: vivos.filter((p) => !p.published_retail).length,
        catalogo_precio_medio_usd: medio("USD"),
        catalogo_precio_medio_eur: medio("EUR"),
        catalogo_precio_medio_cop: medio("COP"),
      },
    );
  } catch (error) {
    console.error(
      "registrarPedidoComoVenta analitica:",
      error instanceof Error ? error.message : error,
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════
// QUITAR UNA MONEDA DEL PEDIDO, Y DEVOLVERLA
// ═══════════════════════════════════════════════════════════════════════
//
// Decisión del dueño el 2026-10-26, cerrando una pregunta que llevaba abierta
// desde que se quitó «Continuar»: ¿puede el tendero cobrar solo una parte de
// un pedido de dos monedas? Su respuesta fue que no --*«ambos pedidos entran
// juntos en la misma venta»*-- y la salida es QUITAR la moneda que no va a
// vender: *«agreguemos botón "Eliminar" en cada una de las cards de los
// pedidos por moneda»*.
//
// ───────────────────────────────────────────────────────────────────────
// SE MARCA, NO SE BORRA
//
// También suyo: *«que se pueda restaurar»*. Y la razón de fondo es de quién
// son esas filas: las escribió su CLIENTE al pedir. Borrarlas de verdad hace
// que el pedido afirme que nunca pidió esos euros, sin rastro de que
// existieron. Ver la migración `161`.
//
// ───────────────────────────────────────────────────────────────────────
// LA MONEDA ES LA SELLADA, Y ESO NO ES UN ATAJO
//
// El servidor no ve el borrador, así que no sabe si «Editar pedido» movió una
// línea a otra moneda. Agrupa por `catalog_order_items.currency`, que es
// exactamente como agrupan la pantalla que dibuja los bloques y el guardia
// que carga uno. Las tres preguntan lo mismo a la misma columna; si esta
// usara otra, el tendero daría a «Eliminar» en un bloque y desaparecería otro.

export type ResultadoDeQuitarMoneda =
  // `pedidoCerrado` -- quitar esta moneda dejó el pedido terminado, porque lo
  // único que quedaba vivo ya estaba vendido. Lo necesita la PANTALLA: sin
  // esto, el tendero da a «Eliminar» esperando su tarjeta de «Restaurar» y lo
  // que recibe es un salto al detalle, sin una palabra de por qué.
  | { ok: true; pedidoCerrado?: boolean }
  | { ok: false; error: string };

async function pedidoDelDueno(
  supabase: Awaited<ReturnType<typeof createClient>>,
  pedidoId: string,
  ownerId: string,
) {
  // `.eq("owner_id")` EXPLÍCITO: el id llega del navegador. Es la regla de
  // `CLAUDE.md` y aquí se estaría tocando el pedido de otro negocio.
  const { data, error } = await supabase
    .from("catalog_orders")
    .select("id, registered_at, status")
    .eq("id", pedidoId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) {
    console.error("[pedido] lectura:", error.message);
    return { pedido: null, error: "No pudimos leer el pedido. Vuelve a intentarlo." };
  }
  if (!data) return { pedido: null, error: "No encontramos ese pedido." };
  // UN PEDIDO YA REGISTRADO NO SE TOCA. Quitarle una línea después de que su
  // venta esté escrita dejaría el pedido diciendo una cosa y la venta otra.
  if (data.registered_at != null) {
    return { pedido: null, error: "Ese pedido ya está registrado." };
  }
  // ── NI UNO DESCARTADO ─────────────────────────────────────────────
  //
  // Desde el 2026-10-26, y cubre tres puertas de una vez: quitar una moneda,
  // devolverla y volver a descartar. Un pedido descartado está fuera de
  // juego, así que editarlo es escribir en algo que nadie va a mirar.
  //
  // Y DE PASO ARREGLA EL DOBLE DESCARTE: hasta hoy, dos toques seguidos --o
  // una pestaña vieja-- volvían a sellar `discarded_at` y subían el aviso al
  // principio de la campana como si acabara de pasar algo nuevo.
  //
  // `restaurarPedido` NO PASA POR AQUÍ a propósito: lo que viene a deshacer es
  // justo este estado. Tiene su propia comprobación de dueño.
  if (data.status === "discarded") {
    return { pedido: null, error: "Ese pedido está descartado." };
  }
  return { pedido: data, error: null };
}

// ═══════════════════════════════════════════════════════════════════════
// QUITAR UNA SOLA LINEA DEL PEDIDO
//
// Encargo del dueno el 2026-10-28: *«cuando el producto es cantidad 1, el
// boton deshabilitado "−" debe ser boton destructive delete igual que en el
// carrito»*. En el carrito de la venta esa papelera quita la linea; aqui tiene
// que hacer lo mismo.
//
// NO EXISTIA. Hasta hoy solo se podia quitar una MONEDA entera
// (`quitarMonedaDelPedido`), y el comentario que yo mismo escribi en el
// stepper decia que quitar un producto «vive en la hoja de Cambiar» -- era
// FALSO: esa hoja cambia la moneda y el escalon, y no quita nada.
//
// ───────────────────────────────────────────────────────────────────────
// LAS MISMAS GUARDAS QUE QUITAR UNA MONEDA, Y UNA MAS
//
// La ultima linea VIVA del pedido no se quita: un pedido sin nada no se
// puede registrar y no tiene nada que ensenar. Es la misma razon por la que
// no se quita la ultima moneda, decidida por el dueno el 2026-10-26.
//
// Y SE COMPRUEBA AQUI aunque la pantalla ya esconda el boton: esto se puede
// llamar desde una pestana vieja, o con dos toques seguidos.
export async function quitarLineaDelPedido(
  pedidoId: string,
  lineaId: string,
): Promise<ResultadoDeQuitarMoneda> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Tu sesión se cerró. Vuelve a entrar." };
  if (!(await puedeEscribir(supabase, user.id))) {
    return { ok: false, error: MENSAJE_CUENTA_PAUSADA };
  }

  // LA PROPIEDAD, EN CODIGO. El id del pedido y el de la linea llegan del
  // navegador, asi que `CLAUDE.md` pide comprobarlo explicitamente y no
  // fiarlo a RLS.
  const { pedido, error } = await pedidoDelDueno(supabase, pedidoId, user.id);
  if (!pedido) return { ok: false, error: error! };

  const { data: vivas, error: errorVivas } = await supabase
    .from("catalog_order_items")
    .select("id, currency")
    .is("deleted_at", null)
    .eq("order_id", pedido.id);
  if (errorVivas) {
    console.error("[pedido] lineas vivas:", errorVivas.message);
    return { ok: false, error: "No pudimos leer el pedido. Vuelve a intentarlo." };
  }

  const esta = (vivas ?? []).find((l) => l.id === lineaId);
  // QUE LA LINEA SEA DE ESTE PEDIDO se comprueba por estar en esta lista, que
  // ya viene filtrada por `order_id`. Una linea de otro pedido no aparece.
  if (!esta) return { ok: false, error: "Ese producto ya no está en el pedido." };
  if ((vivas ?? []).length <= 1) {
    return {
      ok: false,
      error: "Es lo único que queda en el pedido. Si no vas a cobrarlo, no lo registres.",
    };
  }

  const { error: errorQuitar } = await supabase
    .from("catalog_order_items")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", lineaId);
  if (errorQuitar) {
    console.error("[pedido] quitar linea:", errorQuitar.message);
    return { ok: false, error: "No pudimos quitarlo. Vuelve a intentarlo." };
  }

  // ── Y SI YA NO QUEDA NADA POR COBRAR, EL PEDIDO SE CIERRA ──────────
  //
  // La misma mitad que `quitarMonedaDelPedido`, y por la misma razon: quitar
  // la ultima linea pendiente de un pedido cuyo resto ya se vendio lo dejaba
  // `new` PARA SIEMPRE, reclamado por la campana en cada apertura. Un aviso
  // que no se puede apagar es un aviso que se deja de leer.
  //
  // SE PREGUNTA A LA BASE OTRA VEZ, no se resta lo que acabamos de quitar:
  // entre las dos consultas puede haber entrado otra pestana.
  const { data: tras, error: errorTras } = await supabase
    .from("catalog_order_items")
    .select("id, product_id, currency")
    .is("deleted_at", null)
    .eq("order_id", pedido.id);
  if (errorTras) {
    console.error("[pedido] lineas tras quitar:", errorTras.message);
    return { ok: true };
  }
  const { pendientes, hayVentas } = await monedasPendientes(
    supabase,
    pedido.id,
    tras ?? [],
  );
  let pedidoCerrado = false;
  if (hayVentas && pendientes.length === 0) {
    const { error: errorSello } = await supabase
      .from("catalog_orders")
      .update({ registered_at: new Date().toISOString(), status: "registered" })
      .eq("id", pedido.id)
      .eq("owner_id", user.id);
    if (errorSello) {
      console.error("[pedido] sello al quitar linea:", errorSello.message, { pedidoId: pedido.id });
    } else {
      pedidoCerrado = true;
    }
  }

  revalidatePath(`/productos/ordenes/${pedido.id}`, "layout");
  return { ok: true, pedidoCerrado };
}

export async function quitarMonedaDelPedido(
  pedidoId: string,
  moneda: string,
): Promise<ResultadoDeQuitarMoneda> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Tu sesión se cerró. Vuelve a entrar." };
  if (!(await puedeEscribir(supabase, user.id))) {
    return { ok: false, error: MENSAJE_CUENTA_PAUSADA };
  }

  const { pedido, error } = await pedidoDelDueno(supabase, pedidoId, user.id);
  if (!pedido) return { ok: false, error: error! };

  const { data: vivas, error: errorVivas } = await supabase
    .from("catalog_order_items")
    .select("id, currency")
    .is("deleted_at", null)
    .eq("order_id", pedido.id);
  if (errorVivas) {
    console.error("[pedido] lineas vivas:", errorVivas.message);
    return { ok: false, error: "No pudimos leer el pedido. Vuelve a intentarlo." };
  }

  // ── LA ÚLTIMA MONEDA NO SE QUITA ───────────────────────────────────
  //
  // Decisión del dueño el 2026-10-26, preguntada con las tres salidas
  // delante. Un pedido sin líneas no se puede registrar y no tiene nada que
  // enseñar: ofrecerlo sería llevar al tendero a un callejón.
  //
  // LA PANTALLA YA NO DIBUJA EL BOTÓN en ese caso, y aun así se comprueba
  // AQUÍ: esta función se puede llamar desde una pestaña vieja que todavía
  // enseña dos bloques, o con dos toques seguidos en el último que queda.
  const monedasVivas = new Set(
    (vivas ?? []).map((l) => String(l.currency ?? "")),
  );
  if (!monedasVivas.has(moneda)) {
    return { ok: false, error: "Ese pedido ya no tiene esa moneda." };
  }
  if (monedasVivas.size <= 1) {
    return {
      ok: false,
      error: "Es lo único que queda en el pedido. Si no vas a cobrarlo, no lo registres.",
    };
  }

  const aQuitar = (vivas ?? [])
    .filter((l) => String(l.currency ?? "") === moneda)
    .map((l) => l.id as string);

  const { error: errorQuitar } = await supabase
    .from("catalog_order_items")
    .update({ deleted_at: new Date().toISOString() })
    .in("id", aQuitar);
  if (errorQuitar) {
    console.error("[pedido] quitar moneda:", errorQuitar.message);
    return { ok: false, error: "No pudimos quitarlo. Vuelve a intentarlo." };
  }

  // ═══════════════════════════════════════════════════════════════════
  // Y SI YA NO QUEDA NADA POR COBRAR, EL PEDIDO SE CIERRA AQUÍ
  // ═══════════════════════════════════════════════════════════════════
  //
  // EL CALLEJÓN QUE ESTO ARREGLA, medido en dev el 2026-10-26: un pedido de
  // dólares y euros, con los dólares ya cobrados. El tendero quita el bloque
  // de euros --que es exactamente para lo que está ese botón-- y el pedido se
  // quedaba `new` con `registered_at` nulo PARA SIEMPRE. La campana lo
  // reclamaba en cada apertura, y el único botón de su pantalla contestaba
  // «Esa parte del pedido ya se registró».
  //
  // NO PIERDE DINERO --la venta de los dólares es correcta-- y aun así es de
  // los peores fallos que hay: **un aviso que no se puede apagar es un aviso
  // que se deja de leer**, y detrás de ese se dejan de leer los demás. Es la
  // misma avería que `CLAUDE.md` describe para un contador que nunca baja.
  //
  // SE PREGUNTA A LA BASE OTRA VEZ y no se calcula restando lo que acabamos de
  // quitar: entre las dos consultas puede haber entrado otra pestaña, y lo que
  // decide sellar un pedido tiene que mirar lo que hay, no lo que debería
  // haber.
  //
  // LA MISMA FUNCIÓN QUE USA EL REGISTRO. Si esta cuenta se escribiera aquí
  // otra vez, las dos puertas podrían contestar distinto sobre el mismo
  // pedido, y una de las dos respuestas lo dejaría mal sellado.
  const { data: tras, error: errorTras } = await supabase
    .from("catalog_order_items")
    .select("id, product_id, currency")
    .is("deleted_at", null)
    .eq("order_id", pedido.id);
  if (errorTras) {
    // NO SE DESHACE LO QUITADO: eso ya está bien hecho y es lo que el tendero
    // pidió. Lo que queda sin saberse es si además había que cerrar el pedido,
    // y eso se puede volver a intentar quitando otra cosa o registrando.
    console.error("[pedido] lineas tras quitar:", errorTras.message);
    return { ok: true };
  }

  const { pendientes, hayVentas } = await monedasPendientes(
    supabase,
    pedido.id,
    tras ?? [],
  );
  let pedidoCerrado = false;
  if (hayVentas && pendientes.length === 0) {
    const { error: errorSello } = await supabase
      .from("catalog_orders")
      .update({ registered_at: new Date().toISOString(), status: "registered" })
      .eq("id", pedido.id)
      .eq("owner_id", user.id);
    if (errorSello) {
      console.error("[pedido] sello al quitar moneda:", errorSello.message, {
        pedidoId: pedido.id,
      });
    } else {
      pedidoCerrado = true;
    }
  }

  // `layout` Y LA RAÍZ: el contador de la campana vive en la cabecera, que es
  // otro árbol, y al cerrar un pedido ese número baja.
  revalidatePath("/", "layout");
  revalidatePath(`/productos/ordenes/${pedido.id}`, "layout");
  return { ok: true, pedidoCerrado };
}

export async function restaurarMonedaDelPedido(
  pedidoId: string,
  moneda: string,
): Promise<ResultadoDeQuitarMoneda> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Tu sesión se cerró. Vuelve a entrar." };
  if (!(await puedeEscribir(supabase, user.id))) {
    return { ok: false, error: MENSAJE_CUENTA_PAUSADA };
  }

  const { pedido, error } = await pedidoDelDueno(supabase, pedidoId, user.id);
  if (!pedido) return { ok: false, error: error! };

  // LAS BORRADAS, que es la única consulta del repo que las pide. Va con su
  // `.not(...)` explícito y por eso `qa:lineas-borradas` la deja pasar.
  const { data: quitadas, error: errorQuitadas } = await supabase
    .from("catalog_order_items")
    .select("id, currency")
    .not("deleted_at", "is", null)
    .eq("order_id", pedido.id);
  if (errorQuitadas) {
    console.error("[pedido] lineas quitadas:", errorQuitadas.message);
    return { ok: false, error: "No pudimos leer el pedido. Vuelve a intentarlo." };
  }

  const aDevolver = (quitadas ?? [])
    .filter((l) => String(l.currency ?? "") === moneda)
    .map((l) => l.id as string);
  if (aDevolver.length === 0) {
    return { ok: false, error: "No hay nada que restaurar en esa moneda." };
  }

  const { error: errorDevolver } = await supabase
    .from("catalog_order_items")
    .update({ deleted_at: null })
    .in("id", aDevolver);
  if (errorDevolver) {
    console.error("[pedido] restaurar moneda:", errorDevolver.message);
    return { ok: false, error: "No pudimos restaurarlo. Vuelve a intentarlo." };
  }

  revalidatePath(`/productos/ordenes/${pedido.id}`, "layout");
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════
// DESCARTAR UN PEDIDO ENTERO, Y DEVOLVERLO
// ═══════════════════════════════════════════════════════════════════════
//
// Encargo del dueño el 2026-10-26: *«en el header, agrega botón "More" con
// opción "Descartar"; al seleccionarla elimina el pedido (debe mandar la
// notificación y ofrecer restaurarlo)»*.
//
// NO ES LO MISMO QUE QUITAR UNA MONEDA, y por eso son dos acciones y no una
// con un argumento: quitar una moneda deja un pedido que SIGUE vivo y se va a
// registrar; descartar dice que ese pedido no va a ninguna parte. Lo primero
// toca líneas; esto toca el pedido.
//
// ───────────────────────────────────────────────────────────────────────
// SE GUARDA LA FECHA Y NO SOLO EL ESTADO — migración `162`
//
// Porque la notificación cuelga de ella. Los avisos de pedido no se guardan
// en ninguna tabla: `getNotifications` los DEDUCE de `catalog_orders`. Sin un
// `discarded_at` no hay de qué colgar el aviso rojo ni cómo ordenarlo entre
// los demás, y el pedido descartado simplemente desaparecería sin dejar
// rastro de que alguien lo descartó.
//
// DOS FECHAS Y NO UN ESTADO porque esto se puede repetir: descartar, devolver
// y volver a descartar. Gana la más reciente, que es lo que mira la
// notificación para saber si enseña la roja o la azul.
//
// ───────────────────────────────────────────────────────────────────────
// UN PEDIDO YA REGISTRADO NO SE DESCARTA
//
// Su venta está escrita, con su cargo o su cobro. Descartarlo dejaría el
// pedido diciendo que no va a ninguna parte y la venta diciendo lo contrario,
// y nada en pantalla explicaría cuál manda. Para deshacer eso hay que borrar
// la VENTA, que es otra puerta y tiene su propio diálogo.

export type ResultadoDeDescartar = { ok: true } | { ok: false; error: string };

export async function descartarPedido(
  pedidoId: string,
): Promise<ResultadoDeDescartar> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Tu sesión se cerró. Vuelve a entrar." };
  if (!(await puedeEscribir(supabase, user.id))) {
    return { ok: false, error: MENSAJE_CUENTA_PAUSADA };
  }

  const { pedido, error } = await pedidoDelDueno(supabase, pedidoId, user.id);
  if (!pedido) return { ok: false, error: error! };

  const { error: errorDescartar } = await supabase
    .from("catalog_orders")
    .update({
      status: "discarded",
      discarded_at: new Date().toISOString(),
      // `restored_at` A NULO, y no se deja el de la vez anterior: la
      // notificación decide cuál enseña comparando las dos fechas, y una
      // restauración vieja ganándole a un descarte nuevo pintaría de azul un
      // pedido que acaba de descartarse.
      restored_at: null,
    })
    .eq("id", pedido.id)
    .eq("owner_id", user.id);
  if (errorDescartar) {
    console.error("[pedido] descartar:", errorDescartar.message);
    return { ok: false, error: "No pudimos descartarlo. Vuelve a intentarlo." };
  }

  // EL CONTADOR DE LA CAMPANA Y LA LISTA SE REHACEN. `layout` y no la ruta
  // sola: el número vive en la cabecera, que es otro árbol.
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function restaurarPedido(
  pedidoId: string,
): Promise<ResultadoDeDescartar> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Tu sesión se cerró. Vuelve a entrar." };
  if (!(await puedeEscribir(supabase, user.id))) {
    return { ok: false, error: MENSAJE_CUENTA_PAUSADA };
  }

  // AQUÍ NO VALE `pedidoDelDueno`: esa función rechaza los registrados, y
  // además este pedido está DESCARTADO, que es el estado que se viene a
  // deshacer. Se comprueba el dueño igual --el id llega del navegador-- y se
  // exige que de verdad estuviera descartado.
  const { data: pedido, error: errorLeer } = await supabase
    .from("catalog_orders")
    .select("id, status, registered_at")
    .eq("id", pedidoId)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (errorLeer) {
    console.error("[pedido] leer para restaurar:", errorLeer.message);
    return { ok: false, error: "No pudimos leer el pedido. Vuelve a intentarlo." };
  }
  if (!pedido) return { ok: false, error: "No encontramos ese pedido." };
  if (pedido.status !== "discarded") {
    return { ok: false, error: "Ese pedido no está descartado." };
  }

  // VUELVE A `new` Y NO A `seen`. `seen` significaba «lo miré», y ese estado
  // dejó de usarse el 2026-10-25 cuando el dueño eliminó el concepto de
  // pedido atendido. `new` es lo que cuenta como pendiente, que es justo lo
  // que un pedido restaurado vuelve a ser.
  const { error: errorRestaurar } = await supabase
    .from("catalog_orders")
    .update({ status: "new", restored_at: new Date().toISOString() })
    .eq("id", pedido.id)
    .eq("owner_id", user.id);
  if (errorRestaurar) {
    console.error("[pedido] restaurar:", errorRestaurar.message);
    return { ok: false, error: "No pudimos restaurarlo. Vuelve a intentarlo." };
  }

  revalidatePath("/", "layout");
  return { ok: true };
}
