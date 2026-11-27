import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { brandPreviewResponse } from "@/lib/catalog/brand-preview-image";

// THE IMAGE OF THE BALANCE LINK'S PREVIEW (the card WhatsApp draws for `/s/<token>`).
//
// Owner's request of 2026-11-26: the balance link shows the business's logo, «mismo
// patrón/componente del preview al compartir el catálogo con el powered by Sevenz». So
// this only reads the logo; the card is the catalogue's, drawn by
// `lib/catalog/brand-preview-image.tsx`. No logo, a bad token or any failure: the generic
// `/og.png` card, as before.
//
// It carries the logo and nothing else: no client name, no amount. What that changes about
// the rule of 2026-09-11 is written next to `generateMetadata` in `../page.tsx`.
//
// PUBLIC ROUTE, ERRORS MASKED (CLAUDE.md): the answer is always an image.

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const generic = Response.redirect(new URL("/og.png", request.url), 302);

  if (!isSupabaseConfigured()) return generic;

  let logoPath: string | null = null;
  try {
    const supabase = await createClient();
    // `share_link_logo` (migration 226), NEVER `get_shared_balance`: that one records a
    // visit on every call, and this route is fetched by whoever draws the card, with nobody
    // looking at the balance. Until 2026-11-27 it called `get_shared_balance`, and each card
    // WhatsApp drew told the shopkeeper «tu cliente abrió su enlace» (owner's decision of
    // that day: «corrígelo antes de lanzar»).
    const { data, error } = await supabase.rpc("share_link_logo", { p_token: token });
    if (error) {
      console.error("[balancePreviewImage] rpc:", error.message);
      return generic;
    }
    logoPath = typeof data === "string" && data ? data : null;
  } catch (error) {
    console.error("[balancePreviewImage] threw:", error instanceof Error ? error.message : error);
    return generic;
  }
  return brandPreviewResponse(request, logoPath, "balancePreviewImage");
}
