import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { SetupNotice } from "@/components/setup-notice";
import { NuevaVenta } from "@/components/dashboard/nueva-venta";
import type { OwnerCountry } from "@/lib/types";

export const metadata = { title: "Nueva venta — Sevenz" };

export default async function NuevaVentaPage({
  searchParams,
}: {
  // `?cliente=<id>` LO PONEN DOS SITIOS: el botón de la ficha de un cliente, y
  // «Continuar con venta» de la pantalla de cliente nuevo.
  //
  // SIN ÉL TAMBIÉN SE ENTRA, y esa es la novedad del 2026-10-18: se empieza
  // directamente por el producto y no se pregunta a quién hasta el paso 3, y
  // solo si algo queda fiado. Una venta de contado no necesita cliente.
  searchParams: Promise<{ cliente?: string }>;
}) {
  if (!isSupabaseConfigured()) return <SetupNotice />;

  const { cliente: clienteId } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // LA LISTA PARA EL BUSCADOR DEL PASO 3, el de pago, que es donde se pregunta
  // a quién le queda debiendo. Mismos filtros que la del «agregar movimiento»
  // de Inicio, Clientes y Malas pagas: los ocultos quedan fuera (decisión O2),
  // para que «oculto» signifique lo mismo en todas.
  //
  // EL MOSTRADOR TAMBIÉN QUEDA FUERA, y aquí sí importa: aparecería como un
  // cliente llamado «Mostrador» al que se le puede fiar, que es justo lo que
  // la pantalla de pago prohíbe. Se elige con su propio botón, no buscándolo.
  // (Es la única exclusión que existe hoy: `CT-99` sigue abierto para el resto
  // de las listas.)
  // EL PAÍS DEL NEGOCIO decide las letras del documento (V/E/J o CC/CE/NIT) y
  // el prefijo del WhatsApp en el paso 4, que es donde se puede registrar a un
  // cliente nuevo sin salir de la venta.
  const { data: owner } = await supabase
    .from("owners")
    .select("country")
    .eq("id", user.id)
    .maybeSingle();
  const ownerCountry = (owner?.country as OwnerCountry | null) ?? null;

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
    // Un id que no es suyo no da error ni explicación: entra como si no
    // hubiera traído ninguno, y si la venta acaba teniendo fiado se le
    // preguntará en el pago. Quien pruebe ids al azar no aprende nada de la
    // diferencia.
    if (data) {
      return (
        <NuevaVenta
          clientes={clientes ?? []}
          inicial={{ id: data.id, name: data.name, esMostrador: data.is_walk_in }}
          ownerId={user.id}
          ownerCountry={ownerCountry}
        />
      );
    }
  }

  return (
    <NuevaVenta
      clientes={clientes ?? []}
      inicial={null}
      ownerId={user.id}
      ownerCountry={ownerCountry}
    />
  );
}
