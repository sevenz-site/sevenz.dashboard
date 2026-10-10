"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { Camera, ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { getPublicProductPhotoUrl } from "@/lib/supabase/storage";
import { fileToResizedBlob } from "@/lib/image";
import { useIsMobile } from "@/hooks/use-mobile";

// THE PRODUCT'S PHOTO.
//
// The frame annotates it «Mismo al que ya existe en 'Agregar movimiento'», and
// the gesture is the same: pick a file, or take one on a phone, resized by
// `fileToResizedBlob` before it leaves the device. What is NOT the same is what
// happens after.
//
// ─────────────────────────────────────────────────────────────────────────
// IT SHOWS THE PHOTO, WHERE `AttachmentUploader` SHOWS A FILENAME
//
// An attachment is evidence: once it is attached, its content does not matter
// again until somebody goes looking for it, so a paperclip and a name are
// enough. A product photo IS the product on the catalogue card a customer
// sees — so the only honest confirmation that it uploaded is the picture
// itself. A filename cannot tell you that you photographed your thumb.
//
// ─────────────────────────────────────────────────────────────────────────
// AND IT GOES TO A PUBLIC BUCKET, WHICH IS SAID OUT LOUD
//
// `product-photos` is public (migration 084), like `logos` and unlike
// `attachments`. A path is unguessable, but whoever has the URL keeps it — so
// unpublishing a product takes the photo out of the catalogue, not off the
// internet. The line under the control says so, because the person choosing
// the photo is the only one who can decide that is fine.
export function ProductPhotoInput({
  ownerId,
  value,
  onChange,
  disabled,
}: {
  ownerId: string;
  value: string | null;
  onChange: (path: string | null) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const blob = await fileToResizedBlob(file);
      // The owner's own folder, which is what the storage policy checks and
      // what `ownPhotoPath` on the server re-checks before writing the column.
      const path = `${ownerId}/${crypto.randomUUID()}.jpg`;
      const supabase = createClient();
      const { error } = await supabase.storage.from("product-photos").upload(path, blob, {
        contentType: "image/jpeg",
      });
      if (error) throw error;
      onChange(path);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No pudimos subir la foto.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
      if (cameraInputRef.current) cameraInputRef.current.value = "";
    }
  }

  if (value) {
    return (
      <div className="flex items-center gap-3">
        {/* `unoptimized` because the source is a Supabase public URL, the same
            call `/s/[token]` makes for a logo. Next's optimizer would need the
            host in `images.remotePatterns`, and a product photo is already
            resized on the device before it is uploaded. */}
        <Image
          src={getPublicProductPhotoUrl(value)}
          alt="Foto del producto"
          width={64}
          height={64}
          unoptimized
          className="size-16 shrink-0 rounded-lg border object-cover"
        />
        <Button
          type="button"
          variant="outline"
          disabled={disabled || uploading}
          onClick={() => onChange(null)}
        >
          <X className="size-4" /> Quitar foto
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
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
        className="w-full justify-start text-muted-foreground"
        disabled={disabled || uploading}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? (
          <>
            <Loader2 className="size-4 animate-spin" /> Subiendo...
          </>
        ) : (
          <>
            <ImagePlus className="size-4" /> Adjuntar foto
          </>
        )}
      </Button>

      {isMobile ? (
        <>
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
          <Button
            type="button"
            variant="outline"
            className="w-full justify-start text-muted-foreground"
            disabled={disabled || uploading}
            onClick={() => cameraInputRef.current?.click()}
          >
            {uploading ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Subiendo...
              </>
            ) : (
              <>
                <Camera className="size-4" /> Tomar foto
              </>
            )}
          </Button>
        </>
      ) : null}

      <p className="text-xs leading-relaxed text-muted-foreground">
        Si publicas el producto, esta foto la ve cualquiera que abra el enlace de tu catálogo.
      </p>
    </div>
  );
}
