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
import { formatCurrency, formatDate } from "@/lib/format";
import {
  CLIENT_STATUS_BADGE_CLASS,
  CLIENT_STATUS_LABEL,
  getClientStatus,
  type Client,
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
          <AddMovementDialog
            clientId={client.id}
            clientName={client.name}
            ownerId={user!.id}
            currentDebt={balance}
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

      <Suspense fallback={<MovementsSkeleton />}>
        <MovementHistory clientId={id} />
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

async function MovementHistory({ clientId }: { clientId: string }) {
  const supabase = await createClient();

  const { data: movements } = await supabase
    .from("movements")
    .select("*")
    .eq("client_id", clientId)
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
      {movementRows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no hay movimientos.</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {movementRows.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {m.type === "charge" ? "Fiado" : "Abono"}
                  {m.description ? ` · ${m.description}` : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(m.created_at)} · saldo {formatCurrency(m.running_balance)}
                  {m.source === "photo_import" ? " · de libreta" : ""}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {m.photo_path && photoUrls.has(m.photo_path) ? (
                  <a
                    href={photoUrls.get(m.photo_path)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-muted-foreground underline underline-offset-4"
                  >
                    Ver foto
                  </a>
                ) : null}
                <span
                  className={`tabular-nums text-sm font-medium ${m.type === "charge" ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}`}
                >
                  {m.type === "charge" ? "+" : "-"}
                  {formatCurrency(m.amount)}
                </span>
                {m.needs_review ? (
                  <Badge variant="outline" className="text-[10px]">
                    revisar
                  </Badge>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
