// The shape of the customer-facing contact buttons: «Contactar vía WhatsApp»
// (`contact-whatsapp-link.tsx`) and the catalogue's extra link
// (`catalog-contact-buttons.tsx`), so the two sit side by side as one pair (migration 225).
//
// IN ITS OWN FILE, NOT EXPORTED FROM `contact-whatsapp-link.tsx`, and that is not tidiness:
// that file is "use client", and a server component that imports a constant from a client
// module receives a client reference, not the string. Found on 2026-11-26 in the browser:
// the catalogue page (a server component) drew the Instagram button with
// `class="text-white md:flex-1"` and nothing else -- no border, the icon under the text --
// while the owner's preview, a client component, drew it right.

export const PUBLIC_CONTACT_BUTTON =
  "flex h-10 w-full min-w-0 items-center justify-center gap-2 rounded-lg border px-4 text-[17px] outline-none transition-colors";

export const PUBLIC_CONTACT_TONE = {
  dark: "border-brand-secondary hover:bg-white/10 focus-visible:border-white focus-visible:ring-3 focus-visible:ring-white/40",
  light: "border-border bg-white hover:bg-neutral-50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
} as const;
