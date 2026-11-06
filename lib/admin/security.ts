import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

// What /admin/cuentas/[ownerId] shows under «Seguridad» (C1 of PL-22): facts to ask the
// caller about before changing their email, never secrets. Read through a definer, since
// production grants `service_role` nothing on the owner tables (`qa:service-role`).

export type AuditRow = { action: string; actor: string; at: string; detail: Record<string, unknown> };

export type CuentaSeguridad = {
  email: string;
  whatsapp: string | null;
  country: string;
  business_name: string;
  first_name: string | null;
  created_at: string;
  clients: number;
  last_sale_at: string | null;
  sales_30d: number;
  second_factor: boolean;
  known_devices: number;
  last_login_city: string | null;
  audit: AuditRow[];
};

export async function getCuentaSeguridad(ownerId: string): Promise<CuentaSeguridad | null> {
  const { data, error } = await createServiceClient().rpc("admin_cuenta_seguridad", { p_owner_id: ownerId });
  if (error || !data) {
    if (error) console.error("admin_cuenta_seguridad:", error.message);
    return null;
  }
  const r = data as Partial<CuentaSeguridad>;
  return {
    email: r.email ?? "",
    whatsapp: r.whatsapp ?? null,
    country: r.country ?? "VE",
    business_name: r.business_name ?? "",
    first_name: r.first_name ?? null,
    created_at: r.created_at ?? "",
    clients: r.clients ?? 0,
    last_sale_at: r.last_sale_at ?? null,
    sales_30d: r.sales_30d ?? 0,
    second_factor: r.second_factor === true,
    known_devices: r.known_devices ?? 0,
    last_login_city: r.last_login_city ?? null,
    audit: Array.isArray(r.audit) ? r.audit : [],
  };
}
