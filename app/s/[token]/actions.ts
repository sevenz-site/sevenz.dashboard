"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { ALLOWED_IMAGE_TYPES, sniffImageType } from "@/lib/image-type";

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

export type UploadProfilePictureState = { error: string | null; path: string | null };

// Public, unauthenticated action — same trust model as submitDocumentId
// above. resolve_shared_client() (SECURITY DEFINER, anon-key client) is
// the actual gate: only after it confirms this token maps to a real
// client does the service-role client touch Storage or the clients
// table — the service-role client bypasses RLS entirely, so this check
// is the only thing standing between an arbitrary caller and a write.
// Unlike the document ID, this is repeatable: every upload replaces
// whatever picture was there before (old file best-effort deleted after
// the new one is confirmed saved).
// The bucket's own ceiling. Next caps a server action body at 1 MB before this
// runs, so in practice the body limit bites first — this is here so the rule
// still holds if that limit is ever raised, rather than depending on it.
const MAX_PROFILE_PICTURE_BYTES = 5 * 1024 * 1024;

export async function uploadProfilePicture(token: string, formData: FormData): Promise<UploadProfilePictureState> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Selecciona una foto.", path: null };
  }
  if (file.size > MAX_PROFILE_PICTURE_BYTES) {
    return { error: "La foto es muy pesada. Elige una de menos de 5 MB.", path: null };
  }

  const supabase = await createClient();
  const { data: clientId, error: resolveError } = await supabase.rpc("resolve_shared_client", {
    p_token: token,
  });
  if (resolveError || !clientId) {
    return { error: "Link inválido.", path: null };
  }

  const serviceClient = createServiceClient();

  const { data: existing } = await serviceClient
    .from("clients")
    .select("profile_picture_path")
    .eq("id", clientId)
    .single();

  const arrayBuffer = await file.arrayBuffer();
  const mimeType = sniffImageType(new Uint8Array(arrayBuffer.slice(0, 8)));
  if (!mimeType) {
    // Deliberately vague about why. An anonymous caller does not need to learn
    // which byte signatures this accepts.
    return { error: "Ese archivo no es una foto válida. Usa una imagen JPG o PNG.", path: null };
  }

  const path = `${clientId}/profile-${Date.now()}.${ALLOWED_IMAGE_TYPES[mimeType]}`;
  const { error: uploadError } = await serviceClient.storage
    .from("client-profile-pictures")
    .upload(path, arrayBuffer, { contentType: mimeType });

  if (uploadError) {
    console.error("[uploadProfilePicture] storage upload failed:", uploadError.message);
    return { error: "No pudimos subir tu foto. Intenta de nuevo.", path: null };
  }

  const { error: updateError } = await serviceClient
    .from("clients")
    .update({ profile_picture_path: path })
    .eq("id", clientId);

  if (updateError) {
    console.error("[uploadProfilePicture] update failed:", updateError.message);
    return { error: "No pudimos guardar tu foto. Intenta de nuevo.", path: null };
  }

  const previousPath = existing?.profile_picture_path as string | null;
  if (previousPath) {
    await serviceClient.storage.from("client-profile-pictures").remove([previousPath]);
  }

  return { error: null, path };
}
