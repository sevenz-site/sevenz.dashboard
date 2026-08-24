import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
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
import { formatDateTime } from "@/lib/format";
import { getOwnerRateContext } from "@/lib/exchange-rate/owner-rate";
import type { MovementRateContext } from "@/lib/exchange-rate/convert";
import type { LedgerDisplay } from "@/lib/exchange-rate/movement-display";
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
} from "@/lib/types";

const SIGNED_URL_TTL_SECONDS = 300;

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: client }, { data: summary }, ownerRate] = await Promise.all([
    supabase.from("clients").select("*").eq("id", id).eq("owner_id", user!.id).maybeSingle(),
    supabase.from("client_summary").select("*").eq("client_id", id).maybeSingle(),
    getOwnerRateContext(supabase, user!.id),
  ]);

  if (!client) notFound();

  const rateContext: MovementRateContext | null = ownerRate
    ? {
        rateMode: ownerRate.rateMode,
        effectiveRate: ownerRate.effectiveRate,
        officialRateUsd: ownerRate.officialRate.usd,
        displayCurrency: ownerRate.displayCurrency,
      }
    : null;

  const clientSummary = summary as ClientSummary | null;
  const balance = clientSummary?.balance ?? 0;
  const status = getClientStatus(
    balance,
    clientSummary?.days_since_payment ?? 0,
    clientSummary?.oldest_unpaid_charge_at ?? null,
    clientSummary?.oldest_unpaid_charge_plazo_dias ?? null,
  );

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
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
          balance={balance}
        />
      </div>

      {/* Mobile (< sm): status badges, balance, the mala paga control, and a
          full-width "Agregar movimiento" stack vertically below the name.
          Desktop keeps the side-by-side layout in the block after this one —
          these two are mutually exclusive via hidden/sm:hidden, not a JS
          breakpoint check, since this page is a server component. */}
      <div className="flex flex-col gap-3 sm:hidden">
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{client.name}</h1>
          <EditClientDialog client={client as Client} />
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
        <div>
          <p className="text-sm text-muted-foreground">Por cobrar</p>
          <ExchangeRateBalanceDisplay balance={balance} rateContext={ownerRate} />
        </div>
        <ClientFlagControl clientId={client.id} clientName={client.name} isFlagged={client.is_flagged} />
        <AddMovementDialog
          clientId={client.id}
          clientName={client.name}
          ownerId={user!.id}
          currentDebt={balance}
          isFlagged={client.is_flagged}
          triggerClassName="w-full"
          rateContext={rateContext}
        />
      </div>

      <div className="hidden flex-col gap-3 sm:flex">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">{client.name}</h1>
            <EditClientDialog client={client as Client} />
          </div>
          <div className="text-right">
            <p className="text-sm text-muted-foreground">Por cobrar</p>
            <ExchangeRateBalanceDisplay balance={balance} rateContext={ownerRate} align="end" />
          </div>
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
            ownerId={user!.id}
            currentDebt={balance}
            isFlagged={client.is_flagged}
            rateContext={rateContext}
          />
        </div>
      </div>

      <Suspense fallback={<CreditScoreSkeleton />}>
        <CreditScoreSection
          clientId={id}
          balance={balance}
          daysSincePayment={clientSummary?.days_since_payment ?? 0}
          oldestUnpaidChargeAt={clientSummary?.oldest_unpaid_charge_at ?? null}
          oldestUnpaidChargePlazoDias={clientSummary?.oldest_unpaid_charge_plazo_dias ?? null}
          isFlagged={client.is_flagged}
          whatsapp={client.whatsapp}
          documentId={client.document_id}
          address={client.address}
        />
      </Suspense>

      <Suspense fallback={<MovementsSkeleton />}>
        <MovementHistory
          clientId={id}
          ledger={
            ownerRate
              ? { displayCurrency: ownerRate.displayCurrency, rate: ownerRate.effectiveRate }
              : null
          }
        />
      </Suspense>

      <Suspense fallback={null}>
        <ClientFlagHistory clientId={id} />
      </Suspense>
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
  oldestUnpaidChargeAt,
  oldestUnpaidChargePlazoDias,
  isFlagged,
  whatsapp,
  documentId,
  address,
}: {
  clientId: string;
  balance: number;
  daysSincePayment: number;
  oldestUnpaidChargeAt: string | null;
  oldestUnpaidChargePlazoDias: number | null;
  isFlagged: boolean;
  whatsapp: string | null;
  documentId: string | null;
  address: string | null;
}) {
  const supabase = await createClient();

  const [{ data: movements }, { data: lastUnflag }] = await Promise.all([
    supabase
      .from("movements")
      .select("type, amount, created_at, plazo_dias")
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

  const result = computeCreditScore({
    movements: (movements ?? []) as Pick<Movement, "type" | "amount" | "created_at" | "plazo_dias">[],
    balance,
    daysSincePayment,
    oldestUnpaidChargeAt,
    oldestUnpaidChargePlazoDias,
    isFlagged,
    mostRecentUnflaggedAt: lastUnflag?.unflagged_at ?? null,
  });

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-muted-foreground">Puntaje de crédito</h2>
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
        <dl className="flex w-full flex-col gap-1.5 self-start text-xs sm:w-auto">
          <div className="flex flex-col">
            <dt className="text-muted-foreground">WhatsApp</dt>
            <dd>{whatsapp || "—"}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-muted-foreground">Cédula/documento</dt>
            <dd>{documentId || "—"}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-muted-foreground">Dirección</dt>
            <dd>{address || "—"}</dd>
          </div>
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
      <h2 className="text-sm font-medium text-muted-foreground">Historial de movimientos</h2>
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
