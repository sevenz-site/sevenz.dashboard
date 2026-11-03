import { NextResponse } from "next/server";
import { runStorageCleanup } from "@/lib/storage-cleanup";

export const runtime = "nodejs";

// Nightly, from `vercel.json`, at 09:00 UTC (05:00 in Venezuela, 04:00 in
// Colombia): the hour with the fewest products being saved, which is when a
// photo is most likely to be referenced for the first time. Vercel Cron only
// fires against Production, so in dev it runs by hand -- `qa:storage-cleanup`
// does exactly that.
//
// Hobby allows 100 cron jobs per project, once a day each: checked on Vercel's
// usage page on 2026-11-02. The comment in `api/cron/whatsapp/route.ts` that
// says two is from before that limit changed.
//
// Same `Authorization: Bearer $CRON_SECRET` as the other cron routes. Behind
// that secret it may return the real error text (CLAUDE.md, «Mask raw errors
// on unauthenticated endpoints»): nobody without the secret gets past line one.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  try {
    const result = await runStorageCleanup();
    console.log("[storage-cleanup]", JSON.stringify(result));
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido.";
    console.error("[storage-cleanup]", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
