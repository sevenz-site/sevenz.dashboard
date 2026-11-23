"use client";

import { useEffect, useRef } from "react";
import { loadDetector } from "@/lib/barcodes/camera";
import { normalizeBarcode } from "@/lib/barcodes/normalize";

export type CameraStatus = "starting" | "scanning" | "denied" | "unavailable" | "failed";

// HOW LONG A CODE STAYS «ALREADY COUNTED» (CT-182, approved worst case 3). A code held in
// front of the camera is read several times a second; without this, one can of Maltín
// would add five to a fiado. The clock restarts on every sighting, so a code counts once
// for as long as it stays in view, and again only after leaving it for this long.
export const SAME_CODE_PAUSE_MS = 1500;
const READS_EVERY_MS = 150;

// THE CAMERA AND THE READER, nothing drawn on top: the full-screen viewer and the strip
// inside a sale put their own frame around it.
//
// THE CAMERA GOES OFF WHEN THIS UNMOUNTS AND WHEN THE TAB IS HIDDEN (approved worst case:
// a camera left on drains the battery and keeps the iPhone's green light lit -- «la app me
// está grabando»). It comes back when the tab is visible again.
export function CameraFeed({
  onCode,
  onStatus,
  className,
}: {
  onCode: (code: string) => void;
  onStatus?: (status: CameraStatus) => void;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onCodeRef = useRef(onCode);
  const onStatusRef = useRef(onStatus);
  useEffect(() => {
    onCodeRef.current = onCode;
    onStatusRef.current = onStatus;
  });

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let cancelled = false;
    const lastSeen = new Map<string, number>();

    const stop = () => {
      window.clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
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
            video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
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
        let busy = false;
        timer = window.setInterval(async () => {
          if (busy || !video.videoWidth) return;
          busy = true;
          try {
            const found = await detector.detect(video);
            const code = normalizeBarcode(found[0]?.rawValue);
            if (code) {
              const now = Date.now();
              const seen = lastSeen.get(code);
              lastSeen.set(code, now);
              if (seen === undefined || now - seen > SAME_CODE_PAUSE_MS) onCodeRef.current(code);
            }
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
