import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { SetupNotice } from "@/components/setup-notice";
import { NuevaVenta } from "@/components/dashboard/nueva-venta";

export const metadata = { title: "Nueva venta — Sevenz" };

// EL NOMBRE DEL CLIENTE COMODÍN, y vive aquí y no en la base por una razón:
// es texto que el tendero lee, así que cambiarlo es cambiar una palabra en un
// archivo, no una migración sobre filas de 24 negocios.
const NOMBRE_MOSTRADOR = "Mostrador";

export default async function NuevaVentaPage({
  searchParams,
}: {
  // `?cliente=<id>` LO PONE EL BOTÓN «Venta o fiado» de la ficha del cliente,
  // que es de donde el sitemap hace salir este asistente. Sin él, la venta es
  // de mostrador.
  searchParams: Promise<{ cliente?: string }>;
}) {
  if (!isSupabaseConfigured()) return <SetupNotice />;

  const { cliente: clienteId } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // EL CLIENTE SE COMPRUEBA CONTRA EL DUEÑO DE LA SESIÓN, explícitamente y no
  // solo por RLS. Es la regla de `CLAUDE.md` para toda lectura por un id que
  // llega del navegador, y aquí decide a nombre de quién va a quedar una
  // deuda: un id ajeno que colara pondría la venta en la cuenta de otro.
  if (clienteId) {
    const { data } = await supabase
      .from("clients")
      .select("id, name")
      .eq("id", clienteId)
      .eq("owner_id", user.id)
      .is("trashed_at", null)
      .maybeSingle();
    // Un id que no es suyo no da error ni explicación: cae en la venta de
    // mostrador, igual que si no hubiera traído ninguno. Quien pruebe ids al
    // azar no aprende nada de la diferencia.
    if (data) return <NuevaVenta cliente={data} esMostrador={false} />;
  }

  // ── EL CLIENTE MOSTRADOR ────────────────────────────────────────────
  //
  // SE CREA AQUÍ Y NO EN LA MIGRACIÓN `124`, a propósito: crear 24 filas para
  // negocios que quizá nunca hagan una venta de mostrador son 24 filas que
  // alguien tiene que explicar después. Nace la primera vez que hace falta.
  //
  // EL ÍNDICE ÚNICO PARCIAL ES QUIEN DE VERDAD GARANTIZA QUE HAYA UNO SOLO.
  // Dos pestañas abriendo esta pantalla a la vez pasarían las dos por el
  // `maybeSingle` de abajo sin encontrar nada y las dos intentarían crearlo;
  // la segunda falla en la base, y entonces se vuelve a leer. Sin ese
  // segundo intento, una de las dos pestañas se quedaría sin mostrador por
  // una carrera que dura milisegundos y pasa una vez al año.
  const existente = await supabase
    .from("clients")
    .select("id, name")
    .eq("owner_id", user.id)
    .eq("is_walk_in", true)
    .maybeSingle();
  if (existente.data) return <NuevaVenta cliente={existente.data} esMostrador />;

  const creado = await supabase
    .from("clients")
    .insert({ owner_id: user.id, name: NOMBRE_MOSTRADOR, is_walk_in: true })
    .select("id, name")
    .maybeSingle();
  if (creado.data) return <NuevaVenta cliente={creado.data} esMostrador />;

  const segundaLectura = await supabase
    .from("clients")
    .select("id, name")
    .eq("owner_id", user.id)
    .eq("is_walk_in", true)
    .maybeSingle();
  if (segundaLectura.data) return <NuevaVenta cliente={segundaLectura.data} esMostrador />;

  // NI CON LAS DOS: aquí ya no es una carrera, es que algo falla de verdad.
  // El detalle real al log y una frase que no cuenta la forma de la base.
  console.error("[nuevaVenta] no se pudo resolver el cliente mostrador:", creado.error?.message);
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-xl font-semibold">No pudimos abrir la venta</h1>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Vuelve a intentarlo en un momento. Si sigue pasando, escríbenos.
      </p>
    </main>
  );
}
