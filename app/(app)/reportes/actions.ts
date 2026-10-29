"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// EL UMBRAL DE «POR AGOTARSE».
//
// Decisión del dueño el 2026-10-27: arranca en 5 y es ajustable, *«para que lo
// muevas si no te sirve»*. La tercera opción que se le ofreció --un umbral por
// producto, la harina a 20 y el detergente a 2-- es más fiel a una bodega de
// verdad y cuesta un campo más en un formulario que ya es largo; si algún día
// hace falta, se añade al lado y este pasa a ser el valor por defecto.
//
// CERO ES UNA RESPUESTA VÁLIDA: «no me avises». No es «sin configurar».
const TOPE = 10000;

export async function guardarUmbralDeStock(
  valor: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Tu sesión se cerró. Vuelve a entrar." };

  // SE VALIDA AQUÍ ADEMÁS DE EN LA BASE. La restricción de la tabla es el
  // respaldo; esto es lo que convierte un número imposible en una frase que el
  // tendero entiende en vez de en un error de Postgres.
  if (!Number.isFinite(valor) || !Number.isInteger(valor) || valor < 0 || valor > TOPE) {
    return { ok: false, error: `Escribe un número entero entre 0 y ${TOPE}.` };
  }

  // `.eq("id", user.id)` AUNQUE SOLO HAYA UNA FILA POSIBLE: es la regla de
  // `CLAUDE.md` sobre comprobar la propiedad en código y no fiarlo todo a RLS.
  const { error } = await supabase
    .from("owners")
    .update({ low_stock_threshold: valor })
    .eq("id", user.id);
  if (error) {
    console.error("[guardarUmbralDeStock]", error);
    return { ok: false, error: "No pudimos guardar el aviso. Inténtalo otra vez." };
  }

  revalidatePath("/reportes");
  return { ok: true };
}
