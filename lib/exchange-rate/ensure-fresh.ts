import { after } from "next/server";
import { fetchAndStoreBcvRate } from "@/lib/exchange-rate/fetch-and-store";

// How old the stored rate may be before a page load refreshes it. The BCV
// publishes once per business day, so this isn't about tracking volatility —
// it's about how long after that publication an owner keeps seeing yesterday's
// number. The Vercel cron can only fire once a day on the Hobby plan, which is
// why the dashboard could sit up to 24h behind while sevenz.site, fetching from
// the visitor's own browser, was current.
const MAX_AGE_MS = 20 * 60 * 1000;

// Both providers allow themselves 8s, and the fallback runs after the primary
// gives up — up to 16s. That budget is right for the cron, where nobody is
// waiting, and completely wrong here, where an owner is staring at a blank
// dashboard. Past this deadline we render with the stored rate and let the
// fetch finish in the background, so the next load gets the fresh one.
const DEADLINE_MS = 2_500;

// Dedupes within a single serverless instance: without it, every concurrent
// render past the staleness window fires its own fetch. Other instances can
// still overlap — harmless, since each fetch just appends a row and the
// anomaly guard in fetchAndStoreBcvRate decides what counts as official.
let inFlight: Promise<Awaited<ReturnType<typeof fetchAndStoreBcvRate>>> | null = null;

function startFetch() {
  if (inFlight) return inFlight;
  const work = fetchAndStoreBcvRate().finally(() => {
    inFlight = null;
  });
  inFlight = work;
  return work;
}

// Returns fresher rates when it can get them inside the deadline, or null to
// mean "keep using what's stored". Never throws: a rate provider having a bad
// day must not take the dashboard down with it.
export async function refreshBcvRateIfStale(
  fetchedAt: string | null,
): Promise<{ usd: number; eur: number } | null> {
  if (fetchedAt && Date.now() - new Date(fetchedAt).getTime() < MAX_AGE_MS) return null;

  let work: ReturnType<typeof startFetch>;
  try {
    work = startFetch();
  } catch {
    return null;
  }

  // Keeps the fetch alive past the response — on Vercel the function can be
  // frozen the moment it returns, which would drop an in-flight request and
  // leave the rate stale forever under the deadline.
  try {
    after(async () => {
      try {
        await work;
      } catch {
        // Already reported below; swallowed so it can't surface as an
        // unhandled rejection after the response is sent.
      }
    });
  } catch {
    // after() outside a request scope — nothing to keep alive, carry on.
  }

  const settled = await Promise.race([
    work.catch((error) => {
      console.error(
        "[bcv] no pudimos refrescar la tasa:",
        error instanceof Error ? error.message : error,
      );
      return null;
    }),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), DEADLINE_MS)),
  ]);

  // needs_review means the fetch jumped more than the anomaly threshold from
  // the last accepted rate. It's recorded for the audit trail but must never
  // become the number a fiado is stamped with, so fall back to what's stored.
  if (!settled || settled.needs_review) return null;

  return { usd: settled.usd, eur: settled.eur };
}
