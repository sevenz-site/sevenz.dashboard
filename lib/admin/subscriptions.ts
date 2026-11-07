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
  // Migration 171. Why the account cannot write right now, or null. Read from
  // the SAME function the policies use, so the panel cannot say «activa» about
  // an account the database is already refusing.
  motivo_de_bloqueo: "bloqueada" | "prueba_vencida" | "pago_vencido" | null;
  // When the block arrives by itself: the trial's end, or the paid period's
  // end plus the 5 days of grace. Null when nothing is scheduled.
  se_bloquea_el: string | null;
  // A test or demo business: left out of the metrics by default.
  es_prueba: boolean;
  // Migration 198. The KAM in charge today, or null.
  kam_name: string | null;
  kam_email: string | null;
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
  // Ruta dentro del bucket `comprobantes`. Nunca una URL: el bucket es
  // privado y la URL se firma al dibujar la pantalla, con caducidad.
  comprobante_path: string | null;
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
// Las cuatro devuelven `eventoId`: es el asiento que acaban de escribir, y
// es a ese al que se pega el comprobante. Adivinarlo por "el más reciente"
// funciona hasta el día que no, y ese día pega el recibo de un pago al
// asiento de un bloqueo.
type Resultado = { error: string | null; eventoId: string | null };

function leeEvento(data: unknown): string | null {
  const id = (data as { evento_id?: unknown } | null)?.evento_id;
  return typeof id === "string" ? id : null;
}

export async function darDemo(
  ownerId: string,
  dias: number,
  actorEmail: string,
  notas: string | null,
  precioUsd: number | null,
  periodicidad: Periodicidad | null,
): Promise<Resultado> {
  const db = createServiceClient();
  const { data, error } = await db.rpc("admin_dar_demo", {
    p_owner: ownerId,
    p_dias: dias,
    p_actor_email: actorEmail,
    p_notas: notas,
    p_precio_usd: precioUsd,
    p_periodicidad: periodicidad,
  });
  return { error: error?.message ?? null, eventoId: leeEvento(data) };
}

export async function cambiarPlan(
  ownerId: string,
  plan: string,
  actorEmail: string,
  periodicidad: Periodicidad | null,
  precioUsd: number | null,
  notas: string | null,
): Promise<Resultado> {
  const db = createServiceClient();
  const { data, error } = await db.rpc("admin_cambiar_plan", {
    p_owner: ownerId,
    p_plan: plan,
    p_actor_email: actorEmail,
    p_periodicidad: periodicidad,
    p_precio_usd: precioUsd,
    p_notas: notas,
  });
  return { error: error?.message ?? null, eventoId: leeEvento(data) };
}

export async function registrarPago(
  ownerId: string,
  montoUsd: number,
  metodo: string,
  hasta: string,
  actorEmail: string,
  notas: string | null,
): Promise<Resultado> {
  const db = createServiceClient();
  const { data, error } = await db.rpc("admin_registrar_pago", {
    p_owner: ownerId,
    p_monto_usd: montoUsd,
    p_metodo: metodo,
    p_hasta: hasta,
    p_actor_email: actorEmail,
    p_notas: notas,
  });
  return { error: error?.message ?? null, eventoId: leeEvento(data) };
}

// El motivo es OBLIGATORIO y la función lo exige también: el día que alguien
// diga "me bloqueaste y yo había pagado", la respuesta tiene que estar
// escrita. Un historial con "bloqueada" y nada más no responde nada.
export async function bloquear(
  ownerId: string,
  motivo: string,
  actorEmail: string,
): Promise<Resultado> {
  const db = createServiceClient();
  const { data, error } = await db.rpc("admin_bloquear", {
    p_owner: ownerId,
    p_motivo: motivo,
    p_actor_email: actorEmail,
  });
  return { error: error?.message ?? null, eventoId: leeEvento(data) };
}

export async function desbloquear(
  ownerId: string,
  actorEmail: string,
  motivo: string | null,
): Promise<{ error: string | null }> {
  const db = createServiceClient();
  const { error } = await db.rpc("admin_desbloquear", {
    p_owner: ownerId,
    p_actor_email: actorEmail,
    p_motivo: motivo,
  });
  return { error: error?.message ?? null };
}

