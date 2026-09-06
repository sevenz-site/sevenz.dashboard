"use server";

import { requireSuperadmin } from "@/lib/admin/guard";
import { checkServices, type ServiceCheck } from "@/lib/admin/health";

// Gated exactly like the page it sits on. A server action is a public HTTP
// endpoint — being imported only by a component behind the guard protects
// nothing on its own, so the guard runs here too. It calls notFound() for
// anyone not on the allowlist, same as everywhere else under /admin, so this
// action cannot be used to probe which services exist.
export async function runServiceChecks(): Promise<ServiceCheck[]> {
  await requireSuperadmin();
  return checkServices();
}
