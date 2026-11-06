// READING A WHOLE RESULT, NOT THE FIRST THOUSAND ROWS (PL-34, PL-35).
//
// The Data API returns at most «Max rows» per request, 1,000 here, and says nothing when it
// cuts: no error, no flag, a plausible short list. On 2026-11-05 that made `qa:saldos` report
// 263 wrong balances that were right, and on 2026-11-06 a production count found a business
// with 1,228 movements whose list scores were computed from a part of them.
//
// THE CALLER ORDERS BY A UNIQUE COLUMN. Paging without a stable order repeats and skips rows,
// which is the same false number by another road.
//
// THE CALLER ASKS FOR `{ count: "exact" }`, and it is what saves a trip: with the total known
// the loop stops at the last row instead of asking for an empty page. Without it the loop
// goes until a page comes back empty. It NEVER stops on a short page: if «Max rows» is ever
// lowered, every page is short and that test would cut again in silence.
//
// IT THROWS, IT DOES NOT RETURN WHAT IT HAS. Half a result is the failure this file exists to
// prevent. What to do with the error is the caller's decision.

export const PAGE_ROWS = 1000;

// A `.in()` travels in the URL: 100 uuids are ~3.7 KB. Hundreds in one request risk a URL the
// gateway refuses, and that failure takes the whole read with it.
export const IDS_PER_BATCH = 100;

type Page<T> = PromiseLike<{
  data: T[] | null;
  error: { message: string } | null;
  count?: number | null;
}>;

export async function readAllPages<T>(page: (from: number, to: number) => Page<T>): Promise<T[]> {
  const rows: T[] = [];
  for (;;) {
    const { data, error, count } = await page(rows.length, rows.length + PAGE_ROWS - 1);
    if (error) throw new Error(`lectura por páginas: ${error.message}`);
    const got = data ?? [];
    rows.push(...got);
    if (got.length === 0) return rows;
    if (typeof count === "number" && rows.length >= count) return rows;
  }
}

/** The same, for a filter on many ids: batches in parallel, each one read to its end. */
export async function readAllByIds<T>(
  ids: string[],
  page: (batch: string[], from: number, to: number) => Page<T>,
): Promise<T[]> {
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += IDS_PER_BATCH) batches.push(ids.slice(i, i + IDS_PER_BATCH));
  const results = await Promise.all(batches.map((batch) => readAllPages<T>((from, to) => page(batch, from, to))));
  return results.flat();
}
