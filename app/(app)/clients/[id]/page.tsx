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
import { computeCreditScore } from "@/lib/credit-score";
import { formatCurrency, formatDateTime } from "@/lib/format";
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

  const [{ data: client }, { data: summary }] = await Promise.all([
    supabase.from("clients").select("*").eq("id", id).eq("owner_id", user!.id).maybeSingle(),
    supabase.from("client_summary").select("*").eq("client_id", id).maybeSingle(),
  ]);

  if (!client) notFound();

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
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link href="/dashboard">
            <ArrowLeft className="size-4" />
            Cartera
          </Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">{client.name}</h1>
            <EditClientDialog client={client as Client} />
          </div>
          <div className="mt-1 flex items-center gap-2">
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
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-sm text-muted-foreground">Por cobrar</p>
            <p className="text-2xl font-semibold tabular-nums">{formatCurrency(balance)}</p>
          </div>
          <ShareActions
            clientId={client.id}
            clientName={client.name}
            whatsapp={client.whatsapp}
            balance={balance}
          />
          <ClientFlagControl clientId={client.id} clientName={client.name} isFlagged={client.is_flagged} />
          <AddMovementDialog
            clientId={client.id}
            clientName={client.name}
            ownerId={user!.id}
            currentDebt={balance}
            isFlagged={client.is_flagged}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 rounded-lg border p-4 text-sm sm:grid-cols-3">
        <div>
          <p className="text-muted-foreground">WhatsApp</p>
          <p>{client.whatsapp || "—"}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Cédula/documento</p>
          <p>{client.document_id || "—"}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Dirección</p>
          <p>{client.address || "—"}</p>
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
        />
      </Suspense>

      <Suspense fallback={<MovementsSkeleton />}>
        <MovementHistory clientId={id} />
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
}: {
  clientId: string;
  balance: number;
  daysSincePayment: number;
  oldestUnpaidChargeAt: string | null;
  oldestUnpaidChargePlazoDias: number | null;
  isFlagged: boolean;
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
        <dl className="flex w-full flex-col gap-1.5 text-xs">
          {result.breakdown.map((line) => (
            <div key={line.label} className="flex flex-wrap justify-between gap-2">
              <dt className="text-muted-foreground">{line.label}</dt>
              <dd className="text-right">{line.detail}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

async function MovementHistory({ clientId }: { clientId: string }) {
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
      <MovementHistoryList movements={movementRows} photoUrls={Object.fromEntries(photoUrls)} />
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
