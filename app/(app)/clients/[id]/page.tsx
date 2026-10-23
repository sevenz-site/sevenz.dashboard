import { Suspense } from "react";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AddMovementDialog } from "@/components/dashboard/add-movement-dialog";
import { ClientDetailHeader } from "@/components/dashboard/client-detail-header";
import { ClientFlagControl } from "@/components/dashboard/client-flag-control";
import { CreditScoreRadialChart } from "@/components/dashboard/credit-score-radial-chart";
import { MovementHistoryList } from "@/components/dashboard/movement-history-list";
import { claveDeFila, filasDeContado, type VentaDeContado } from "@/lib/ventas-de-contado";
import { estadoDelFiado, type EstadoDelPlazo } from "@/lib/estado-del-plazo";
import { ExchangeRateBalanceDisplay } from "@/components/exchange-rate-balance-display";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import type { PriceCurrency } from "@/lib/products/price";
import { OwnerUnavailableDialog } from "@/components/owner-unavailable-dialog";
import { readOwnerCountry } from "@/lib/owner-country";
import { computeCreditScore } from "@/lib/credit-score";
import { CLIENT_ORIGINS, clientOriginFrom } from "@/lib/client-origin";
import { formatDateTime } from "@/lib/format";
import { getOwnerRateContext } from "@/lib/exchange-rate/owner-rate";
import { getMonedaHabitual } from "@/lib/moneda-habitual";
import { combinedBalanceUsd } from "@/lib/exchange-rate/convert";
import { formatBalanceSummary, type LedgerDisplay } from "@/lib/exchange-rate/movement-display";
import type { MovementRateContext } from "@/lib/exchange-rate/convert";
import {
  CLIENT_STATUS_BADGE_CLASS,
  clientStatusLabel,
  CREDIT_SCORE_TIER_BADGE_CLASS,
  MALA_PAGA_BADGE_CLASS,
  getClientStatus,
  type Client,
  type ClientFlag,
  type ClientSummary,
  type Movement,
  type OwnerCountry,
} from "@/lib/types";


