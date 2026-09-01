"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Check, RotateCcw } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.85;

// A real camera view via getUserMedia, not the <input capture> trick — that
// attribute only ever launches an actual camera on mobile; desktop browsers
// ignore it outright and fall back to the plain file picker, which isn't
// "opens the camera" at all. This works identically on both.
export function CameraCaptureDialog({
  open,
  onOpenChange,
  onCapture,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCapture: (blob: Blob) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);

  function stopStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  // Deliberately no synchronous setState here — every state update happens
  // inside the promise callbacks below, in response to the camera actually
  // granting or refusing access, not as a direct effect of calling this
  // function (see the useEffect below, which calls this directly).
  function startStream() {
    // Front camera by default — this is a profile picture (a selfie), not
    // the libreta-import flow's rear-camera document capture.
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user" } })
      .then((stream) => {
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setError(null);
      })
      .catch(() => setError("No pudimos acceder a la cámara. Revisa los permisos del navegador."));
  }

  useEffect(() => {
    if (!open) return;
    startStream();
    return () => stopStream();
  }, [open]);

  // Resetting local state belongs here, not in the effect above — this
  // only ever runs from a real user action (closing the dialog), not as a
  // synchronous side effect of rendering.
  function handleOpenChange(next: boolean) {
    if (!next) {
      stopStream();
      setCapturedUrl(null);
      setCapturedBlob(null);
      setError(null);
    }
    onOpenChange(next);
  }

  function handleShutter() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const scale = Math.min(1, MAX_DIMENSION / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        setCapturedBlob(blob);
        setCapturedUrl(URL.createObjectURL(blob));
        stopStream();
      },
      "image/jpeg",
      JPEG_QUALITY,
    );
  }

  function handleRetake() {
    setCapturedUrl(null);
    setCapturedBlob(null);
    startStream();
  }

  function handleUse() {
    if (!capturedBlob) return;
    onCapture(capturedBlob);
    handleOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Tomar foto</DialogTitle>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : capturedUrl ? (
          <div className="flex flex-col gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={capturedUrl} alt="Foto capturada" className="w-full rounded-lg" />
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={handleRetake}>
                <RotateCcw className="size-4" />
                Tomar de nuevo
              </Button>
              <Button type="button" className="flex-1" onClick={handleUse}>
                <Check className="size-4" />
                Usar foto
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <video ref={videoRef} autoPlay playsInline muted className="w-full rounded-lg bg-black" />
            <Button type="button" onClick={handleShutter}>
              <Camera className="size-4" />
              Capturar
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
