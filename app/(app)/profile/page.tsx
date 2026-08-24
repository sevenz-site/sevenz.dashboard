import { createClient } from "@/lib/supabase/server";
import { getPublicLogoUrl } from "@/lib/supabase/storage";
import { BusinessSettingsForm } from "@/components/dashboard/business-settings-form";
import { ChangePasswordDialog } from "@/components/dashboard/change-password-dialog";
import type { Owner, OwnerExchangeSettings } from "@/lib/types";

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: owner } = await supabase
    .from("owners")
    .select("*")
    .eq("id", user!.id)
    .single();

  if (!owner) return null;

  const logoUrl = owner.logo_path ? getPublicLogoUrl(owner.logo_path) : null;

  // The whole exchange-rate section is gated on country — it never renders
  // (and these two queries never run) for a 'CO' owner.
  let exchangeSettings: OwnerExchangeSettings | null = null;
  let currentBcvUsd: number | null = null;
  let currentBcvEur: number | null = null;
  if (owner.country === "VE") {
    const [{ data: settings }, { data: currentRate }] = await Promise.all([
      supabase.from("owner_exchange_settings").select("*").eq("owner_id", user!.id).maybeSingle(),
      supabase.rpc("get_current_bcv_rate").maybeSingle(),
    ]);
    exchangeSettings = settings as OwnerExchangeSettings | null;
    const rate = currentRate as unknown as { usd: number; eur: number } | null;
    currentBcvUsd = rate?.usd ?? null;
    currentBcvEur = rate?.eur ?? null;
  }

  return (
    <div className="flex flex-1 flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Mi negocio</h1>
        <p className="text-sm text-muted-foreground">
          Estos datos se usan en tu cartera y en lo que ven tus clientes.
        </p>
      </div>

      <BusinessSettingsForm
        owner={owner as Owner}
        logoUrl={logoUrl}
        exchangeSettings={exchangeSettings}
        currentBcvUsd={currentBcvUsd}
        currentBcvEur={currentBcvEur}
      />

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium text-muted-foreground">Contraseña</h2>
        <ChangePasswordDialog />
      </section>
    </div>
  );
}
