import { unsubscribeFromTips } from "@/lib/inactivity-nudge/unsubscribe";

export const runtime = "nodejs";

// RFC 8058 ONE-CLICK UNSUBSCRIBE for the nudge emails (MS-53, 2026-11-17). Gmail and Yahoo
// POST `List-Unsubscribe=One-Click` here when the reader taps their own «unsubscribe» button,
// with the token in the query string of the `List-Unsubscribe` header.
//
// PUBLIC BY DESIGN, and the proxy exempts it: the mail provider has no session. It answers the
// same empty 200 whatever happens, so it tells nobody whether a token was valid; the outcome
// is in the server log. POST only: a GET from a scanner must never unsubscribe.
export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get("t");
  await unsubscribeFromTips(token);
  return new Response(null, { status: 200 });
}