export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ movimiento?: string; from?: string }>;
}) {
  const { id } = await params;
  // Which action the mobile bar asked for while this client is on screen. The
  // bar carries "Agregar fiado" / "Agregar abono" on this route, so it marks
  // the URL rather than navigating. Passed to the mobile AddMovementDialog
  // only — the sm+ layout below renders a second instance, and both opening
  // would stack two dialogs.
  const { movimiento, from } = await searchParams;
  const autoOpenType =
    movimiento === "abono" ? ("payment" as const) : movimiento === "fiado" ? ("charge" as const) : undefined;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [
    { data: client },
    { data: summary },
    ownerRate,
    { data: ownerRow },
    { count: movementCount },
    monedaHabitual,
    { data: aceptaAvisos },
  ] =
    await Promise.all([
      supabase.from("clients").select("*").eq("id", id).eq("owner_id", user!.id).maybeSingle(),
      // client_summary_all, not client_summary: this page is reached by id,
      // including from the Papelera, and a hidden client whose balance
      // silently rendered as $0 here would be worse than not opening at all.
      // The filtered view stays the default everywhere a client is *listed*.
      supabase.from("client_summary_all").select("*").eq("client_id", id).maybeSingle(),
      getOwnerRateContext(supabase, user!.id),
      // getOwnerRateContext reads owners.country too, but discards it for a CO
      // owner. Asking again here is cheaper than widening its contract.
      supabase.from("owners").select("country").eq("id", user!.id).maybeSingle(),
      // Si el TELEFONO de este cliente ya acepta avisos -- no la ficha. Decide
      // si el formulario de movimiento ensena la casilla del permiso o solo la
      // linea de estado (MS-34).
      //
      // Es `client_accepts_whatsapp` y no una consulta propia a proposito: es
      // la misma funcion que usara la puerta de envio, y dos predicados que
      // responden "casi" lo mismo acaban discrepando -- y la discrepancia
      // seria mensajes a quien no acepto, o silencio hacia quien si.
      //
      // La 095 le dio `execute` a `authenticated` y le metio dentro la
      // comprobacion de dueno, porque hasta entonces era solo para
      // `service_role` y esta pagina habla con la sesion del tendero.
      // Only ever compared against zero — it decides which of the three
      // "mover a papelera" confirmations the owner sees. head:true so Postgres
      // returns the count without the rows.
      supabase
        .from("movements")
        .select("id", { count: "exact", head: true })
        .eq("client_id", id)
        .is("deleted_at", null),
      // En que moneda escribio la ultima vez, para que el formulario abra ahi.
      // Va la ultima: el orden de este array es el de la linea de arriba.
      getMonedaHabitual(supabase, user!.id),
      supabase.rpc("client_accepts_whatsapp", { p_client_id: id }),
    ]);

  if (!client) notFound();

  // Aquí había un `?? "CO"`. Parecía inofensivo desde que el servidor rechaza
  // en vez de adivinar, pero el efecto era peor de lo que decía su comentario:
  // la pantalla se dibujaba como un negocio colombiano —sin selector de moneda,
  // sin el equivalente en bolívares, con los saldos en formato COP— y el dueño
  // venezolano solo se enteraba al pulsar Guardar, con un mensaje que le pedía
  // elegir una moneda que no estaba en pantalla. Reintentar no lo arreglaba;
  // solo recargar, y eso no se lo decíamos.
  //
  // No saber el país no es saber que es CO. Sin él no se dibuja nada.
  // Si la primera lectura no trajo país, readOwnerCountry lo reintenta antes de
  // rendirse: un parpadeo de red no debería taparle la pantalla a nadie. Y si
  // tampoco así, deja constancia de que este aviso apareció.
  const ownerCountry =
    (ownerRow?.country as OwnerCountry | undefined) ?? (await readOwnerCountry(supabase, user!.id));
  if (!ownerCountry) return <OwnerUnavailableDialog />;

  const rateContext: MovementRateContext | null = ownerRate
    ? {
        rateMode: ownerRate.rateMode,
        effectiveRate: ownerRate.effectiveRate,
        officialRateUsd: ownerRate.officialRate.usd,
        prevista: ownerRate.prevista,
      }
    : null;
  const ledger: LedgerDisplay | null = ownerRate ? { rate: ownerRate.effectiveRate } : null;

  // Where "back" goes, and what a screen reader calls it.
  //
  // Every list links here with `?from=`, so the arrow returns to the screen the
  // owner actually came from — Clientes, Malas pagas, Papelera or Cartera —
  // rather than always dumping them on Cartera. Without it, an owner working
  // through Malas pagas lost their place on every single client they opened.
  //
  // The fallback covers the routes that arrive with no marker: a notification,
  // a shared URL, the search dialog. A client in the Papelera defaults there,
  // since that is the only list they are on; everyone else defaults to Cartera.
  const inPapelera = Boolean(client.trashed_at) && !client.deleted_at;
  const back =
    clientOriginFrom(from) ?? (inPapelera ? CLIENT_ORIGINS.papelera : CLIENT_ORIGINS.cartera);
  const backHref = back.href;
  const backLabel = back.label;

  const clientSummary = summary as ClientSummary | null;
  const balance = clientSummary?.balance ?? 0;
  const balanceUsd = clientSummary?.balance_usd ?? 0;
  const balanceEur = clientSummary?.balance_eur ?? 0;
  // Status/mora/score are one combined judgement per client even when a VE
  // owner tracks two independent balances — converted to USD so they're
  // comparable, per the "uno solo, combinado" decision.
  // El mensaje de «Compartir enlace» del perfil. Lo mandaba también el
  // «Compartir» de la ficha de cada movimiento, que desde el 2026-10-19 vive en
  // la pantalla del detalle y lo arma allí con los mismos datos.
  const balanceText = formatBalanceSummary(balance, balanceUsd, balanceEur, ledger);

  const judgementBalance = ownerRate ? combinedBalanceUsd(balanceUsd, balanceEur, ownerRate.effectiveRate) : balance;
  const status = getClientStatus({
    balance: judgementBalance,
    daysSincePayment: clientSummary?.days_since_payment ?? 0,
    worstChargeAt: clientSummary?.worst_unpaid_charge_at ?? null,
    worstChargePlazoDias: clientSummary?.worst_unpaid_charge_plazo_dias ?? null,
    worstChargeDueAt: clientSummary?.worst_unpaid_charge_due_at ?? null,
  });

  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* LA CABECERA OSCURA, desde el spec del 2026-10-04 (`1082:6047`).

          Se come lo que antes eran dos cosas pegadas: la barra de volver —
          sticky en teléfono, estática desde sm— y la columna centrada con la
          foto, el nombre y los datos de contacto. Ahora es una superficie
          sola, y por eso `app-header.tsx` esconde la barra de la app en esta
          ruta a TODOS los anchos, como ya hacía con las otras cuatro
          pantallas de cabecera oscura.

          El aviso de papelera y el botón de registrar movimiento se quedan
          fuera, debajo: el frame los dibuja fuera del nodo `header`. */}
      <ClientDetailHeader
        aceptaAvisos={aceptaAvisos === true}
        client={client as Client}
        ownerCountry={ownerCountry}
        backHref={backHref}
        backLabel={backLabel}
        balanceText={balanceText}
        // A VE client owes money if either independent balance is positive.
        // The two are never summed — that is what rateContext being non-null
        // means on this page.
        owesMoney={rateContext ? balanceUsd > 0 || balanceEur > 0 : balance > 0}
        hasMovements={(movementCount ?? 0) > 0}
        ownerId={user!.id}
        // LOS DOS BOTONES VIAJAN A LA CABECERA (2026-10-18, mockup del dueño):
        // «cuando se haga scrolldown solo se vea el header oscuro más los
        // botones de registrar abono y fiado». Debajo no se podían pegar — un
        // `sticky` hermano se despega en cuanto la cabecera pasa de largo— así
        // que entran dentro del único elemento sticky de la pantalla.
        //
        // Un cliente en la papelera no acepta movimientos nuevos —addMovement
        // los rechaza en el servidor—, y ofrecer un botón que siempre falla es
        // peor que no ofrecerlo. El aviso de abajo dice cómo recuperarlo.
        acciones={
          client.trashed_at ? null : (
            <AddMovementDialog
              clientId={client.id}
              clientName={client.name}
              clientWhatsapp={client.whatsapp}
              ownerId={user!.id}
              ownerCountry={ownerCountry}
              currentDebtCop={balance}
              currentDebtUsd={balanceUsd}
              currentDebtEur={balanceEur}
              isFlagged={client.is_flagged}
              consentAsked={
                // Migración 093, llega por el select("*") de arriba. Mientras
                // la migración no esté corrida vale undefined, que cae del lado
                // seguro: la casilla se enseña.
                Boolean(client.whatsapp_consent_asked_at)
              }
              consentGranted={aceptaAvisos === true}
              triggerClassName="w-full"
              hrefVentaOFiado={`/ventas/nueva?cliente=${client.id}`}
              hrefAbono={`/abonos/nuevo?cliente=${client.id}`}
              autoOpen={autoOpenType}
              rateContext={rateContext}
              monedaHabitual={monedaHabitual}
            />
          )
        }
      />

      {/* A client reached from the Papelera looks identical to a live one
          otherwise — same name, same balance, same history — and an owner who
          records a payment here would be writing to a client no list shows.
          The banner is the only thing on the page that says which it is. */}
      {client.trashed_at ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          <p className="font-medium">Este cliente está en la papelera</p>
          <p className="text-muted-foreground">
            No aparece en tu Cartera y su saldo no cuenta en los totales. Restáuralo desde el menú
            &ldquo;Más&rdquo; para volver a trabajarlo.
          </p>
        </div>
      ) : null}

      {/* El estado va junto al título de la sección y no dentro de una tarjeta
          de saldo: juzga la cuenta entera, y abajo hay una tarjeta por moneda. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">Por cobrar</h2>
        <div className="flex flex-wrap items-center gap-1">
          <Badge variant="outline" className={CLIENT_STATUS_BADGE_CLASS[status]}>
            {clientStatusLabel(status, clientSummary?.overdue_charge_count ?? null)}
          </Badge>
          {clientSummary?.has_pending_review ? <Badge variant="outline">transacciones por revisar</Badge> : null}
          {client.is_flagged ? (
            <Badge variant="outline" className={MALA_PAGA_BADGE_CLASS}>
              Mala paga
            </Badge>
          ) : null}
        </div>
      </div>

      {rateContext ? (
        <>
          <BalanceRowCard label="Por cobrar Dólares" currency="USD">
            <ExchangeRateBalanceDisplay balance={balanceUsd} currency="USD" ledger={ledger} align="end" />
          </BalanceRowCard>
          <BalanceRowCard label="Por cobrar Euros" currency="EUR">
            <ExchangeRateBalanceDisplay balance={balanceEur} currency="EUR" ledger={ledger} align="end" />
          </BalanceRowCard>
        </>
      ) : (
        <BalanceRowCard label="Por cobrar">
          <ExchangeRateBalanceDisplay balance={balance} currency={null} ledger={null} align="end" />
        </BalanceRowCard>
      )}

      <div className="rounded-lg border bg-muted/30 px-3 py-2">
        <ClientFlagControl
          clientId={client.id}
          clientName={client.name}
          isFlagged={client.is_flagged}
          spread
        />
      </div>

      <Suspense fallback={<CreditScoreSkeleton />}>
        <CreditScoreSection
          clientId={id}
          balance={judgementBalance}
          daysSincePayment={clientSummary?.days_since_payment ?? 0}
          worstChargeAt={clientSummary?.worst_unpaid_charge_at ?? null}
          worstChargePlazoDias={clientSummary?.worst_unpaid_charge_plazo_dias ?? null}
          worstChargeDueAt={clientSummary?.worst_unpaid_charge_due_at ?? null}
          isFlagged={client.is_flagged}
        />
      </Suspense>

      <Suspense fallback={<MovementsSkeleton />}>
        <MovementHistory clientId={id} ledger={ledger} />
      </Suspense>

      <Suspense fallback={null}>
        <ClientFlagHistory clientId={id} />
      </Suspense>
    </div>
  );
}

// One currency's balance as its own outlined card, label left and figure
// right. One card per currency rather than both in one: they're independent
// debts, and a phone reads them faster as two rows than as two columns.
// LA BANDERA VA PEGADA AL RÓTULO, no a la cifra. Instrucción del dueño,
// 2026-10-16: *«todo lo que muestre moneda debe contener el ícono (flag)»*.
//
// Delante del rótulo y no detrás del número porque la fila ya tiene la cifra
// en el extremo derecho con su equivalente en bolívares debajo; meter ahí un
// icono más empuja los dos renglones y, a 375px, es justo donde menos sitio
// hay. El rótulo, en cambio, tiene el flanco izquierdo libre.
//
// Y no reemplaza a la palabra: "Dólares" se queda. La bandera es lo que se ve
// de un vistazo y la palabra lo que lo deja sin ambigüedad para quien no
// distingue dos banderas pequeñas —o no las ve.
function BalanceRowCard({
  label,
  currency,
  children,
}: {
  label: string;
  // null para un negocio colombiano: allí no hay dos libros que distinguir.
  currency?: PriceCurrency | null;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
          {currency ? <CurrencyFlagIcon currency={currency} /> : null}
          <span className="truncate">{label}</span>
        </p>
        {children}
      </div>
    </div>
  );
}

function MovementsSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-16 w-full rounded-lg" />
      <Skeleton className="h-16 w-full rounded-lg" />
      <Skeleton className="h-16 w-full rounded-lg" />
    </div>
  );
}

function CreditScoreSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-28 w-full rounded-lg" />
    </div>
  );
}

async function CreditScoreSection({
  clientId,
  balance,
  daysSincePayment,
  worstChargeAt,
  worstChargePlazoDias,
  worstChargeDueAt,
  isFlagged,
}: {
  clientId: string;
  // Ya convertido a dólares por quien llama, cuando el dueño es venezolano.
  //
  // ESTE COMPONENTE YA NO RECIBE LA TASA, desde `CT-124` (2026-10-23): estaba
  // aquí para convertir los movimientos antes de repartir los abonos, y ese
  // reparto ahora lleva un libro por moneda —igual que la base— así que cada
  // uno se mide en su propio dinero y no hay nada que convertir.
  balance: number;
  daysSincePayment: number;
  // Migración `134`: el fiado MÁS VENCIDO, no el más antiguo.
  worstChargeAt: string | null;
  worstChargePlazoDias: number | null;
  // Migración `118`: el vencimiento de la próxima cuota sin pagar.
  worstChargeDueAt: string | null;
  isFlagged: boolean;
}) {
  const supabase = await createClient();

  const [{ data: movements }, { data: lastUnflag }] = await Promise.all([
    supabase
      .from("movements")
      .select("id, type, amount, currency, created_at, plazo_dias, applies_to_movement_id")
      .eq("client_id", clientId)
      .is("deleted_at", null),
    supabase
      .from("client_flags")
      .select("unflagged_at")
      .eq("client_id", clientId)
      .not("unflagged_at", "is", null)
      .order("unflagged_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  // SIN CONVERTIR A DÓLARES, desde `CT-124` (2026-10-23). `buildChargeLedger`
  // lleva ahora un libro por moneda, igual que `get_open_charges_for_client`,
  // así que cada uno se mide en su propio dinero. La conversión que había aquí
  // no separaba los libros —solo igualaba las cifras— y metía decimales que la
  // base no guarda: un fiado de 3 € pagado con tres abonos de 1 € se quedaba
  // en 0,01 y no cerraba nunca. `balance`, más arriba, sí sigue convertido:
  // ahí la pregunta es «cuánto debe en total», que es otra.
  const movementRows = (movements ?? []) as Pick<
    Movement,
    "id" | "type" | "amount" | "currency" | "created_at" | "plazo_dias" | "applies_to_movement_id"
  >[];

  const result = computeCreditScore({
    movements: movementRows,
    balance,
    daysSincePayment,
    worstChargeAt,
    worstChargePlazoDias,
    worstChargeDueAt,
    isFlagged,
    mostRecentUnflaggedAt: lastUnflag?.unflagged_at ?? null,
  });

  return (
    <div className="flex flex-col gap-2">
      <h2 className="mt-1 text-xl font-semibold">Puntaje de crédito</h2>
      <div className="flex flex-col items-center gap-3 rounded-lg border p-4 sm:flex-row sm:items-start sm:gap-6">
        <div className="flex shrink-0 flex-col items-center gap-2">
          <CreditScoreRadialChart score={result.score} tier={result.tier} />
          <Badge variant="outline" className={CREDIT_SCORE_TIER_BADGE_CLASS[result.tier]}>
            {result.tier}
          </Badge>
        </div>
        <dl className="flex w-full flex-col gap-1.5 self-start text-xs sm:w-auto">
          {result.breakdown.map((line) => (
            <div key={line.label} className="flex flex-col">
              <dt className="text-muted-foreground">{line.label}</dt>
              <dd>{line.detail}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

// EL HISTORIAL YA NO CARGA LO QUE ERA DE LA FICHA.
//
// Hasta el 2026-10-19 cada fila montaba un diálogo, así que esta función tenía
// que traer de antemano todo lo que ese diálogo podía necesitar: una URL
// firmada por cada foto, el reparto de abonos por fiado, las líneas de venta de
// cada movimiento y con qué compartir. El detalle pasó a ser una pantalla con
// dirección propia, y ahora eso lo carga la página de destino — una vez, para
// el movimiento que se abrió, en vez de para los cincuenta de la lista.
async function MovementHistory({
  clientId,
  ledger,
}: {
  clientId: string;
  ledger: LedgerDisplay | null;
}) {
  const supabase = await createClient();

  const { data: movements } = await supabase
    .from("movements")
    .select("*")
    .eq("client_id", clientId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  const movementRows = (movements ?? []) as Movement[];

  // ── LAS VENTAS PAGADAS ENTERAS ──────────────────────────────────
  //
  // No son movimientos y por eso no vienen en la consulta de arriba: una
  // venta pagada no escribe nada en `movements` (migración `124`). Se traen
  // aparte y la lista las mezcla al pintar. Ver `lib/ventas-de-contado.ts`,
  // que explica por qué no se arregla metiéndolas en esa tabla.
  //
  // Lo reportó el dueño el 2026-10-18: «las transacciones como ventas
  // directas no están apareciendo en el historial de movimiento del cliente».
  const { data: ventasCrudas } = await supabase
    .from("sales")
    .select("id, created_at")
    .eq("client_id", clientId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  // LOS PARES (VENTA, LIBRO) QUE YA DEJARON UN CARGO, para que ESE libro no
  // saque además una fila de contado.
  //
  // POR MONEDA Y NO POR VENTA, desde el 2026-10-20. Antes era un conjunto de
  // ids de venta, y una venta mixta perdía su fila de contado en todas las
  // monedas por tener cargo en una sola: los dólares cobrados al momento no
  // salían en ninguna parte. Ver la cabecera de `lib/ventas-de-contado.ts`.
  const clavesConCargo = new Set<string>();
  for (const m of movementRows) {
    if (m.sale_id && m.type === "charge") {
      clavesConCargo.add(claveDeFila(m.sale_id, m.currency));
    }
  }

  let ventasDeContado: VentaDeContado[] = [];
  // CÓMO SE LLAMA CADA FILA DEL HISTORIAL: `sale_id` → nombres de productos.
  //
  // Hasta el 2026-10-22 el nombre salía de `description`, porque el guardado
  // copiaba ahí los productos cuando el tendero no escribía nada. El dueño
  // mandó quitar esa copia ese día, así que los nombres se resuelven aquí,
  // desde donde viven. NO CUESTA UNA LECTURA MÁS: `sale_lines` ya se consulta
  // justo debajo para las ventas de contado.
  const productosPorVenta: Record<string, string[]> = {};
  const idsDeVenta = (ventasCrudas ?? []).map((v) => v.id as string);
  if (idsDeVenta.length > 0) {
    const [{ data: pagos }, { data: lineasDeVenta }] = await Promise.all([
      // `rate_used` desde el 2026-10-21: la fila de una venta de contado enseña
      // los bolívares SELLADOS, no los de hoy (frame `1512:10061`).
      supabase.from("sale_payments").select("sale_id, currency, amount, rate_used").in("sale_id", idsDeVenta),
      supabase.from("sale_lines").select("sale_id, name, quantity, unit_price, currency").in("sale_id", idsDeVenta),
    ]);
    for (const l of lineasDeVenta ?? []) {
      const id = l.sale_id as string;
      (productosPorVenta[id] ??= []).push(l.name as string);
    }
    ventasDeContado = filasDeContado(
      (ventasCrudas ?? []).map((v) => ({ id: v.id as string, created_at: v.created_at as string })),
      pagos ?? [],
      lineasDeVenta ?? [],
      clavesConCargo,
    );
  }

  // ── EL ESTADO DEL PLAZO DE CADA FIADO, para su chip en la lista ──────
  //
  // Pedido por el dueño el 2026-10-20. Se calcula aquí y no en la lista
  // porque hace falta lo que cada fiado TODAVÍA DEBE, y eso solo lo sabe
  // `get_open_charges_for_client` -- el `running_balance` de la fila es el
  // saldo del cliente en ese libro, que es otra cosa.
  //
  // UN FIADO QUE NO ESTÉ EN LA LISTA DE ABIERTOS ESTÁ SALDADO, y ese es el
  // estado «Pagado» que el dueño pidió como nuevo. No es una ausencia de
  // dato: es la respuesta. Por eso el bucle recorre los MOVIMIENTOS y busca
  // en el mapa, y no al revés -- recorrer los abiertos dejaría a los pagados
  // sin chip, que es justo el caso que se quería enseñar.
  const estadosDeFiado: Record<string, EstadoDelPlazo | null> = {};
  const pendientePorFiadoMapa: Record<string, number> = {};
  const hayFiados = movementRows.some((m) => m.type === "charge");
  if (hayFiados) {
    const { data: abiertos } = await supabase.rpc("get_open_charges_for_client", {
      p_client_id: clientId,
    });
    const pendientePorFiado = new Map<string, number>();
    for (const c of (abiertos ?? []) as { movement_id: string; pending: number }[]) {
      pendientePorFiado.set(c.movement_id, Number(c.pending));
    }
    for (const m of movementRows) {
      if (m.type !== "charge") continue;
      const pendiente = pendientePorFiado.get(m.id) ?? 0;
      pendientePorFiadoMapa[m.id] = pendiente;
      estadosDeFiado[m.id] = estadoDelFiado({
        createdAt: m.created_at,
        plazoDias: m.plazo_dias,
        cuotas: m.cuotas,
        amount: Number(m.amount),
        pendiente,
      });
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {/* El rótulo viaja DENTRO de la lista para que el filtro por tipo pueda
          ir a su derecha, en la misma fila. La tipografía se queda aquí: las
          dos pantallas que usan esa lista titulan distinto. */}
      <MovementHistoryList
        titulo={<h2 className="mt-1 text-xl font-semibold">Historial de transacciones</h2>}
        movements={movementRows}
        ledger={ledger}
        ventasDeContado={ventasDeContado}
        pendientePorFiado={pendientePorFiadoMapa}
        productosPorVenta={productosPorVenta}
      />
    </div>
  );
}

// Renders nothing when the client has never been flagged — most clients.
async function ClientFlagHistory({ clientId }: { clientId: string }) {
  const supabase = await createClient();

  const { data: flags } = await supabase
    .from("client_flags")
    .select("*")
    .eq("client_id", clientId)
    .order("flagged_at", { ascending: false });

  const flagRows = (flags ?? []) as ClientFlag[];
  if (flagRows.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-muted-foreground">Historial de mala paga</h2>
      <ul className="flex flex-col divide-y rounded-lg border">
        {flagRows.map((f) => (
          <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <p className="text-sm">{f.reason}</p>
              <p className="text-xs text-muted-foreground">Marcado: {formatDateTime(f.flagged_at)}</p>
            </div>
            {f.unflagged_at ? (
              <span className="text-xs text-muted-foreground">Desmarcado: {formatDateTime(f.unflagged_at)}</span>
            ) : (
              <Badge variant="outline" className={MALA_PAGA_BADGE_CLASS}>
                Activo
              </Badge>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
