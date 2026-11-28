import Image from "next/image";
import { getPublicLogoUrl } from "@/lib/supabase/storage";
import { customerEndDay, maxPercent, type SharedPromotion } from "@/lib/promotions/pricing";
import { dayLabel } from "@/lib/promotions/rules";

// THE PROMOTION'S BANNER ABOVE THE PRODUCTS (CT-184, frames 10, 11 and 16 of `2300:21627`):
// the owner's image when he uploaded one (115px tall on a phone, 280 on the web, cropped to
// fill like the catalogue cover), then «<name> · hasta N% menos» and when it ends -- or, in
// the extension the owner switched on, «¡Extendida hasta el …!».
//
// Under the header, in BOTH headers (the white one of a customised catalogue and the dark one):
// it belongs to the product list, not to the shop's identity.
export function PromotionBanner({ promo }: { promo: SharedPromotion }) {
  const pct = maxPercent(promo);
  return (
    <section aria-label={`Promoción ${promo.name}`} className="flex flex-col gap-2.5">
      {promo.banner_path ? (
        <div className="relative h-[115px] w-full overflow-hidden rounded-xl bg-muted md:h-[280px] md:rounded-2xl">
          {/* `unoptimized`: a Supabase public URL of an image resized on the owner's device. */}
          <Image src={getPublicLogoUrl(promo.banner_path)} alt="" fill unoptimized sizes="100vw" className="object-cover" />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-base leading-[22px] font-semibold md:text-xl md:leading-7">
          {promo.name}
          {pct > 0 ? ` · hasta ${pct}% menos` : ""}
        </p>
        {promo.extended ? (
          <span className="rounded-full bg-orange-50 px-2 py-0.5 text-xs leading-4 font-medium text-orange-700">
            ¡Extendida hasta el {dayLabel(promo.last_day)}!
          </span>
        ) : (
          <span className="text-[13px] leading-[18px] text-muted-foreground">Termina el {dayLabel(customerEndDay(promo))}</span>
        )}
      </div>
    </section>
  );
}
