import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { SetupNotice } from "@/components/setup-notice";
import { ProductoFlujo } from "@/components/dashboard/producto-flujo";
import { cargarDatosDelFlujo, cargarProductoParaEditar } from "@/lib/products/datos-del-flujo";

export const metadata = { title: "Editar producto — Sevenz" };

// EDITAR UN PRODUCTO, EN LAS MISMAS CUATRO PANTALLAS.
//
// El frame se llama «Crear producto V4» y sus conectores solo hablan del
// alta, así que se preguntó: el dueño respondió el 2026-10-20 *«editar
// también pasa a pantallas»*. Por eso esta ruta existe y el diálogo no.
//
// MISMO COMPONENTE, no una copia: lo único que cambia es que llega un
// `product`, que es lo que ese formulario ya distinguía con `editing`.
export default async function EditarProductoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!isSupabaseConfigured()) return <SetupNotice />;

  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [datos, delProducto] = await Promise.all([
    cargarDatosDelFlujo(supabase, user.id),
    cargarProductoParaEditar(supabase, user.id, id),
  ]);
  // Un producto de otro negocio, o uno en la papelera, no existe para esta
  // pantalla. La comprobación de propiedad va en la consulta, en código.
  if (!delProducto) notFound();

  return (
    <ProductoFlujo
      product={delProducto.product}
      ownerId={user.id}
      rates={datos.rates}
      defaultCurrency={datos.defaultCurrency}
      overrides={delProducto.overrides}
      initialCurrencies={delProducto.initialCurrencies}
      supplierSuggestions={datos.supplierSuggestions}
      // AL EDITAR MANDA LA DEL PRODUCTO QUE SE ABRE, no la del último creado:
      // esa es para estrenar uno, y aquí ya hay una decisión tomada.
      lastCostCurrency={null}
    />
  );
}
