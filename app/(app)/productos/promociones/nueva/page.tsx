import { redirect } from "next/navigation";
import { getCurrentUser, getRequestClient } from "@/lib/supabase/current-user";
import { loadPromoProducts } from "@/lib/promotions/load";
import { businessToday } from "@/lib/promotions/rules";
import { PromotionWizard } from "@/components/dashboard/promotion-wizard";

// «Crear promoción» (CT-184). The wizard and its reasons are in
// `components/dashboard/promotion-wizard.tsx`.
export default async function NuevaPromocionPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const supabase = await getRequestClient();
  const [{ data: owner }, catalog] = await Promise.all([
    supabase.from("owners").select("country").eq("id", user.id).single(),
    loadPromoProducts(supabase, user.id),
  ]);
  return (
    <PromotionWizard
      ownerId={user.id}
      today={businessToday((owner?.country as string | null) ?? null)}
      initial={null}
      products={catalog.products}
      categories={catalog.categories}
    />
  );
}
