"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { trackServer } from "@/lib/mixpanel-server";
import { getBolivarRates } from "@/lib/products/catalog";
import type { ProductoDelCarrito } from "@/lib/cart/cart";
import { bloqueDesdeRpc, type BloqueCrudo } from "@/lib/products/public-pricing";
import type { BolivarRates } from "@/lib/products/price";

// LAS DOS ACCIONES DEL CARRITO, Y LAS LLAMA UN VISITANTE SIN SESION.
//
// ===========================================================================
// ERRORES ENMASCARADOS, SIEMPRE
//
// Es la regla de `CLAUDE.md` para todo lo que se puede llamar sin iniciar
// sesion: el detalle real va a `console.error` y NUNCA a la respuesta. Un
// mensaje de Postgres en pantalla le cuenta la forma de la base de datos a
// cualquiera que sepa leerlo — y esta pagina la abre quien reciba un enlace.
//
// Las razones que SI viajan son las que la funcion devuelve a proposito
// (`producto_invalido`, `demasiadas_ordenes`…): son codigos nuestros, cerrados
// y pensados para traducirse, no texto de la base.
//
// ===========================================================================
// AQUI NO SE VALIDA NADA IMPORTANTE, Y ES CORRECTO
//
// Ni el precio, ni que el producto sea del dueno, ni el tope. Todo eso vive en
// `create_catalog_order` (migracion 109), porque esto es codigo que se puede
// saltar: quien quiera puede llamar al RPC directamente con la clave anonima,
// que es publica. La unica frontera real es la base.

export type RespuestaProductos = {
  productos: ProductoDelCarrito[];
  rates: BolivarRates | null;
};

export async function productosDelCarrito(
  token: string,
  ids: string[],
): Promise<RespuestaProductos> {
  if (ids.length === 0) return { productos: [], rates: null };

  const supabase = await createClient();
  try {
    const { data, error } = await supabase.rpc("get_shared_products", {
      p_token: token,
      p_ids: ids,
    });
    if (error) {
      console.error("[carrito] get_shared_products:", error.message);
      return { productos: [], rates: null };
    }
    const shared = data as {
      owner_country: string | null;
      // THE TIER BLOCKS ARRIVE RAW, and the `as` is a promise rather than a
      // check -- it is JSON from the database. Typing them as `BloqueCrudo`
      // is what makes the normalisation below look necessary instead of
      // looking like dead code.
      products: (Omit<ProductoDelCarrito, "retail" | "wholesale"> & {
        retail: BloqueCrudo | null;
        wholesale: BloqueCrudo | null;
      })[];
      rate_mode: string | null;
      current_bcv_usd: number | null;
      current_bcv_eur: number | null;
      custom_rate_usd: number | null;
      custom_rate_eur: number | null;
    } | null;
    if (!shared) return { productos: [], rates: null };

    // Las mismas tasas que la lista y el detalle, por el mismo camino: la del
    // tendero si la fijó, la del BCV si no, y ninguna fuera de Venezuela.
    // THE USDT RATE HERE TOO, for the same reason as the catalogue and the
    // detail: the cart recomputes every line, so if it resolved USDT
    // differently from the screen the customer added from, a line would change
    // price -- or vanish -- between one screen and the next. See migrations
    // 112 and 113.
    const tasaBase =
      shared.owner_country === "VE" &&
      shared.current_bcv_usd != null &&
      shared.current_bcv_eur != null
        ? shared.rate_mode === "CUSTOM" && shared.custom_rate_usd && shared.custom_rate_eur
          ? { usd: shared.custom_rate_usd, eur: shared.custom_rate_eur }
          : { usd: shared.current_bcv_usd, eur: shared.current_bcv_eur }
        : null;
    const rates: BolivarRates | null = tasaBase ? await getBolivarRates(tasaBase) : null;

    // EACH TIER BLOCK IS NORMALISED, and this is not cosmetic: `precioUnitario`
    // reads `bloque.base` and `bloque.currencies`, so a raw block would give a
    // TypeError and a blank cart screen rather than a strange price.
    //
    // `bloqueDesdeRpc` holds the fallbacks in one place -- see it for why they
    // degrade to the pre-114 behaviour instead of to nothing.
    const productos = (shared.products ?? []).map((p) => ({
      ...p,
      retail: bloqueDesdeRpc(p.retail, p.base_currency),
      wholesale: bloqueDesdeRpc(p.wholesale, p.base_currency),
    }));

    return { productos, rates };
  } catch (error) {
    console.error("[carrito] threw:", error instanceof Error ? error.message : error);
    return { productos: [], rates: null };
  }
}

