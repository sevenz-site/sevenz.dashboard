import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { SetupNotice } from "@/components/setup-notice";
import { VentaResumen } from "@/components/dashboard/venta-resumen";
import { resumenDeVenta } from "@/app/(app)/ventas/actions";

export const metadata = { title: "Venta registrada — Sevenz" };

// EL RESUMEN DE UNA VENTA -- frame `1389:8595`.
//
// Es una ruta propia y no el último paso del asistente: ver el comentario de
// cabecera de `VentaResumen`, que explica por qué. Lo importante desde aquí es
// que `/ventas/<id>` se puede recargar, marcar y volver a abrir, que es lo que
// una pantalla hecha para enseñársela a alguien necesita.
//
// LA COMPROBACIÓN DE PROPIEDAD VIVE EN `resumenDeVenta`, con la sesión, y no
// aquí: un id de venta llega del navegador —de la barra de direcciones, nada
// menos— y leerlo sin más enseñaría la compra de un cliente de otro negocio.
export default async function ResumenDeVentaPage({
  params,
}: {
  params: Promise<{ saleId: string }>;
}) {
  if (!isSupabaseConfigured()) return <SetupNotice />;

  const { saleId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const resumen = await resumenDeVenta(saleId);
  // UN 404 Y NO UN MENSAJE DE ERROR. Una venta que no es suya y una que no
  // existe se contestan igual: quien pruebe ids al azar no aprende de la
  // diferencia. El error legible queda para los fallos de lectura, que es
  // donde `resumenDeVenta` ya escribe en `console.error`.
  if (!resumen.ok) notFound();

  return (
    <VentaResumen
      comprador={resumen.comprador}
      bloques={resumen.bloques}
      rates={resumen.rates}
      fecha={resumen.fecha}
    />
  );
}
