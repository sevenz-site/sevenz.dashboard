"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { puedeEscribir } from "@/lib/cuenta-pausada-server";
import { MENSAJE_CUENTA_PAUSADA } from "@/lib/cuenta-pausada";
import { readOwnerCountry } from "@/lib/owner-country";
import { isDocumentTypeFor } from "@/lib/document-id";
import { DOCUMENT_SOURCE } from "@/lib/types";
import { registrarVenta, type VentaEntrada } from "@/app/(app)/ventas/actions";
import type { PriceCurrency } from "@/lib/products/price";

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

export async function markOrderAttended(
  orderId: string,
): Promise<OrderActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión expirada, vuelve a entrar." };

  // `.eq("owner_id", user.id)` EXPLICITLY, not RLS alone. `orderId` arrives
  // from the browser, and CLAUDE.md's rule exists because two functions once
  // relied on the policy and would have had nothing left if a migration ever
  // loosened it. The policy is the backstop; this is the lock.
  const { error, count } = await supabase
    .from("catalog_orders")
    .update(
      { status: "seen", seen_at: new Date().toISOString() },
      { count: "exact" },
    )
    .eq("id", orderId)
    .eq("owner_id", user.id)
    // ONLY FROM `new`. An order already registered or discarded must not be
    // dragged back to "seen" by a second tap -- `status` is what CT-70's
    // button will set, and this one must never undo it.
    .eq("status", "new");

  if (error) {
    console.error("[orders] markOrderAttended:", error.message);
    return { error: "No pudimos marcar el pedido. Intenta de nuevo." };
  }

  // Zero rows is not an error the shopkeeper needs to see: it means the order
  // was already attended, which is where they wanted to get to anyway.
  if (count === 0) {
    console.warn("[orders] markOrderAttended: nada que marcar", orderId);
  }

  revalidatePath("/productos/ordenes");
  revalidatePath(`/productos/ordenes/${orderId}`);
  // The bell and the Catálogo link both carry the count, so both go stale.
  revalidatePath("/productos");
  revalidatePath("/notificaciones");
  return { error: null };
}

// REGISTERING A CATALOGUE ORDER AS A SALE — the last step of the flow the
// sitemap draws from «Registrar» on a product to «Registrar y finalizar».
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
// So what lives here is the TRANSLATION: a draft that was filled in line by
// line in the browser, turned into the one shape that action takes.
//
// ===========================================================================
// THE PRICE IS THE SEALED ONE, AND THAT IS WHY `pedidoId` TRAVELS
//
// The owner's decision of 2026-10-24, asked whether to charge what the
// customer saw or today's catalogue: *«al congelado»*. The browser still
// sends no price — it sends the order's id, and the server reads the sealed
// figure out of `catalog_order_items`. See `VentaEntrada.pedidoId`.