export type DatosDeLaOrden = {
  nombre: string;
  documento: string;
  // LA LETRA DEL DOCUMENTO — migración `155`. `null` si el negocio no tiene
  // país conocido: ahí el formulario no dibuja selector, porque sin país no se
  // sabe qué juego de letras corresponde.
  tipoDeDocumento: string | null;
  whatsapp: string;
  // WHERE TO TAKE IT. Optional, and the one field in this form the shop does
  // not strictly need to answer: a customer who would rather not give it still
  // gets to order. Added 2026-10-24, migration `157`, because the shopkeeper's
  // order card shows «Dirección:» and nothing could fill it.
  direccion: string;
  quiereAvisos: boolean;
  textoDelPermiso: string | null;
};

export type ItemDeLaOrden = {
  product_id: string;
  quantity: number;
  currency: string;
  comment: string | null;
};

// LOS MOTIVOS, TRADUCIDOS UNA SOLA VEZ Y AQUI.
//
// La funcion devuelve codigos estables; la pantalla ensena frases. Juntarlos
// en la pantalla significaria repetir el diccionario el dia que haya otra que
// cree ordenes, y dos diccionarios acaban diciendo cosas distintas del mismo
// error.
const MOTIVOS: Record<string, string> = {
  enlace_invalido: "Este catálogo ya no está disponible.",
  demasiadas_ordenes: "Hay muchos pedidos ahora mismo. Espera un momento y vuelve a intentarlo.",
  nombre_invalido: "Escribe tu nombre.",
  documento_invalido: "Escribe tu documento.",
  whatsapp_invalido: "Ese número de WhatsApp no se entiende. Revísalo.",
  sin_productos: "Tu carrito está vacío.",
  demasiados_productos: "Son demasiados productos para un solo pedido.",
  producto_invalido: "Uno de los productos ya no está disponible. Quítalo y vuelve a intentarlo.",
  cantidad_invalida: "Hay una cantidad que no es válida.",
  cantidad_bajo_el_minimo: "Hay un producto del que tienes que pedir más unidades.",
  sin_precio: "Uno de los productos ya no tiene precio. Quítalo y vuelve a intentarlo.",
  moneda_invalida: "Una de las monedas ya no está disponible para esa cantidad.",
  // NEW IN MIGRATION 111, and distinct from `moneda_invalida` on purpose:
  // "we do not sell it in that currency" is fixed by picking another, and "we
  // have no rate right now" is fixed by waiting. Giving the same advice for
  // both sends the customer to change something that was not the problem.
  //
  // In practice it falls to USDT: its rate comes from CriptoYa and public
  // pages do not ask for it (decision of 2026-10-10), so a USDT order is only
  // possible when the shopkeeper pinned that price by hand. See `CT-73`.
  sin_tasa: "Ahora mismo no podemos calcular ese precio. Prueba con otra moneda.",
};

