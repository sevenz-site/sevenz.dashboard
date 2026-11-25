"use client";

import { useEffect, useRef } from "react";
import { loadDetector, type DetectedCode } from "@/lib/barcodes/camera";
import { toast } from "sonner";
import { enlargement, setTorch, tuneCamera, VIDEO_CONSTRAINTS, viewfinderRect } from "@/lib/barcodes/camera-tuning";
import { createConfirmer } from "@/lib/barcodes/confirm";
import { normalizeBarcode } from "@/lib/barcodes/normalize";

/** The torch, for whoever draws its button. Null: no camera is open. */
export type Torch = { on: boolean; toggle: () => void };

export type CameraStatus = "starting" | "scanning" | "denied" | "unavailable" | "failed";

// HOW LONG A CODE STAYS «ALREADY COUNTED» (CT-182, approved worst case 3). A code held in
// front of the camera is read several times a second; without this, one can of Maltín
// would add five to a fiado. The clock restarts on every sighting, so a code counts once
// for as long as it stays in view, and again only after leaving it for this long.
export const SAME_CODE_PAUSE_MS = 1500;
// 100, from 150: a code needs two equal reads now (`createConfirmer`). A read still running when
// its turn comes is never overlapped, so a slow phone reads less often and not more at once.
const READS_EVERY_MS = 100;
// The whole picture is read no bigger than this; the part that matters goes at full detail.
const FULL_PASS_MAX = 1920;

/** The code nearest the centre: on a shelf the picture holds several, and the aimed one is that. */
function nearestToCentre(found: DetectedCode[], width: number, height: number): DetectedCode | undefined {
  const distance = (d: DetectedCode) =>
    d.boundingBox
      ? Math.hypot(d.boundingBox.x + d.boundingBox.width / 2 - width / 2, d.boundingBox.y + d.boundingBox.height / 2 - height / 2)
      : 0;
  return [...found].sort((a, b) => distance(a) - distance(b))[0];
}

// THE CAMERA AND THE READER, nothing drawn on top: the full-screen viewer and the strip
// inside a sale put their own frame around it.
//
// THE CAMERA GOES OFF WHEN THIS UNMOUNTS AND WHEN THE TAB IS HIDDEN (approved worst case:
// a camera left on drains the battery and keeps the iPhone's green light lit -- «la app me
// está grabando»). It comes back when the tab is visible again.
export function CameraFeed({
  onCode,
  onStatus,
  onTorch,
  className,
}: {
  onCode: (code: string) => void;
  onStatus?: (status: CameraStatus) => void;
  onTorch?: (torch: Torch | null) => void;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onCodeRef = useRef(onCode);
  const onStatusRef = useRef(onStatus);
  const onTorchRef = useRef(onTorch);
  useEffect(() => {
    onCodeRef.current = onCode;
    onStatusRef.current = onStatus;
    onTorchRef.current = onTorch;
  });

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let cancelled = false;
    const counts = createConfirmer(SAME_CODE_PAUSE_MS);
    const canvas = document.createElement("canvas");

    const stop = () => {
      window.clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      // Closing the camera turns its torch off, so the button goes back to off with it.
      onTorchRef.current?.(null);
    };

    const start = async () => {
      onStatusRef.current?.("starting");
      if (!navigator.mediaDevices?.getUserMedia) {
        onStatusRef.current?.("unavailable");
        return;
      }
      try {
        const [s, detector] = await Promise.all([
          navigator.mediaDevices.getUserMedia({
            video: VIDEO_CONSTRAINTS,
            audio: false,
          }),
          loadDetector(),
        ]);
        if (cancelled || document.hidden) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = s;
        await video.play().catch(() => undefined);
        onStatusRef.current?.("scanning");
        // Not awaited: focus and zoom settle while the first pictures are already being read.
        const track = s.getVideoTracks()[0];
        const tuned = tuneCamera(track);
        // THE TORCH'S BUTTON IS ON EVERY VIEWER (owner's request of 2026-11-25: «debe estar en
        // todos los flujos del escaner»). Until then it waited for the phone to say it had one,
        // and a phone that says so late or never had no button anywhere. Now it is tried when
        // touched, and a phone that refuses answers with a sentence.
        let changing = false;
        const report = (on: boolean) => onTorchRef.current?.({ on, toggle: () => void toggle(!on) });
        const toggle = async (on: boolean) => {
          if (changing || stream !== s) return;
          changing = true;
          const result = await setTorch(track, on, await tuned);
          changing = false;
          if (cancelled || stream !== s) return;
          if (result === "ok") report(on);
          else if (result === "failed") toast.error("Este teléfono no permite encender la linterna desde Sevenz.");
          else {
            // It would not turn off: closing the camera is the only thing that does it.
            stop();
            void start();
          }
        };
        report(false);
        let busy = false;
        let turn = 0;

        // TWO READS OF THE PICTURE, TAKING TURNS. The part around the viewfinder at full detail,
        // enlarged, is where a small code gets read; the whole picture is what keeps a code
        // outside the frame readable, as it always was («a target, not a crop»).
        const drawn = (): CanvasImageSource & { width: number; height: number } => {
          const { videoWidth: vw, videoHeight: vh } = video;
          const full = turn++ % 2 === 1;
          const r = full
            ? { x: 0, y: 0, width: vw, height: vh }
            : viewfinderRect(vw, vh, video.clientWidth || vw, video.clientHeight || vh);
          const k = full ? Math.min(1, FULL_PASS_MAX / Math.max(vw, vh)) : enlargement(r.width);
          canvas.width = Math.round(r.width * k);
          canvas.height = Math.round(r.height * k);
          canvas.getContext("2d", { willReadFrequently: true })?.drawImage(video, r.x, r.y, r.width, r.height, 0, 0, canvas.width, canvas.height);
          return canvas;
        };
        timer = window.setInterval(async () => {
          if (busy || !video.videoWidth) return;
          busy = true;
          try {
            const picture = drawn();
            const found = await detector.detect(picture);
            const code = normalizeBarcode(nearestToCentre(found, picture.width, picture.height)?.rawValue);
            // `cancelled`: a read that finishes after the viewer closed must not act.
            if (code && !cancelled && counts(code, Date.now())) onCodeRef.current(code);
          } catch {
            // A frame the reader could not process; the next one will.
          } finally {
            busy = false;
          }
        }, READS_EVERY_MS);
      } catch (e) {
        const name = e instanceof DOMException ? e.name : "";
        console.error("[CameraFeed]", name || e);
        onStatusRef.current?.(
          name === "NotAllowedError" || name === "SecurityError"
            ? "denied"
            : name === "NotFoundError" || name === "OverconstrainedError"
              ? "unavailable"
              : "failed",
        );
      }
    };

    const onVisibility = () => {
      if (document.hidden) stop();
      else if (!stream && !cancelled) void start();
    };

    void start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <video ref={videoRef} playsInline muted autoPlay className={className} />;
}

// A SHORT TONE ON EVERY READ, so the shopkeeper knows without looking. Phones that allow
// it also vibrate (Android; iPhone has no vibration API on the web). Never throws.
let audio: AudioContext | null = null;
export function scanFeedback() {
  try {
    navigator.vibrate?.(60);
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio ??= new Ctx();
    void audio.resume();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = 1760;
    gain.gain.value = 0.08;
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + 0.08);
  } catch {
    // Sound is a courtesy.
  }
}
