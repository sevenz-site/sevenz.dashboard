import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { SetupNotice } from "@/components/setup-notice";
import { NewClientForm } from "@/components/dashboard/new-client-form";
import type { OwnerCountry } from "@/lib/types";

export const metadata = { title: "Nuevo cliente — Sevenz" };

// `/clients/nuevo` Y NO `/clientes/nuevo`, aunque las rutas de este producto
// se escriban en castellano por ser cosa que el usuario lee: ya existe
// `/clients` y `/clients/[id]`, y dos grafías del mismo sustantivo en la misma
// app son peores que una ruta en inglés. Renombrar las que ya están en
// producción cuesta más que la inconsistencia (decisión del 2026-09-17).
//
// UN SEGMENTO FIJO GANA AL DINÁMICO en Next, así que esto no lo intercepta
// `[id]` y nadie acaba buscando un cliente llamado «nuevo».
//
// Y DE AQUÍ SALE GRATIS ALGO QUE EL FRAME PIDE: `MobileNav` se esconde entera
// en todo lo que empieza por `/clients/`, así que esta pantalla no lleva barra
// abajo — que es exactamente como está dibujada. Es un efecto secundario, no
// un descuido: si algún día esa condición cambia, esta pantalla gana una barra
// que su maquetación no reserva.
export default async function NuevoClientePage() {
  if (!isSupabaseConfigured()) return <SetupNotice />;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // EL PAÍS DEL NEGOCIO decide qué letras ofrece el selector de documento:
  // V/E/J en Venezuela, CC/CE/NIT en Colombia (migración 125). Si no se sabe,
  // `DocumentIdInput` no pinta selector — elegir a ciegas guardaría una «V» en
  // la cédula de un colombiano.
  const { data: owner } = await supabase
    .from("owners")
    .select("country")
    .eq("id", user.id)
    .maybeSingle();

  // LA TASA YA NO HACE FALTA AQUÍ: la hoja de la cuenta duplicada se fue el
  // 2026-10-18 y en su lugar hay un enlace que navega a la ficha del cliente,
  // que trae la suya.
  // `ownerId` para la foto de la deuda antigua: se sube a la carpeta del dueño
  // en `attachments`, que es la única ruta que el servidor acepta.
  return (
    <NewClientForm ownerCountry={(owner?.country as OwnerCountry | null) ?? null} ownerId={user.id} />
  );
}
