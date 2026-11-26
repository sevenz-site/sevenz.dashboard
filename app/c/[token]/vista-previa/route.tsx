import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { brandPreviewResponse } from "@/lib/catalog/brand-preview-image";

// THE IMAGE OF THE CATALOGUE'S LINK PREVIEW. It only reads the business's logo; the
// card itself, and why it is drawn the way it is, lives in
// `lib/catalog/brand-preview-image.tsx`, shared with the balance link since 2026-11-26.
// PUBLIC ROUTE, ERRORS MASKED (CLAUDE.md): the answer is always an image.

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const generic = Response.redirect(new URL("/og.png", request.url), 302);

  if (!isSupabaseConfigured()) return generic;

  let logoPath: string | null = null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("get_shared_catalog", { p_token: token });
    if (error) {
      console.error("[catalogPreviewImage] rpc:", error.message);
      return generic;
    }
    logoPath = (data as { owner_logo_path?: string | null } | null)?.owner_logo_path ?? null;
  } catch (error) {
    console.error("[catalogPreviewImage] threw:", error instanceof Error ? error.message : error);
    return generic;
  }
  return brandPreviewResponse(request, logoPath, "catalogPreviewImage");
}
