// THE SHAPE OF A TRANSACTION CODE, AND WHAT A SEARCH BOX MAY ASK FOR.
//
// A code is four letters and three digits, `ABCD123` (migration 150). The
// alphabet leaves out I and O, which next to 1 and 0 are the two characters a
// code loses when it is read out loud or retyped from a screenshot.
//
// This lives in `lib/` because two places have to agree on it: the Inicio
// search box decides WHETHER to ask the server (so a client name never fires a
// request), and the server action re-checks the same thing before touching the
// database. Two copies of one rule are how a search box and its endpoint end up
// disagreeing about what a code looks like.

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

/**
 * What the owner typed, as a prefix of a code -- or null when it cannot be the
 * start of one.
 *
 * FOUR LETTERS BEFORE IT SEARCHES, which is the point of the function. A client
 * called «Mari» is a legitimate thing to type and must not trigger a lookup
 * that matches a transaction by chance; four letters is also what any code
 * starts with, so nothing real is lost by waiting for the fourth. With fewer,
 * a random 3-letter name prefix would match a code about once in every 14,000
 * transactions -- noise on a screen whose whole job is to be quiet.
 *
 * «Pedro» (five letters) is rejected here too: a code has digits from its fifth
 * character, so no code starts with it.
 *
 * NO O-FOR-ZERO FORGIVENESS, which an earlier draft had and the suite caught: in
 * the digit positions an O could only be a mistyped 0, so it was read as one --
 * and that made «Pedro» into `PEDR0`, a perfectly valid prefix. Every name
 * ending in o or i would then ask the server for a transaction. The alphabet
 * already leaves O and I out precisely so nobody has to guess; the copy button
 * on the detail screen is how the code travels, and a mistyped one simply finds
 * nothing.
 *
 * SPACES AND DASHES ARE IGNORED («abcd-123», «ABCD 123»), because the code is
 * shown and read in groups.
 */
export function normalizePartialCode(text: string): string | null {
  const clean = text.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (clean.length < 4 || clean.length > 7) return null;

  const letters = clean.slice(0, 4);
  const digits = clean.slice(4);

  for (const ch of letters) if (!LETTERS.includes(ch)) return null;
  if (!/^[0-9]*$/.test(digits)) return null;

  return letters + digits;
}
