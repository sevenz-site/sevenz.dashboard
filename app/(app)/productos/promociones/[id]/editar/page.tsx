import { notFound, redirect } from "next/navigation";
import { getCurrentUser, getRequestClient } from "@/lib/supabase/current-user";
import { loadPromoProducts, loadPromotions } from "@/lib/promotions/load";
import { PromotionWizard } from "@/components/dashboard/promotion-wizard";

// «Editar promoción» (CT-184, frame 9's «Editar»): the same wizard, filled. While it is active,
// the changes apply to new orders; orders already received keep their prices (they are stored
// on each order line by migration 228).
export default async function EditarPromocionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const supabase = await getRequestClient();
  const [data, catalog] = await Promise.all([loadPromotions(supabase, user.id), loadPromoProducts(supabase, user.id)]);
  const promo = data?.rows.find((r) => r.id === id);
  if (!data || !promo) notFound();
  return (
    <PromotionWizard ownerId={user.id} today={data.today} initial={promo} products={catalog.products} categories={catalog.categories} />
  );
}
