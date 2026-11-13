"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { getPublicProductPhotoUrl } from "@/lib/supabase/storage";
import { fileToResizedBlob } from "@/lib/image";
import { MAX_PRODUCT_PHOTOS } from "@/lib/products/photos";

// UP TO FIVE PRODUCT PHOTOS, THE FIRST ONE IS THE COVER. CT-171, frames `2119:21556` and
// `2119:21629`, approved by the owner on 2026-11-12 («Sí, la primera foto es la portada»).
//
// `value[0]` is saved to `products.photo_path` -- the cover every other screen already
// shows -- and the rest to `product_photos` (migration 204). Removing the cover promotes
// the next photo, so a product with photos never ends up with an empty cover.
//
// NO REORDERING. The frame does not draw it; to change the cover the shopkeeper removes
// the first photo. Said here so it reads as a decision and not as something forgotten.
//
// UPLOADS GO TO THE OWNER'S OWN FOLDER, one by one, exactly as the single-photo input did
// (`product-photo-input.tsx`): the storage policy checks the folder, and the server
// checks it again with `ownPhotoPath` before writing any path.
export function ProductPhotosInput({
  ownerId,
  value,
  onChange,
  disabled,
}: {
  ownerId: string;
  value: string[];
  onChange: (paths: string[]) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const lleno = value.length >= MAX_PRODUCT_PHOTOS;

  async function handleFiles(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    const caben = MAX_PRODUCT_PHOTOS - value.length;
    // MORE FILES THAN ROOM: the first ones that fit go up, and the shopkeeper is told.
    // Silently dropping the rest would leave them wondering where their photos went.
    if (files.length > caben) {
      toast.message(
        caben === 1
          ? "Solo cabía 1 foto más. Subimos la primera."
          : `Solo cabían ${caben} fotos más. Subimos las primeras ${caben}.`,
      );
    }
    setUploading(true);
    const subidas: string[] = [];
    try {
      const supabase = createClient();
      for (const file of files.slice(0, caben)) {
        const blob = await fileToResizedBlob(file);
        const path = `${ownerId}/${crypto.randomUUID()}.jpg`;
        const { error } = await supabase.storage.from("product-photos").upload(path, blob, {
          contentType: "image/jpeg",
        });
        if (error) throw error;
        subidas.push(path);
      }
    } catch (error) {
      console.error("[ProductPhotosInput] upload:", error);
      toast.error("No pudimos subir una de las fotos. Intenta de nuevo.");
    } finally {
      // What did go up is kept even if a later file failed.
      if (subidas.length) onChange([...value, ...subidas].slice(0, MAX_PRODUCT_PHOTOS));
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">Fotos (opcional)</span>
        <span className="text-xs text-muted-foreground">
          {value.length}/{MAX_PRODUCT_PHOTOS}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {value.map((path, i) => (
          <div key={path} className="relative size-16 shrink-0">
            {/* `unoptimized`: a Supabase public URL of a photo already resized on the
                device, same as the single-photo input. */}
            <Image
              src={getPublicProductPhotoUrl(path)}
              alt={i === 0 ? "Portada del producto" : `Foto ${i + 1} del producto`}
              width={64}
              height={64}
              unoptimized
              className="size-16 rounded-lg border object-cover"
            />
            {i === 0 ? (
              <span className="absolute bottom-1 left-1 rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
                Portada
              </span>
            ) : null}
            <button
              type="button"
              aria-label={i === 0 ? "Quitar la portada" : `Quitar la foto ${i + 1}`}
              disabled={disabled || uploading}
              onClick={() => onChange(value.filter((p) => p !== path))}
              className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-50"
            >
              <X className="size-3" />
            </button>
          </div>
        ))}

        {lleno ? null : (
          <button
            type="button"
            disabled={disabled || uploading}
            onClick={() => inputRef.current?.click()}
            className="flex size-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed text-muted-foreground disabled:opacity-50"
          >
            {uploading ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <>
                <Plus className="size-5" />
                <span className="text-[10px]">Agregar</span>
              </>
            )}
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        onChange={(e) => handleFiles(e.target.files)}
      />

      <p className="text-xs text-muted-foreground">
        {lleno
          ? `Llegaste al máximo de ${MAX_PRODUCT_PHOTOS} fotos. Quita una para agregar otra.`
          : `La primera es la portada de tu catálogo. Puedes subir hasta ${MAX_PRODUCT_PHOTOS}.`}
      </p>
    </div>
  );
}
