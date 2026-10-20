import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { SetupNotice } from "@/components/setup-notice";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DetalleDeTransaccion } from "@/components/dashboard/detalle-de-transaccion";
import { DetalleAcciones } from "@/components/dashboard/detalle-acciones";
import { getOwnerRateContextResult } from "@/lib/exchange-rate/owner-rate";
import { getBolivarRates } from "@/lib/products/catalog";
import type { SaleLineRow } from "@/lib/sale-lines";
import { formatBalanceSummary, type LedgerDisplay } from "@/lib/exchange-rate/movement-display";
import type { DatosParaCompartir } from "@/lib/share-balance";
import type { FiadoAbierto } from "@/components/dashboard/tarjeta-de-fiado";
import type { AbonoDirigido } from "@/components/dashboard/tarjeta-de-abono";
import type { BolivarRates } from "@/lib/products/price";
import type { Movement } from "@/lib/types";

export const metadata = { title: "Detalle de transacción — Sevenz" };

// EL DETALLE DE UNA TRANSACCIÓN, PARA EL DUEÑO — frames `1465:18349` (abono) y
// `1463:18100` (fiado).
//
// Era un diálogo hasta el 2026-10-19; el cuerpo y el porqué del cambio están en
// `detalle-de-transaccion.tsx`. Aquí viven solo las dos cosas que son de esta
// superficie: de dónde salen los datos, y qué acciones hay arriba.
// Las líneas de la venta de la que nació un movimiento, si nació de una.
// Devuelve lista vacía cuando no hay venta, que es el caso normal de todo lo
// anterior a la migración `124` y de lo que entra por la libreta.
async function lineasDe(supabase: SupabaseClient, saleId: string | null): Promise<SaleLineRow[]> {
  if (!saleId) return [];
  const { data } = await supabase
    .from("sale_lines")
    .select("name, quantity, unit_price")
    .eq("sale_id", saleId);
  return (data ?? []).map((l) => ({
    name: l.name as string,
    quantity: Number(l.quantity),
    unitPrice: Number(l.unit_price),
  }));
}

