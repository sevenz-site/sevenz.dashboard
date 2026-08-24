import { createClient } from "@/lib/supabase/server";
import { getPublicLogoUrl } from "@/lib/supabase/storage";
import { BusinessSettingsForm } from "@/components/dashboard/business-settings-form";
import { ChangePasswordDialog } from "@/components/dashboard/change-password-dialog";
import type { Owner } from "@/lib/types";

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

  return (
    <div className="flex flex-1 flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Mi negocio</h1>
        <p className="text-sm text-muted-foreground">
          Estos datos se usan en tu cartera y en lo que ven tus clientes.
        </p>
      </div>

      <BusinessSettingsForm owner={owner as Owner} logoUrl={logoUrl} />

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium text-muted-foreground">Contraseña</h2>
        <ChangePasswordDialog />
      </section>
    </div>
  );
}
