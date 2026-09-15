import type { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// ¿Puede escribir este negocio? Para la APP del tendero, no para /admin.
//
// Vive aquí y no en lib/admin/subscriptions.ts porque ese archivo importa el
// cliente de service_role, y esto lo llama cada acción que escribe. No hay
// razón para que el código del tendero arrastre la llave maestra de la
// plataforma solo para preguntar si su propia cuenta está al día.
//
// Lee la misma función de Postgres que aplican las políticas de la 061, en vez
// de consultar `subscriptions` por su cuenta. Dos lecturas de la misma regla se
// separan: el día que el bloqueo signifique algo más, la pantalla seguiría
// diciendo lo de antes y el tendero vería un formulario que no puede guardar.
//
// Ante cualquier fallo devuelve true. Un error de red no puede dejar a un
// tendero al día sin poder anotar un fiado que ya hizo — y si de verdad está
// bloqueado, la política lo para igual. Esto es el cartel, no la cerradura.
export async function puedeEscribir(
  supabase: SupabaseServerClient,
  ownerId: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("owner_puede_escribir", { p_owner: ownerId });
  if (error) return true;
  return data !== false;
}
