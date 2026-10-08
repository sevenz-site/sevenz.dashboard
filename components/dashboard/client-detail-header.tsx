"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ClientAvatar } from "@/components/dashboard/client-avatar";
import { ClientHeaderActions } from "@/components/dashboard/client-header-actions";
import { ShareActions } from "@/components/dashboard/share-actions";
import { useCollapseOnScroll } from "@/hooks/use-collapse-on-scroll";
import { formatDocumentId } from "@/lib/format";
import type { Client, OwnerCountry } from "@/lib/types";

// THE DARK HEADER OF THE CLIENT DETAIL — from the Figma spec of 2026-10-04
// (frame `1082:6047`, node `header`).
//
// It is the fourth dark header and the first that is not a list screen: back
// arrow and the ⋮ menu on one row, then the photo, the name, Cédula / Teléfono
// / Dirección, and "Compartir saldo vía WhatsApp" inside the block.
//
// It replaces the `sm:hidden`-ish bar that used to sit here (sticky on a phone,
// static from sm up) plus the centred name-and-contact column below it. Those
// were two separate things that happened to be adjacent; the spec makes them
// one surface, so `app-header.tsx` now hides the app bar on this route at every
// width, like it already does for Inicio, Clientes, Malas pagas and Papelera.
//
// ─────────────────────────────────────────────────────────────────────────
// WHY IT IS NOT `ScreenHeader`
//
// That one takes `title`/`subtitle`/`action`/`search`/`filters`. This one has a
// photo, a ⋮ menu, three lines of contact data and a labelled button, and no
// search and no filters. Sharing the component would mean a prop per
// difference and two screens that break each other. What they DO share is the
// collapse rule, which is why that lives in `useCollapseOnScroll`.
//
// ─────────────────────────────────────────────────────────────────────────
// NOT ONE SEMANTIC TOKEN ON THIS SURFACE
//
// `--brand-primary` is the same value in light and in dark, so a colour that
// inverts is exactly what breaks here unnoticed. Two concrete cases this
// header already had to fix: `Button variant="outline"` paints `bg-background`
// — white in the light theme — and `ClientAvatar`'s fallback is `bg-muted`,
// also light. Both now come from the brand layer. Measured with
// `npm run qa:contraste`.
//
// ─────────────────────────────────────────────────────────────────────────
// WHAT COLLAPSES
//
// The photo, the name and the contact lines — 224px of a 375×667 phone. The
// back arrow, the ⋮ menu and the WhatsApp button stay, because they are what
// the owner reaches for while scrolling a long history.
//
// The name then reappears NEXT TO THE ARROW, which is where this screen departs
// from `ScreenHeader`. There the collapsing title says "Clientes", something
// you already know by the time you have scrolled. Here it is whose account you
// are reading — the one thing on the page you cannot reconstruct from the rows
// below. It is rendered in one place or the other and never both: two `h1`s
// would be wrong twice over, as markup and as a thing to keep in sync.
export function ClientDetailHeader({
  client,
  ownerCountry,
  backHref,
  backLabel,
  balanceText,
  owesMoney,
  hasMovements,
  ownerId,
}: {
  client: Client;
  ownerCountry: OwnerCountry;
  // Computed by the page from where the owner came in: a client opened from
  // the Papelera goes back to the Papelera, not to Cartera, which is a list
  // they are not on.
  backHref: string;
  backLabel: string;
  balanceText: string;
  owesMoney: boolean;
  hasMovements: boolean;
  ownerId: string;
}) {
  // Nothing to freeze on this screen: there is no search field to type in, so
  // the collapse has no reason to pause. The other three pass the field's
  // focus state for the iOS keyboard case.
  const { collapsed, collapsibleRef } = useCollapseOnScroll(false);

  const rows = [
    { label: "Cédula", value: formatDocumentId(client.document_id) },
    { label: "Teléfono", value: client.whatsapp || "—" },
    { label: "Dirección", value: client.address || "—" },
  ];

  return (
    // One sticky element, not three. A `sticky` child only sticks inside its
    // containing block, so pinning the rows one by one unpins them the moment
    // the dark div scrolls past — `home-header.tsx` learned that the hard way.
    <header className="sticky top-0 z-20 -mx-4 -mt-4 flex flex-col bg-brand-primary">
      {/* 16 all round, per the spec. No padding or gap on the header itself:
          each row carries its own and they are not the same — 0/16/16/16 for
          the photo block and 16/16/24/16 for the button. */}
      <div className="flex items-center justify-between gap-3 px-4 py-4">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href={backHref}
            aria-label={backLabel}
            className="-m-2 shrink-0 rounded-md p-2 text-brand-muted outline-none transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-white/40"
          >
            <ArrowLeft className="size-6" aria-hidden="true" />
          </Link>
          {collapsed ? (
            <h1 className="truncate text-lg font-medium text-white">{client.name}</h1>
          ) : null}
        </div>
        <ClientHeaderActions
          clientId={client.id}
          clientName={client.name}
          whatsapp={client.whatsapp}
          balanceText={balanceText}
          owesMoney={owesMoney}
          hasMovements={hasMovements}
          trashedAt={client.trashed_at}
          client={client}
          ownerCountry={ownerCountry}
          onDark
        />
      </div>

      {/* One wrapper around everything that disappears, because the hook
          MEASURES it: the threshold that stops the collapse oscillating is
          derived from this element's height. Splitting it into siblings is how
          the flicker of 2026-10-04 came back. */}
      {collapsed ? null : (
        <div ref={collapsibleRef} className="flex flex-col items-center gap-3.5 px-4 pb-4">
          <ClientAvatar
            clientId={client.id}
            clientName={client.name}
            ownerId={ownerId}
            picturePath={client.profile_picture_path}
            editable={!client.trashed_at}
            onDark
          />

          {/* 24px, regular, #F5F5F5 — 13,70:1 on this header. `min-w-0` plus
              `truncate` rather than wrapping: a four-word name pushing the
              contact lines down moves the button, and the button is the thing
              the owner is aiming at. */}
          <h1 className="w-full truncate text-center text-2xl font-normal text-[#f5f5f5]">
            {client.name}
          </h1>

          {/* Labels on screen and not only in `dt`: an empty value keeps its
              row and shows a dash, so the absence of a phone or an address is
              itself visible instead of the row vanishing and the block
              changing height per client. */}
          <dl className="flex w-full flex-col gap-1 text-sm text-brand-muted">
            {rows.map((row) => (
              <div key={row.label} className="flex items-center justify-center gap-1.5">
                <dt>{row.label}:</dt>
                <dd className="min-w-0 truncate">{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {/* 24 below and 16 above, from the spec. The bigger gap underneath is
          what separates the dark block from the page, and the collapsed header
          leans on it too. */}
      <div className="px-4 pt-4 pb-6">
        <ShareActions
          clientId={client.id}
          clientName={client.name}
          whatsapp={client.whatsapp}
          balanceText={balanceText}
          variant="whatsapp-button"
          ownerCountry={ownerCountry}
        />
      </div>
    </header>
  );
}