// Las tres listas en las que se parte el panel. Se calcula aquí y no en la
// pantalla porque es la regla del negocio, no una decisión de maquetación.
//
// CHANGED ON 2026-10-31 (migration 171). The list that mattered most used to
// be «vencidas y sigue trabajando»: the owner had decided on 2026-09-15 that
// demos do not expire by themselves, and that list was the price of it. Now
// they do, so an expired demo no longer keeps working -- it is BLOCKED. What
// matters most becomes the list BEFORE that happens: accounts that block by
// themselves within 14 days, because one of them may be someone who paid and
// whose payment was never registered -- the risk he accepted with the change.
export function repartirPorUrgencia(cuentas: Cuenta[], ahora: Date = new Date()) {
  const bloqueadas: Cuenta[] = [];
  const porBloquearse: Cuenta[] = [];
  const resto: Cuenta[] = [];
  const limite = ahora.getTime() + 14 * 24 * 60 * 60 * 1000;

  for (const c of cuentas) {
    if (c.motivo_de_bloqueo) {
      bloqueadas.push(c);
    } else if (c.se_bloquea_el && new Date(c.se_bloquea_el).getTime() <= limite) {
      porBloquearse.push(c);
    } else {
      resto.push(c);
    }
  }

  const cuando = (c: Cuenta) => (c.se_bloquea_el ? new Date(c.se_bloquea_el).getTime() : Infinity);
  porBloquearse.sort((a, b) => cuando(a) - cuando(b));

  return { bloqueadas, porBloquearse, resto };
}

// Mark or unmark a test business (migration 171). Recorded in the history,
// like every other change to an account.
export async function marcarPrueba(
  ownerId: string,
  esPrueba: boolean,
  actorEmail: string,
): Promise<{ error: string | null }> {
  const db = createServiceClient();
  const { error } = await db.rpc("admin_marcar_prueba", {
    p_owner: ownerId,
    p_es_prueba: esPrueba,
    p_actor_email: actorEmail,
  });
  return { error: error?.message ?? null };
}

// ── El comprobante ──────────────────────────────────────────────────────
//
// Todo pasa por service_role, y no es una comodidad: el bucket `comprobantes`
// no tiene ni una politica. Una sesion normal —incluida la del superadmin, que
// para la base es un tendero mas— no puede ni subir ni leer. Quien es
// superadmin lo dice SUPERADMIN_EMAILS, que es una variable de entorno, asi
// que ninguna politica de storage podria comprobarlo aunque la escribieramos.

const BUCKET = "comprobantes";

// Extensiones por tipo, no por el nombre que traiga el archivo. Un
// "recibo.pdf.exe" no deberia decidir como se guarda nada.
const EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export async function subirComprobante(
  ownerId: string,
  archivo: File,
): Promise<{ path: string | null; error: string | null }> {
  const extension = EXTENSION[archivo.type];
  if (!extension) {
    return { path: null, error: "Solo aceptamos imagenes o PDF." };
  }
  // El bucket tambien lo limita, pero rechazarlo aqui ahorra subir 8 MB para
  // que el otro extremo diga que no.
  if (archivo.size > 5 * 1024 * 1024) {
    return { path: null, error: "El archivo pasa de 5 MB." };
  }

  const db = createServiceClient();
  const path = `${ownerId}/${crypto.randomUUID()}.${extension}`;
  const { error } = await db.storage.from(BUCKET).upload(path, archivo, {
    contentType: archivo.type,
    upsert: false,
  });
  if (error) return { path: null, error: error.message };
  return { path, error: null };
}

export async function borrarComprobante(path: string): Promise<void> {
  const db = createServiceClient();
  await db.storage.from(BUCKET).remove([path]);
}

export async function guardarComprobante(
  eventoId: string,
  path: string,
): Promise<{ error: string | null }> {
  const db = createServiceClient();
  const { error } = await db.rpc("admin_guarda_comprobante", {
    p_evento: eventoId,
    p_path: path,
  });
  return { error: error?.message ?? null };
}

// URL firmada y no publica. Caduca en una hora: lo que se comparte por error
// —un pantallazo, un enlace pegado en un chat— deja de funcionar solo.
//
// Se firman todas de una vez al dibujar el historial, en vez de una por click:
// una accion de servidor por cada comprobante seria un endpoint mas al que
// llamar con una ruta cualquiera.
export async function urlsDeComprobantes(
  paths: string[],
): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const db = createServiceClient();
  const { data, error } = await db.storage.from(BUCKET).createSignedUrls(paths, 3600);
  if (error || !data) return {};

  const porRuta: Record<string, string> = {};
  for (const fila of data) {
    if (fila.path && fila.signedUrl) porRuta[fila.path] = fila.signedUrl;
  }
  return porRuta;
}
