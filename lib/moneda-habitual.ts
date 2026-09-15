import type { SupabaseClient } from "@supabase/supabase-js";
import type { LedgerCurrency, MonedaTecleada } from "@/lib/types";

// En qué moneda suele escribir este negocio.
//
// POR QUÉ. El formulario abría siempre en dólares. El bodeguero que cobra todo
// en bolívares tenía que pulsar "Bolívares" en cada movimiento —y son decenas
// al día—, y el que lleva euros lo mismo. Un toque de más repetido cincuenta
// veces no es un detalle: es la diferencia entre una app que aprende y una que
// hay que corregir.
//
// NO SE GUARDA NADA NUEVO. Cada movimiento ya anota en qué moneda se escribió
// —entry_currency: 'VES' si fue en bolívares, 'USD' o 'EUR' si no— y a qué
// libro fue. La preferencia se DEDUCE de ahí en vez de inventarse una columna,
// una migración y un sitio más donde el dato pueda quedar desincronizado. Y
// como vive en la base y no en el navegador, sigue al dueño si cambia de
// teléfono, cosa que la memoria del navegador no hace.
//
// DEL NEGOCIO ENTERO, no de cada cliente. Se consideró por cliente —"a Juan
// siempre en bolívares, a María en dólares"— y se descartó: un cliente nuevo no
// tiene historial del que deducir nada, así que haría falta igualmente el dato
// del negocio como respaldo, y dos reglas donde una acierta casi siempre es más
// de lo que este problema pide.
//
// NO MANDA SIEMPRE. En un abono, la deuda gana: de nada sirve abrir en euros si
// lo que el cliente debe son dólares. Quien llama decide eso; aquí solo se dice
// cuál fue la última.
export type MonedaHabitual = {
  // En qué moneda escribió el monto la última vez.
  tecleada: MonedaTecleada;
  // A qué libro fue esa deuda. Solo se separa de la anterior cuando escribió
  // en bolívares: tecleando dólares, el libro es el de dólares.
  libro: LedgerCurrency;
};

// Null cuando el negocio todavía no tiene ningún movimiento, que es justo el
// caso en que no hay costumbre que recordar. Quien llama se queda con su valor
// de siempre.
export async function getMonedaHabitual(
  supabase: SupabaseClient,
  ownerId: string,
): Promise<MonedaHabitual | null> {
  // El filtro por dueño va explícito aunque RLS ya lo imponga. movements no
  // tiene owner_id —cuelga del cliente—, así que hace falta la unión de todas
  // formas para expresarlo, y dejarlo escrito significa que esta consulta sigue
  // siendo correcta si algún día se lee con el service_role, que se salta RLS.
  const { data } = await supabase
    .from("movements")
    .select("entry_currency, currency, clients!inner(owner_id)")
    .eq("clients.owner_id", ownerId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  const libro: LedgerCurrency = data.currency === "EUR" ? "EUR" : "USD";

  // entry_currency puede venir vacío en movimientos viejos, de antes de que la
  // columna existiera. Entonces la moneda tecleada fue la del libro: escribir
  // en bolívares es posterior a esos movimientos.
  const tecleada: MonedaTecleada =
    data.entry_currency === "VES"
      ? "VES"
      : data.entry_currency === "EUR"
        ? "EUR"
        : data.entry_currency === "USD"
          ? "USD"
          : libro;

  return { tecleada, libro };
}

// A qué libro se abre un ABONO, cuando la costumbre y la deuda no coinciden.
//
// La costumbre no manda aquí. De nada sirve abrir en euros porque fue lo último
// que usó si lo que ESTE cliente debe son dólares: el dueño leería "Máximo
// 0,00" y tendría que cambiar de moneda a mano, que es justo el toque que la
// costumbre venía a ahorrarle.
//
// La costumbre solo DESEMPATA: cuando el cliente debe en las dos, se abre en la
// que el negocio suele usar en vez de en dólares por orden alfabético.
//
// Y si no debe nada, se queda en la preferida. Ese caso no llega a verse —el
// formulario no deja abrir un abono sin deuda— pero devolver algo coherente es
// más barato que razonar sobre si puede llegar.
export function libroParaAbono(
  preferida: LedgerCurrency,
  deudaUsd: number,
  deudaEur: number,
): LedgerCurrency {
  const debeLaPreferida = (preferida === "USD" ? deudaUsd : deudaEur) > 0;
  if (debeLaPreferida) return preferida;
  if (deudaUsd > 0) return "USD";
  if (deudaEur > 0) return "EUR";
  return preferida;
}
