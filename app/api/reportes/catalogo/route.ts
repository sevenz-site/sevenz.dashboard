import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOwnerRateContext } from "@/lib/exchange-rate/owner-rate";
import { deISO, rangoDe } from "@/lib/reports/rango";
import { exportarInventario, exportarProveedores } from "@/lib/reports/exportar-inventario";

// ═══════════════════════════════════════════════════════════════════════
// LA DESCARGA DE «INVENTARIO» Y «PROVEEDORES»
//
// Mismo molde que `/api/reportes/movimientos`, hasta el último detalle de la
// respuesta: `Content-Disposition: attachment` para que el teléfono GUARDE el
// fichero, `Content-Length` en BYTES y no en caracteres --el BOM y cada
// acento ocupan más de uno--, y `no-store` porque esto es el catálogo de un
// negocio detrás de una URL con parámetros.
//
// ───────────────────────────────────────────────────────────────────────
// UNA RUTA PARA LOS DOS APARTADOS, CON `?que=`
//
// Y no dos rutas. Todo lo que rodea al fichero --sesión, país, tasas, rango,
// nombre del negocio, cabeceras, el redirect de error-- es idéntico; lo único
// que cambia es qué función se llama. Dos copias de esta envoltura se
// separarían en el primer arreglo que alguien hiciera en una sola.
//
// UN `?que=` DESCONOCIDO ES UN FALLO, no «inventario por defecto»: adivinar
// aquí entregaría un fichero que no es el que se pidió, con el nombre del que
// sí se pidió. Un rango ausente ya se rechaza por la misma razón.
// ═══════════════════════════════════════════════════════════════════════

export const runtime = "nodejs";
export const maxDuration = 60;
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
  if (!user) return NextResponse.redirect(new URL("/login", request.url), 303);

  const url = new URL(request.url);
  const que = url.searchParams.get("que");
  if (que !== "inventario" && que !== "proveedores") return alError(request, "rango");

  // LAS DOS FECHAS, EXPLÍCITAS. Una pantalla puede interpretar un rango
  // ausente como «los últimos 30 días»; un fichero es una prueba, y uno con el
  // rango adivinado es peor que ninguno. Es la misma regla de la otra ruta.
  const desde = url.searchParams.get("desde");
  const hasta = url.searchParams.get("hasta");
  if (!deISO(desde) || !deISO(hasta)) return alError(request, "rango");
  const rango = rangoDe({ desde: desde!, hasta: hasta! });

  const [{ data: owner }, ownerRate] = await Promise.all([
    supabase.from("owners").select("business_name").eq("id", user.id).single(),
    getOwnerRateContext(supabase, user.id),
  ]);

  // Las mismas tasas que la pantalla arma, con `usdt: null` a propósito:
  // ninguna cifra de estos dos apartados se expresa en USDT, así que salir a
  // CriptoYa sería una llamada de red por un dato que nadie va a leer.
  const rates = ownerRate
    ? { usd: ownerRate.effectiveRate.usd, eur: ownerRate.effectiveRate.eur, usdt: null }
    : null;

  const comun = {
    supabase,
    ownerId: user.id,
    nombreDelNegocio: (owner?.business_name as string | undefined) ?? "Mi negocio",
    rango,
    rates,
  };
  const r =
    que === "inventario" ? await exportarInventario(comun) : await exportarProveedores(comun);
  if ("motivo" in r) return alError(request, r.motivo);

  const slug = ((owner?.business_name as string | undefined) ?? "negocio")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
  // EL NOMBRE VA DOS VECES, por lo mismo que en la otra ruta: `filename=` en
  // ASCII para los lectores viejos y `filename*=UTF-8''` con el del negocio,
  // que lleva acentos y espacios.
  const completo = `${r.nombre}-${slug || "negocio"}.csv`;

  return new NextResponse(r.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${r.nombre}.csv"; filename*=UTF-8''${encodeURIComponent(completo)}`,
      "Content-Length": String(Buffer.byteLength(r.csv, "utf8")),
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
