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

// El número de Sevenz en Kapso. Uno solo para toda la plataforma, que es la
// decisión abierta nº1 del plan: si los clientes de una bodega reportan spam,
// se cae la mensajería de todos los negocios a la vez.
const PHONE_NUMBER_ID = "1373508439159674";

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
    respuesta = await fetch(`${BASE}/${PHONE_NUMBER_ID}/messages`, {
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
