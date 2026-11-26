// THE ADDRESS THIS DEPLOYMENT IS SERVED FROM, for the absolute links a chat app reads in the
// page's metadata (`og:image`, `twitter:image`): WhatsApp does not resolve relative ones.
//
// IT WAS «https://app.sevenz.site» FOR EVERY DEPLOYMENT until 2026-11-25. Then the catalogue's
// preview became an image drawn by a route of its own (`/c/<token>/vista-previa`), and a
// catalogue shared from `dev.sevenz.site` pointed WhatsApp at production, where that route did
// not exist yet: the card came out without the logo, and nothing could be tested before
// launching. Owner's request that day: «Haz que en dev apunte a dev.sevenz.site».
//
// Production keeps its domain, as before. The `dev` branch gets its own domain. Any other
// branch (a `release/vX.Y.Z`) gets Vercel's branch address, which is where it is served. Off
// Vercel, `npm run dev` on this computer.
//
// Read from Vercel's own variables, set at build and at runtime (vercel.com/docs, «System
// environment variables», read 2026-11-25): no variable to set by hand, so none to forget.
const PRODUCTION = "https://app.sevenz.site";
const DEV_BRANCH = "https://dev.sevenz.site";

export function siteUrl(env: Record<string, string | undefined> = process.env): string {
  if (env.VERCEL_ENV === "production") return PRODUCTION;
  if (env.VERCEL_GIT_COMMIT_REF === "dev") return DEV_BRANCH;
  if (env.VERCEL_BRANCH_URL) return `https://${env.VERCEL_BRANCH_URL}`;
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  if (env.VERCEL_ENV) return PRODUCTION;
  return `http://localhost:${env.PORT || 3000}`;
}
