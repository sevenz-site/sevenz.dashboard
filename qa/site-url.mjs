// The address a deployment puts in front of its `og:image` (lib/site-url.ts). Pure, no network.
import { siteUrl } from "../lib/site-url.ts";

const cases = [
  ["Producción: app.sevenz.site", siteUrl({ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main", VERCEL_BRANCH_URL: "x-git-main.vercel.app" }) === "https://app.sevenz.site"],
  ["Rama dev: dev.sevenz.site", siteUrl({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "dev", VERCEL_BRANCH_URL: "x-git-dev.vercel.app" }) === "https://dev.sevenz.site"],
  ["Rama release: su dirección de Vercel", siteUrl({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "release/v1.0.0", VERCEL_BRANCH_URL: "x-git-release-v100.vercel.app" }) === "https://x-git-release-v100.vercel.app"],
  ["Vista previa sin rama: la del despliegue", siteUrl({ VERCEL_ENV: "preview", VERCEL_URL: "x-abc.vercel.app" }) === "https://x-abc.vercel.app"],
  ["En Vercel sin ninguna dirección: producción, como antes", siteUrl({ VERCEL_ENV: "preview" }) === "https://app.sevenz.site"],
  ["En esta computadora: localhost", siteUrl({}) === "http://localhost:3000" && siteUrl({ PORT: "3100" }) === "http://localhost:3100"],
];
let fails = 0;
for (const [name, ok] of cases) {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  if (!ok) fails++;
}
console.log(fails ? `\n${fails} fallo(s).` : `\n${cases.length}/${cases.length} bien.`);
process.exit(fails ? 1 : 0);
