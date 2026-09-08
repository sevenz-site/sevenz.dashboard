import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

// The back chevron above the login and signup cards.
//
// It goes to a different place on each screen, and that is the point: from
// login you leave the app entirely (sevenz.site), from signup you step back one
// screen (/login). Both are real destinations rather than history.back(), which
// does nothing at all for the visitor who opened the link directly — from a
// WhatsApp message, say, which is how most owners will arrive.
//
// The label is what a screen reader announces, so it names the destination
// instead of the direction: "Volver" alone tells a blind user nothing about
// where they are about to land.
export function AuthBackLink({
  href,
  label,
  external = false,
}: {
  href: string;
  label: string;
  external?: boolean;
}) {
  return (
    <div className="mx-auto w-full max-w-sm px-4 pt-4">
      <Button variant="ghost" size="icon" asChild className="-ml-2">
        {external ? (
          <a href={href} aria-label={label}>
            <ChevronLeft className="size-5" />
          </a>
        ) : (
          <Link href={href} aria-label={label}>
            <ChevronLeft className="size-5" />
          </Link>
        )}
      </Button>
    </div>
  );
}
