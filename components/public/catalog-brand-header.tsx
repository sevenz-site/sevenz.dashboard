import Image from "next/image";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

// THE CATALOGUE'S HEADER WITH THE OWNER'S BRAND (CT-170, phase 1), frames `2115:21736`
// (phone, cover and a light colour), `2115:21772` (phone, no cover, a dark colour and the
// address) and `2115:21823` (web, 1280). Approved by the owner on 2026-11-12.
//
// Top to bottom: the cover, when there is one (125px tall on a phone, 280px on the web,
// cropped to fill: it is a banner, not a product); then a band in the brand colour with
// the logo in a white circle, the business name, the welcome message, the address and the
// note about bolívares. Without a cover the band starts the page, with 28px above the logo.
//
// THE COLOURS COME FROM `--catalog-brand` / `--catalog-brand-foreground`, set by the
// catalogue page (`lib/catalog/brand-style.ts`), so the band and the selected chip cannot
// disagree. Unset, the band is the catalogue's old #272727 with #DADADA on
// it -- the frame's own note: «Sin color elegido, el catálogo se ve como hoy».
//
// ONLY WHEN THE OWNER CUSTOMISED SOMETHING. A catalogue with no colour, no cover, no
// welcome and no address keeps `PublicHeader`, the header it had before CT-170, watermark
// included: an owner who never opened «Personalizar catálogo» sees nothing move. The page
// makes that choice (`hasCatalogBranding`).
//
// The text column is capped at 560px on the web, as the frame notes: «El texto de la
// cabecera no pasa de 560 px de ancho».
export function CatalogBrandHeader({
  logoUrl,
  logoIsRemote,
  title,
  coverUrl,
  welcome,
  address,
  note,
  back,
  backSlot,
}: {
  logoUrl: string;
  logoIsRemote: boolean;
  title: string;
  coverUrl?: string | null;
  welcome?: string | null;
  address?: string | null;
  note?: ReactNode;
  back?: { href: string; label: string };
  // `BackToBalance`, which draws itself only when the client came from his balance link.
  backSlot?: ReactNode;
}) {
  return (
    <header className="relative isolate w-full overflow-hidden">
      {back ? (
        <Link
          href={back.href}
          aria-label={back.label}
          // On a dark disc: it can sit on a cover photo of any colour, or on the band.
          className="absolute top-4 left-4 z-10 flex size-10 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-colors hover:bg-black/55"
        >
          <ArrowLeft className="size-5" aria-hidden="true" />
        </Link>
      ) : (
        backSlot
      )}

      {coverUrl ? (
        <div className="relative h-[125px] w-full bg-muted md:h-[280px]">
          {/* `unoptimized`: a Supabase public URL of an image already resized on the
              owner's device, served like the logo. */}
          <Image src={coverUrl} alt="" fill unoptimized priority sizes="100vw" className="object-cover" />
        </div>
      ) : null}

      <div
        className={`flex flex-col items-center gap-2.5 bg-[color:var(--catalog-brand,#272727)] px-4 pb-6 text-center text-[color:var(--catalog-brand-foreground,#DADADA)] md:px-12 ${
          coverUrl ? "" : "pt-7"
        }`}
      >
        <div className="relative size-[76px] shrink-0 overflow-hidden rounded-full border-3 border-white bg-white">
          <Image
            src={logoUrl}
            alt=""
            width={76}
            height={76}
            unoptimized={logoIsRemote}
            className="size-full object-cover"
          />
        </div>
        <h1 className="w-full max-w-[560px] text-2xl leading-[35px] font-bold break-words md:text-[28px] md:leading-[41px]">
          {title}
        </h1>
        {welcome ? (
          <p className="w-full max-w-[560px] text-[15px] leading-[22px] break-words">{welcome}</p>
        ) : null}
        {address ? (
          // `⌖` as the frame writes it (nodes `2115:21744` and `2115:21781`).
          <p className="w-full max-w-[560px] text-[13px] leading-[19px] font-medium break-words">
            ⌖&nbsp;&nbsp;{address}
          </p>
        ) : null}
        {note ? <p className="w-full max-w-[560px] text-xs leading-[17px]">{note}</p> : null}
      </div>
    </header>
  );
}

// Whether the owner customised anything that the header shows. Shared by the catalogue
// page and the owner's «Ver cómo queda» preview, so the two decide alike.
export function hasCatalogBranding(b: {
  brand_color?: string | null;
  catalog_cover_path?: string | null;
  catalog_welcome?: string | null;
  catalog_address?: string | null;
}): boolean {
  return Boolean(b.brand_color || b.catalog_cover_path || b.catalog_welcome || b.catalog_address);
}
