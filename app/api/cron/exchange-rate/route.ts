import { NextResponse } from "next/server";
import { fetchAndStoreBcvRate } from "@/lib/exchange-rate/fetch-and-store";

export const runtime = "nodejs";

// Manually-triggerable for now (this feature is dev-only so far — Vercel
// Cron Jobs only ever fire against a Production deployment, so a real
// schedule can't run against dev.sevenz.site yet). Same
// Authorization: Bearer $CRON_SECRET convention Vercel Cron itself uses,
// so this becomes the real scheduled job with zero code changes once
// vercel.json registers it on merge to main — just curl it directly to
// test in the meantime.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  try {
    const result = await fetchAndStoreBcvRate();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
