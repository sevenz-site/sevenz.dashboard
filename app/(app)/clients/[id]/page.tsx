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
import { filasDeContado, type VentaDeContado } from "@/lib/ventas-de-contado";
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
import { combinedBalanceUsd, toCombinedUsd, type EffectiveRate } from "@/lib/exchange-rate/convert";
import { formatBalanceSummary, type LedgerDisplay } from "@/lib/exchange-rate/movement-display";
import type { DatosParaCompartir } from "@/lib/share-balance";
import type { MovementRateContext } from "@/lib/exchange-rate/convert";
import {
  CLIENT_STATUS_BADGE_CLASS,
  CLIENT_STATUS_LABEL,
  CREDIT_SCORE_TIER_BADGE_CLASS,
  MALA_PAGA_BADGE_CLASS,
  getClientStatus,
  type Client,
  type ClientFlag,
  type ClientSummary,
  type Movement,
  type OwnerCountry,
} from "@/lib/types";
import type { SaleLineRow } from "@/lib/sale-lines";

const SIGNED_URL_TTL_SECONDS = 300;

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
  // Un solo mensaje para los dos botones que lo mandan: "Compartir enlace" en
  // el perfil y "Compartir" dentro de la ficha de cada movimiento. Lo calculaban
  // dos sitios por su cuenta con la misma llamada repetida; ahora es uno.
  const balanceText = formatBalanceSummary(balance, balanceUsd, balanceEur, ledger);
  const compartir: DatosParaCompartir = {
    clientName: client.name,
    balanceText,
    enlace: { de: "dueño", clientId: client.id },
  };

  const judgementBalance = ownerRate ? combinedBalanceUsd(balanceUsd, balanceEur, ownerRate.effectiveRate) : balance;
  const status = getClientStatus(
    judgementBalance,
    clientSummary?.days_since_payment ?? 0,
    clientSummary?.oldest_unpaid_charge_at ?? null,
    clientSummary?.oldest_unpaid_charge_plazo_dias ?? null,
    clientSummary?.oldest_unpaid_charge_due_at ?? null,
  );

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
            {CLIENT_STATUS_LABEL[status]}
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
          effectiveRate={ownerRate?.effectiveRate ?? null}
          daysSincePayment={clientSummary?.days_since_payment ?? 0}
          oldestUnpaidChargeAt={clientSummary?.oldest_unpaid_charge_at ?? null}
          oldestUnpaidChargePlazoDias={clientSummary?.oldest_unpaid_charge_plazo_dias ?? null}
          oldestUnpaidChargeDueAt={clientSummary?.oldest_unpaid_charge_due_at ?? null}
          isFlagged={client.is_flagged}
        />
      </Suspense>

      <Suspense fallback={<MovementsSkeleton />}>
        <MovementHistory clientId={id} ledger={ledger} compartir={compartir} />
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
  effectiveRate,
  daysSincePayment,
  oldestUnpaidChargeAt,
  oldestUnpaidChargePlazoDias,
  oldestUnpaidChargeDueAt,
  isFlagged,
}: {
  clientId: string;
  balance: number;
  // Only present for a VE owner — needed to convert USD/EUR movements into
  // one comparable unit before the score's FIFO payment-matching runs.
  // Without this, a EUR payment could appear to close a USD charge just
  // because it's the oldest unpaid one, which is wrong.
  effectiveRate: EffectiveRate | null;
  daysSincePayment: number;
  oldestUnpaidChargeAt: string | null;
  oldestUnpaidChargePlazoDias: number | null;
  // Migración `118`: el vencimiento de la próxima cuota sin pagar.
  oldestUnpaidChargeDueAt: string | null;
  isFlagged: boolean;
}) {
  const supabase = await createClient();

  const [{ data: movements }, { data: lastUnflag }] = await Promise.all([
    supabase
      .from("movements")
      .select("type, amount, currency, created_at, plazo_dias")
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

  const movementRows = (movements ?? []) as Pick<
    Movement,
    "type" | "amount" | "currency" | "created_at" | "plazo_dias"
  >[];
  const scoreMovements = effectiveRate
    ? movementRows.map((m) => ({ ...m, amount: toCombinedUsd(m.amount, m.currency, effectiveRate) }))
    : movementRows;

  const result = computeCreditScore({
    movements: scoreMovements,
    balance,
    daysSincePayment,
    oldestUnpaidChargeAt,
    oldestUnpaidChargePlazoDias,
    oldestUnpaidChargeDueAt,
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

async function MovementHistory({
  clientId,
  ledger,
  compartir,
}: {
  clientId: string;
  ledger: LedgerDisplay | null;
  // El mismo mensaje y el mismo enlace que "Compartir enlace" del perfil. Se
  // calcula arriba, donde ya estan el nombre y el saldo, y baja hasta aqui:
  // este componente solo lee movimientos y no sabria construirlo.
  compartir: DatosParaCompartir;
}) {
  const supabase = await createClient();

  const { data: movements } = await supabase
    .from("movements")
    .select("*")
    .eq("client_id", clientId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  const movementRows = (movements ?? []) as Movement[];

  // QUÉ SE LLEVÓ EL CLIENTE EN CADA MOVIMIENTO — paso 8, entregable `E`.
  //
  // UNA SOLA CONSULTA PARA TODA LA LISTA y no una por ficha: el detalle se
  // abre en un diálogo que ya está montado, así que pedirlo al abrirlo
  // significaría una espera justo donde el dueño espera un dato inmediato.
  // Son pocas filas --la mayoría de los movimientos no llevan productos-- y
  // van indexadas por `movement_id`.
  //
  // SE BUSCAN POR LA VENTA Y NO POR EL MOVIMIENTO desde el 2026-10-17: las
  // líneas se mudaron a `sale_lines` (migración `124`) porque una venta
  // pagada al contado no tiene movimiento del que colgar. El movimiento
  // apunta a su venta con `sale_id`, así que el índice sigue siendo por
  // movimiento y la pantalla no se entera del cambio.
  const productosPorMovimiento = new Map<string, SaleLineRow[]>();
  const ventaDelMovimiento = new Map<string, string>();
  for (const m of movementRows) {
    if (m.sale_id) ventaDelMovimiento.set(m.sale_id, m.id);
  }
  if (ventaDelMovimiento.size > 0) {
    const { data: lineas } = await supabase
      .from("sale_lines")
      .select("sale_id, name, quantity, unit_price")
      .in("sale_id", [...ventaDelMovimiento.keys()]);
    for (const l of lineas ?? []) {
      const movementId = ventaDelMovimiento.get(l.sale_id);
      if (!movementId) continue;
      const lista = productosPorMovimiento.get(movementId) ?? [];
      lista.push({ name: l.name, quantity: Number(l.quantity), unitPrice: Number(l.unit_price) });
      productosPorMovimiento.set(movementId, lista);
    }
  }
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

  let ventasDeContado: VentaDeContado[] = [];
  const idsDeVenta = (ventasCrudas ?? []).map((v) => v.id as string);
  if (idsDeVenta.length > 0) {
    const [{ data: pagos }, { data: lineasDeVenta }] = await Promise.all([
      supabase.from("sale_payments").select("sale_id, currency, amount").in("sale_id", idsDeVenta),
      supabase.from("sale_lines").select("sale_id, name, quantity, unit_price, currency").in("sale_id", idsDeVenta),
    ]);
    // LAS VENTAS QUE DEJARON UN CARGO QUEDAN FUERA: ya tienen su fila, y es
    // la del fiado. `ventaDelMovimiento` se construyó arriba con exactamente
    // esas, así que se reutiliza en vez de volver a preguntarlo.
    ventasDeContado = filasDeContado(
      (ventasCrudas ?? []).map((v) => ({ id: v.id as string, created_at: v.created_at as string })),
      pagos ?? [],
      lineasDeVenta ?? [],
      new Set(ventaDelMovimiento.keys()),
    );
  }

  const photoPaths = movementRows.map((m) => m.photo_path).filter((p): p is string => Boolean(p));

  const photoUrls = new Map<string, string>();
  if (photoPaths.length > 0) {
    const { data: signed } = await supabase.storage
      .from("attachments")
      .createSignedUrls(photoPaths, SIGNED_URL_TTL_SECONDS);
    for (const entry of signed ?? []) {
      if (entry.path && entry.signedUrl) photoUrls.set(entry.path, entry.signedUrl);
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
        photoUrls={Object.fromEntries(photoUrls)}
        ledger={ledger}
        compartir={compartir}
        productosPorMovimiento={productosPorMovimiento}
        ventasDeContado={ventasDeContado}
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
