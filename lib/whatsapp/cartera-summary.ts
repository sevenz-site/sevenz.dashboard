import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { formatCurrency } from "@/lib/format";
import { formatDisplayCurrency } from "@/lib/exchange-rate/format";
import { claveSemanal, enviarAvisoAlDueno, type ResultadoEnvio } from "@/lib/whatsapp/send";
import type { OwnerCountry } from "@/lib/types";

// El resumen semanal de cartera, a todos los dueños que lo aceptaron.
//
// La plantilla `cartera_summary` está aprobada por Meta como `Utility` desde el
// 2026-09-22, con estas tres variables y con estos nombres exactos:
//
//   Hola {{customer_name}}, este es el resumen de tu cartera en Sevenz.
//
//   Por cobrar: {{amount_due}}
//   Clientes con plazo vencido: {{overdue_clients}}
//
//   Puedes ver el detalle en app.sevenz.site
//
// OJO CON `customer_name`. Lo recibe el DUEÑO, no un cliente. Es como Meta
// llama al destinatario de un mensaje —su documentación dice "the customer"— y
// Kapso genera los nombres con esa convención, así que en su vocabulario es
// correcto. En el de Sevenz no: aquí "cliente" es el deudor del tendero. No se
// puede renombrar sin rehacer la plantilla y perder la aprobación, así que el
// desajuste se aísla en `PLANTILLAS`, abajo. Las demás usan `owner_name` y
// `client_name`.
//
// Y ESE DESAJUSTE ES POR QUÉ `PLANTILLAS` EXISTE. Desde la 072 este archivo
// manda DOS plantillas, y no declaran igual el parámetro del destinatario:
// `cartera_summary` lo llama `customer_name` y `cartera_pausada` —aprobada seis
// días después— lo llama `owner_name`, porque la corrección se hizo en la
// plantilla nueva, donde salía gratis.
//
// Kapso los manda POR NOMBRE (`parameter_name`, en lib/whatsapp/kapso.ts) y
// Meta rechaza un parámetro que la plantilla no declara. O sea que el nombre no
// es cosmético: elegir la plantilla sin elegir también el nombre hace que el
// envío falle ENTERO. Y falla callado — el dueño pausado se queda sin nada esa
// semana, porque solo se le manda una plantilla y es la que falla.

// LA PLANTILLA Y SU PARÁMETRO, JUNTOS, porque separados ya se rompieron una
// vez: la primera versión de la 072 cambiaba la plantilla y dejaba el nombre
// fijo en `customer_name`. Atados aquí, añadir una tercera obliga a decir su
// nombre — no hay un valor por defecto que pueda ser el equivocado.
//
// Es la misma forma que `BANDERAS` en exchange-rate-strip.tsx, y por el mismo
// motivo: dos datos que tienen que cambiar a la vez no se guardan en dos
// sitios.
const PLANTILLAS = {
  alDia: { nombre: "cartera_summary", parametroDelDueno: "customer_name" },
  pausado: { nombre: "cartera_pausada", parametroDelDueno: "owner_name" },
} as const;

type Destinatario = {
  owner_id: string;
  whatsapp: string;
  first_name: string | null;
  country: OwnerCountry;
  balance_cop: number;
  balance_usd: number;
  balance_eur: number;
  overdue_clients: number;
  // Migración 072. Viene como COLUMNA y no como filtro a propósito: un dueño
  // pausado sigue en la lista y recibe OTRA plantilla, no ninguna.
  pausado: boolean;
};

// Lo que el dueño lee como "Por cobrar". Un negocio VE lleva dos libros
// independientes —USD y EUR— y sumarlos sería inventar un número, así que
// cuando debe en las dos se mandan las dos: "$50.00 y €20.00".
function porCobrar(d: Destinatario): string {
  if (d.country !== "VE") return formatCurrency(Number(d.balance_cop));

  const partes: string[] = [];
  if (Number(d.balance_usd) > 0) partes.push(formatDisplayCurrency(Number(d.balance_usd), "USD"));
  if (Number(d.balance_eur) > 0) partes.push(formatDisplayCurrency(Number(d.balance_eur), "EUR"));
  // Sin deuda en ninguna de las dos, "$0.00" dice la verdad y es mejor que una
  // cadena vacía: Meta rechaza un parámetro vacío.
  if (partes.length === 0) return formatDisplayCurrency(0, "USD");
  return partes.join(" y ");
}

export type ResumenDeLaTanda = {
  periodo: string;
  destinatarios: number;
  enviados: number;
  omitidos: number;
  fallidos: number;
  detalle: { ownerId: string; resultado: ResultadoEnvio }[];
};

