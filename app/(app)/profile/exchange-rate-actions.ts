"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ExchangeSettingsState = { error: string | null; success: boolean };

export async function updateExchangeSettings(
  _prevState: ExchangeSettingsState,
  formData: FormData,
): Promise<ExchangeSettingsState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sesión expirada, vuelve a entrar.", success: false };

  const rateMode = String(formData.get("rate_mode") ?? "");

  if (rateMode !== "BCV_AUTO" && rateMode !== "CUSTOM") {
    return { error: "Modo de tasa inválido.", success: false };
  }

  let customRateUsd: number | null = null;
  let customRateEur: number | null = null;

  if (rateMode === "CUSTOM") {
    customRateUsd = Number(formData.get("custom_rate_usd"));
    customRateEur = Number(formData.get("custom_rate_eur"));
    if (!Number.isFinite(customRateUsd) || customRateUsd <= 0) {
      return { error: "Ingresa una tasa USD válida.", success: false };
    }
    if (!Number.isFinite(customRateEur) || customRateEur <= 0) {
      return { error: "Ingresa una tasa EUR válida.", success: false };
    }
  }

  const { error } = await supabase.from("owner_exchange_settings").upsert(
    {
      owner_id: user.id,
      rate_mode: rateMode,
      custom_rate_usd: customRateUsd,
      custom_rate_eur: customRateEur,
      // Only refreshed on an actual CUSTOM save — audits when the custom
      // rate last changed, and is left untouched when switching back to
      // BCV_AUTO so that history isn't lost if the owner flips back later.
      ...(rateMode === "CUSTOM" ? { custom_rate_set_at: new Date().toISOString() } : {}),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "owner_id" },
  );

  if (error) {
    return { error: `No pudimos guardar la configuración: ${error.message}`, success: false };
  }

  revalidatePath("/profile");
  revalidatePath("/dashboard");
  return { error: null, success: true };
}
