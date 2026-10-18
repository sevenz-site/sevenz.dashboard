import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { SetupNotice } from "@/components/setup-notice";
import { NuevaVenta } from "@/components/dashboard/nueva-venta";

export const metadata = { title: "Nueva venta — Sevenz" };

export default async function NuevaVentaPage({
  searchParams,
}: {
  // `?cliente=<id>` LO PONE EL BOTÓN «Venta o fiado» de la ficha del cliente.
  // Sin él se entra por el paso 1, que es lo que abre el «Agregar» de Inicio
  // desde el 2026-10-18, y ahí el tendero elige a quién le vende.
  searchParams: Promise<{ cliente?: string }>;
}) {
  if (!isSupabaseConfigured()) return <SetupNotice />;

  const { cliente: clienteId } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // LA LISTA PARA EL BUSCADOR DEL PASO 1. Mismos filtros que la del «agregar
  // movimiento» de Inicio, Clientes y Malas pagas: los ocultos quedan fuera
  // (decisión O2), para que «oculto» signifique lo mismo en todas.
  //
  // EL MOSTRADOR TAMBIÉN QUEDA FUERA, y aquí sí importa: aparecería como un
  // cliente llamado «Mostrador» al que se le puede fiar, que es justo lo que
  // la pantalla de pago prohíbe. Se elige con su propio botón, no buscándolo.
  // (Es la única exclusión que existe hoy: `CT-99` sigue abierto para el resto
  // de las listas.)
  const { data: clientes } = await supabase
    .from("clients")
    .select("id, name")
    .eq("owner_id", user.id)
    .is("trashed_at", null)
    .is("deleted_at", null)
    .eq("is_walk_in", false)
    .order("name");

  // EL CLIENTE SE COMPRUEBA CONTRA EL DUEÑO DE LA SESIÓN, explícitamente y no
  // solo por RLS. Es la regla de `CLAUDE.md` para toda lectura por un id que
  // llega del navegador, y aquí decide a nombre de quién va a quedar una
  // deuda: un id ajeno que colara pondría la venta en la cuenta de otro.
  if (clienteId) {
    const { data } = await supabase
      .from("clients")
      .select("id, name, is_walk_in")
      .eq("id", clienteId)
      .eq("owner_id", user.id)
      .is("trashed_at", null)
      .maybeSingle();
    // Un id que no es suyo no da error ni explicación: cae en el paso 1 con el
    // buscador, igual que si no hubiera traído ninguno. Quien pruebe ids al
    // azar no aprende nada de la diferencia.
    if (data) {
      return (
        <NuevaVenta
          clientes={clientes ?? []}
          inicial={{ id: data.id, name: data.name, esMostrador: data.is_walk_in }}
        />
      );
    }
  }

  return <NuevaVenta clientes={clientes ?? []} inicial={null} />;
}
