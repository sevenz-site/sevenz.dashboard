import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { claveSemanal, enviarAvisoAlDueno, type ResultadoEnvio } from "@/lib/whatsapp/send";

// "Lo que necesita atención en tu cartera", los jueves.
//
// La plantilla `cartera_attention` está aprobada por Meta como `Utility` desde
// el 2026-09-22:
//
//   Hola {{owner_name}}, esto es lo que requiere atención en tu cartera:
//
//   Clientes con plazo vencido: {{overdue_clients}}
//   Clientes que vencen en los próximos 7 días: {{due_this_week}}
//   Clientes que vieron su saldo esta semana y no abonaron: {{viewed_no_payment}}
//
//   Puedes ver el detalle en app.sevenz.site
//
// Aquí la variable del dueño sí se llama `owner_name`, al revés que en
// `cartera_summary`, que quedó aprobada con `customer_name`. Es la
// inconsistencia que decidimos no arreglar porque costaba una aprobación
// entera; está documentada y el código la mapea plantilla por plantilla.
//
// JUEVES Y NO LUNES: `cartera_summary` ya ocupa el lunes, y las dos llevan
// "clientes con plazo vencido". El mismo día, el dueño leería la misma cifra
// dos veces y aprendería que el canal se repite.

type Destinatario = {
  owner_id: string;
  whatsapp: string;
  first_name: string | null;
  overdue_clients: number;
  due_this_week: number;
  viewed_no_payment: number;
  // Migración 072. Aquí NO elige plantilla: sirve para saltarse al dueño.
  pausado: boolean;
};

export type ResumenDeLaTanda = {
  periodo: string;
  destinatarios: number;
  enviados: number;
  omitidos: number;
  fallidos: number;
  // Cuántos no recibieron nada porque no había nada que contarles. Se devuelve
  // aparte de `omitidos` a propósito: omitido es "ya lo tenía", suprimido es
  // "no había motivo". Confundirlos taparía que el mensaje dejó de servirle a
  // media base.
  suprimidos: number;
  // Aparte de `suprimidos`, y no sumados con ellos: son dos motivos distintos
  // de no mandar, y mezclarlos escondería si el enrutado de pausados funciona.
  pausados: number;
};

export async function enviarAtencionSemanal(): Promise<ResumenDeLaTanda> {
  const supabase = createServiceClient();
  const periodo = claveSemanal();

  const { data, error } = await supabase.rpc("whatsapp_destinatarios_atencion");
  if (error) {
    console.error("whatsapp_destinatarios_atencion:", error);
    throw new Error("No se pudo leer la lista de destinatarios.");
  }

  const destinatarios = (data ?? []) as Destinatario[];
  const resultados: ResultadoEnvio[] = [];
  let suprimidos = 0;
  let pausados = 0;

  for (const d of destinatarios) {
    // LA SUPRESIÓN DE VACÍOS, que es la palanca más grande de todo esto y no
    // cuesta nada.
    //
    // Un mensaje que dice "0, 0, 0" gasta presupuesto, gasta reputación del
    // número y —lo peor— enseña al dueño que los avisos de Sevenz no traen
    // nada. Después de tres jueves así, el cuarto no se abre aunque traiga
    // algo.
    //
    // Vive aquí y no en la consulta para que se lea junto a su motivo: es una
    // decisión de producto, no una optimización.
    // AL PAUSADO NO SE LE MANDA ESTA. Ya recibió `cartera_pausada` en la tanda
    // del lunes, y esa plantilla sustituye a las dos: dice lo mismo que el
    // resumen más que la cuenta está pausada. Mandarle además la de atención
    // sería el segundo mensaje de la semana a quien no puede tocar su cartera
    // — el doble de coste en Meta justo en quien no está pagando, y el doble
    // de probabilidad de que lo marque como no deseado. Con un solo número
    // para toda la plataforma, esa denuncia baja el quality rating de TODOS.
    //
    // Va ANTES de la supresión de vacíos a propósito: un pausado sin nada que
    // contar debe contarse como pausado, no como suprimido, o el número deja
    // de decir si el enrutado funciona.
    if (d.pausado) {
      pausados++;
      continue;
    }

    const hayAlgoQueContar =
      d.overdue_clients > 0 || d.due_this_week > 0 || d.viewed_no_payment > 0;
    if (!hayAlgoQueContar) {
      suprimidos++;
      continue;
    }

    // En serie, igual que el resumen del lunes: son dieciocho, y en paralelo
    // los fallos llegan todos juntos sin poder distinguirlos.
    resultados.push(
      await enviarAvisoAlDueno({
        ownerId: d.owner_id,
        to: d.whatsapp,
        plantilla: "cartera_attention",
        periodKey: periodo,
        parametrosCuerpo: [
          { nombre: "owner_name", texto: d.first_name?.trim() || "hola" },
          { nombre: "overdue_clients", texto: String(d.overdue_clients) },
          { nombre: "due_this_week", texto: String(d.due_this_week) },
          { nombre: "viewed_no_payment", texto: String(d.viewed_no_payment) },
        ],
      }),
    );
  }

  return {
    periodo,
    destinatarios: destinatarios.length,
    enviados: resultados.filter((r) => r.estado === "enviado").length,
    omitidos: resultados.filter((r) => r.estado === "omitido").length,
    fallidos: resultados.filter((r) => r.estado === "fallido").length,
    suprimidos,
    pausados,
  };
}
