"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

// Quotas for the two actions below, the only two anyone can reach without a
// login. Both are per share token and generous enough that a real client will
// never meet them — a person sets their document once and changes their photo
// occasionally. They exist to make a script pointless, not to police use.
const DOCUMENT_ID_LIMIT = 5;
const RATE_WINDOW_SECONDS = 60 * 60;

// Returns true when the caller may proceed.
//
// Fails OPEN. If the limiter itself is unreachable, a client who is trying to
// upload their photo should not be blocked by our infrastructure problem —
// the limiter defends against abuse, and abuse is not what is happening when
// the database is having a bad minute. The tradeoff is deliberate: a limiter
// outage is a window with no limit, which is the state this endpoint has been
// in permanently until now anyway.
async function withinQuota(token: string, action: string, limit: number): Promise<boolean> {
  try {
    // Service client, not the anon one the caller already holds: otherwise the
    // limiter is callable by anyone, which makes it both bypassable and a way
    // to burn someone else's quota.
    const service = createServiceClient();
    const { data, error } = await service.rpc("claim_rate_limit_quota", {
      p_key: `${action}:${token}`,
      p_limit: limit,
      p_window_seconds: RATE_WINDOW_SECONDS,
    });
    if (error) {
      console.error(`[rateLimit] ${action} check failed:`, error.message);
      return true;
    }
    return data !== false;
  } catch (error) {
    console.error(
      `[rateLimit] ${action} check threw:`,
      error instanceof Error ? error.message : error,
    );
    return true;
  }
}

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

  if (!(await withinQuota(token, "document_id", DOCUMENT_ID_LIMIT))) {
    return { error: "Demasiados intentos. Vuelve a intentarlo más tarde.", documentId: null };
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
export async function uploadProfilePicture(): Promise<UploadProfilePictureState> {
  // Closed alongside /s/[token]/perfil, its only caller.
  //
  // A server action is a public HTTP endpoint in its own right: 404-ing the
  // page that used it does not stop anyone invoking it directly, which is
  // exactly the "otro método" this change exists to cover. It wrote to
  // billable Storage on nothing more than a share token, so leaving it live
  // behind a removed page would be the worst combination — invisible and
  // reachable.
  //
  // The implementation is not reproduced here as dead code; unreachable code
  // stops type-checking and rots unread. It is intact in git as of 076867c,
  // with its byte sniffing, size ceiling and rate limit, and should be
  // restored from there when clients can authenticate — not rewritten from
  // memory, which is how hardening quietly gets lost. lib/image-type.ts is
  // left in place for the same reason — it is tested and comes back with it.
  //
  // Takes no arguments now: nothing calls it, and a signature that promises to
  // accept a file it will never read is a lie to the next reader.
  return { error: "Esta opción no está disponible por ahora.", path: null };
}