export async function enviarResumenSemanal(): Promise<ResumenDeLaTanda> {
  const supabase = createServiceClient();
  const periodo = claveSemanal();

  // A UNA CUENTA BLOQUEADA SÍ SE LE ESCRIBE, y es una decisión, no un olvido.
  //
  // `whatsapp_destinatarios_resumen` filtra por número, consentimiento y baja
  // voluntaria. NO filtra por `owner_puede_escribir`. Se escribió la migración
  // que lo añadía y se descartó sin correrla, el 2026-09-25.
  //
  // El motivo: un dueño bloqueado sigue pudiendo LEER su cartera —eso no se
  // bloquea nunca— así que el resumen del lunes le sigue sirviendo, y recibir
  // el valor del producto es justo lo que puede empujarle a ponerse al día.
  // Cortarle el aviso le quita una razón para volver.
  //
  // LO QUE SE ACEPTA A CAMBIO, para que nadie lo descubra por sorpresa:
  //   - Se paga a Meta por cada mensaje a quien no está pagando.
  //   - RESUELTO EL 2026-09-28. Meta aprobó `cartera_pausada`, así que el
  //     mensaje ya NO es idéntico al de un dueño al día: dice que la cuenta
  //     está pausada, que la cartera y el historial siguen ahí, y trae un
  //     botón de respuesta rápida para pedir la reactivación. Sustituye a las
  //     DOS: el pausado recibe una sola cosa a la semana.
  //
  //     LO QUE ESA RESPUESTA RÁPIDA ARRASTRA: vuelve al número de Kapso
  //     (+1 202 915 8501), NO al de soporte (+57 323 813 0265), y no hay
  //     webhook que la recoja — la solicitud existe solo dentro de Kapso. Se
  //     acepta porque el usuario revisa esa bandeja a diario. Si eso deja de
  //     ser cierto hay que revisar esta decisión: un dueño que pide la
  //     reactivación y no recibe respuesta está peor que uno que nunca pudo
  //     pedirla.
  //   - Si alguna vez un dueño bloqueado marca el mensaje como no deseado,
  //     con un solo número para toda la plataforma el quality rating baja
  //     para todos. Ese es el riesgo real de esta decisión.
  //
  // Si algún día se revierte —dejar de escribirle a un pausado— el cambio es
  // una línea en las funciones de la 072: pasar `pausado` de columna a filtro,
  // `and public.owner_puede_escribir(o.id)`.
  const { data, error } = await supabase.rpc("whatsapp_destinatarios_resumen");
  if (error) {
    console.error("whatsapp_destinatarios_resumen:", error);
    throw new Error("No se pudo leer la lista de destinatarios.");
  }

  const destinatarios = (data ?? []) as Destinatario[];
  const detalle: ResumenDeLaTanda["detalle"] = [];

  // En serie, no en paralelo. Son dieciocho dueños: el tiempo que se ahorra no
  // compensa que dieciocho llamadas simultáneas a Kapso disparen su límite de
  // ritmo y que los fallos lleguen todos juntos sin poder distinguirlos.
  for (const d of destinatarios) {
    // LA ÚNICA LÍNEA QUE ELIGE, y elige las dos cosas a la vez. `cartera_pausada`
    // sustituye a las DOS plantillas para un dueño pausado: una sola cosa a la
    // semana, no dos. Que `cartera_attention` no se le mande también se
    // resuelve en su propio archivo, saltándoselo.
    const plantilla = d.pausado ? PLANTILLAS.pausado : PLANTILLAS.alDia;

    const resultado = await enviarAvisoAlDueno({
      ownerId: d.owner_id,
      to: d.whatsapp,
      plantilla: plantilla.nombre,
      periodKey: periodo,
      parametrosCuerpo: [
        // El parámetro del destinatario lleva el nombre del DUEÑO, se llame
        // como se llame en cada plantilla. Ver la nota de arriba.
        // El respaldo no es decorativo: `first_name` es obligatorio desde el
        // registro, pero una fila anterior a esa regla lo tiene nulo, y "Hola
        // , este es el resumen" es peor que un saludo genérico.
        { nombre: plantilla.parametroDelDueno, texto: d.first_name?.trim() || "hola" },
        { nombre: "amount_due", texto: porCobrar(d) },
        { nombre: "overdue_clients", texto: String(d.overdue_clients) },
      ],
    });
    detalle.push({ ownerId: d.owner_id, resultado });
  }

  return {
    periodo,
    destinatarios: destinatarios.length,
    enviados: detalle.filter((x) => x.resultado.estado === "enviado").length,
    omitidos: detalle.filter((x) => x.resultado.estado === "omitido").length,
    fallidos: detalle.filter((x) => x.resultado.estado === "fallido").length,
    detalle,
  };
}