export type PagoDeLineaEntrada = {
  lineaId: string;
  amount: number;
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
  pagos: PagoDeLineaEntrada[];
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
      // LINES LEFT OUT, NAMED. The owner's decision of 2026-10-24 about a
      // product that is no longer in the catalogue: *«se excluye esa línea y
      // se avisa»*. Returning the names is the «y se avisa» half — a count
      // would tell the shopkeeper something was dropped without telling them
      // what, which is worse than silence because it cannot be acted on.
      excluidas: string[];
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

  // `.eq("owner_id")` EXPLICITLY — the id comes from the browser.
  const { data: pedido, error: errorPedido } = await supabase
    .from("catalog_orders")
    .select("id, sale_id, registered_at")
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
  if (pedido.sale_id != null || pedido.registered_at != null) {
    return { ok: false, error: "Este pedido ya se registró." };
  }

  if (entrada.pagos.length === 0) {
    return {
      ok: false,
      error: "Registra al menos un producto antes de finalizar.",
    };
  }

  // ── LAS LÍNEAS, CON LO QUE EL BORRADOR DICE DE CADA UNA ─────────────
  const { data: lineasDelPedido, error: errorLineas } = await supabase
    .from("catalog_order_items")
    .select("id, product_id, product_name, quantity, currency")
    .eq("order_id", pedido.id);
  if (errorLineas) {
    console.error("registrarPedidoComoVenta lineas:", errorLineas.message);
    return {
      ok: false,
      error: "No pudimos leer el pedido. Vuelve a intentarlo.",
    };
  }
  const porLinea = new Map((lineasDelPedido ?? []).map((l) => [l.id, l]));

  const lineas: VentaEntrada["lineas"] = [];
  const pagos: VentaEntrada["pagos"] = [];
  const excluidas: string[] = [];
  // THE LONGEST TERM WINS, PER CURRENCY — the owner's decision of 2026-10-24,
  // and he called it what it is in the same breath: a patch over a product
  // mistake, because registering should be per currency and not per product.
  // That is `CT-147`, marked critical, and it blocks this flow from
  // production.
  //
  // THE LONGEST AND NOT THE SHORTEST because the shortest would make the app
  // chase a customer sooner than the shopkeeper agreed to, which is the error
  // that costs a relationship. The longest only delays an alert.
  const credito = new Map<PriceCurrency, VentaEntrada["credito"][number]>();

  for (const pago of entrada.pagos) {
    const linea = porLinea.get(pago.lineaId);
    // A payment for a line that is not in this order. Not an attack worth a
    // message of its own — the draft simply went stale — and silently
    // dropping it is wrong, so it is reported like any other exclusion.
    if (!linea) {
      excluidas.push("Una línea que ya no está en el pedido");
      continue;
    }
    // THE PRODUCT IS GONE FROM THE CATALOGUE. `registrarVenta` prices from
    // `products`, so a line with no product cannot become a `sale_line` and
    // would take the WHOLE sale down with it. The owner's decision: leave it
    // out and say so.
    if (!linea.product_id) {
      excluidas.push(linea.product_name);
      continue;
    }

    const edicion = entrada.editadas[linea.id];
    const currency = ((edicion?.currency as PriceCurrency | undefined) ??
      linea.currency) as PriceCurrency;
    const quantity = edicion?.quantity ?? Number(linea.quantity);

    lineas.push({
      productId: linea.product_id,
      quantity,
      currency,
      orderItemId: linea.id,
    });

    // ONE PAYMENT ROW PER LINE, not one per currency. `registrarVenta` takes
    // an array and adds them up itself, so each line keeps its own photo and
    // its own note instead of the first one swallowing the rest.
    if (pago.amount > 0) {
      pagos.push({
        currency,
        amount: pago.amount,
        entryCurrency: pago.entryCurrency,
        entryAmount: pago.entryAmount,
        photoPath: pago.photoPath,
        description: pago.description || null,
      });
    }

    const plazoDias = pago.plazo === "" ? null : Number(pago.plazo);
    const cuotas = pago.cuotas === "" ? null : Number(pago.cuotas);
    const actual = credito.get(currency);
    const masLargo =
      actual == null ||
      // `null` IS «sin especificar» AND IT WINS: a term nobody set cannot be
      // overridden by one somebody did, or the app would invent a deadline.
      actual.plazoDias == null ||
      plazoDias == null ||
      plazoDias > actual.plazoDias;
    if (masLargo) {
      credito.set(currency, {
        currency,
        plazoDias:
          plazoDias != null && Number.isFinite(plazoDias) ? plazoDias : null,
        cuotas: cuotas != null && Number.isFinite(cuotas) ? cuotas : null,
        usarPrevista: pago.usarPrevista,
        photoPath: pago.photoPath,
        description: pago.description || null,
      });
    }
  }

  if (lineas.length === 0) {
    return {
      ok: false,
      error:
        "Ninguno de los productos registrados sigue en tu catálogo, así que no hay nada que cobrar.",
    };
  }

  // ── EL CLIENTE: LA FICHA QUE HAY, O UNA NUEVA ───────────────────────
  //
  // SE CREA AQUÍ Y NO EN LA PANTALLA, que es lo que evita dejar una persona
  // huérfana en la lista del tendero cada vez que alguien se sale del flujo.
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
    credito: [...credito.values()],
    pedidoId: pedido.id,
  });

  if (!resultado.ok) return { ok: false, error: resultado.error };
  return { ok: true, saleId: resultado.saleId, excluidas };
}
