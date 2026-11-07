import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import type { AccountPayment, CommissionRow, Periodicity } from "@/lib/admin/commission";
import type { CommercialEvent, SecurityEvent } from "@/lib/admin/history";

// What /admin/cuentas reads about a KAM. Everything goes through the `security
// definer` functions of migration 198: production gives `service_role` no table
// reads, and a direct read would work in dev and die there (`qa:service-role`). The
// door is `requireSuperadmin()`, in the caller.

export type Kam = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  city: string | null;
  phone: string | null;
  accounts: number;
};

export type AccountFeedback = {
  id: string;
  kind: string;
  body: string;
  attachment_path: string | null;
  actor_email: string | null;
  at: string;
};

export type AccountCommercial = {
  today: string;
  demo_ends_on: string | null;
  paid_until_on: string | null;
  price_usd: number | null;
  periodicidad: Periodicity | null;
  catalog_pro_usd: number;
  kam: Kam | null;
  commissions: CommissionRow[];
  account_payments: AccountPayment[];
  feedback: AccountFeedback[];
  events: CommercialEvent[];
};

export async function getKams(): Promise<Kam[]> {
  const { data, error } = await createServiceClient().rpc("admin_kam_list");
  if (error) throw new Error(`admin_kam_list: ${error.message}`);
  return (data ?? []) as Kam[];
}

export async function getAccountCommercial(ownerId: string): Promise<AccountCommercial | null> {
  const { data, error } = await createServiceClient().rpc("admin_account_commercial", { p_owner: ownerId });
  if (error) throw new Error(`admin_account_commercial: ${error.message}`);
  return (data ?? null) as AccountCommercial | null;
}

export async function getSecurityLog(ownerId: string): Promise<SecurityEvent[]> {
  const { data, error } = await createServiceClient().rpc("admin_account_security_log", { p_owner: ownerId });
  if (error) throw new Error(`admin_account_security_log: ${error.message}`);
  return (data ?? []) as SecurityEvent[];
}