export async function crearOrden(
  token: string,
  datos: DatosDeLaOrden,
  items: ItemDeLaOrden[],
): Promise<{ ok: true; orderId: string } | { ok: false; error: string }> {
  const supabase = await createClient();

  try {
    const { data, error } = await supabase.rpc("create_catalog_order", {
      p_token: token,
      p_customer_name: datos.nombre,
      p_customer_document: datos.documento,
      p_customer_document_type: datos.tipoDeDocumento,
      p_customer_whatsapp: datos.whatsapp,
      p_wants_notices: datos.quiereAvisos,
      p_consent_text: datos.textoDelPermiso,
      // EL NOVENO ARGUMENTO, que la función acepta desde la `157` con
      // `default null`. Mandarlo siempre —aunque vaya vacío— y no solo cuando
      // hay algo: PostgREST resuelve por los nombres que recibe, y una llamada
      // que a veces lleva ocho y a veces nueve son dos resoluciones distintas
      // que probar. La función ya limpia el vacío a `null`.
      p_customer_address: datos.direccion,
      p_items: items,
    });

    if (error) {
      console.error("[orden] rpc:", error.message);
      return { ok: false, error: "No pudimos enviar tu pedido. Intenta de nuevo." };
    }

    const r = data as { ok: boolean; order_id?: string; reason?: string };
    if (!r?.ok) {
      const motivo = r?.reason ?? "";
      // `error` sin traducción es el comodín de la función para lo que no
      // previó, y ya quedó en el log del servidor con su detalle real.
      console.error("[orden] rechazada:", motivo);
      return {
        ok: false,
        error: MOTIVOS[motivo] ?? "No pudimos enviar tu pedido. Intenta de nuevo.",
      };
    }

    // ══ ANALÍTICA: «Catalog Order Received» ═══════════════════════════
    //
    // PREGUNTA DE NEGOCIO, del dueño el 2026-10-25: *«¿cuántas órdenes recibe
    // un negocio?»* — y, de la misma tanda, *«¿cuántos productos en promedio
    // se procesan en una orden?»*.
    //
    // QUÉ DECISIÓN CAMBIA SEGÚN LA RESPUESTA. Si un negocio recibe pedidos y
    // casi ninguno se registra, el problema no es el catálogo: es el flujo de
    // registro, y hay que ir a mirarlo. Si no recibe ninguno, el catálogo no
    // se está compartiendo y lo que hay que trabajar es el enlace. Las dos
    // salidas llevan a sitios opuestos, y sin este evento no se distinguen.
    //
    // BAJO QUÉ PERFIL SE ARCHIVA: el del DUEÑO, resuelto en el servidor con
    // `catalog_link_owner` (migración `159`). Quien hace esta acción es el
    // CLIENTE, que no tiene identidad en Mixpanel — es el caso que `CLAUDE.md`
    // nombra: la resolución es parte de la decisión, no un detalle.
    //
    // SE PUEDE PERDER: si Mixpanel no está configurado, `trackServer` calla y
    // sigue. El pedido ya está guardado en Supabase, que es la fuente; este
    // número es un suelo, no un recuento exacto.
    try {
      const { data: dueno } = await createServiceClient().rpc("catalog_link_owner", {
        p_token: token,
      });
      const o = dueno as { owner_id: string; owner_email: string | null } | null;
      if (o?.owner_id) {
        const unidades = items.reduce((suma, i) => suma + Number(i.quantity ?? 0), 0);
        trackServer(
          "Catalog Order Received",
          o.owner_id,
          {
            order_id: r.order_id,
            // DOS CUENTAS Y NO UNA: «tres productos» y «tres unidades del
            // mismo producto» son pedidos muy distintos de preparar, y la
            // pregunta del dueño —cuántos productos se procesan— se lee mejor
            // con las dos al lado.
            lineas: items.length,
            unidades,
            quiere_avisos: datos.quiereAvisos,
            con_direccion: Boolean(datos.direccion?.trim()),
          },
          o.owner_email,
        );
      }
    } catch (error) {
      // LA ANALÍTICA NO TUMBA UN PEDIDO. Está guardado; lo que falle aquí
      // cuesta una fila en Mixpanel, no una venta.
      console.error(
        "[orden] analitica:",
        error instanceof Error ? error.message : error,
      );
    }

    return { ok: true, orderId: r.order_id! };
  } catch (error) {
    console.error("[orden] threw:", error instanceof Error ? error.message : error);
    return { ok: false, error: "No pudimos enviar tu pedido. Intenta de nuevo." };
  }
}
