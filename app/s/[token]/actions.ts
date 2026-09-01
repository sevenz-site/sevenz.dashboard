"use server";

import { createClient } from "@/lib/supabase/server";

export type SubmitDocumentIdState = { error: string | null; documentId: string | null };

// Public, unauthenticated action — reachable by anyone with a share link,
// same trust model as get_shared_balance() itself. All the actual scoping
// (token -> client resolution, refusing to overwrite an existing value)
// happens inside submit_shared_document_id() in the database, not here —
// this action is just a thin, unauthenticated-safe wrapper. Errors are
// generic by design (mask-raw-errors rule): nothing here should leak
// database detail to an anonymous caller.
export async function submitDocumentId(token: string, documentId: string): Promise<SubmitDocumentIdState> {
  const trimmed = documentId.trim();
  if (!trimmed) {
    return { error: "Escribe tu número de documento.", documentId: null };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_shared_document_id", {
    p_token: token,
    p_document_id: trimmed,
  });

  if (error) {
    console.error("[submitDocumentId] rpc failed:", error.message);
    return { error: "No pudimos guardar tu documento. Intenta de nuevo.", documentId: null };
  }

  const result = data as { error: string | null; document_id: string | null };
  if (result.error) {
    return { error: result.error, documentId: null };
  }

  return { error: null, documentId: result.document_id };
}
