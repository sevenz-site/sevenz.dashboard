import { cookies } from "next/headers";
import { RETURN_COOKIE, safeReturnPath } from "@/lib/auth/return-after-login";

// Where this sign-in was going, once, and then forgotten.
export async function landingAfterLogin(): Promise<string> {
  const jar = await cookies();
  const destino = safeReturnPath(jar.get(RETURN_COOKIE)?.value);
  jar.delete(RETURN_COOKIE);
  return destino ?? "/dashboard";
}
