import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { readOwnerCountry } from "@/lib/owner-country";
import { exportarMovimientos } from "@/lib/reports/exportar-movimientos";

// ═══════════════════════════════════════════════════════════════════════
// LA DESCARGA DE MOVIMIENTOS
//
// Molde: `app/api/extract/route.ts` -- `runtime = "nodejs"`, `maxDuration`, y
// `supabase.auth.getUser()` como primera línea.
//
// ───────────────────────────────────────────────────────────────────────
// UNA RUTA Y NO UNA ACCIÓN DE SERVIDOR
//
// Lo que hace que el teléfono GUARDE el fichero en vez de pintarlo es la
// cabecera `Content-Disposition: attachment`, y eso solo existe en una
// respuesta HTTP. La razón entera, con lo que falla en iPhone, está en
// `components/dashboard/reportes-descargar.tsx`.
//
// ───────────────────────────────────────────────────────────────────────
// UN FALLO VUELVE A `/reportes`, NO DEVUELVE UN 500 PELADO
//
// Un cuerpo de error en una pestaña del navegador del teléfono es un callejón
// sin salida: no hay reintento, no hay app alrededor, y lo que el tendero ve
// es texto suelto sobre fondo blanco. Así que cada fallo contesta `303` a
// `/reportes?export=error&motivo=<código>` y la pantalla enseña su mensaje.
//
// **SIGUE SIENDO RUIDOSO**, que es lo que pide la regla: no se entrega ningún
// fichero, y el mensaje nombra la causa. Lo que no se hace es entregar medio
// fichero -- ver la parada dura de `exportarMovimientos`.
// ═══════════════════════════════════════════════════════════════════════

export const runtime = "nodejs";
// El tope del plan Hobby, igual que `/api/extract`. No se declara más por el
// mismo motivo que allí: una cifra que el plan no concede es una cifra falsa.
export const maxDuration = 60;
// Dinámico de verdad: esto lee la sesión y datos de dinero. Una respuesta
// cacheada aquí sería el libro de un negocio servido a otro.
export const dynamic = "force-dynamic";

function alError(request: Request, motivo: string): NextResponse {
  const destino = new URL("/reportes", request.url);
  destino.searchParams.set("export", "error");
  destino.searchParams.set("motivo", motivo);
  return NextResponse.redirect(destino, 303);
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const login = new URL("/login", request.url);
    return NextResponse.redirect(login, 303);
  }

  // La misma guarda que la pantalla, y por la misma razón: no saber el país no
  // es saber que es CO. Aquí además decide el desplazamiento con el que se
  // resuelve el rango, así que adivinarlo desplazaría el fichero entero entre
  // 4 y 5 horas en cada punta.
  const country = await readOwnerCountry(supabase, user.id);
  if (!country) return alError(request, "pais");

  const { data: owner } = await supabase
    .from("owners")
    .select("business_name")
    .eq("id", user.id)
    .single();

  const url = new URL(request.url);
  const clientId = url.searchParams.get("cliente");

  // LA PROPIEDAD DEL CLIENTE SE COMPRUEBA AQUÍ, antes de usarlo como filtro, y
  // no se delega en que el embed lo acote.
  //
  // Hoy `exportarMovimientos` filtra por `clients.owner_id` además de por
  // `client_id`, así que un id ajeno ya devolvería cero filas -- pero eso es
  // un fichero vacío perfectamente plausible, no un rechazo. Y `CLAUDE.md`
  // pide la comprobación explícita en código precisamente para que la
  // seguridad no dependa de que ese segundo filtro siga ahí mañana.
  if (clientId) {
    const { data: suyo } = await supabase
      .from("clients")
      .select("id")
      .eq("id", clientId)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (!suyo) return alError(request, "cliente");
  }

  const r = await exportarMovimientos({
    supabase,
    ownerId: user.id,
    country,
    nombreDelNegocio: (owner?.business_name as string | undefined) ?? "Mi negocio",
    desde: url.searchParams.get("desde"),
    hasta: url.searchParams.get("hasta"),
    clientId,
  });
  if ("motivo" in r) return alError(request, r.motivo);

  // EL NOMBRE DEL FICHERO VA DOS VECES, y no es redundancia: `filename=` en
  // ASCII para los lectores viejos, y `filename*=UTF-8''` con el nombre del
  // negocio dentro, que lleva acentos y espacios. Un solo campo con acentos lo
  // trunca algún navegador por el primer byte raro.
  const slug = (owner?.business_name as string | undefined ?? "negocio")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
  const completo = `facturacion-${slug || "negocio"}-${r.nombre.replace(/^facturacion-/, "")}`;

  return new NextResponse(r.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${r.nombre}"; filename*=UTF-8''${encodeURIComponent(completo)}`,
      // `Buffer.byteLength` Y NO `.length`: el BOM y cada acento ocupan más de
      // un byte, así que la cuenta de caracteres daría un `Content-Length`
      // corto y el fichero llegaría truncado.
      "Content-Length": String(Buffer.byteLength(r.csv, "utf8")),
      // NO CACHEAR, y no es precaución de más: esto es el libro de un negocio
      // detrás de una URL con parámetros, y el CDN de Vercel no puede guardar
      // una copia de eso.
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
