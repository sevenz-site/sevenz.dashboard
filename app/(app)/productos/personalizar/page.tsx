import { redirect } from "next/navigation";
import { getCurrentUser, getRequestClient } from "@/lib/supabase/current-user";
import { CatalogBrandingForm } from "@/components/dashboard/catalog-branding-form";

// «PERSONALIZAR CATÁLOGO» (CT-170, phase 1). The form and its reasons are in
// `components/dashboard/catalog-branding-form.tsx`; this page only reads the owner's row.
//
// A FAILED READ IS SAID, not drawn as an empty form: an empty form saved by mistake would
// wipe the owner's colour, cover and message. The likeliest cause is an environment where
// migration 210 or 211 has not run yet, and the real error goes to the server log only.
export default async function PersonalizarCatalogoPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string }>;
}) {
  // Entered from Mi negocio (2026-11-18), the back arrow returns there; from the ⋮ menu of
  // Catálogo, to Catálogo. Anything else in `desde` falls back to Catálogo.
  const fromProfile = (await searchParams).desde === "negocio";
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const supabase = await getRequestClient();
  const { data: owner, error } = await supabase
    .from("owners")
    .select("business_name, logo_path, address, brand_color, catalog_cover_path, catalog_welcome, brand_description, catalog_show_address")
    .eq("id", user.id)
    .single();

  if (error || !owner) {
    console.error("[personalizar] owners:", error?.message);
    return (
      <div className="flex flex-col gap-2 py-6">
        <h1 className="text-2xl font-semibold">Personalizar catálogo</h1>
        <p className="text-sm text-muted-foreground">
          No pudimos cargar tu catálogo. Vuelve a intentarlo en un momento.
        </p>
      </div>
    );
  }

  return (
    <CatalogBrandingForm
      ownerId={user.id}
      businessName={owner.business_name ?? ""}
      logoPath={owner.logo_path ?? null}
      address={owner.address ?? null}
      brandColor={owner.brand_color ?? null}
      coverPath={owner.catalog_cover_path ?? null}
      welcome={owner.catalog_welcome ?? null}
      description={owner.brand_description ?? null}
      showAddress={Boolean(owner.catalog_show_address)}
      backHref={fromProfile ? "/profile" : "/productos"}
      backLabel={fromProfile ? "Volver a Mi negocio" : "Volver a Catálogo"}
    />
  );
}
