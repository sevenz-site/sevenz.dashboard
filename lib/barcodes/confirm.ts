// WHEN A CODE THE CAMERA READ COUNTS (CT-182).
//
// TWO EQUAL READS, since 2026-11-25. Measured that day with the app's own reader on drawn
// EAN-13 codes: at two pixels per bar, 5 of 150 pictures came back as ANOTHER valid EAN-13,
// check digit included (7591058001109 read as 0561850001109). One read was enough until then,
// so a small code could open «código nuevo» with a number printed on no package, or add the
// wrong product to a sale, and nothing on screen would look wrong. A second read of the same
// code in another picture costs about a tenth of a second.
//
// A CODE ALREADY COUNTED counts again only after leaving the picture for `pauseMs` (approved
// worst case 3): the clock restarts on every sighting.

/** A second read of the same code has to arrive within this time of the first. */
export const CONFIRM_WITHIN_MS = 1200;

export function createConfirmer(pauseMs: number) {
  let candidate: { code: string; at: number } | null = null;
  const counted = new Map<string, number>();

  /** Whether this read makes `code` count, now. */
  return (code: string, now: number): boolean => {
    const seen = counted.get(code);
    if (seen !== undefined && now - seen <= pauseMs) {
      counted.set(code, now);
      candidate = null;
      return false;
    }
    if (candidate?.code === code && now - candidate.at <= CONFIRM_WITHIN_MS) {
      candidate = null;
      counted.set(code, now);
      return true;
    }
    candidate = { code, at: now };
    return false;
  };
}
