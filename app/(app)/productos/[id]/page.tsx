import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { SetupNotice } from "@/components/setup-notice";
import { ProductDetail } from "@/components/dashboard/product-detail";
import { cargarProductoParaEditar } from "@/lib/products/datos-del-flujo";
import { getOwnerRateContext } from "@/lib/exchange-rate/owner-rate";
import { getBolivarRates } from "@/lib/products/catalog";
import type { BolivarRates } from "@/lib/products/price";

export const metadata = { title: "Producto — Sevenz" };

// LA FICHA DE UN PRODUCTO — frame `1730:14329`, encargo del dueño el
// 2026-10-27.
//
// ES LA PANTALLA A LA QUE AHORA LLEVA LA TARJETA del catálogo, que antes iba
// derecha a `/productos/<id>/editar`. El porqué del cambio --y la anotación
// del frame que decía lo contrario-- está en `product-detail.tsx`.
//
// REUSA EL CARGADOR DE LA EDICIÓN y eso no es pereza: `cargarProductoParaEditar`
// ya trae la comprobación de propiedad EN CÓDIGO (`.eq("owner_id", ...)`, más
// `trashed_at is null`), que es lo que `CLAUDE.md` exige de toda fila que se
// toca por un id venido del navegador. Escribir aquí una segunda consulta sería
// un segundo sitio donde olvidarse de ese `.eq`.
//
// LO QUE NO USA son los `overrides` ni las `initialCurrencies` que ese cargador
// devuelve: los precios por moneda de esta ficha salen de `allPrices` con las
// tasas, igual que el catálogo y que la hoja de un pedido. Se deja así --en vez
// de partir el cargador en dos-- porque son tres consultas en paralelo y la que
// sobra no cuesta un viaje extra.
export default async function ProductoPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return <SetupNotice />;

  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [cargado, { data: owner }, { data: catalogLink }, rateContext] = await Promise.all([
    cargarProductoParaEditar(supabase, user.id, id),
    supabase.from("owners").select("business_name").eq("id", user.id).maybeSingle(),
    // EL ENLACE QUE YA TIENE, LEÍDO SIN CREARLO -- misma razón que en
    // `/productos`: acuñar un token por abrir una pantalla pondría al negocio
    // a una URL de distancia de un catálogo que nunca decidió publicar. Crear
    // es cosa del primer «Compartir».
    supabase.from("catalog_share_links").select("token").eq("owner_id", user.id).maybeSingle(),
    getOwnerRateContext(supabase, user.id),
  ]);

  // Un producto de otro negocio, o uno en la papelera, no existe para esta
  // pantalla.
  if (!cargado) notFound();

  // Las equivalencias solo existen donde hay tasas. Un negocio colombiano
  // cobra en pesos y su ficha enseña un precio y ya.
  const rates: BolivarRates | null = rateContext
    ? await getBolivarRates(rateContext.effectiveRate)
    : null;

  return (
    <ProductDetail
      product={cargado.product}
      rates={rates}
      businessName={owner?.business_name ?? "mi negocio"}
      catalogToken={catalogLink?.token ?? null}
    />
  );
}
