"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

// Wraps <main> purely so the bottom padding can follow whether MobileNav
// actually renders. That reservation is unconditional by design — the bar
// unmounts while a dialog or the keyboard is open, and a padding that came
// and went with it would make the page jump underneath the owner. But
// MobileNav renders nothing at all on a client's own screen, so there the
// reserved strip is permanent dead air below the content.
//
// Same predicate as MobileNav's, trailing slash included: /clients (the list)
// keeps its bar, only /clients/<id> loses it. If one changes the other has to.
export function AppMain({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const hasBar = !pathname.startsWith("/clients/");

  return (
    <main
      className={cn(
        "flex flex-1 flex-col gap-4 p-4 md:pb-4",
        hasBar
          ? "pb-[calc(4rem+env(safe-area-inset-bottom)+1rem)]"
          : "pb-[calc(env(safe-area-inset-bottom)+1rem)]",
      )}
    >
      {children}
    </main>
  );
}
