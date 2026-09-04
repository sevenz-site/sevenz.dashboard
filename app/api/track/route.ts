import { after } from "next/server";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendEvent, setProfile } from "@/lib/mixpanel-http";

export const runtime = "nodejs";

// First-party proxy for browser analytics. The browser posts here — same
// origin as the app — and this route forwards to Mixpanel. That is the whole
// point: iOS Safari's tracking protection and every content blocker drop
// requests to api.mixpanel.com, so events sent straight from the page were
// invisible for a large share of this app's traffic while looking perfectly
// healthy in the code. A request to the app's own domain is indistinguishable
// from any other app traffic and cannot be singled out.
//
// It also removes mixpanel-browser (412 KB, the largest asset the app shipped)
// from the bundle entirely, which beats the earlier attempt at deferring it.

// distinct_id is ALWAYS the session's owner id and never anything the caller
// sent. A body-supplied id would let any signed-in owner write events onto
// another owner's profile.
const MAX_PROPS_BYTES = 4_000;

const ALLOWED_PROFILE_KEYS = new Set(["$email", "plan"]);

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Belt and braces: the middleware already redirects an unauthenticated
  // request to /login before it reaches this handler (verified — an anonymous
  // POST here answers 307, not 204), so in practice this branch only catches a
  // session that expired between the two checks. Answering 204 rather than 401
  // keeps analytics from becoming an error the caller has to handle, or noise
  // in the console of a long-idle background tab.
  //
  // Cost worth knowing: because /api/track sits behind the middleware, every
  // event costs two getUser() calls — one there, one here. Both run after the
  // browser's fire-and-forget request, so nothing the owner does waits on it.
  if (!user) return new NextResponse(null, { status: 204 });

  let body: { event?: unknown; props?: unknown; profile?: unknown };
  try {
    body = await request.json();
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  const event = typeof body.event === "string" && body.event.length <= 120 ? body.event : null;
  const props =
    body.props && typeof body.props === "object" && !Array.isArray(body.props)
      ? (body.props as Record<string, unknown>)
      : undefined;

  // A runaway or malicious caller must not be able to push arbitrarily large
  // payloads through this route into Mixpanel.
  if (props && JSON.stringify(props).length > MAX_PROPS_BYTES) {
    return new NextResponse(null, { status: 204 });
  }

  // Only the two profile fields identifyOwner used to set. Anything else the
  // caller asks for is dropped rather than written onto the owner's profile.
  let profile: Record<string, unknown> | undefined;
  if (body.profile && typeof body.profile === "object" && !Array.isArray(body.profile)) {
    const entries = Object.entries(body.profile as Record<string, unknown>).filter(([k]) =>
      ALLOWED_PROFILE_KEYS.has(k),
    );
    if (entries.length > 0) profile = Object.fromEntries(entries);
  }

  // after() sends the response first, so the page never waits on Mixpanel and
  // a slow or dead endpoint can't stall the interaction that raised the event.
  after(async () => {
    if (event) await sendEvent(event, user.id, props, "browser", profile);
    else if (profile) await setProfile(user.id, profile);
  });

  return new NextResponse(null, { status: 204 });
}
