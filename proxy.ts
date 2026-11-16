import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { routePublicHost } from "@/lib/public-link-routing";

export async function proxy(request: NextRequest) {
  // Customer pages on their own host, so an installed app does not swallow them
  // (lib/public-link.ts). A no-op while NEXT_PUBLIC_PUBLIC_LINK_ORIGIN is unset.
  const routed = routePublicHost(request);
  if (routed) return routed;
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
