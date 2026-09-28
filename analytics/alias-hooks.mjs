// Resolves the "@/..." path alias that Next.js provides at build time but plain
// Node does not, so a script here can import the app's real modules instead of
// keeping a second copy of their logic. Adds the .ts extension the alias omits.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function resolve(specifier, context, next) {
  // `server-only` y `client-only` no son paquetes instalados: los aporta Next
  // en build, y su única función es reventar el build si el módulo acaba en el
  // lado equivocado. No tienen código. En Node suelto no existen, así que un
  // import de ellos tumba el script con ERR_MODULE_NOT_FOUND antes de llegar a
  // lo que se quería probar — y ese import está en cabeza de casi todo lo que
  // vive en `lib/` y merece una prueba.
  //
  // Resolverlos a un módulo vacío no debilita nada: la protección que dan es
  // de tiempo de build, y aquí no hay build.
  if (specifier === "server-only" || specifier === "client-only") {
    return { url: "data:text/javascript,export{}", shortCircuit: true };
  }

  // "next/server" y compañía resuelven dentro de Next pero no en Node suelto:
  // el paquete no declara esos subpaths sin extensión. Añadírsela deja que un
  // script importe un módulo de la app que, más abajo en la cadena, toque algo
  // de Next — como ensure-fresh.ts, que usa `after` para refrescar la tasa.
  if (specifier.startsWith("next/") && !specifier.endsWith(".js")) {
    const conExtension = `${specifier}.js`;
    try {
      return await next(conExtension, context);
    } catch {
      return next(specifier, context);
    }
  }

  if (!specifier.startsWith("@/")) return next(specifier, context);
  const base = path.join(root, specifier.slice(2));
  const target = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")].find(existsSync);
  return next(pathToFileURL(target ?? base).href, context);
}
