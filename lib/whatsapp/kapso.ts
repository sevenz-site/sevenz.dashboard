import "server-only";

// La llamada cruda a Kapso, y nada más. Sin contador, sin reglas de negocio:
// eso vive en send.ts, que es lo único que debería llamar a este archivo.
//
// ─────────────────────────────────────────────────────────────────────────
// NO SE INSTALA EL SDK, Y LA RAZÓN NO ES EL TAMAÑO
//
// Kapso publica `@kapso/whatsapp-cloud-api`. Esto es un POST con una cabecera
// y un JSON, así que el SDK no ahorra código que justifique una dependencia —
// y añadirlo dispararía `new-api-risk-review` por la regla de CLAUDE.md, una
// reseña entera para envolver un `fetch`.
//
// Pero lo que decide es otra cosa: **el contador de whatsapp_sends tiene que
// ser inesquivable**. Un SDK invita a importarlo desde cualquier sitio y
// llamar a `sendTemplate` directamente, saltándose la reserva del turno. Una
// función propia no: si no pasa por send.ts, no hay forma de mandar nada.
//
// ─────────────────────────────────────────────────────────────────────────
// LA AUTENTICACIÓN ES `X-API-Key`, NO UN BEARER DE META
//
// Kapso hace de proxy sobre el Cloud API. Un `Authorization: Bearer <token>`
// de Meta aquí no vale — lo dice su propia documentación, y es fácil de
// equivocar porque el endpoint imita la forma del de Meta.

const BASE = "https://api.kapso.ai/meta/whatsapp/v24.0";

// DOS NÚMEROS, UNO POR AUDIENCIA (MS-24, 2026-10-12).
//
// Antes había uno solo para toda la plataforma, y era la decisión abierta nº1
// del plan: Meta mide la calidad POR NÚMERO, así que unos cuantos clientes
// marcando como no deseado el recordatorio de su deuda estrangulaban el mismo
// número que lleva los avisos a los 24 dueños — que ya funcionan en producción.
// Un experimento se habría llevado por delante lo que ya iba bien.
//
// EL VIEJO SE QUEDA CON LOS DUEÑOS, y ese reparto no es arbitrario: ese número
// lleva meses de historial limpio, y el tráfico arriesgado es el nuevo. Darle
// los clientes al número con reputación sería apostar justo lo que no hay que
// apostar.
//
// LO QUE ESTO **NO** ARREGLA, y conviene no darlo por cerrado: separar aisla la
// CALIDAD, no la CAPACIDAD. Kapso confirmó el 2026-10-10 que el techo de 250
// conversaciones/24h es del **business portfolio**, no del número: dos números
// no son 500, y los avisos al dueño compiten por el mismo cupo que los del
// cliente. Eso es `MS-37`.
//
// Y TAMPOCO ARREGLA `MS-17`: el número nuevo es **+1 201 908 5747**, otra vez
// de EE. UU. Un cliente venezolano sigue recibiendo un mensaje sobre su deuda
// desde un número estadounidense, que es la forma exacta de la estafa más
// corriente del país. El pie antifraude de las plantillas refuerza; lo que
// resuelve es un número local.
const PHONE_ID_OWNERS = "1373508439159674"; // +1 202 915 8501
const PHONE_ID_CLIENTS = "1329482340254222"; // +1 201 908 5747

export type Audience = "owner" | "client";

function phoneIdFor(audience: Audience): string {
  return audience === "client" ? PHONE_ID_CLIENTS : PHONE_ID_OWNERS;
}

// `NEXT_PUBLIC_` NUNCA. Se lee dentro de la función y no en el módulo para
// que importar este archivo no reviente en un entorno donde no esté puesta —
// el error tiene que salir al intentar mandar, no al arrancar.
function apiKey(): string {
  const key = process.env.KAPSO_API_KEY;
  if (!key) throw new Error("KAPSO_API_KEY no está configurada.");
  return key;
}

export type ParametroPlantilla = { nombre: string; texto: string };

export type ResultadoKapso =
  | { ok: true; messageId: string | null }
  | { ok: false; error: string };

// `to` va en dígitos con prefijo de país y SIN `+`, que es exactamente como
// `owners.whatsapp` y `clients.whatsapp` lo guardan ya. No hay conversión que
// escribir — y por eso mismo conviene comprobarlo en el primer envío real en
// vez de darlo por cierto.
export async function enviarPlantilla(opciones: {
  // Sin valor por defecto a propósito: desde qué número sale un mensaje decide
  // qué reputación se arriesga, y eso no puede quedar en manos de una omisión
  // que nadie ve en el sitio de la llamada.
  audience: Audience;
  to: string;
  plantilla: string;
  parametrosCuerpo: ParametroPlantilla[];
  // Sufijo variable del botón de URL, cuando la plantilla lleva uno. Las dos
  // de dueño no llevan; las de cliente sí.
  parametroBoton?: ParametroPlantilla;
}): Promise<ResultadoKapso> {
  const componentes: unknown[] = [
    {
      type: "body",
      parameters: opciones.parametrosCuerpo.map((p) => ({
        type: "text",
        parameter_name: p.nombre,
        text: p.texto,
      })),
    },
  ];

  if (opciones.parametroBoton) {
    componentes.push({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [
        {
          type: "text",
          parameter_name: opciones.parametroBoton.nombre,
          text: opciones.parametroBoton.texto,
        },
      ],
    });
  }

  let respuesta: Response;
  try {
    respuesta = await fetch(`${BASE}/${phoneIdFor(opciones.audience)}/messages`, {
      method: "POST",
      headers: {
        "X-API-Key": apiKey(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: opciones.to,
        type: "template",
        template: {
          name: opciones.plantilla,
          language: { code: "es" },
          components: componentes,
        },
      }),
      // Sin esto, una llamada colgada bloquea el cron entero: dieciocho
      // dueños esperando detrás de uno.
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    // Red caída, DNS, timeout. El texto se guarda en whatsapp_sends.error y no
    // sale a ninguna respuesta HTTP.
    return { ok: false, error: error instanceof Error ? error.message : "Error de red." };
  }

  const cuerpo = await respuesta.text();

  if (!respuesta.ok) {
    return { ok: false, error: `HTTP ${respuesta.status}: ${cuerpo.slice(0, 500)}` };
  }

  // El id del mensaje es informativo: sirve para rastrear una entrega con
  // Kapso, no para decidir nada. Si el JSON cambia de forma, un envío bueno no
  // debe contarse como fallido solo porque no encontramos el id.
  try {
    const json = JSON.parse(cuerpo) as { messages?: { id?: string }[] };
    return { ok: true, messageId: json.messages?.[0]?.id ?? null };
  } catch {
    return { ok: true, messageId: null };
  }
}
