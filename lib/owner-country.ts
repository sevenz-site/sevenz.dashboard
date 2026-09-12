import type { createClient } from "@/lib/supabase/server";
import type { OwnerCountry } from "@/lib/types";

// Medio segundo. Suficiente para que un parpadeo de red se resuelva, poco
// suficiente para que nadie lo note: la primera lectura ya tardó lo suyo en
// fallar, y esto se suma a una página que de todos modos está cargando.
const ESPERA_MS = 500;

// Lee el país del negocio, reintentando una vez antes de rendirse.
//
// Por qué el reintento. Al quitar el `?? "CO"` ganamos honestidad y perdimos
// una suerte: para un dueño COLOMBIANO aquella suposición acertaba siempre —él
// es colombiano—, así que un corte de dos segundos pasaba sin que se enterara.
// Ahora ve un diálogo que le tapa la pantalla. Para un venezolano el cambio es
// una mejora clara; para un colombiano era molestia nueva a cambio de nada.
//
// Un segundo intento devuelve casi toda esa suerte sin devolver la mentira: si
// la segunda lectura funciona, el dueño no se entera de nada y el país que
// usamos es el suyo de verdad, no uno inventado.
//
// Es un select por clave primaria. Repetirlo no duplica nada ni escribe nada.
export async function readOwnerCountry(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ownerId: string,
): Promise<OwnerCountry | null> {
  for (let intento = 1; intento <= 2; intento++) {
    const { data } = await supabase.from("owners").select("country").eq("id", ownerId).single();
    const country = (data?.country as OwnerCountry | undefined) ?? null;
    if (country) return country;
    if (intento === 1) await new Promise((r) => setTimeout(r, ESPERA_MS));
  }

  // Los dos intentos fallaron: el dueño va a ver el diálogo. Se anota aquí y no
  // en el componente porque aquí pasan las cinco pantallas, y porque un
  // componente de cliente tendría que dar un viaje de vuelta al servidor para
  // decir algo que el servidor ya sabe.
  //
  // Sin este contador no sabríamos cuántas veces aparece ese aviso, que es
  // justo el número que dice si el reintento de arriba bastó. Silencioso a
  // propósito: fallar al anotar no puede empeorar una página que ya va mal.
  try {
    await supabase.rpc("record_movement_rejection", {
      p_reason: "pais_desconocido",
      p_source: "pantalla",
      p_client_id: null,
      p_amount: null,
      p_attempted_currency: null,
      p_rows_affected: 1,
    });
  } catch {
    // Ni una excepción aquí: lo que se está anotando ya es un fallo.
  }

  return null;
}
