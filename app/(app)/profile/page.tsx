import { createClient } from "@/lib/supabase/server";
import { getPublicLogoUrl } from "@/lib/supabase/storage";
import { BusinessSettingsForm } from "@/components/dashboard/business-settings-form";
import { ScreenBackRow } from "@/components/dashboard/screen-back-row";
import { CarteraBackButton } from "@/components/dashboard/cartera-back-button";
import type { Owner } from "@/lib/types";
import { ScreenTitle } from "@/components/dashboard/screen-chrome";
import { mySecondFactor } from "@/lib/security/second-factor";

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: owner }, { data: paymentMethods }, secondFactor] = await Promise.all([
    supabase.from("owners").select("*").eq("id", user!.id).single(),
    // Migration 179. Oldest first, so a new method lands at the bottom of the
    // list where the owner just tapped "Agregar".
    supabase
      .from("owner_payment_methods")
      .select("id, body")
      .eq("owner_id", user!.id)
      .order("created_at", { ascending: true }),
    // C1 of PL-22: the session may ask one thing about its own factor, through my_second_factor.
    mySecondFactor(supabase),
  ]);

  if (!owner) return null;

  const logoUrl = owner.logo_path ? getPublicLogoUrl(owner.logo_path) : null;

  // The line under the title («Estos datos se usan en tu cartera y en lo que
  // ven tus clientes») went on 2026-11-02: frame `1928:24764` has none.
  return (
    <div className="flex flex-1 flex-col gap-6">
      {/* Replaces the app header on a phone (see AppHeader), so it behaves like
          one: flush to the top, edge to edge. The negative margins cancel main's
          p-4 and px-4 restores the inset for the content itself. Hidden from sm
          up, where the real header returns. */}
      <ScreenBackRow>
        <CarteraBackButton />
      </ScreenBackRow>
      <ScreenTitle>Mi negocio</ScreenTitle>

      <BusinessSettingsForm owner={owner as Owner} logoUrl={logoUrl} paymentMethods={paymentMethods ?? []} secondFactor={secondFactor} />
    </div>
  );
}
