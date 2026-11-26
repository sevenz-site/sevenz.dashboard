// THE CAMERA, SET UP FOR SMALL CODES (CT-182, owner's report of 2026-11-25: «está fallando en
// repetidas ocasiones, no escanea (…) la cámara del teléfono no enfoca de cerca cuando el
// código es muy pequeño»).
//
// THE CAUSE WAS THE PICTURE ASKED FOR, 1280x720, our own choice. A phone camera does not focus
// closer than about 15-20 cm, and at that distance a small package's bars were 1.25 pixels wide.
// Measured that day on drawn codes, the reader needs about 1.6. So the shopkeeper moved closer to
// make it bigger, out of focus range: neither distance worked.
//
// THE ANSWER IS ZOOM, NOT A BIGGER PICTURE. 1920x1080 at 2x gives about 3.7 pixels per bar at
// 20 cm, and the phone stays where it can focus. The same detail without zoom needs a 4K picture,
// which a cheap Android would read slowly; that is only asked for where zoom does not exist.
//
// EVERYTHING HERE IS ASKED OF THE DEVICE AT RUNTIME AND MAY BE REFUSED. Nothing throws: a phone
// that supports none of it gets the plain camera, as before.

/** What `getUserMedia` is asked for. `ideal`, so a camera that cannot simply gives less. */
export const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  facingMode: { ideal: "environment" },
  width: { ideal: 1920 },
  height: { ideal: 1080 },
};

// WHAT THE FIRST CALL ASKS FOR, PERMISSIONS INCLUDED (owner's request of 2026-11-25: «debería
// otorgarlos desde el primer intento»). The torch has no permission of its own in any browser:
// the camera's covers it. The ZOOM does in Chrome: without `zoom: true` here the page never gets
// it, even with the camera granted, and a camera granted before without it is asked again
// (web.dev/articles/camera-pan-tilt-zoom). Safari reads it as «zoom 1, if possible».
export const OPEN_CONSTRAINTS = { ...VIDEO_CONSTRAINTS, zoom: true } as MediaTrackConstraints;

const ZOOM_TARGET = 2;

type Range = { min?: number; max?: number };
type CameraCapabilities = {
  zoom?: Range;
  focusMode?: string[];
  torch?: boolean | boolean[];
  width?: Range;
  height?: Range;
};
/** What was asked of the camera, kept so a later call (the torch) repeats it and undoes nothing. */
export type CameraSettings = { focusMode?: string; zoom?: number };

// ANDROID CHROME ANSWERS LATE: focus and zoom are missing from `getCapabilities()` for a
// moment after the camera opens, as if the phone had none. Asked again a few times before
// believing it.
const CAPABILITY_TRIES = 4;
const CAPABILITY_WAIT_MS = 350;

async function readCapabilities(track: MediaStreamTrack, waitMs: number): Promise<CameraCapabilities | null> {
  for (let i = 0; i < CAPABILITY_TRIES; i++) {
    let caps: CameraCapabilities;
    try {
      caps = track.getCapabilities() as CameraCapabilities;
    } catch {
      return null;
    }
    if (caps.zoom || caps.focusMode || i === CAPABILITY_TRIES - 1) return caps;
    await new Promise((r) => setTimeout(r, waitMs));
  }
  return null;
}

/** Whether the open camera has a torch a page may turn on. */
export function hasTorch(torch: CameraCapabilities["torch"]): boolean {
  return Array.isArray(torch) ? torch.includes(true) : torch === true;
}

/** The zoom to ask for, or null when the camera has none. */
export function zoomTarget(zoom: Range | undefined): number | null {
  if (!zoom || typeof zoom.min !== "number" || typeof zoom.max !== "number") return null;
  // Old Chrome on Android counts in hundredths (100 = 1x). From 0.5 with an ultra wide lens, 1
  // is still the main one, so the target is absolute and not a multiple of the minimum.
  const unit = zoom.min >= 50 ? 100 : 1;
  const target = Math.min(ZOOM_TARGET * unit, zoom.max);
  return target > unit ? target : null;
}

/** Asks the open camera for continuous focus and zoom, or for more detail without zoom. */
export async function tuneCamera(
  track: MediaStreamTrack | undefined,
  waitMs = CAPABILITY_WAIT_MS,
): Promise<CameraSettings> {
  const set: CameraSettings = {};
  if (!track?.getCapabilities) return set;
  const caps = await readCapabilities(track, waitMs);
  if (!caps) return set;
  const before = track.getSettings?.().width ?? 0;
  if (caps.focusMode?.includes("continuous")) set.focusMode = "continuous";
  const zoom = zoomTarget(caps.zoom);
  if (zoom !== null) set.zoom = zoom;

  // FOCUS AND ZOOM GO ALONE: older Chromes refuse a call that mixes them with a size.
  if (Object.keys(set).length > 0) {
    const ok = await apply(track, { advanced: [set as MediaTrackConstraintSet] });
    // A browser that resets the size when it is not repeated gets it back.
    if (ok && (track.getSettings?.().width ?? before) < before) {
      await apply(track, { ...VIDEO_CONSTRAINTS, advanced: [set as MediaTrackConstraintSet] });
    }
  }
  if (zoom === null && Math.max(caps.width?.max ?? 0, caps.height?.max ?? 0) > 1920) {
    await apply(track, { ...VIDEO_CONSTRAINTS, width: { ideal: 3840 }, height: { ideal: 2160 } });
  }
  return set;
}

