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
// REVISED BY THE OWNER ON 2026-11-15, frame `2163:955`, and this displaces the coloured
// band of the 2026-11-12 frames: *«se registra el color de la marca pero de momento no se
// aplica en ningún lugar, el background del header será blanco»*. So the band is WHITE with
// the app's primary text (#272727) whatever colour the owner picked; the colour is stored
// (`owners.brand_color`) and nothing reads it here. The selected category chip went back to
// its usual #272727 the same day. If the colour is ever applied again, the contrast rules
// are still in `lib/catalog/brand-color.ts`.
//
// NO COVER, A GREY ONE: owner's decision the same day, «Portada gris por defecto». A
// customised catalogue always opens with the cover's 125 / 280 px, so every white header has
// the same shape.
//
// ONLY WHEN THE OWNER CUSTOMISED SOMETHING, colour included: *«Cualquier cambio, color
// incluido»* (2026-11-15). A catalogue nobody customised keeps `PublicHeader`, the dark
// header it had before CT-170, watermark included -- *«Se queda oscura»*, the same day. The
// page makes that choice (`hasCatalogBranding`).
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
  actions,
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
  // Migration 225: «Contactar vía WhatsApp» and the extra link (`CatalogContactButtons`),
  // under the address and above the note, as frames `2291:25036` and `2291:25137` draw them.
  actions?: ReactNode;
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

      <div className="relative h-[125px] w-full bg-muted md:h-[280px]">
        {coverUrl ? (
          // `unoptimized`: a Supabase public URL of an image already resized on the owner's
          // device, served like the logo.
          <Image src={coverUrl} alt="" fill unoptimized priority sizes="100vw" className="object-cover" />
        ) : null}
      </div>

      {/* Node `2163:958`: white, padding 24 / 16, 10 between items, text #272727. */}
      <div className="flex flex-col items-center gap-2.5 bg-white px-4 py-6 text-center text-[#272727] md:px-12">
        <div className="relative size-[76px] shrink-0 overflow-hidden rounded-full border-3 border-white bg-[#F5F5F5]">
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
        {/* 6px on top of the 10px gap: the frames' 16 between the address and the buttons. */}
        {actions ? <div className="w-full pt-1.5">{actions}</div> : null}
        {/* `text-muted-foreground` since 2026-11-25, owner's request: the note about the
            rate sits one level below the address instead of reading as loud as it. The
            header's #272727 stays for everything else. The dark header without
            customisation (`PublicHeader`) already shows it in its own muted tone. */}
        {note ? <p className="w-full max-w-[560px] text-xs leading-[17px] text-muted-foreground">{note}</p> : null}
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
