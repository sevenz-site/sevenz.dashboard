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
    request.nextUrl.pathname.startsWith("/api/cron/");

  // A public route's decision doesn't depend on who is asking, so skip the
  // session lookup entirely rather than paying for an answer nothing reads.
  // getUser() is a network round trip to Supabase Auth on every single
  // request, and /s/ — the balance link an owner sends to every client at
  // once — is both the burstiest path in the app and the one where the
  // visitor is guaranteed not to have a session to validate.
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
    return NextResponse.redirect(url);
  }

  if (user && isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
