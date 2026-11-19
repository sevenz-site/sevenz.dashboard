import "server-only";

import { fetchUsdtP2p, type UsdtP2p } from "@/lib/exchange-rate/usdt-p2p";

// ONE CACHE FOR BOTH DOORS. The owner's calculator reads the USDT price through
// `/api/usdt` (session) and the client's, since 2026-11-19, through
// `/api/share-usdt` (share token). Both call this, so CriptoYa still sees at
// most one request per minute per instance however many people are looking,
// owners and clients together. Two caches would have doubled that for no gain.
//
// Why the cache lives in process memory and caches null too is written in
// `app/api/usdt/route.ts`, where this logic was born.
const CACHE_MS = 60_000;

let cache: { precio: UsdtP2p | null; en: number } | null = null;

export async function cachedUsdtPrice(
  // The official dollar rate, only for the sanity band in `fetchUsdtP2p`. Read
  // lazily: on a cache hit nobody pays for it.
  officialUsd: () => Promise<number | undefined>,
): Promise<{ usdt: UsdtP2p | null; cacheado: boolean }> {
  const ahora = Date.now();
  if (cache && ahora - cache.en < CACHE_MS) return { usdt: cache.precio, cacheado: true };

  const precio = await fetchUsdtP2p(await officialUsd());
  cache = { precio, en: ahora };
  return { usdt: precio, cacheado: false };
}
