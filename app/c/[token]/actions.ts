"use server";

import { createClient } from "@/lib/supabase/server";
import type { ProductoDelCarrito } from "@/lib/cart/cart";
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
      products: ProductoDelCarrito[];
      rate_mode: string | null;
      current_bcv_usd: number | null;
      current_bcv_eur: number | null;
      custom_rate_usd: number | null;
      custom_rate_eur: number | null;
    } | null;
    if (!shared) return { productos: [], rates: null };

    // Las mismas tasas que la lista y el detalle, por el mismo camino: la del
    // tendero si la fijó, la del BCV si no, y ninguna fuera de Venezuela.
    const rates: BolivarRates | null =
      shared.owner_country === "VE" &&
      shared.current_bcv_usd != null &&
      shared.current_bcv_eur != null
        ? shared.rate_mode === "CUSTOM" && shared.custom_rate_usd && shared.custom_rate_eur
          ? { usd: shared.custom_rate_usd, eur: shared.custom_rate_eur, usdt: null }
          : { usd: shared.current_bcv_usd, eur: shared.current_bcv_eur, usdt: null }
        : null;

    return { productos: shared.products ?? [], rates };
  } catch (error) {
    console.error("[carrito] threw:", error instanceof Error ? error.message : error);
    return { productos: [], rates: null };
  }
}

export type DatosDeLaOrden = {
  nombre: string;
  documento: string;
  whatsapp: string;
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
      p_customer_whatsapp: datos.whatsapp,
      p_wants_notices: datos.quiereAvisos,
      p_consent_text: datos.textoDelPermiso,
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

    return { ok: true, orderId: r.order_id! };
  } catch (error) {
    console.error("[orden] threw:", error instanceof Error ? error.message : error);
    return { ok: false, error: "No pudimos enviar tu pedido. Intenta de nuevo." };
  }
}
