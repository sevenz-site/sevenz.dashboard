// The icons of the catalogue's extra link (migration 225, frames `2291:25034`): Instagram,
// Facebook and TikTok. «Sitio web» uses lucide's `Globe`.
//
// OUR OWN, because lucide 1.x ships no brand icons. Instagram and Facebook are the outline
// glyphs lucide had before removing them, so they sit next to `Globe` with the same 2px
// stroke; TikTok has no outline form and is the filled glyph, which reads at 20px.
//
// `currentColor`, like `WhatsappIcon`: each button sets its own colour (dark text on the
// white header, white on the dark one) and the icon follows.

import { Globe } from "lucide-react";
import type { LinkKind } from "@/lib/catalog/extra-link";

type IconProps = React.ComponentProps<"svg">;

// The icon of each kind of extra link, in ONE place: the owner's selector and the
// customer's button draw the same one (CLAUDE.md, a visual value in two screens is born
// in a component).
export function LinkKindIcon({ kind, className }: { kind: LinkKind; className?: string }) {
  if (kind === "instagram") return <InstagramIcon className={className} />;
  if (kind === "facebook") return <FacebookIcon className={className} />;
  if (kind === "tiktok") return <TiktokIcon className={className} />;
  return <Globe className={className} aria-hidden="true" />;
}

export function InstagramIcon({ className, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
    </svg>
  );
}

export function FacebookIcon({ className, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
    </svg>
  );
}

export function TiktokIcon({ className, ...props }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} {...props}>
      <path
        fill="currentColor"
        d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"
      />
    </svg>
  );
}
