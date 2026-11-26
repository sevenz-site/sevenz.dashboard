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
    // `p_limit: 1`: only the business's logo is read here, so the history is cut to one
    // movement instead of the page's fifty.
    const { data, error } = await supabase.rpc("get_shared_balance", { p_token: token, p_limit: 1 });
    if (error) {
      console.error("[balancePreviewImage] rpc:", error.message);
      return generic;
    }
    logoPath = (data as { owner_logo_path?: string | null } | null)?.owner_logo_path ?? null;
  } catch (error) {
    console.error("[balancePreviewImage] threw:", error instanceof Error ? error.message : error);
    return generic;
  }
  return brandPreviewResponse(request, logoPath, "balancePreviewImage");
}
