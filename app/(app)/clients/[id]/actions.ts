"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type EditClientState = { error: string | null; success: boolean };

export async function updateClient(
  _prevState: EditClientState,
  formData: FormData,
): Promise<EditClientState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión expirada, vuelve a entrar.", success: false };

  const clientId = String(formData.get("client_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const whatsapp = String(formData.get("whatsapp") ?? "").trim();
  const documentId = String(formData.get("document_id") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();

  if (!clientId) return { error: "Cliente inválido.", success: false };
  if (!name) return { error: "El nombre no puede quedar vacío.", success: false };

  const { error } = await supabase
    .from("clients")
    .update({
      name,
      whatsapp: whatsapp || null,
      document_id: documentId || null,
      address: address || null,
    })
    .eq("id", clientId)
    .eq("owner_id", user.id);

  if (error) {
    return { error: `No pudimos guardar los cambios: ${error.message}`, success: false };
  }

  revalidatePath(`/clients/${clientId}`);
  revalidatePath("/dashboard");
  return { error: null, success: true };
}
