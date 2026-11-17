import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { trackServer } from "@/lib/mixpanel-server";
import { verifyUnsubscribeToken } from "@/lib/inactivity-nudge/unsubscribe-token";

// The one write behind both ways out of a nudge email: the page's button and the mail client's
// own one-click unsubscribe (RFC 8058). Unauthenticated by design; the signed token is the
// authorisation, and all it can do is turn the tips OFF.
//
// NEVER says why it failed: the two callers are public, so the answer is a yes or a no and the
// detail goes to the server log (CLAUDE.md, «Mask raw errors on unauthenticated endpoints»).
export async function unsubscribeFromTips(token: string | null | undefined): Promise<boolean> {
  const ownerId = verifyUnsubscribeToken(token);
  if (!ownerId) return false;
  const { error } = await createServiceClient().rpc("product_tips_unsubscribe", { p_owner_id: ownerId });
  if (error) {
    console.error("[consejos baja]:", error.message);
    return false;
  }
  // «¿Los consejos de Sevenz molestan?» -- see `guardarConsejosSevenz` in the profile actions
  // for the business question. Filed under the owner the link was signed for. A click on an
  // already-unsubscribed link counts again; the column keeps the first date.
  trackServer("Product Tips Changed", ownerId, { enabled: false, source: "email_link" });
  return true;
}
