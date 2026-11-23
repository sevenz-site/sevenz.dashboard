// TELLING A BARCODE GUN FROM A PERSON TYPING (CT-182).
//
// A USB or Bluetooth gun is a keyboard: it types the code a few milliseconds per key and
// usually ends with Enter (some send Tab, some nothing). A person, even a fast one, leaves
// 50 ms or more between keys. So a run of keys closer than `GAP_MS` is a scan.
//
// WHY THIS EXISTS EVEN WITH THE SWITCH OFF (owner's decision of 2026-11-23). The worst case
// of a gun in Sevenz is not a missed scan, it is a scan into the wrong field: the cursor
// in the amount of a payment, and «Bs. 7.591.234.567.890» saved -- or the gun's Enter
// submitting a sale half done. Nothing errors. So every burst is taken out of whatever
// field it was heading to, and its Enter never reaches a form.
//
// THE FIRST KEYS CANNOT BE STOPPED: a burst is only recognisable from its second key. So
// the field's value is remembered when a run starts, and put back when the run turns out
// to be a scan. A person's typing never forms a run of `MIN_LENGTH` keys under `GAP_MS`
// apart, so it is never touched.

// 50 and not 35, measured on 2026-11-23: with 35 a burst whose keys arrived a little late
// split in two, and the second half (12 digits) read as an invalid code. A USB gun sends a
// key every 1-10 ms; some Bluetooth ones approach 40. A person never types three keys in a
// row under 50 ms apart.
export const GAP_MS = 50;
export const MIN_LENGTH = 6;
/** A run with no Enter or Tab ends this long after its last key. */
export const IDLE_MS = 80;

export type BurstState = {
  chars: string;
  last: number;
  // The field the run started in, and its value before the first key landed.
  target: HTMLInputElement | HTMLTextAreaElement | null;
  before: string;
};

export function emptyBurst(): BurstState {
  return { chars: "", last: -Infinity, target: null, before: "" };
}

/** Whether the run collected so far already reads as a gun, not a hand. */
export function isScanSoFar(state: BurstState): boolean {
  return state.chars.length >= 3;
}

/** Whether a finished run is a whole code. */
export function isCompleteScan(state: BurstState): boolean {
  return state.chars.length >= MIN_LENGTH;
}
