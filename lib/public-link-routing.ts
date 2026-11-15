import { NextResponse, type NextRequest } from "next/server";
import { isPublicLinkPath, publicLinkOrigin } from "@/lib/public-link";

// THE TWO HOSTS, KEPT APART. The reasons for a second host are in `lib/public-link.ts`.
// This runs first in `proxy.ts`, before the session lookup, and does nothing at all while
// `NEXT_PUBLIC_PUBLIC_LINK_ORIGIN` is unset.
//
// 1. ON THE APP HOST, a customer page is sent to the public host. That keeps every link
//    already out there working: the WhatsApp templates write `app.sevenz.site/s/{{1}}`
//    and Meta does not let an approved template be edited, and owners have months of
//    links in their chats.
//      EXCEPT the owner's own «Vista previa» (`?previa=1`). Owner's decision of
//    2026-10-15 (`components/dashboard/catalog-share.tsx`): the preview opens INSIDE the
//    app, because `window.open` in the installed app showed a system tab with the URL
//    bar. Sending it to another host would bring that tab back.
//    307, not 308: a browser keeps a 308 for good, and this must be undoable by unsetting
//    the variable.
//
// 2. ON THE PUBLIC HOST, an owner page is sent back to the app host, so nobody ends up
//    signed in on the customers' host (a separate cookie jar, a separate install prompt).
//    Only page paths: `/_next`, the API and files with an extension are served as they
//    are. Needs `NEXT_PUBLIC_APP_ORIGIN`; without it those pages are served where asked,
//    which is harmless, only untidy.
//
// THE LOOP GUARD, `redirectTo`. Next rewrites a proxy redirect into a RELATIVE one whenever
// the target's host equals `request.nextUrl.host` (`relativizeURL` in
// `next/dist/server/web/adapter.js`). `nextUrl` is built from `request.url`, which is not
// always the Host header: under `next dev` every request reads as `localhost:3000`. There,
// «go to the app host» came out as `Location: /dashboard`, which the browser follows on the
// SAME public host -- a redirect loop. Measured 2026-11-15. So a redirect is only sent when
// Next cannot turn it relative; otherwise the page is served where it was asked.
function redirectTo(request: NextRequest, target: string): NextResponse | null {
  let host: string;
  try {
    host = new URL(target).host;
  } catch {
    console.error("routePublicHost: not a URL", target);
    return null;
  }
  if (host === request.nextUrl.host) return null;
  return NextResponse.redirect(target, 307);
}

export function routePublicHost(request: NextRequest): NextResponse | null {
  const publicOrigin = publicLinkOrigin();
  if (!publicOrigin) return null;

  let publicHost: string;
  try {
    publicHost = new URL(publicOrigin).host;
  } catch {
    console.error("routePublicHost: NEXT_PUBLIC_PUBLIC_LINK_ORIGIN is not a URL");
    return null;
  }

  const { pathname, search, searchParams } = request.nextUrl;
  const host = request.headers.get("host") ?? request.nextUrl.host;
  const isGet = request.method === "GET" || request.method === "HEAD";

  if (host !== publicHost) {
    const isCustomerPage = pathname.startsWith("/s/") || pathname.startsWith("/c/");
    if (isGet && isCustomerPage && searchParams.get("previa") !== "1") {
      return redirectTo(request, `${publicOrigin}${pathname}${search}`);
    }
    return null;
  }

  const appOrigin = process.env.NEXT_PUBLIC_APP_ORIGIN?.trim().replace(/\/+$/, "");
  const isAsset =
    pathname.startsWith("/_next/") || pathname.startsWith("/api/") || /\/[^/]*\.[a-z0-9]+$/i.test(pathname);
  if (appOrigin && isGet && !isPublicLinkPath(pathname) && !isAsset) {
    return redirectTo(request, `${appOrigin}${pathname}${search}`);
  }
  return null;
}
