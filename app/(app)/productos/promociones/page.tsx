import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, getRequestClient } from "@/lib/supabase/current-user";
import { loadPromotions } from "@/lib/promotions/load";
import { ScreenBackRow } from "@/components/dashboard/screen-back-row";
import { ScreenTitle } from "@/components/dashboard/screen-chrome";
import { StickyActions } from "@/components/dashboard/sticky-actions";
import { Button } from "@/components/ui/button";
import { PromotionStatusChip } from "@/components/dashboard/promotion-status-chip";
import { countOf, dayLabel, rangeLabel } from "@/lib/promotions/rules";

// «PROMOCIONES» (CT-184), frames 1 and 2 of section `2300:21627`: the owner's promotions, most
// recent first, each with its state, dates, %, products and code; or, with none, the empty
// state. Entered from the ⋮ menu of Catálogo.
export default async function PromocionesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const supabase = await getRequestClient();
  const data = await loadPromotions(supabase, user.id);

  return (
    <div className="flex min-h-full flex-col">
      <ScreenBackRow href="/productos" label="Volver a Catálogo" soloEnTelefono={false} />
      {/* The app's title, as in «Nueva venta» (frames 1 and 2, adjusted by the owner on 2026-11-28). */}
      <ScreenTitle className="pt-4 pb-2">Promociones</ScreenTitle>

      {data == null ? (
        <p className="py-6 text-sm text-muted-foreground">No pudimos cargar tus promociones. Vuelve a intentarlo en un momento.</p>
      ) : data.rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-24 text-center md:max-w-[560px]">
          <p className="text-lg leading-[26px] font-semibold">Todavía no tienes promociones</p>
          <p className="text-sm leading-5 text-muted-foreground">
            Crea una para rebajar tus precios unos días, como en el Black Friday. Tus clientes la ven en tu catálogo.
          </p>
          <Button asChild className="h-10">
            <Link href="/productos/promociones/nueva">Crear promoción</Link>
          </Button>
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-3 py-4 md:max-w-[560px]">
            {data.rows.map((p) => (
              <li key={p.id}>
                <Link href={`/productos/promociones/${p.id}`} className="flex flex-col gap-1.5 rounded-[10px] border p-3.5 transition-colors hover:bg-accent/40">
                  <span className="flex items-center gap-2">
                    <span className="flex-1 text-base leading-[22px] font-semibold">{p.name}</span>
                    <PromotionStatusChip status={p.status} />
                  </span>
                  <span className="text-[13px] leading-[19px] text-muted-foreground">
                    {rangeLabel(p.startsOn, p.endsOn)}
                    {p.extendedUntil ? ` · se extiende al ${dayLabel(p.extendedUntil)}` : ""}
                  </span>
                  <span className="text-[13px] leading-[19px] text-muted-foreground">
                    {p.groups.map((g) => `${g.percent}%`).join(" y ")}
                    {p.groups.some((g) => g.allProducts) ? " · incluye todos los productos" : ` · ${countOf(p.groups.reduce((n, g) => n + g.productIds.length, 0), "producto", "productos")}`}
                  </span>
                  <span className="text-[13px] leading-[19px] text-muted-foreground">
                    {p.code ? `Código ${p.code} · ${p.codePercent}% extra` : "Sin código"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <StickyActions>
            <Button asChild className="h-10 w-full md:w-[200px]">
              <Link href="/productos/promociones/nueva">Crear promoción</Link>
            </Button>
          </StickyActions>
        </>
      )}
    </div>
  );
}
