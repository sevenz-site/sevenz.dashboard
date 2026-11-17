"use server";

import { unsubscribeFromTips } from "@/lib/inactivity-nudge/unsubscribe";

export type UnsubscribeState = { done: boolean; error: string | null };

// The tap on «Dejar de recibir consejos». The GET of the page changes nothing (link scanners
// open URLs on their own); this does.
export async function confirmUnsubscribe(_prev: UnsubscribeState, formData: FormData): Promise<UnsubscribeState> {
  const ok = await unsubscribeFromTips(String(formData.get("token") ?? ""));
  return ok
    ? { done: true, error: null }
    : { done: false, error: "No pudimos guardar tu baja. Intenta de nuevo en un momento." };
}
