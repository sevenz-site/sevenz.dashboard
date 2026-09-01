"use client";

import { useRef, useState } from "react";
import { UserRound, Loader2, Upload, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { fileToResizedBlob } from "@/lib/image";
import { uploadProfilePicture } from "@/app/s/[token]/actions";
import { getPublicClientProfilePictureUrl } from "@/lib/supabase/storage";
import { CameraCaptureDialog } from "@/components/public/camera-capture-dialog";

// Client-only edit on this page: unlike the document ID (one-time,
// server-validated), a profile picture can be replaced anytime — every
// successful upload overwrites the previous one, both on screen and in
// Storage (the old file is removed server-side once the new one is saved).
export function ClientProfilePictureUploader({
  token,
  initialPath,
}: {
  token: string;
  initialPath: string | null;
}) {
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(
    initialPath ? getPublicClientProfilePictureUrl(initialPath) : null,
  );

  async function uploadBlob(blob: Blob) {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.set("file", blob, "profile.jpg");
      const result = await uploadProfilePicture(token, formData);
      if (result.error) throw new Error(result.error);
      setPreviewUrl(URL.createObjectURL(blob));
      toast.success("Foto actualizada");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No pudimos subir tu foto.");
    } finally {
      setUploading(false);
    }
  }

  async function handleGalleryFile(file: File | undefined) {
    if (!file) return;
    const blob = await fileToResizedBlob(file);
    await uploadBlob(blob);
    if (galleryInputRef.current) galleryInputRef.current.value = "";
  }

  return (
    <div className="flex items-center gap-3">
      <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-muted">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="Tu foto de perfil" className="h-full w-full object-cover" />
        ) : (
          <UserRound className="size-6 text-muted-foreground" />
        )}
      </div>
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => handleGalleryFile(e.target.files?.[0])}
      />

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={uploading}
          onClick={() => setPickerOpen(true)}
        >
          {uploading ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Subiendo...
            </>
          ) : previewUrl ? (
            "Cambiar foto"
          ) : (
            "Subir foto"
          )}
        </Button>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>Foto de perfil</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setPickerOpen(false);
                galleryInputRef.current?.click();
              }}
            >
              <Upload className="size-4" />
              Subir foto
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setPickerOpen(false);
                setCameraOpen(true);
              }}
            >
              <Camera className="size-4" />
              Tomar foto
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <CameraCaptureDialog open={cameraOpen} onOpenChange={setCameraOpen} onCapture={uploadBlob} />
    </div>
  );
}
