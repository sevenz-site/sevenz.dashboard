import { redirect, notFound } from "next/navigation";
import { CodigoDeTransaccion } from "@/components/dashboard/codigo-de-transaccion";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { SetupNotice } from "@/components/setup-notice";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DetalleDeTransaccion } from "@/components/dashboard/detalle-de-transaccion";
import { DetalleAcciones, DetalleBotones } from "@/components/dashboard/detalle-acciones";
import { getOwnerRateContextResult } from "@/lib/exchange-rate/owner-rate";
import { getBolivarRates } from "@/lib/products/catalog";
import type { SaleLineRow } from "@/lib/sale-lines";
import { formatBalanceSummary, type LedgerDisplay } from "@/lib/exchange-rate/movement-display";
import type { DatosParaCompartir } from "@/lib/share-balance";
import type { FiadoAbierto } from "@/components/dashboard/tarjeta-de-fiado";
import type { AbonoDirigido } from "@/components/dashboard/tarjeta-de-abono";
import type { BolivarRates } from "@/lib/products/price";
import type { LedgerCurrency, Movement } from "@/lib/types";
import { ScreenTitle } from "@/components/dashboard/screen-chrome";
import { IconoVolver } from "@/components/dashboard/screen-chrome";

export const metadata = { title: "Detalle de transacción — Sevenz" };

// EL DETALLE DE UNA TRANSACCIÓN, PARA EL DUEÑO — frames `1465:18349` (abono) y
// `1463:18100` (fiado).
//
// Era un diálogo hasta el 2026-10-19; el cuerpo y el porqué del cambio están en
// `detalle-de-transaccion.tsx`. Aquí viven solo las dos cosas que son de esta
// superficie: de dónde salen los datos, y qué acciones hay arriba.
// Las líneas de la venta de la que nació un movimiento, SOLO LAS DE SU MONEDA.
//
// ===========================================================================
// EL FILTRO POR MONEDA ES EL ARREGLO DE UN FALLO REPORTADO, no una precaución
//
// Esta función seleccionaba `name, quantity, unit_price` y **dejaba fuera
// `currency`**, que la columna sí tiene desde la `124`. Luego la pantalla
// formateaba cada línea con la moneda del MOVIMIENTO, así que una venta mixta
// --unos productos en dólares, otros en euros-- salía entera como si fuera de
// una sola.
//
// Lo reportó el dueño el 2026-10-20 con una captura. Confirmado contra dev:
// guardado estaban «Casco 2 × 40,57 EUR» y «Lapicero 10 × 1,00 USD», y la
// pantalla enseñaba «Lapicero 10 × €1,00» y sumaba los diez dólares a lo
// abonado en euros. El total final salía bien por casualidad: esa cifra viene
// del movimiento, no de la suma de arriba.
//
// UNA VENTA MIXTA SON DOS FILAS INDEPENDIENTES en el historial --decisión del
// dueño el 2026-10-20-- así que la ficha de un movimiento enseña SOLO su
// moneda. La parte en la otra moneda tiene su propia fila y su propia
// pantalla; aquí no se anida ni se menciona.
//
// `moneda` nula es un negocio colombiano: un solo libro, y las líneas se
// guardan con `currency` nulo. El filtro lo respeta.
async function lineasDe(
  supabase: SupabaseClient,
  saleId: string | null,
  moneda: LedgerCurrency | null,
): Promise<SaleLineRow[]> {
  if (!saleId) return [];
  const { data } = await supabase
    .from("sale_lines")
    .select("name, quantity, unit_price, currency")
    .eq("sale_id", saleId);
  return (data ?? [])
    .filter((l) => (l.currency ?? null) === moneda)
    .map((l) => ({
      name: l.name as string,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unit_price),
    }));
}

