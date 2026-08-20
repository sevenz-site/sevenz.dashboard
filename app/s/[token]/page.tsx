import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getPublicLogoUrl } from "@/lib/supabase/storage";
import { SetupNotice } from "@/components/setup-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/format";
import { renderFormattedText } from "@/lib/format-text";
import { getBalanceLabel } from "@/lib/types";
import { VerifyBadge } from "@/components/public/verify-badge";

type SharedMovement = {
  id: string;
  type: "charge" | "payment";
  amount: number;
  description: string | null;
  running_balance: number;
  needs_review: boolean;
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
  movements: SharedMovement[];
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
        <p className="text-4xl font-semibold tabular-nums">{formatCurrency(shared.balance)}</p>
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
        {movements.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay movimientos.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border">
            {movements.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {m.type === "charge" ? "Fiado" : "Abono"}
                    {m.description ? ` · ${m.description}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">{formatDate(m.created_at)}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className={`tabular-nums text-sm font-medium ${m.type === "charge" ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}`}>
                    {m.type === "charge" ? "+" : "-"}
                    {formatCurrency(m.amount)}
                  </span>
                  {m.needs_review ? (
                    <Badge variant="outline" className="text-[10px]">
                      en revisión
                    </Badge>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-5 text-center">
        <p className="text-sm font-medium">
          ¿Quieres tener las cuentas claras con tus clientes?
        </p>
        <Button asChild size="sm">
          <Link href="/signup">Regístrate en Sevenz</Link>
        </Button>
      </div>
    </div>
  );
}
