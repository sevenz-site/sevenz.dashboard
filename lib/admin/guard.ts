import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// The only thing that decides who may cross every owner's RLS boundary.
//
// Deliberately an env var and not a database row: nothing in the schema grants
// admin, so no mistaken migration, no loosened policy and no compromised row
// can escalate someone into it. The trade is that granting or revoking access
// needs a Vercel env edit and a redeploy, which is the right shape when the
// list is one or two people.
//
// NOT prefixed NEXT_PUBLIC_, so it is never inlined into a browser bundle.
//
// That absence is also the safety net. If this module were ever imported into
// a client component by mistake, process.env.SUPERADMIN_EMAILS would read as
// undefined there, the list would be empty, and requireSuperadmin() would call
// notFound() — the failure mode is "nobody is an admin", never "everybody is".
// The `server-only` package would make that a build error instead of a runtime
// one, but it is not a dependency here and adding it would be a new-dependency
// decision for a guarantee this already has by construction.
const RAW = process.env.SUPERADMIN_EMAILS ?? "";

function allowlist(): string[] {
  return RAW.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

// Throws Next's not-found rather than redirecting or returning 403. An owner
// who guesses /admin should not be able to tell the difference between "this
// route is not for you" and "this route does not exist" — a 403 confirms there
// is something there worth attacking.
//
// Returns the admin's email so a page can show whose session is open, which is
// the one thing worth displaying on a screen that shows everyone's data.
export async function requireSuperadmin(): Promise<{ email: string }> {
  const emails = allowlist();
  // An unset or empty SUPERADMIN_EMAILS means nobody is an admin. Failing
  // closed matters more here than a helpful error: a misconfigured deploy must
  // not open the dashboard to every signed-in owner.
  if (emails.length === 0) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // The middleware already bounces a sessionless visitor to /login before this
  // runs, so reaching here without a user means something changed upstream.
  // Treated the same as not being an admin.
  const email = user?.email?.trim().toLowerCase();
  if (!email || !emails.includes(email)) notFound();

  return { email };
}
