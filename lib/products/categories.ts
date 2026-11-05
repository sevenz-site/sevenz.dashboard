// Product categories (migration 184). The rules live here and not in each
// screen: the create-product sheet, the owner's catalogue and the client's
// catalogue all read the same name the same way, and the action validates
// with the same function the form uses to warn.

export type Categoria = { id: string; name: string };

/** The `check` of `product_categories.name`: a chip has to fit on a phone. */
export const MAX_NOMBRE_DE_CATEGORIA = 30;

/** Trimmed, inner spaces collapsed. «  Bebidas   frías » → «Bebidas frías». */
export function limpiarNombreDeCategoria(nombre: string): string {
  return nombre.replace(/\s+/g, " ").trim();
}

/** A sentence for the shopkeeper, or null when the name can be saved. */
export function errorDeNombreDeCategoria(nombre: string, existentes: Categoria[], ignorarId?: string): string | null {
  const limpio = limpiarNombreDeCategoria(nombre);
  if (!limpio) return "Escribe el nombre de la categoría.";
  if (limpio.length > MAX_NOMBRE_DE_CATEGORIA) {
    return `Como mucho ${MAX_NOMBRE_DE_CATEGORIA} letras: tiene que caber en un chip.`;
  }
  // The same comparison as the database's unique index on lower(name).
  const repetida = existentes.find(
    (c) => c.id !== ignorarId && c.name.toLocaleLowerCase("es") === limpio.toLocaleLowerCase("es"),
  );
  if (repetida) return `Ya tienes la categoría «${repetida.name}».`;
  return null;
}

/** Alphabetical in Spanish, so «Ñame» sits after «N» and not after «Z». */
export function ordenarCategorias(categorias: Categoria[]): Categoria[] {
  return [...categorias].sort((a, b) => a.name.localeCompare(b.name, "es"));
}
