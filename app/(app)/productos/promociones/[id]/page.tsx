import Link from "next/link";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser, getRequestClient } from "@/lib/supabase/current-user";
import { loadPromoProducts, loadPromotions } from "@/lib/promotions/load";
import { getPublicLogoUrl } from "@/lib/supabase/storage";
import { ScreenBackRow } from "@/components/dashboard/screen-back-row";
import { StickyActions } from "@/components/dashboard/sticky-actions";
import { Button } from "@/components/ui/button";
import { PromotionStatusChip } from "@/components/dashboard/promotion-status-chip";
import { EndPromotionButton } from "@/components/dashboard/end-promotion-button";
import { coveredIds, dayLabel, groupLine } from "@/lib/promotions/rules";
import { ScreenTitle } from "@/components/dashboard/screen-chrome";

// A PROMOTION'S DETAIL (CT-184, frame 9 of `2300:21627`): its state, dates, %, code and how
// many catalogue orders it has had; «Editar», «Cambiar la fecha extendida» (the same wizard)
// and «Terminar ahora». An ended one is read-only.
export default async function PromocionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const supabase = await getRequestClient();
  const [data, { products }] = await Promise.all([loadPromotions(supabase, user.id), loadPromoProducts(supabase, user.id)]);
  const productIds = products.map((x) => x.id);
  const p = data?.rows.find((r) => r.id === id);
  if (!data || !p) notFound();

  const when =
    p.status === "scheduled"
      ? `Empieza el ${dayLabel(p.startsOn)}`
      : p.status === "ended"
        ? // Ended with «Terminar ahora»: the day the owner ended it, not `lastDay` (that day
          // minus one, the last FULL day). Showing `lastDay` said «Terminó el 27 nov» for a
          // promotion started and ended on the 28th -- browser QA of 2026-11-28.
          `Terminó el ${dayLabel(p.endedOn && p.endedOn <= (p.extendedUntil ?? p.endsOn) ? p.endedOn : p.lastDay)}`
        : `Termina el ${dayLabel(p.lastDay)} a las 11:59 p. m.`;
  const rows: [string, string][] = [
    ["Fechas", `${dayLabel(p.startsOn)} – ${dayLabel(p.endsOn, true)}.${p.extendedUntil ? ` Se extiende hasta el ${dayLabel(p.extendedUntil)}.` : ""}`],
    // Frame 9 as approved on 2026-11-28: one line per group with both prices' %, and the
    // products it covers today (the «Precio al mayor» row is gone, migration 230).
    ["Descuentos", p.groups.map((g, i) => groupLine(g, coveredIds(p.groups, i, productIds).length)).join("\n")],
    ["Pedidos con esta promoción", String(p.orders)],
  ];

  return (
    <div className="flex min-h-full flex-col">
      <ScreenBackRow href="/productos/promociones" label="Volver a Promociones" soloEnTelefono={false} />
      <ScreenTitle className="pt-4">{p.name}</ScreenTitle>
      <div className="flex flex-col gap-4 py-4 md:max-w-[560px]">
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <PromotionStatusChip status={p.status} />
          {when}
        </p>
        {p.bannerPath ? (
          <div className="relative aspect-[3/1] w-full overflow-hidden rounded-[10px] bg-muted">
            <Image src={getPublicLogoUrl(p.bannerPath)} alt="" fill unoptimized sizes="560px" className="object-cover" />
          </div>
        ) : null}
        <dl className="flex flex-col gap-3 rounded-[10px] border p-3.5">
          {rows.map(([k, v]) => (
            <div key={k} className="flex flex-col gap-0.5">
              <dt className="text-xs leading-[17px] text-muted-foreground">{k}</dt>
              <dd className="text-sm leading-5 font-medium whitespace-pre-line">{v}</dd>
            </div>
          ))}
        </dl>
        {p.status !== "ended" ? (
          <p className="text-xs leading-[17px] text-muted-foreground">
            Los cambios de porcentajes o productos se aplican a los pedidos nuevos. Los pedidos ya recibidos guardan su precio.
          </p>
        ) : null}
      </div>
      {p.status !== "ended" ? (
        <StickyActions>
          <div className="flex flex-col gap-2 md:flex-row">
            <Button asChild className="h-10 w-full md:w-[160px]">
              <Link href={`/productos/promociones/${p.id}/editar`}>Editar</Link>
            </Button>
            <Button asChild variant="outline" className="h-10 w-full md:w-auto">
              <Link href={`/productos/promociones/${p.id}/editar`}>Cambiar la fecha extendida</Link>
            </Button>
            <EndPromotionButton id={p.id} name={p.name} />
          </div>
        </StickyActions>
      ) : null}
    </div>
  );
}
