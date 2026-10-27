import { ImageResponse } from "next/og";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getPublicProductPhotoUrl } from "@/lib/supabase/storage";

// ═══════════════════════════════════════════════════════════════════════
// LA VISTA PREVIA DE UN PRODUCTO COMPARTIDO — frame `1732:14757`
//
// Encargo del dueño el 2026-10-27: *«El preview de la URL al compartirla debe
// verse así»*, con el frame delante. Lo que dibuja es la tarjeta tal como la
// pinta WhatsApp: la FOTO arriba, y debajo un panel oscuro con el nombre del
// producto, su descripción y la línea «Sevenz.site ¡Cuentas claras sin tanta
// vaina!» junto al favicon.
//
// ───────────────────────────────────────────────────────────────────────
// ESTO DESHACE UNA DECISIÓN ESCRITA, Y LAS DOS QUEDAN ANOTADAS
//
// `page.tsx` decía, con todas las letras: *«SIN `generateMetadata` A PROPÓSITO
// (…) el nombre y la foto de un producto en la vista previa de un enlace de
// WhatsApp le dirían a cualquiera que lo reenvíe qué vende ese negocio y a
// cómo»*.
//
// Lo que cambió es la premisa, no el riesgo: ese día el enlace solo circulaba
// de rebote, y hoy hay un botón «Compartir» cuyo trabajo entero es que
// circule. El tendero elige mandarlo.
//
// Y LA MITAD DEL MIEDO VIEJO SIGUE CUBIERTA, porque el frame no dibuja ningún
// precio. «Qué vende» pasa a verse; «a cómo» no. Quien reenvíe el enlace
// comparte un producto, no la lista de precios del negocio.
//
// `robots: noindex` SE QUEDA, en `page.tsx`. Compartir por WhatsApp y salir en
// Google son dos cosas distintas, y los rastreadores de los chats no miran esa
// etiqueta: la vista previa funciona igual.
//
// ───────────────────────────────────────────────────────────────────────
// QUÉ PONE ESTA IMAGEN Y QUÉ PONEN LAS ETIQUETAS
//
// La imagen es LA FOTO, recortada al tamaño que los chats esperan. El nombre,
// la descripción y la línea de Sevenz van en `og:title`, `og:description` y
// `og:site_name` --ver `generateMetadata` en `page.tsx`-- porque es ahí donde
// el chat los pinta, con su tipografía y su modo oscuro, que es justo lo que
// el frame dibuja.
//
// QUEMARLOS DENTRO DE LA IMAGEN se consideró y se dejó fuera: el chat
// enseñaría el nombre DOS veces --el suyo encima, el mío dentro-- y el texto
// de una imagen no se puede seleccionar, traducir ni leer en voz alta.
//
// SIN FOTO, UNA PIEZA DE MARCA Y NO UN HUECO GRIS. Un producto sin foto es el
// caso corriente en este producto, y un enlace cuya vista previa es un
// rectángulo vacío parece un enlace roto.
// ═══════════════════════════════════════════════════════════════════════

export const runtime = "nodejs";
export const alt = "Producto";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Los mismos tokens que el frame: `--primary` para el fondo, `--secondary`
// para el texto principal y `--subtle` para el secundario.
const FONDO = "#272727";
const TEXTO = "#dadada";
const SUAVE = "#9a9a9a";

export default async function Image({
  params,
}: {
  params: Promise<{ token: string; productId: string }>;
}) {
  const { token, productId } = await params;

  // MISMA PUERTA QUE LA PÁGINA: `get_shared_product` es `security definer` y
  // es lo único que puede leer un producto sin sesión. Si no contesta, se
  // dibuja la pieza de marca -- nunca un error, que en una vista previa se
  // vería como un enlace roto.
  let foto: string | null = null;
  let nombre = "";
  if (isSupabaseConfigured()) {
    try {
      const supabase = await createClient();
      const { data } = await supabase.rpc("get_shared_product", {
        p_token: token,
        p_product_id: productId,
      });
      const d = data as { name?: string; photo_path?: string | null } | null;
      if (d) {
        nombre = d.name ?? "";
        foto = d.photo_path ? getPublicProductPhotoUrl(d.photo_path) : null;
      }
    } catch (error) {
      console.error(
        "[og producto]:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: FONDO,
        }}
      >
        {foto ? (
          // `cover` Y NO `contain`: el frame enseña la foto llenando el ancho.
          // Con `contain`, una foto vertical deja dos franjas negras y la
          // tarjeta parece mal hecha.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={foto}
            alt=""
            width={size.width}
            height={size.height}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 24,
              color: TEXTO,
            }}
          >
            <div style={{ fontSize: 56, fontWeight: 600 }}>
              {nombre || "Producto"}
            </div>
            <div style={{ fontSize: 28, color: SUAVE }}>
              Sevenz.site ¡Cuentas claras sin tanta vaina!
            </div>
          </div>
        )}
      </div>
    ),
    size,
  );
}