// How long a phone gets to say what the torch is doing, and how many times it is asked.
const TORCH_WAIT_MS = 150;
const TORCH_READS = 3;

/**
 * Turns the torch on or off.
 *
 * WHAT THE PHONE REPORTS RIGHT AFTER MAY BE THE STATE FROM BEFORE. Read in both browsers' source
 * on 2026-11-25: Safari applies the torch in a deferred task, and Chrome on Android refreshes
 * `getSettings().torch` only with each call. The first version read it at once and believed the
 * «no»: on an iPhone that is «este teléfono no permite encender la linterna» over a light that was
 * coming on. So a torch the phone LISTS, asked for without an error, is on.
 *
 * TRIED WHETHER OR NOT IT IS LISTED, because the button is always there (owner's request): then it
 * has to report itself lit, with time, or the button would say «on» over a dark shelf. Each try
 * goes first with the focus and zoom already in use, because a call replaces the one before, and
 * then alone, because a browser that cannot take one of them drops the whole set without an error.
 *
 * - `"failed"`: it did not light.
 * - `"stuck"`: asked twice to turn off and still on. A known fault of some Samsungs (Chromium issue
 *   40789586, the Galaxy A9) whose only cure is closing the camera. The caller reopens it. Twice,
 *   because the first answer may be the stale one above and the second call is what refreshes it.
 */
export async function setTorch(
  track: MediaStreamTrack,
  on: boolean,
  settings: CameraSettings,
  waitMs = TORCH_WAIT_MS,
): Promise<"ok" | "failed" | "stuck"> {
  const reported = () => (track.getSettings?.() as { torch?: boolean } | undefined)?.torch;
  for (const base of [settings, {}]) {
    if (!(await apply(track, { advanced: [{ ...base, torch: on } as MediaTrackConstraintSet] }))) continue;
    if (on && torchListed(track)) return "ok";
    for (let i = 0; i < TORCH_READS; i++) {
      if (reported() === on || (!on && reported() === undefined)) return "ok";
      await new Promise((done) => setTimeout(done, waitMs));
    }
  }
  return on ? "failed" : "stuck";
}

/** Whether the open camera lists a torch, giving a late phone time to say so. */
export async function listsTorch(track: MediaStreamTrack, waitMs = CAPABILITY_WAIT_MS): Promise<boolean> {
  for (let i = 0; i < CAPABILITY_TRIES; i++) {
    if (torchListed(track)) return true;
    await new Promise((done) => setTimeout(done, waitMs));
  }
  return false;
}

/**
 * The other back cameras, in the order worth trying for a torch. A phone with several may open one
 * with no flash beside it, and the flash belongs to one of the others. Labels exist once the
 * camera has been granted, in the phone's language.
 */
export function otherBackCameras(
  devices: readonly { kind: string; deviceId: string; label: string }[],
  current: string | undefined,
): string[] {
  return devices
    .filter((d) => d.kind === "videoinput" && d.deviceId && d.deviceId !== current)
    .filter((d) => /back|rear|environment|trasera|posterior|traseira/i.test(d.label))
    .map((d) => d.deviceId)
    .slice(0, 4);
}

function torchListed(track: MediaStreamTrack): boolean {
  try {
    return hasTorch((track.getCapabilities?.() as CameraCapabilities | undefined)?.torch);
  } catch {
    return false;
  }
}

async function apply(track: MediaStreamTrack, constraints: MediaTrackConstraints): Promise<boolean> {
  try {
    await track.applyConstraints(constraints);
    return true;
  } catch {
    return false;
  }
}

export type Rect = { x: number; y: number; width: number; height: number };

/**
 * The part of the picture around the viewfinder, in the picture's own pixels. The video is drawn
 * `object-cover`, so what the shopkeeper sees is a centred cut of it: 90% of that width, and as
 * tall as 60% of it, which holds the viewfinder of both viewers.
 */
export function viewfinderRect(videoW: number, videoH: number, boxW: number, boxH: number): Rect {
  const scale = Math.max(boxW / videoW, boxH / videoH) || 1;
  const visibleW = Math.min(videoW, boxW / scale);
  const visibleH = Math.min(videoH, boxH / scale);
  const width = Math.round(visibleW * 0.9);
  const height = Math.round(Math.min(visibleH, visibleW * 0.6));
  return { x: Math.round((videoW - width) / 2), y: Math.round((videoH - height) / 2), width, height };
}

/**
 * How much to enlarge that part before reading it. Measured: at 1.4 pixels per bar the reader
 * gets 113 of 150 as is and 147 of 150 enlarged twice. Never past 1,900 pixels wide, which is
 * where reading one picture starts to cost a cheap phone real time.
 */
export function enlargement(width: number): number {
  return Math.min(2, Math.max(1, 1900 / Math.max(1, width)));
}
