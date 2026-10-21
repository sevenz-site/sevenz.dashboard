import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { SetupNotice } from "@/components/setup-notice";
import { ProductoFlujo } from "@/components/dashboard/producto-flujo";
import { cargarDatosDelFlujo } from "@/lib/products/datos-del-flujo";

export const metadata = { title: "Crear producto — Sevenz" };

// EL ALTA DE UN PRODUCTO, EN CUATRO PANTALLAS — frame `1465:18582`.
//
// Era un diálogo de 1634 líneas hasta el 2026-10-20. Palabras del dueño:
// *«actualmente es un popup y es muy extenso, lo que afecta la experiencia
// del usuario»*.
//
// SE ENTRA POR DOS PUERTAS y las dos acaban aquí: el botón flotante de la
// barra y el del estado vacío del catálogo. Lo dicen los conectores del
// propio frame.
export default async function NuevoProductoPage() {
  if (!isSupabaseConfigured()) return <SetupNotice />;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const datos = await cargarDatosDelFlujo(supabase, user.id);

  return (
    <ProductoFlujo
      product={null}
      ownerId={user.id}
      rates={datos.rates}
      defaultCurrency={datos.defaultCurrency}
      overrides={{ retail: {}, wholesale: {} }}
      // UN PRODUCTO NUEVO ARRANCA IGUAL EN LOS DOS ESCALONES. La decisión del
      // dueño del 2026-10-14 --abrir con la moneda del último producto
      // creado-- no dice nada de escalones, y empezar con dos listas
      // distintas sería inventarse una intención.
      initialCurrencies={{
        retail: [datos.lastBaseCurrency ?? datos.defaultCurrency],
        wholesale: [datos.lastBaseCurrency ?? datos.defaultCurrency],
      }}
      supplierSuggestions={datos.supplierSuggestions}
      lastCostCurrency={datos.lastCostCurrency}
    />
  );
}
