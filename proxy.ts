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

// `.well-known/` is excluded for the Play Store app (PL-48, docs PLAY-STORE-PLAN.md §7,
// step 1.1). Android fetches /.well-known/assetlinks.json with no session to check that
// the app and app.sevenz.site belong together. Through updateSession, a signed-out
// request is redirected to /login, the check fails, and the app opens with Chrome's
// address bar on top. Nothing errors: the bar simply appears. So the file must answer
// 200 with JSON, with no session and no redirect.
//
// The file holds `[]` until Play Console shows the signing fingerprints. Every one of
// them goes in (Google's "quantum-ready" signing uses several keys), plus the upload
// key's for local testing.
//
// `.wasm` is excluded for the barcode scanner (CT-182): its reader is a static file in
// public/wasm/, like the images in this list. Through updateSession every opening of the
// scanner cost a session check, and an owner whose session had just expired got the
// /login page instead of the reader -- the camera opened and never read anything, with
// no error he could read. Found on dev.sevenz.site on 2026-11-23 (307 to /login).
//
// `offline.html` is excluded for the «Sin conexión» screen (PL-48, step 1.2): public/sw.js
// caches it on install, and through updateSession a signed-out phone, which is every
// phone on the login screen, would cache the /login redirect instead of the page.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|offline\\.html|\\.well-known/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|wasm)$).*)",
  ],
};
