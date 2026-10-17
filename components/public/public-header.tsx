import Image from "next/image";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

// THE DARK BAND THAT OPENS BOTH PUBLIC PAGES.
//
// It was written for `/c/[token]` and lived inside that file until 2026-10-17,
// when the owner's frame `1378:7916` put the same band on top of `/s/[token]`
// as well -- so that a client who jumps from their balance to the catalogue
// and back is plainly looking at two screens of the SAME shop.
//
// EXTRACTED RATHER THAN COPIED, and that is not tidiness. These two pages are
// the only surfaces a stranger ever sees, and the band is what says who
// answers for them. Two copies drift: one gets the new logo treatment, the
// other keeps the old one, and nobody notices because no single person opens
// both in the same minute. The copy is the bug, not the duplication.
//
// `overflow-hidden` on the band and the watermark cropped at the top, as the
// frame draws it. Without it the watermark overflows and pushes the page's
// width -- the easiest layout fault to introduce here and the hardest to see
// on a desktop preview.
export function PublicHeader({
  logoUrl,
  logoIsRemote,
  title,
  subtitle,
  back,
  actions,
  children,
}: {
  logoUrl: string;
  // Supabase-hosted logos skip Next's optimizer; the bundled fallback does not.
  logoIsRemote: boolean;
  title: string;
  subtitle?: ReactNode;
  // A back arrow is only drawn when there is somewhere to go. A client who
  // opened this from a WhatsApp message came from nowhere, and an arrow that
  // leaves the page is an exit nobody asked for.
  back?: { href: string; label: string };
  // Top-right slot: today the "..." menu on the balance page, nothing on the
  // catalogue.
  actions?: ReactNode;
  // Anything that belongs inside the dark band, below the title. The balance
  // page puts its WhatsApp button here, which is what the frame draws.
  children?: ReactNode;
}) {
  return (
    <header className="relative isolate overflow-hidden bg-brand-primary px-6 pt-10 pb-8 text-center">
      {back ? (
        <Link
          href={back.href}
          aria-label={back.label}
          className="absolute top-4 left-4 z-10 flex size-10 items-center justify-center rounded-full text-white outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/40"
        >
          <ArrowLeft className="size-5" aria-hidden="true" />
        </Link>
      ) : null}

      {actions ? <div className="absolute top-4 right-4 z-10">{actions}</div> : null}

      <Image
        src="/logo-secundary.svg"
        alt=""
        aria-hidden="true"
        width={520}
        height={160}
        priority={false}
        className="pointer-events-none absolute -top-6 left-1/2 -z-10 w-[130%] max-w-none -translate-x-1/2 opacity-[0.06] select-none"
      />
      <Image
        src={logoUrl}
        alt=""
        width={96}
        height={96}
        unoptimized={logoIsRemote}
        className="mx-auto size-24 rounded-full border-2 border-white/10 object-cover"
      />
      <h1 className="pt-4 text-2xl font-semibold text-white">{title}</h1>
      {subtitle ? (
        <p className="mx-auto max-w-sm pt-2 text-sm leading-relaxed text-brand-muted">{subtitle}</p>
      ) : null}
      {children ? <div className="pt-6">{children}</div> : null}
    </header>
  );
}
