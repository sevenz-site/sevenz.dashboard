import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { SetupNotice } from "@/components/setup-notice";
import { NuevaVenta } from "@/components/dashboard/nueva-venta";
import { getOwnerRateContext } from "@/lib/exchange-rate/owner-rate";
import type { ClientSummary, OwnerCountry } from "@/lib/types";

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

  // DE `client_summary` Y NO DE `clients`, desde el 2026-10-18: la tarjeta del
  // paso 4 es la MISMA que la de Clientes (frame `1411:12272`), y esa enseña
  // documento, estado y saldo. Con `id, name` a secas no se puede pintar.
  //
  // `is_walk_in` NO ESTÁ EN LA VISTA, así que el mostrador se quita con la
  // lista de ids de abajo en vez de con un filtro. Aparecería como un cliente
  // llamado «Mostrador» al que se le puede fiar, que es justo lo que el paso 3
  // prohíbe; se llega a él sin elegirlo, con el botón de finalizar.
  const [{ data: comodin }, rateContext] = await Promise.all([
    supabase.from("clients").select("id").eq("owner_id", user.id).eq("is_walk_in", true),
    getOwnerRateContext(supabase, user.id),
  ]);
  const idsComodin = new Set((comodin ?? []).map((c) => c.id as string));

  const { data: filas } = await supabase
    .from("client_summary")
    .select("*")
    .eq("owner_id", user.id)
    .order("name");
  const clientes = ((filas ?? []) as ClientSummary[]).filter((c) => !idsComodin.has(c.client_id));

  // EL CLIENTE SE COMPRUEBA CONTRA EL DUEÑO DE LA SESIÓN, explícitamente y no
  // solo por RLS. Es la regla de `CLAUDE.md` para toda lectura por un id que
  // llega del navegador, y aquí decide a nombre de quién va a quedar una
  // deuda: un id ajeno que colara pondría la venta en la cuenta de otro.
  if (clienteId) {
    const { data } = await supabase
      .from("clients")
      // `is_flagged` DESDE EL 2026-10-27: es lo que decide si al fiarle se
      // pregunta antes. Entrando por aquí --desde la ficha del cliente-- no
      // hay paso de elegir cliente, así que esta consulta es la ÚNICA que
      // puede traer la marca.
      .select("id, name, is_walk_in, is_flagged")
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
          clientes={clientes}
          inicial={{
            id: data.id,
            name: data.name,
            esMostrador: data.is_walk_in,
            marcada: data.is_flagged === true,
          }}
          ownerId={user.id}
          ownerCountry={ownerCountry}
          rateContext={rateContext}
        />
      );
    }
  }

  return (
    <NuevaVenta
      clientes={clientes}
      inicial={null}
      ownerId={user.id}
      ownerCountry={ownerCountry}
      rateContext={rateContext}
    />
  );
}
