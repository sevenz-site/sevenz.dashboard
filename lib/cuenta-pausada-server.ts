import { createClient } from "@/lib/supabase/server";

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

// FOR THE DOOR OF A FLOW (the layouts of migration 170's phase): is the
// signed-in owner blocked? With no session it answers false and lets the page
// do what it already does without one -- this is a sign, not a gate.
export async function sesionPausada(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  return !(await puedeEscribir(supabase, user.id));
}

export type MotivoDeBloqueo = "bloqueada" | "prueba_vencida" | "pago_vencido";

// WHY the signed-in owner cannot write, or null if they can (migration 171).
// The layout uses it so the dialog can say «tu prueba terminó» instead of only
// «cuenta pausada».
//
// IF THE FUNCTION IS NOT THERE YET -- the code reached production before the
// migration -- it falls back to `puedeEscribir`, and a block reads as a manual
// one. Same reasoning as above: this is the sign, not the lock.
export async function motivoDeBloqueo(
  supabase: SupabaseServerClient,
  ownerId: string,
): Promise<MotivoDeBloqueo | null> {
  const { data, error } = await supabase.rpc("mi_motivo_de_bloqueo");
  if (!error) {
    return data === "bloqueada" || data === "prueba_vencida" || data === "pago_vencido" ? data : null;
  }
  return (await puedeEscribir(supabase, ownerId)) ? null : "bloqueada";
}
