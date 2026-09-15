import { createServiceClient } from "@/lib/supabase/service";

// Las cuentas de la plataforma: qué plan tiene cada negocio, en qué estado
// está y qué se le ha hecho.
//
// Server-side only, igual que lib/admin/metrics.ts: todo esto pasa por el
// cliente de service_role, que es el único que puede ejecutar las funciones de
// la 058. Nada de este archivo puede importarse desde un componente de
// cliente. La puerta que decide quién puede ver esto vive en
// lib/admin/guard.ts, no aquí.
//
// LAS FUNCIONES HACEN EL TRABAJO, no estas envolturas. Cada cambio de plan
// escribe además su asiento en el historial, y eso ocurre DENTRO de la función
// de Postgres, en la misma transacción. Si el historial dependiera de que
// quien llama se acuerde de escribirlo, algún día no se acordaría — y el
// historial de un cobro con huecos no sirve para nada.

export type EstadoCuenta = "demo" | "activa" | "bloqueada" | "cancelada";
export type Periodicidad = "mensual" | "trimestral" | "anual";

export type Cuenta = {
  owner_id: string;
  business_name: string;
  email: string | null;
  whatsapp: string | null;
  country: "CO" | "VE";
  plan_code: string;
  estado: EstadoCuenta;
  demo_termina_el: string | null;
  periodo_termina_el: string | null;
  periodicidad: Periodicidad | null;
  precio_pactado_usd: number | null;
  notas: string | null;
  // false = se registró después de la 057 y nadie lo ha tocado todavía.
  // handle_new_user no crea la suscripción, así que estas cuentas existen.
  tiene_suscripcion: boolean;
  // Negativo = la demo ya venció y el negocio sigue trabajando. Esa es
  // justamente la lista que hay que mirar.
  dias_restantes: number | null;
  ultimo_pago_el: string | null;
  clientes: number;
  creado_el: string;
};

export type EventoCuenta = {
  id: string;
  ocurrido_el: string;
  actor_email: string | null;
  desde_estado: string | null;
  hasta_estado: string | null;
  desde_plan: string | null;
  hasta_plan: string | null;
  motivo: string | null;
  metodo_pago: string | null;
  monto_usd: number | null;
};

export async function getCuentas(): Promise<Cuenta[]> {
  const db = createServiceClient();
  const { data, error } = await db.rpc("admin_cuentas_lista");
  if (error) throw new Error(`admin_cuentas_lista: ${error.message}`);
  return (data ?? []) as Cuenta[];
}

export type IngresoMes = { mes: string; total_usd: number; pagos: number };

// Sale de subscription_events y no de subscriptions: los asientos son
// inmutables, así que subir un precio no reescribe el pasado. Ver la 060.
export async function getIngresosPorMes(meses = 12): Promise<IngresoMes[]> {
  const db = createServiceClient();
  const { data, error } = await db.rpc("admin_ingresos_por_mes", { p_meses: meses });
  if (error) throw new Error(`admin_ingresos_por_mes: ${error.message}`);
  return (data ?? []) as IngresoMes[];
}

export async function getHistorial(ownerId: string): Promise<EventoCuenta[]> {
  const db = createServiceClient();
  const { data, error } = await db.rpc("admin_cuenta_historial", { p_owner: ownerId });
  if (error) throw new Error(`admin_cuenta_historial: ${error.message}`);
  return (data ?? []) as EventoCuenta[];
}

// Los errores de estas tres vuelven como texto para enseñárselo a quien pulsó
// el botón. Es /admin, detrás de requireSuperadmin: aquí el texto crudo de
// Postgres es información útil, no una fuga. La regla de enmascarar errores
// aplica a lo que puede tocar alguien sin sesión.

// El precio y la periodicidad se acuerdan en la MISMA conversación que los
// días de prueba, así que se guardan aquí. Antes había que acordarse de abrir
// "Cambiar plan" semanas después, justo cuando ya nadie recuerda qué se dijo.
//
// Null en cualquiera de los dos significa "no lo hablamos", y la función los
// deja como estaban — no los borra.
export async function darDemo(
  ownerId: string,
  dias: number,
  actorEmail: string,
  notas: string | null,
  precioUsd: number | null,
  periodicidad: Periodicidad | null,
): Promise<{ error: string | null }> {
  const db = createServiceClient();
  const { error } = await db.rpc("admin_dar_demo", {
    p_owner: ownerId,
    p_dias: dias,
    p_actor_email: actorEmail,
    p_notas: notas,
    p_precio_usd: precioUsd,
    p_periodicidad: periodicidad,
  });
  return { error: error?.message ?? null };
}

export async function cambiarPlan(
  ownerId: string,
  plan: string,
  actorEmail: string,
  periodicidad: Periodicidad | null,
  precioUsd: number | null,
  notas: string | null,
): Promise<{ error: string | null }> {
  const db = createServiceClient();
  const { error } = await db.rpc("admin_cambiar_plan", {
    p_owner: ownerId,
    p_plan: plan,
    p_actor_email: actorEmail,
    p_periodicidad: periodicidad,
    p_precio_usd: precioUsd,
    p_notas: notas,
  });
  return { error: error?.message ?? null };
}

export async function registrarPago(
  ownerId: string,
  montoUsd: number,
  metodo: string,
  hasta: string,
  actorEmail: string,
  notas: string | null,
): Promise<{ error: string | null }> {
  const db = createServiceClient();
  const { error } = await db.rpc("admin_registrar_pago", {
    p_owner: ownerId,
    p_monto_usd: montoUsd,
    p_metodo: metodo,
    p_hasta: hasta,
    p_actor_email: actorEmail,
    p_notas: notas,
  });
  return { error: error?.message ?? null };
}

// Las tres listas en las que se parte el panel. Se calcula aquí y no en la
// pantalla porque es la regla del negocio, no una decisión de maquetación.
//
// "Vencidas" son las que más importan: la demo terminó y el negocio SIGUE
// TRABAJANDO, porque se decidió que las demos no bajan solas. Es el precio de
// esa decisión, y por eso tiene su propia lista en vez de estar mezclada.
export function repartirPorUrgencia(cuentas: Cuenta[]) {
  const vencidas: Cuenta[] = [];
  const porVencer: Cuenta[] = [];
  const resto: Cuenta[] = [];

  for (const c of cuentas) {
    if (c.estado === "demo" && c.dias_restantes !== null && c.dias_restantes < 0) {
      vencidas.push(c);
    } else if (c.estado === "demo" && c.dias_restantes !== null && c.dias_restantes <= 14) {
      porVencer.push(c);
    } else {
      resto.push(c);
    }
  }

  // Las más urgentes arriba dentro de cada grupo.
  vencidas.sort((a, b) => (a.dias_restantes ?? 0) - (b.dias_restantes ?? 0));
  porVencer.sort((a, b) => (a.dias_restantes ?? 0) - (b.dias_restantes ?? 0));

  return { vencidas, porVencer, resto };
}
