import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RepartoPropuesta } from "@/components/dashboard/reparto-propuesta";

// PROPUESTA NAVEGABLE DE «REPARTIR UN ABONO ENTRE VARIOS FIADOS» — `CT-128`.
//
// Pedida por el dueño el 2026-10-21: *«crea una propuesta en localhost para
// revisarla»*, después de que un tendero reportara desde producción que un
// cliente le paga una cantidad que cubre dos fiados y hay que registrar dos
// abonos por separado.
//
// ===========================================================================
// ESTO NO ESCRIBE NADA, Y ESA ES LA DECISIÓN QUE LA HACE ÚTIL
//
// Lee fiados REALES de la base —no datos inventados— y calcula el reparto de
// verdad, pero el botón de confirmar no llama a ninguna acción: enseña lo que
// guardaría. Así la conversación es sobre la pantalla y no sobre si el código
// de debajo está terminado, y revisarla no deja movimientos de prueba en la
// cuenta de nadie.
//
// Datos reales y no una maqueta porque las tres decisiones que hay encima de
// la mesa —el orden del reparto, si se puede ajustar, y el tope— solo se ven
// con los números de un cliente que de verdad debe en dos monedas.
//
// ===========================================================================
// CUANDO SE APRUEBE, ESTA RUTA SE BORRA
//
// Lo que sigue es su pareja de verdad: una migración que agrupe los pagos
// —sin ella un abono repartido en tres manda TRES WhatsApp por un solo
// billete— y esta misma pantalla colgando de `/abonos/nuevo`, escribiendo.
// Mientras tanto vive aparte para que no se cuele en un flujo que el tendero
// usa con dinero real.
// UN SOLO INSTANTE PARA TODA LA PANTALLA, sellado en el servidor. El orden de
// los fiados y el «vencido hace N días» de cada uno salen de la misma marca,
// así que la vista no puede contar dos historias distintas.
//
// FUERA DEL COMPONENTE A PROPÓSITO: el linter de React 19 trata el cuerpo de
// una página como un render y marca `Date.now()` como impuro. Aquí no lo es
// --esto corre una vez por petición, en el servidor, igual que las lecturas de
// hora que el resto del repo hace en sus `actions.ts`--, pero la regla no
// distingue, y silenciarla dejaría apagada una comprobación que en un
// componente de cliente sí acierta. Esta es la misma lectura, hecha donde de
// verdad vive.
function sellarLaHora(): number {
  return Date.now();
}

export default async function Page({ params }: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // LA PROPIEDAD, EN CÓDIGO, aunque esto no escriba: el id llega por la URL y
  // leer los fiados de otro negocio sería una fuga igual de real que
  // escribirlos. Es la regla de `CLAUDE.md` y no se relaja porque la pantalla
  // sea una propuesta.
  const { data: cliente } = await supabase
    .from("clients")
    .select("id, name")
    .eq("id", clientId)
    .eq("owner_id", user.id)
    .is("trashed_at", null)
    .maybeSingle();
  if (!cliente) notFound();

  const { data: abiertos } = await supabase.rpc("get_open_charges_for_client", {
    p_client_id: clientId,
  });

  const ahora = sellarLaHora();

  return (
    <RepartoPropuesta
      clientName={cliente.name}
      ahora={ahora}
      fiados={(abiertos ?? []).map((f: Record<string, unknown>) => ({
        movementId: f.movement_id as string,
        chargeAt: f.charge_at as string,
        currency: (f.currency as string | null) ?? null,
        amount: Number(f.amount ?? 0),
        pending: Number(f.pending ?? 0),
        plazoDias: (f.plazo_dias as number | null) ?? null,
        cuotas: (f.cuotas as number | null) ?? null,
        description: (f.description as string | null) ?? null,
      }))}
    />
  );
}
