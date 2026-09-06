// Resolves the "@/..." path alias that Next.js provides at build time but plain
// Node does not, so a script here can import the app's real modules instead of
// keeping a second copy of their logic. Adds the .ts extension the alias omits.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function resolve(specifier, context, next) {
  if (!specifier.startsWith("@/")) return next(specifier, context);
  const base = path.join(root, specifier.slice(2));
  const target = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")].find(existsSync);
  return next(pathToFileURL(target ?? base).href, context);
}
