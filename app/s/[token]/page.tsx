import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getPublicLogoUrl } from "@/lib/supabase/storage";
import { SetupNotice } from "@/components/setup-notice";
import { Button } from "@/components/ui/button";
import { MovementHistoryList } from "@/components/public/movement-history-list";
import { ExchangeRateBalanceDisplay } from "@/components/exchange-rate-balance-display";
import { ExchangeRateLegalDisclaimer } from "@/components/exchange-rate-legal-disclaimer";
import { formatCurrency, formatDocumentId } from "@/lib/format";
import { renderFormattedText } from "@/lib/format-text";
import { getBalanceLabel } from "@/lib/types";
import type { ExchangeRateMode, LedgerCurrency, MovementCurrencyCode } from "@/lib/types";
import type { LedgerDisplay } from "@/lib/exchange-rate/movement-display";
import { VerifyBadge } from "@/components/public/verify-badge";
import { DocumentIdDialog } from "@/components/public/document-id-dialog";

type SharedMovement = {
  id: string;
  type: "charge" | "payment";
  amount: number;
  currency: LedgerCurrency | null;
  description: string | null;
  running_balance: number;
  needs_review: boolean;
  plazo_dias: number | null;
  created_at: string;
};

type SharedBalance = {
  business_name: string;
  owner_whatsapp: string | null;
  owner_logo_path: string | null;
  payment_info: string | null;
  client_name: string;
  document_id: string | null;
  whatsapp_last4: string;
  // The COP ledger (country='CO'). A VE client's debt lives in the two
  // per-currency balances below instead.
  balance: number;
  balance_usd: number;
  balance_eur: number;
  movements: (SharedMovement & {
    rate_mode_used: ExchangeRateMode | null;
    exchange_rate_used: number | null;
    official_bcv_rate_at_time: number | null;
    entry_currency: MovementCurrencyCode | null;
    entry_amount: number | null;
    rate_usd_at_time: number | null;
    rate_eur_at_time: number | null;
  })[];
  // Only meaningful when owner_country = 'VE' — a 'CO' owner's payload
  // still includes these keys (the SQL function always returns them) but
  // every value is null, and the page falls back to the plain COP figure.
  owner_country: "CO" | "VE" | null;
  rate_mode: ExchangeRateMode | null;
  current_bcv_usd: number | null;
  current_bcv_eur: number | null;
  custom_rate_usd: number | null;
  custom_rate_eur: number | null;
};

export default async function SharedBalancePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  if (!isSupabaseConfigured()) {
    return <SetupNotice />;
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_shared_balance", { p_token: token });

  if (error || !data) {
    notFound();
  }

  const shared = data as SharedBalance;
  const movements = [...shared.movements].reverse();

  const ownerWhatsappDigits = shared.owner_whatsapp?.replace(/\D/g, "");
  const logoUrl = shared.owner_logo_path ? getPublicLogoUrl(shared.owner_logo_path) : "/icon.svg";

  // Absent (null) for a 'CO' owner, or a 'VE' owner before any rate has ever
  // been fetched — the balance then renders exactly like today's plain COP
  // figure, same as everywhere else this shape is used.
  const rateContext =
    shared.owner_country === "VE" && shared.current_bcv_usd != null && shared.current_bcv_eur != null
      ? {
          rateMode: shared.rate_mode ?? ("BCV_AUTO" as ExchangeRateMode),
          effectiveRate:
            shared.rate_mode === "CUSTOM" && shared.custom_rate_usd && shared.custom_rate_eur
              ? { usd: shared.custom_rate_usd, eur: shared.custom_rate_eur }
              : { usd: shared.current_bcv_usd, eur: shared.current_bcv_eur },
          officialRate: { usd: shared.current_bcv_usd, eur: shared.current_bcv_eur },
        }
      : null;
  const ledger: LedgerDisplay | null = rateContext ? { rate: rateContext.effectiveRate } : null;

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-4">
      <DocumentIdDialog token={token} clientName={shared.client_name} initialDocumentId={shared.document_id} />
      <div className="flex items-start justify-between gap-3 pt-2">
        <div className="flex items-center gap-3">
          <Image
            src={logoUrl}
            alt=""
            width={40}
            height={40}
            unoptimized={Boolean(shared.owner_logo_path)}
            className="size-10 shrink-0 rounded-md object-cover"
          />
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">{shared.business_name}</h1>
            <p className="text-sm text-muted-foreground">Saldo de {shared.client_name}</p>
            <p className="text-xs text-muted-foreground">Cédula/documento: {formatDocumentId(shared.document_id)}</p>
          </div>
        </div>
        <Button asChild variant="outline" size="sm" className="shrink-0">
          <Link href={`/s/${token}/perfil`}>Mi perfil</Link>
        </Button>
      </div>

      <div className="rounded-xl border bg-card p-5">
        {rateContext ? (
          <div className="flex flex-wrap gap-6">
            <div>
              <p className="text-sm text-muted-foreground">{getBalanceLabel(shared.balance_usd)} (USD)</p>
              <ExchangeRateBalanceDisplay
                balance={shared.balance_usd}
                currency="USD"
                ledger={ledger}
                mainClassName="text-4xl"
              />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{getBalanceLabel(shared.balance_eur)} (EUR)</p>
              <ExchangeRateBalanceDisplay
                balance={shared.balance_eur}
                currency="EUR"
                ledger={ledger}
                mainClassName="text-4xl"
              />
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{getBalanceLabel(shared.balance)}</p>
            <p className="text-4xl font-semibold tabular-nums">{formatCurrency(shared.balance)}</p>
          </>
        )}
        {shared.payment_info ? (
          <div className="mt-4 border-t pt-4">
            <p className="mb-1 text-sm font-medium text-muted-foreground">Cómo pagar</p>
            <p className="text-sm">{renderFormattedText(shared.payment_info)}</p>
          </div>
        ) : null}
      </div>

      {ownerWhatsappDigits ? (
        <a
          href={`https://wa.me/${ownerWhatsappDigits}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-fit items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-500/10"
        >
          <MessageCircle className="size-4" />
          Escribir a {shared.business_name} por WhatsApp
        </a>
      ) : null}

      {shared.whatsapp_last4 ? <VerifyBadge expectedLast4={shared.whatsapp_last4} /> : null}

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">Historial</h2>
        <MovementHistoryList movements={movements} ledger={ledger} />
      </div>

      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-5 text-center">
        <p className="text-sm font-medium">
          ¿Quieres tener las cuentas claras con tus clientes?
        </p>
        <Button asChild size="sm">
          <Link href="/signup">Regístrate en Sevenz</Link>
        </Button>
      </div>

      {rateContext ? <ExchangeRateLegalDisclaimer /> : null}
    </div>
  );
}