export default async function TransaccionPage({
  params,
  searchParams,
}: {
  params: Promise<{ movementId: string }>;
  // `?abono=<id>` — cuál de las tarjetas de abono se vino a ver. Lo manda la
  // fila del historial desde el 2026-10-22, porque esa fila abre el FIADO.
  searchParams: Promise<{ abono?: string }>;
}) {
  if (!isSupabaseConfigured()) return <SetupNotice />;

  const { movementId } = await params;
  // `?abono=` YA NO MARCA NADA: desde el 2026-10-23 la fila de un abono
  // abre su propia ficha, así que nadie llega aquí con ese parámetro. Se
  // sigue aceptando en la URL —hay enlaces compartidos con él— y se
  // ignora, que es lo que hace que no rompan.
  await searchParams;
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
  const productos = await lineasDe(supabase, m.sale_id, m.currency);

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
      const lineas = await lineasDe(supabase, f.sale_id as string | null, f.currency as LedgerCurrency | null);
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
  let abonoInicial = 0;
  let pendienteDelFiado: number | null = null;
  let abonosRecibidos: AbonoDirigido[] | undefined;
  if (m.type === "charge") {
    const { data: abiertos } = await supabase.rpc("get_open_charges_for_client", {
      p_client_id: cliente.id,
    });
    const abierto = ((abiertos ?? []) as { movement_id: string; pending: number }[]).find(
      (c) => c.movement_id === m.id,
    );
    puedePagar = abierto != null && Number(abierto.pending) > 0.005;

    // ── «TOTAL POR COBRAR» DE UN FIADO ES LO QUE ESE FIADO DEBE ─────────
    //
    // No `running_balance`, que es el saldo del CLIENTE justo después de este
    // movimiento y no se mueve cuando llegan abonos posteriores.
    //
    // SE VIO EL 2026-10-20, en cuanto la tarjeta empezó a listar los abonos:
    // un fiado de $85 con un abono de $42,50 listado encima decía «Total por
    // cobrar $85.00». La tarjeta se contradecía a sí misma, y quien rehiciera
    // la cuenta a mano creería que el abono no se guardó.
    //
    // Sale de `get_open_charges_for_client`, la MISMA función que alimenta el
    // tope del abono y la tarjeta «Abonó a». Un fiado saldado no sale de esa
    // lista y su pendiente es cero, que es lo correcto.
    pendienteDelFiado = abierto == null ? 0 : Number(abierto.pending);

    // EL ABONO PARCIAL DEL MOMENTO DE LA VENTA, que es lo que el frame llama
    // «Abonó» en un fiado (`1463:18100`, nodo `1463:18127`).
    //
    // VIVE EN `sale_payments` Y NO EN `movements`: la migración `124` escribe
    // el cargo por LO QUE QUEDA y nunca por el total --«una compra por 10 USD
    // puede abonar 5 y quedar debiendo 5», palabras del dueño--, así que lo
    // que pagó en el momento no está en el movimiento.
    //
    // CERO CUANDO NO HUBO NINGUNO, y se dibuja: instrucción del dueño el
    // 2026-10-20. Un fiado sin venta detrás --todo lo anterior a la `124` y lo
    // que entra por la libreta-- también da cero, que es la verdad.
    if (m.sale_id) {
      // POR MONEDA TAMBIÉN, por lo mismo que las líneas: en la venta mixta
      // del 2026-10-20 esto sumaba los 40 dólares de contado al «Abonó» del
      // fiado en euros y lo enseñaba como «€40,00».
      //
      // NORMALIZANDO LOS DOS LADOS, y eso no es cosmética. Hasta el 2026-10-22
      // la comparación era `(p.currency ?? null) === m.currency`, que para un
      // negocio COLOMBIANO compara `'COP'` contra `null` y no casa nunca:
      // `sale_payments` escribe el libro colombiano como 'COP' y `movements`
      // lo escribe NULL. Resultado medido en dev: un fiado de 16.000 con
      // 8.000 entregados al comprar enseñaba «Abonó $0» al tendero, mientras
      // su cliente veía los 8.000 en el enlace compartido. Dinero real
      // contradiciéndose entre las dos pantallas del mismo fiado.
      //
      // `?? "COP"` es la misma normalización que usa `get_shared_balance`
      // para las líneas de la venta (migración 139) y que `qa:currency`
      // vigila desde el 2026-09-11. Y conserva intacto el arreglo del
      // 2026-10-20: en Venezuela 'USD' y 'EUR' siguen sin casar entre sí.
      //
      // Lo vigila `qa:colombia`, filas 5 y 6.
      const { data: pagos } = await supabase
        .from("sale_payments")
        .select("amount, currency")
        .eq("sale_id", m.sale_id);
      abonoInicial = (pagos ?? [])
        .filter((p) => (p.currency ?? "COP") === (m.currency ?? "COP"))
        .reduce((suma, p) => suma + Number(p.amount), 0);
    }

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
      .select("id, created_at, currency, amount, description, exchange_rate_used, entry_currency, entry_amount, transaction_code")
      .eq("client_id", cliente.id)
      .eq("applies_to_movement_id", m.id)
      .eq("type", "payment")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    abonosRecibidos = (pagos ?? []).map((p) => ({
      movementId: p.id as string,
      fecha: p.created_at as string,
      currency: p.currency as AbonoDirigido["currency"],
      // La tasa que ESE abono selló, para su línea «Bs. … al día del abono».
      tasaSellada: p.exchange_rate_used == null ? null : Number(p.exchange_rate_used),
      // El código de su transacción, para el pie de la tarjeta. Ver
      // `transactionCode` en `tarjeta-de-abono.tsx`.
      transactionCode: (p.transaction_code as string | null) ?? null,
      // En qué moneda se tecleó y cuánto. El diálogo de editar que los pedía
      // se quitó el 2026-10-23, pero siguen haciendo falta: el menú del «⋮»
      // los usa para decir «la deuda vuelve a subir Bs. 900» en la moneda en
      // que el tendero escribió, no en la del libro.
      entryCurrency: (p.entry_currency ?? null) as AbonoDirigido["entryCurrency"],
      entryAmount: p.entry_amount == null ? null : Number(p.entry_amount),
      amount: Number(p.amount),
      descripcion: (p.description as string | null) ?? null,
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
            <IconoVolver className="text-primary" />
          </Link>
        </Button>
        <DetalleAcciones
          movementId={m.id}
          clientId={cliente.id}
          compartir={compartir}
          puedePagar={puedePagar}
          // CUÁNTOS ABONOS COLGARÍAN DE ESTE FIADO AL BORRARLO. Decide si el
          // diálogo de confirmación pregunta qué hacer con ellos. Ya está
          // calculado arriba para la propia ficha, así que no cuesta otra
          // consulta; `?? []` cubre el caso de un abono, donde no se pide.
          abonosDirigidos={(abonosRecibidos ?? []).length}
        />
      </div>

      <ScreenTitle>Detalle de transacción</ScreenTitle>
      <CodigoDeTransaccion codigo={(m.transaction_code as string | null) ?? null} />

      <DetalleDeTransaccion
        // Cada tarjeta de «Abonos relacionados» abre la ficha de ese abono.
        hrefDeUnAbono={(id) => `/transacciones/${id}`}
        type={m.type}
        amount={Number(m.amount)}
        currency={m.currency}
        description={m.description}
        ownerNote={m.owner_note}
        plazoDias={m.plazo_dias}
        cuotas={m.cuotas}
        productos={productos}
        createdAt={m.created_at}
        runningBalance={pendienteDelFiado ?? Number(m.running_balance)}
        photoUrl={photoUrl}
        entryCurrency={m.entry_currency}
        entryAmount={m.entry_amount == null ? null : Number(m.entry_amount)}
        exchangeRateUsed={m.exchange_rate_used == null ? null : Number(m.exchange_rate_used)}
        ledger={ledger}
        fiadoAplicado={fiadoAplicado}
        // APUNTABA A UNO Y NO SE ENCONTRÓ = se borró. La consulta de arriba
        // filtra por `deleted_at is null`, así que «no está» y «está borrado»
        // son lo mismo aquí.
        fiadoBorrado={m.type === "payment" && m.applies_to_movement_id != null && fiadoAplicado == null}
        hrefDelFiado={fiadoAplicado ? `/transacciones/${fiadoAplicado.movementId}` : null}
        abonosRecibidos={abonosRecibidos}
        abonoInicial={abonoInicial}
        rates={rates}
        // ESTA PANTALLA ES DEL DUEÑO: sus tarjetas de abono llevan el «⋮» con
        // «Editar abono» y «Eliminar abono». La del cliente pasa `false`.
        conAcciones
      />

      {/* LOS BOTONES DEL FRAME, FUERA DEL «⋮» Y REPETIDOS A PROPÓSITO.
          Instrucción del dueño el 2026-10-20: *«te dije que se redundaban, en
          el caso del fiado se ven los botones "Compartir" y "Pagar" también
          fuera del botón more y en el caso de abono solo se ve el botón
          "Compartir"»*.

          O SEA QUE LA REDUNDANCIA ES LA DECISIÓN, no un descuido: las mismas
          acciones están arriba en el menú y abajo como botones. Frames
          `1463:18100` (fiado: los dos) y `1465:18349` (abono: solo
          «Compartir»).

          «Pagar» SOLO SI QUEDA ALGO QUE PAGAR, igual que en el menú: el flujo
          rechazaría un fiado saldado con «ese fiado ya está saldado», y
          ofrecerlo sería mandar al tendero a un callejón sin salida. */}
      <DetalleBotones
        movementId={m.id}
        compartir={compartir}
        puedePagar={puedePagar}
      />
    </div>
  );
}
