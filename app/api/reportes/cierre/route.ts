import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { trackServer } from "@/lib/mixpanel-server";
import { readOwnerCountry } from "@/lib/owner-country";
import { exportarCierre } from "@/lib/reports/exportar-cierre";

// THE DAY'S AND THE MONTH'S CLOSE AS A FILE (owner's request of 2026-11-17). Same shape as
// `/api/reportes/catalogo`: a GET that answers with an attachment, so the system's download
// sheet takes the file and the session cookie travels on its own -- the iPhone reason is
// written in `components/dashboard/reportes-descargar.tsx`.
//
// AUTHENTICATED ONLY, so a failure may say what failed in the logs; the screen gets the same
// «No se pudo descargar» band as the other two routes, with a fixed reason.

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

  const que = new URL(request.url).searchParams.get("que");
  if (que !== "dia" && que !== "mes") return alError(request, "rango");

  const [{ data: owner }, country] = await Promise.all([
    supabase.from("owners").select("business_name").eq("id", user.id).single(),
    readOwnerCountry(supabase, user.id),
  ]);
  // Not knowing the country is not knowing it is Colombia (the same guard as the screen).
  if (!country) return alError(request, "pais");

  let r;
  try {
    r = await exportarCierre({
      supabase,
      ownerId: user.id,
      country,
      nombreDelNegocio: (owner?.business_name as string | undefined) ?? "Mi negocio",
      que,
    });
  } catch (e) {
    console.error("[reportes/cierre]", e instanceof Error ? e.message : e);
    // «Did the closes' download fail, and how often?» -- the same question `Report Export
    // Failed` answers for the other files; `que` tells them apart.
    trackServer("Report Export Failed", user.id, { que: `cierre_${que}`, reason: "lectura" }, user.email);
    return alError(request, "lectura");
  }

  const slug = ((owner?.business_name as string | undefined) ?? "negocio")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
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
