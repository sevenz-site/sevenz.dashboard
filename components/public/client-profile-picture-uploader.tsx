"use client";

import { useRef, useState } from "react";
import { UserRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { fileToResizedBlob } from "@/lib/image";
import { uploadProfilePicture } from "@/app/s/[token]/actions";
import { getPublicClientProfilePictureUrl } from "@/lib/supabase/storage";

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
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(
    initialPath ? getPublicClientProfilePictureUrl(initialPath) : null,
  );

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const blob = await fileToResizedBlob(file);
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
      if (inputRef.current) inputRef.current.value = "";
    }
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
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
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
    </div>
  );
}