export default async function TransaccionPage({
  params,
}: {
  params: Promise<{ movementId: string }>;
}) {
  if (!isSupabaseConfigured()) return <SetupNotice />;

  const { movementId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // LA PROPIEDAD SE COMPROBA A TRAVÉS DEL CLIENTE, en código y no solo por RLS.
  // Es la regla de `CLAUDE.md` para toda fila que se toca por un id que llega
  // del navegador, y aquí ese id es toda la dirección de la página.
  const { data: fila } = await supabase
    .from("movements")
    .select("*, clients!inner(id, name, owner_id)")
    .eq("id", movementId)
    .is("deleted_at", null)
    .maybeSingle();

  const cliente = fila?.clients as unknown as { id: string; name: string; owner_id: string } | null;
  if (!fila || !cliente || cliente.owner_id !== user.id) notFound();
  const m = fila as unknown as Movement;

  // ── LA TASA DEL NEGOCIO ──────────────────────────────────────────────
  const resultado = await getOwnerRateContextResult(supabase, user.id);
  const ledger: LedgerDisplay | null =
    resultado.kind === "ve" ? { rate: resultado.context.effectiveRate } : null;
  const rates: BolivarRates | null = ledger ? await getBolivarRates(ledger.rate) : null;

  // ── LA FOTO, FIRMADA ─────────────────────────────────────────────────
  let photoUrl: string | null = null;
  if (m.photo_path) {
    const { data: firmada } = await supabase.storage
      .from("attachments")
      .createSignedUrl(m.photo_path, 60 * 60);
    photoUrl = firmada?.signedUrl ?? null;
  }

  // ── QUÉ SE LLEVÓ EL CLIENTE, si este movimiento nació de una venta ───
  const productos = await lineasDe(supabase, m.sale_id);

  // ── EL FIADO AL QUE FUE ESTE ABONO ───────────────────────────────────
  //
  // Una sola lectura más, y solo cuando hace falta: un cargo no abona a nada, y
  // un abono de antes de la migración `126` no apunta a ninguno.
  let fiadoAplicado: FiadoAbierto | null = null;
  if (m.type === "payment" && m.applies_to_movement_id) {
    const { data: f } = await supabase
      .from("movements")
      .select("id, sale_id, created_at, currency, amount, plazo_dias, cuotas, description")
      .eq("id", m.applies_to_movement_id)
      .eq("client_id", cliente.id)
      .is("deleted_at", null)
      .maybeSingle();

    if (f) {
      // «Debe $X» sale de la MISMA función que alimenta el flujo de abonar. Una
      // cuenta propia aquí acabaría enseñando una cifra distinta de la que el
      // tope del abono acepta.
      const { data: abiertos } = await supabase.rpc("get_open_charges_for_client", {
        p_client_id: cliente.id,
      });
      const abierto = ((abiertos ?? []) as { movement_id: string; pending: number }[]).find(
        (c) => c.movement_id === f.id,
      );
      const lineas = await lineasDe(supabase, f.sale_id as string | null);
      fiadoAplicado = {
        movementId: f.id as string,
        saleId: (f.sale_id as string | null) ?? null,
        fecha: f.created_at as string,
        currency: f.currency as FiadoAbierto["currency"],
        amount: Number(f.amount),
        pending: abierto ? Number(abierto.pending) : 0,
        plazoDias: (f.plazo_dias as number | null) ?? null,
        cuotas: (f.cuotas as number | null) ?? null,
        productos: lineas.map((l) => l.name),
        descripcion: (f.description as string | null) ?? null,
      };
    }
  }

  // ── PUEDE PAGARSE ESTE FIADO, Y QUÉ SE LE HA ABONADO ─────────────────
  //
  // Las dos preguntas son del mismo movimiento y solo tienen sentido en un
  // cargo, así que comparten el `if`.
  let puedePagar = false;
  let abonosRecibidos: (AbonoDirigido & { href: string })[] | undefined;
  if (m.type === "charge") {
    const { data: abiertos } = await supabase.rpc("get_open_charges_for_client", {
      p_client_id: cliente.id,
    });
    const abierto = ((abiertos ?? []) as { movement_id: string; pending: number }[]).find(
      (c) => c.movement_id === m.id,
    );
    puedePagar = abierto != null && Number(abierto.pending) > 0.005;

    // LOS ABONOS DIRIGIDOS A ESTE FIADO. Encargo del dueño el 2026-10-20.
    //
    // `eq("client_id", cliente.id)` NO SOBRA aunque ya sepamos de quién es el
    // movimiento: `applies_to_movement_id` es una FK suelta a `movements (id)`
    // (migración `124`) y nada la obliga a apuntar dentro del mismo cliente,
    // así que sin este filtro una fila cruzada traería aquí el abono de otra
    // persona. Es la regla de `CLAUDE.md`: la RLS es el respaldo, no la única
    // defensa.
    //
    // DEL MÁS NUEVO AL MÁS VIEJO: aquí la pregunta es «qué se ha pagado
    // últimamente», y el último abono es el que se viene a comprobar.
    const { data: pagos } = await supabase
      .from("movements")
      .select("id, created_at, currency, amount, description")
      .eq("client_id", cliente.id)
      .eq("applies_to_movement_id", m.id)
      .eq("type", "payment")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    abonosRecibidos = (pagos ?? []).map((p) => ({
      movementId: p.id as string,
      fecha: p.created_at as string,
      currency: p.currency as AbonoDirigido["currency"],
      amount: Number(p.amount),
      descripcion: (p.description as string | null) ?? null,
      href: `/transacciones/${p.id as string}`,
    }));
  }

  // ── CON QUÉ SE COMPARTE ──────────────────────────────────────────────
  const { data: resumen } = await supabase
    .from("client_summary")
    .select("balance, balance_usd, balance_eur")
    .eq("client_id", cliente.id)
    .maybeSingle();
  const compartir: DatosParaCompartir = {
    clientName: cliente.name,
    balanceText: formatBalanceSummary(
      Number(resumen?.balance ?? 0),
      Number(resumen?.balance_usd ?? 0),
      Number(resumen?.balance_eur ?? 0),
      ledger,
    ),
    enlace: { de: "dueño", clientId: cliente.id },
  };

  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* LA BARRA DE ARRIBA DEL FRAME: flecha a la izquierda, «⋮» a la derecha.
          NO ES `ScreenBackRow`: ese componente usa `children` para SUSTITUIR la
          flecha, no para poner algo a su lado, así que no sabe dibujar una fila
          con dos extremos. Se escribe aquí con sus mismas clases.

          Sin `sm:hidden`, y es deliberado: `app-header.tsx` esconde la barra de
          la app en todo `/transacciones` a TODAS las anchuras, así que si esta
          se escondiera a partir de `sm` la pantalla se quedaría sin ninguna
          salida. */}
      <div className="sticky top-0 z-20 -mx-4 -mt-4 flex items-center justify-between border-b bg-background px-4 py-3">
        <Button variant="ghost" size="icon" asChild className="-ml-2">
          <Link href={`/clients/${cliente.id}`} aria-label={`Volver a ${cliente.name}`}>
            <ChevronLeft className="size-5" aria-hidden="true" />
          </Link>
        </Button>
        <DetalleAcciones
          movementId={m.id}
          clientId={cliente.id}
          compartir={compartir}
          puedePagar={puedePagar}
        />
      </div>

      <h1 className="text-2xl leading-8 font-normal">Detalle de transacción</h1>

      <DetalleDeTransaccion
        type={m.type}
        amount={Number(m.amount)}
        currency={m.currency}
        description={m.description}
        ownerNote={m.owner_note}
        plazoDias={m.plazo_dias}
        cuotas={m.cuotas}
        productos={productos}
        createdAt={m.created_at}
        runningBalance={Number(m.running_balance)}
        photoUrl={photoUrl}
        entryCurrency={m.entry_currency}
        entryAmount={m.entry_amount == null ? null : Number(m.entry_amount)}
        exchangeRateUsed={m.exchange_rate_used == null ? null : Number(m.exchange_rate_used)}
        ledger={ledger}
        fiadoAplicado={fiadoAplicado}
        hrefDelFiado={fiadoAplicado ? `/transacciones/${fiadoAplicado.movementId}` : null}
        abonosRecibidos={abonosRecibidos}
        rates={rates}
      />
    </div>
  );
}
