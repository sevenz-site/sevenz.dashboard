import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, IdCard, MapPin, Phone } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ShareActions } from "@/components/dashboard/share-actions";
import { AddMovementDialog } from "@/components/dashboard/add-movement-dialog";
import { EditClientDialog } from "@/components/dashboard/edit-client-dialog";
import { ClientFlagControl } from "@/components/dashboard/client-flag-control";
import { CreditScoreRadialChart } from "@/components/dashboard/credit-score-radial-chart";
import { MovementHistoryList } from "@/components/dashboard/movement-history-list";
import { ExchangeRateBalanceDisplay } from "@/components/exchange-rate-balance-display";
import { computeCreditScore } from "@/lib/credit-score";
import { formatDateTime, formatDocumentId } from "@/lib/format";
import { getOwnerRateContext } from "@/lib/exchange-rate/owner-rate";
import { combinedBalanceUsd, toCombinedUsd, type EffectiveRate } from "@/lib/exchange-rate/convert";
import { formatBalanceSummary, type LedgerDisplay } from "@/lib/exchange-rate/movement-display";
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

const SIGNED_URL_TTL_SECONDS = 300;

export default async function ClientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ movimiento?: string }>;
}) {
  const { id } = await params;
  // Which action the mobile bar asked for while this client is on screen. The
  // bar carries "Agregar fiado" / "Agregar abono" on this route, so it marks
  // the URL rather than navigating. Passed to the mobile AddMovementDialog
  // only — the sm+ layout below renders a second instance, and both opening
  // would stack two dialogs.
  const { movimiento } = await searchParams;
  const autoOpenType =
    movimiento === "abono" ? ("payment" as const) : movimiento === "fiado" ? ("charge" as const) : undefined;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: client }, { data: summary }, ownerRate, { data: ownerRow }] = await Promise.all([
    supabase.from("clients").select("*").eq("id", id).eq("owner_id", user!.id).maybeSingle(),
    supabase.from("client_summary").select("*").eq("client_id", id).maybeSingle(),
    getOwnerRateContext(supabase, user!.id),
    // getOwnerRateContext reads owners.country too, but discards it for a CO
    // owner. Asking again here is cheaper than widening its contract.
    supabase.from("owners").select("country").eq("id", user!.id).maybeSingle(),
  ]);

  if (!client) notFound();

  const ownerCountry = (ownerRow?.country as OwnerCountry | undefined) ?? "CO";

  const rateContext: MovementRateContext | null = ownerRate
    ? {
        rateMode: ownerRate.rateMode,
        effectiveRate: ownerRate.effectiveRate,
        officialRateUsd: ownerRate.officialRate.usd,
      }
    : null;
  const ledger: LedgerDisplay | null = ownerRate ? { rate: ownerRate.effectiveRate } : null;

  const clientSummary = summary as ClientSummary | null;
  const balance = clientSummary?.balance ?? 0;
  const balanceUsd = clientSummary?.balance_usd ?? 0;
  const balanceEur = clientSummary?.balance_eur ?? 0;
  // Status/mora/score are one combined judgement per client even when a VE
  // owner tracks two independent balances — converted to USD so they're
  // comparable, per the "uno solo, combinado" decision.
  const judgementBalance = ownerRate ? combinedBalanceUsd(balanceUsd, balanceEur, ownerRate.effectiveRate) : balance;
  const status = getClientStatus(
    judgementBalance,
    clientSummary?.days_since_payment ?? 0,
    clientSummary?.oldest_unpaid_charge_at ?? null,
    clientSummary?.oldest_unpaid_charge_plazo_dias ?? null,
  );

  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* On a phone this replaces the app header (see AppHeader), so it
          carries the same bottom rule the header does. From sm up the real
          header is back above it and the rule would double, hence sm:border-0. */}
      <div className="flex items-center justify-between gap-4 border-b pb-3 sm:border-0 sm:pb-0">
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link href="/dashboard">
            <ArrowLeft className="size-4" />
            Cartera
          </Link>
        </Button>
        <ShareActions
          clientId={client.id}
          clientName={client.name}
          whatsapp={client.whatsapp}
          balanceText={formatBalanceSummary(balance, balanceUsd, balanceEur, ledger)}
        />
      </div>

      {/* Mobile (< sm): status badges, balance, the mala paga control, and a
          full-width "Agregar movimiento" stack vertically below the name.
          Desktop keeps the side-by-side layout in the block after this one —
          these two are mutually exclusive via hidden/sm:hidden, not a JS
          breakpoint check, since this page is a server component. */}
      <div className="flex flex-col gap-3 sm:hidden">
        <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 px-3 py-2">
          <div className="flex w-full items-center justify-between gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{client.name}</h1>
            <EditClientDialog client={client as Client} ownerCountry={ownerCountry} />
          </div>
          <ClientInfoRows
            documentId={client.document_id}
            whatsapp={client.whatsapp}
            address={client.address}
          />
        </div>

        <h2 className="mt-10 text-xl font-semibold">Cartera pendiente</h2>
        <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 px-3 py-2">
          {rateContext ? (
            <div className="flex flex-wrap gap-6">
              <div>
                <p className="text-sm text-muted-foreground">Por cobrar USD</p>
                <ExchangeRateBalanceDisplay balance={balanceUsd} currency="USD" ledger={ledger} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Por cobrar EUR</p>
                <ExchangeRateBalanceDisplay balance={balanceEur} currency="EUR" ledger={ledger} />
              </div>
            </div>
          ) : (
            <div>
              <p className="text-sm text-muted-foreground">Por cobrar</p>
              <ExchangeRateBalanceDisplay balance={balance} currency={null} ledger={null} />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={CLIENT_STATUS_BADGE_CLASS[status]}>
              {CLIENT_STATUS_LABEL[status]}
            </Badge>
            {clientSummary?.has_pending_review ? <Badge variant="outline">movimientos por revisar</Badge> : null}
            {client.is_flagged ? (
              <Badge variant="outline" className={MALA_PAGA_BADGE_CLASS}>
                Mala paga
              </Badge>
            ) : null}
          </div>
          <ClientFlagControl clientId={client.id} clientName={client.name} isFlagged={client.is_flagged} />
        </div>
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
          triggerClassName="w-full"
          autoOpen={autoOpenType}
          hideTriggers
          rateContext={rateContext}
        />
      </div>

      <div className="hidden flex-col gap-3 sm:flex">
        {/* Info and balances stay side by side here — the phone stacks them
            into two cards instead. Same section rule either way. */}
        <div className="flex flex-wrap items-start justify-between gap-4 rounded-lg border bg-muted/30 px-3 py-2">
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1">
              <h1 className="text-2xl font-semibold tracking-tight">{client.name}</h1>
              <EditClientDialog client={client as Client} ownerCountry={ownerCountry} />
            </div>
            <ClientInfoRows
              documentId={client.document_id}
              whatsapp={client.whatsapp}
              address={client.address}
            />
          </div>
          {rateContext ? (
            <div className="flex gap-4">
              <div className="text-right">
                <p className="text-sm text-muted-foreground">Por cobrar USD</p>
                <ExchangeRateBalanceDisplay balance={balanceUsd} currency="USD" ledger={ledger} align="end" />
              </div>
              <div className="text-right">
                <p className="text-sm text-muted-foreground">Por cobrar EUR</p>
                <ExchangeRateBalanceDisplay balance={balanceEur} currency="EUR" ledger={ledger} align="end" />
              </div>
            </div>
          ) : (
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Por cobrar</p>
              <ExchangeRateBalanceDisplay balance={balance} currency={null} ledger={null} align="end" />
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={CLIENT_STATUS_BADGE_CLASS[status]}>
            {CLIENT_STATUS_LABEL[status]}
          </Badge>
          {clientSummary?.has_pending_review ? <Badge variant="outline">movimientos por revisar</Badge> : null}
          {client.is_flagged ? (
            <Badge variant="outline" className={MALA_PAGA_BADGE_CLASS}>
              Mala paga
            </Badge>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <ClientFlagControl clientId={client.id} clientName={client.name} isFlagged={client.is_flagged} />
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
            rateContext={rateContext}
          />
        </div>
      </div>

      <Suspense fallback={<CreditScoreSkeleton />}>
        <CreditScoreSection
          clientId={id}
          balance={judgementBalance}
          effectiveRate={ownerRate?.effectiveRate ?? null}
          daysSincePayment={clientSummary?.days_since_payment ?? 0}
          oldestUnpaidChargeAt={clientSummary?.oldest_unpaid_charge_at ?? null}
          oldestUnpaidChargePlazoDias={clientSummary?.oldest_unpaid_charge_plazo_dias ?? null}
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

// Cédula, teléfono and dirección as icon rows under the client's name. Empty
// values keep their row and show a dash, so every client's card has the same
// shape and the absence of a phone or an address is itself visible.
function ClientInfoRows({
  documentId,
  whatsapp,
  address,
}: {
  documentId: string | null;
  whatsapp: string | null;
  address: string | null;
}) {
  const rows = [
    { icon: IdCard, label: "Cédula / Documento", value: formatDocumentId(documentId) },
    { icon: Phone, label: "Teléfono", value: whatsapp || "—" },
    { icon: MapPin, label: "Dirección", value: address || "—" },
  ];
  return (
    <dl className="flex flex-col gap-1 text-sm text-muted-foreground">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center gap-2">
          <dt className="sr-only">{row.label}</dt>
          <row.icon className="size-4 shrink-0" aria-hidden="true" />
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
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
    isFlagged,
    mostRecentUnflaggedAt: lastUnflag?.unflagged_at ?? null,
  });

  return (
    <div className="flex flex-col gap-2">
      <h2 className="mt-10 text-xl font-semibold">Puntaje de crédito</h2>
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
      <h2 className="mt-10 text-xl font-semibold">Historial de movimientos</h2>
      <MovementHistoryList
        movements={movementRows}
        photoUrls={Object.fromEntries(photoUrls)}
        ledger={ledger}
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
