import { createServiceClient } from "@/lib/supabase/service";

// LA SALUD DEL CRON DE WHATSAPP, para la tarjeta de /admin.
//
// La cuenta que importa NO es cuántos mensajes salieron: es CUÁNTO HACE DE LA
// ÚLTIMA CORRIDA. `whatsapp_sends` solo escribe cuando se reserva un envío, así
// que una tanda sin destinatarios y un cron que dejó de dispararse son cero
// filas las dos. `whatsapp_cron_runs` (migración 071) escribe una fila por
// ejecución, siempre, y eso es lo único que los distingue.
//
// Se lee por RPC y no con un select a la tabla: producción revoca el SELECT a
// `service_role` sobre las tablas de clientes y dev no, y esa asimetría ya tiró
// /admin una vez (migración 039). Una SECURITY DEFINER no necesita grant.

// El cron corre una vez al día. 26 horas da margen para que Vercel se retrase
// un par de horas sin encender una alarma que no significa nada, y sigue
// cazando el día entero perdido. Por encima de 50 h ya son dos disparos
// seguidos fallados, que es otra conversación.
const HORAS_PARA_ALARMA = 26;
const HORAS_PARA_ALARMA_GRAVE = 50;

type Contadores = {
  periodo?: string;
  destinatarios?: number;
  enviados?: number;
  omitidos?: number;
  fallidos?: number;
};

export type SaludDelCron = {
  // Null solo antes de la primera corrida. En producción eso significa que el
  // cron nunca se ha disparado desde que existe el latido, que es exactamente
  // lo que la tarjeta tiene que gritar.
  ultimaCorrida: string | null;
  horasDesdeUltima: number | null;
  ultimoDiaIso: number | null;
  resumen: Contadores | null;
  atencion: Contadores | null;
  ultimoError: string | null;
  corridas7d: number;
  corridasConError7d: number;
  enviados7d: number;
  fallidos7d: number;
  estado: "ok" | "warn" | "fail";
  // Una frase, la que se pinta debajo del número. Dice el porqué, no el qué.
  detalle: string;
};

function horasEnPalabras(h: number): string {
  if (h < 1) return "hace menos de una hora";
  if (h < 24) return `hace ${Math.round(h)} h`;
  const dias = Math.floor(h / 24);
  return dias === 1 ? "hace 1 día" : `hace ${dias} días`;
}

export async function getSaludDelCronWhatsapp(): Promise<SaludDelCron> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("admin_whatsapp_cron_salud").maybeSingle();

  if (error || !data) {
    // No se distingue "la función no existe" de "la consulta falló", y da
    // igual: las dos significan que este panel no sabe nada, y decir "0
    // enviados" sería peor que decirlo.
    if (error) console.error("salud del cron de whatsapp:", error);
    return {
      ultimaCorrida: null, horasDesdeUltima: null, ultimoDiaIso: null,
      resumen: null, atencion: null, ultimoError: null,
      corridas7d: 0, corridasConError7d: 0, enviados7d: 0, fallidos7d: 0,
      estado: "fail",
      detalle: "no pudimos leer el estado del cron",
    };
  }

  const d = data as {
    ultima_ran_at: string | null;
    horas_desde_ultima: number | null;
    ultimo_dia_iso: number | null;
    ultimo_resultado: { resumen?: Contadores; atencion?: Contadores | null } | null;
    ultimo_error: string | null;
    corridas_7d: number;
    corridas_con_error_7d: number;
    enviados_7d: number;
    fallidos_7d: number;
  };

  const horas = d.horas_desde_ultima === null ? null : Number(d.horas_desde_ultima);

  let estado: SaludDelCron["estado"] = "ok";
  let detalle: string;

  if (horas === null) {
    estado = "fail";
    detalle = "nunca se ha disparado";
  } else if (horas >= HORAS_PARA_ALARMA_GRAVE) {
    estado = "fail";
    detalle = `${horasEnPalabras(horas)} · lleva dos disparos o más sin correr`;
  } else if (horas >= HORAS_PARA_ALARMA) {
    estado = "fail";
    detalle = `${horasEnPalabras(horas)} · debería correr cada 24 h`;
  } else if (d.ultimo_error) {
    estado = "fail";
    detalle = `${horasEnPalabras(horas)} · la última tanda reventó`;
  } else if (d.fallidos_7d > 0) {
    estado = "warn";
    detalle = `${horasEnPalabras(horas)} · ${d.fallidos_7d} envíos fallidos esta semana`;
  } else {
    // El lunes que no sale `cartera_attention` no es un fallo, y decirlo evita
    // que alguien lea el cero como un problema.
    const lunes = d.ultimo_dia_iso === 1;
    detalle = `${horasEnPalabras(horas)}${lunes ? " · lunes: solo va el resumen" : ""}`;
  }

  return {
    ultimaCorrida: d.ultima_ran_at,
    horasDesdeUltima: horas,
    ultimoDiaIso: d.ultimo_dia_iso,
    resumen: d.ultimo_resultado?.resumen ?? null,
    atencion: d.ultimo_resultado?.atencion ?? null,
    ultimoError: d.ultimo_error,
    corridas7d: d.corridas_7d,
    corridasConError7d: d.corridas_con_error_7d,
    enviados7d: d.enviados_7d,
    fallidos7d: d.fallidos_7d,
    estado,
    detalle,
  };
}
