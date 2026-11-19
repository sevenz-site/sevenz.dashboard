import { RETURN_COOKIE, RETURN_MAX_AGE, safeReturnPath } from "@/lib/auth/return-after-login";
import {
  DEVICE_COOKIE,
  DEVICE_COOKIE_PATTERN,
  deviceCookieOptions,
  isPageVisit,
  rememberSessionDevice,
} from "@/lib/security/session-device";
import {
  STOCK_ALERTS_DAY_COOKIE,
  stockAlertsDayCookieOptions,
  stockAlertsDayValue,
} from "@/lib/stock-alerts-day";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return supabaseResponse;
  }

  const isAuthRoute =
    request.nextUrl.pathname.startsWith("/login") ||
    request.nextUrl.pathname.startsWith("/signup") ||
    request.nextUrl.pathname.startsWith("/forgot-password");
  const isPublicRoute =
    request.nextUrl.pathname.startsWith("/s/") ||
    // /c/ — the shareable catalogue, since 2026-10-09. Same reasoning as /s/:
    // the visitor is a customer with no account, so bouncing them to /login
    // makes the link they were sent do nothing. Found by reading this file
    // before testing, which is the only reason it did not ship broken: a
    // missing entry here fails as a redirect, not as an error, so the page
    // itself would have looked blameless.
    request.nextUrl.pathname.startsWith("/c/") ||
    // The recovery link itself signs the visitor in, so this route must
    // never bounce them to /dashboard the way other auth routes do —
    // otherwise they'd never reach the "set a new password" form.
    request.nextUrl.pathname.startsWith("/reset-password") ||
    request.nextUrl.pathname === "/" ||
    // Cron/service routes authenticate via their own Authorization: Bearer
    // $CRON_SECRET header, not a login session — Vercel Cron (and a manual
    // curl for testing) calls these with no session cookie at all, so they
    // must be exempt from the redirect-to-login check below. Each route
    // still enforces its own secret check and returns 401 on its own.
    request.nextUrl.pathname.startsWith("/api/cron/") ||
    // El aviso de "Contactar vía WhatsApp" de /s/[token], que lo manda el
    // CLIENTE y por tanto nunca trae sesión. Sin esta línea el proxy lo
    // redirige a /login con un 307 y el evento no llega nunca — el mismo
    // tropiezo que /c/ documenta justo arriba, y que falla igual de callado:
    // la petición "sale" del navegador y nadie la cuenta.
    //
    // La ruta no se fía de que esto la proteja: solo admite un token y emite
    // un nombre de evento fijo. Ver app/api/share-contact/route.ts.
    request.nextUrl.pathname === "/api/share-contact" ||
    // The same event family, sent by the same anonymous client. It was missing
    // from this list from the day the route was added, 2026-10-17, so every
    // client's tap answered 307 and `Catalog Opened From Share Link` only ever
    // counted people who happened to be signed in. The route guards itself the
    // same way: a token in, a fixed event name out.
    request.nextUrl.pathname === "/api/share-catalog" ||
    // Every other event from `/s` and `/c`. Same reason, and the route guards itself:
    // a code from a closed list in, nothing readable out.
    request.nextUrl.pathname === "/api/public-event" ||
    // The USDT price for the client's calculator on `/s/[token]` (2026-11-19). Without
    // this line it answers 307 and the USDT tab never appears, silently. The route
    // guards itself: a balance-link token in, a price or null out, behind a limiter.
    request.nextUrl.pathname === "/api/share-usdt" ||
    // «No fui yo» (C2 of PL-22): the owner taps it on a phone with no session, and when the
    // thief is the one signed in, that is the session it ends. The page guards itself: a
    // one-use token in, three fixed sentences out, and nothing closes on a GET.
    request.nextUrl.pathname.startsWith("/cuenta/no-fui-yo/") ||
    // The nudge email's unsubscribe (2026-11-17): the page behind the link in the body, and
    // the RFC 8058 one-click POST from the mail client. Both read with no session, and both
    // guard themselves: a signed token in, nothing but «off» out, and nothing changes on a GET.
    request.nextUrl.pathname.startsWith("/consejos/baja/") ||
    request.nextUrl.pathname === "/api/consejos/baja";

  // A public route's decision doesn't depend on who is asking, so skip the
  // session lookup entirely rather than paying for an answer nothing reads.
  // getUser() is a network round trip to Supabase Auth on every single
  // request, and /s/ — the balance link an owner sends to every client at
  // once — is both the burstiest path in the app and the one where the
  // visitor is guaranteed not to have a session to validate. /c/ is the same
  // shape: one link shared to many people, none of them with an account.
  //
  // /reset-password is deliberately still public-but-checked below: it needs
  // no redirect either way, and the branch that follows leaves it alone.
  if (isPublicRoute && !isAuthRoute) {
    return supabaseResponse;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          supabaseResponse = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            supabaseResponse.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isAuthRoute && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    const response = NextResponse.redirect(url);
    // A button in a WhatsApp template opens Reportes: see lib/auth/return-after-login.ts.
    const destino = safeReturnPath(`${request.nextUrl.pathname}${request.nextUrl.search}`);
    if (destino && request.method === "GET") {
      response.cookies.set(RETURN_COOKIE, destino, {
        httpOnly: true,
        sameSite: "lax",
        secure: request.nextUrl.protocol === "https:",
        maxAge: RETURN_MAX_AGE,
        path: "/",
      });
    }
    return response;
  }

  if (user && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  // Today's inventory notices, once per Venezuelan day instead of on every layout render.
  // The reasons, and why it is here and not in the layout, are in lib/stock-alerts-day.ts.
  // Before the device branch on purpose: this call uses `supabase`, whose setAll would
  // replace supabaseResponse, and a cookie set on the old response would be lost. Never
  // throws, and on failure leaves no cookie, so the layout runs the RPC itself.
  if (
    user &&
    isPageVisit(request) &&
    !request.nextUrl.pathname.startsWith("/admin") &&
    request.cookies.get(STOCK_ALERTS_DAY_COOKIE)?.value !== stockAlertsDayValue(user.id)
  ) {
    try {
      const { error } = await supabase.rpc("refresh_stock_alerts");
      if (error) {
        console.error("proxy: refresh_stock_alerts failed", error);
      } else {
        supabaseResponse.cookies.set(
          STOCK_ALERTS_DAY_COOKIE,
          stockAlertsDayValue(user.id),
          stockAlertsDayCookieOptions(request.nextUrl.protocol === "https:"),
        );
      }
    } catch (error) {
      console.error("proxy: refresh_stock_alerts threw", error);
    }
  }

  // A session that was already open when the device list shipped never went through the
  // sign-in that records its device (PL-40, owner's decision of 2026-11-09). The reasons, and
  // what this deliberately does not do, are in lib/security/session-device.ts. It costs one
  // or two database calls ONCE per browser: the cookie it leaves is what skips this branch.
  if (user && isPageVisit(request) && !DEVICE_COOKIE_PATTERN.test(request.cookies.get(DEVICE_COOKIE)?.value ?? "")) {
    const device = await rememberSessionDevice(user.id, request.headers);
    if (device) {
      supabaseResponse.cookies.set(DEVICE_COOKIE, device, deviceCookieOptions(request.nextUrl.protocol === "https:"));
    }
  }

  return supabaseResponse;
}
