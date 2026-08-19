import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Supabase's password-recovery email links here to exchange a token for a
// real session (setting the auth cookies) before handing off to the page
// that actually asks for the new password. Which query params show up
// depends on the project's email template / auth flow — the default
// template sends a PKCE "code", while a template customized to link
// straight at this route sends "token_hash" + "type". Handle both so this
// works regardless of what's configured on the Supabase side.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/dashboard";

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }

  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent("El link expiró o ya se usó. Intenta de nuevo.")}`,
  );
}
