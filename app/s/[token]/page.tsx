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
import { formatCurrency } from "@/lib/format";
import { renderFormattedText } from "@/lib/format-text";
import { getBalanceLabel } from "@/lib/types";
import type { DisplayCurrency, ExchangeRateMode, MovementCurrencyCode } from "@/lib/types";
import { VerifyBadge } from "@/components/public/verify-badge";

type SharedMovement = {
  id: string;
  type: "charge" | "payment";
  amount: number;
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
  balance: number;
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
  display_currency: DisplayCurrency | null;
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
          displayCurrency: shared.display_currency ?? ("USD" as DisplayCurrency),
        }
      : null;

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-4">
      <div className="flex items-center gap-3 pt-2">
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
          <p className="text-xs text-muted-foreground">Cédula/documento: {shared.document_id || "—"}</p>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-5">
        <p className="text-sm text-muted-foreground">{getBalanceLabel(shared.balance)}</p>
        {rateContext ? (
          <ExchangeRateBalanceDisplay balance={shared.balance} rateContext={rateContext} mainClassName="text-4xl" />
        ) : (
          <p className="text-4xl font-semibold tabular-nums">{formatCurrency(shared.balance)}</p>
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
        <MovementHistoryList
          movements={movements}
          ledger={
            rateContext
              ? {
                  displayCurrency: rateContext.displayCurrency,
                  rate: rateContext.effectiveRate,
                }
              : null
          }
        />
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
