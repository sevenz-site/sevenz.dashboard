"use client";

import { useRef, useState } from "react";
import { Camera, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";
import { createClient } from "@/lib/supabase/client";
import { ProductThumbnail } from "@/components/product-thumbnail";
import { MAX_PRODUCT_PHOTOS } from "@/lib/products/photos";
import { uploadProductPhoto } from "@/lib/products/upload-photo";

// UP TO TWO PRODUCT PHOTOS, THE FIRST ONE IS THE COVER. Two since 2026-11-15, owner's
// request («limitemos la carga de fotos a los productos solo a 2»); it was five from
// CT-171, frames `2119:21556` and `2119:21629`, approved by the owner on 2026-11-12
// («Sí, la primera foto es la portada»). NO FRAME DRAWS THE TWO-PHOTO VERSION: the layout
// is the same one with fewer tiles, and the sentence for a product over the cap is new.
//
// `value[0]` is saved to `products.photo_path` -- the cover every other screen already
// shows -- and the rest to `product_photos` (migration 204). Removing the cover promotes
// the next photo, so a product with photos never ends up with an empty cover.
//
// A PRODUCT FROM BEFORE THE CAP KEEPS ITS PHOTOS. `value` may arrive with three, four or
// five: they are all drawn, all removable, and nothing is cut on the way in or out. Only
// «Agregar» and «Foto» wait until the product is under the cap. See
// `LEGACY_MAX_PRODUCT_PHOTOS` in `lib/products/photos.ts` for why nothing is trimmed.
//
// NO REORDERING. The frame does not draw it; to change the cover the shopkeeper removes
// the first photo. Said here so it reads as a decision and not as something forgotten.
//
// UPLOADS GO TO THE OWNER'S OWN FOLDER, one by one, exactly as the single-photo input did
// (`product-photo-input.tsx`): the storage policy checks the folder, and the server
// checks it again with `ownPhotoPath` before writing any path.
// «Agregar» and «Foto» are the same tile: one class list, so they cannot drift apart.
const TILE =
  "flex size-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed text-muted-foreground disabled:opacity-50";

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
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();
  const [uploading, setUploading] = useState(false);
  const lleno = value.length >= MAX_PRODUCT_PHOTOS;
  // More photos than the cap allows today: a product saved while the cap was five.
  const sobreElTope = value.length > MAX_PRODUCT_PHOTOS;

  async function handleFiles(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    const caben = MAX_PRODUCT_PHOTOS - value.length;
    // NO ROOM, NOTHING GOES UP. The tiles are hidden when full, but the gallery input
    // stays mounted; and over the cap `caben` is negative, where `slice(0, caben)` would
    // not mean "none" but "all except the last ones".
    if (caben <= 0) return;
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
        // The photo and its 400px thumbnail; see `uploadProductPhoto` for why a
        // thumbnail that fails does not fail the photo.
        subidas.push(await uploadProductPhoto(supabase, ownerId, file));
      }
    } catch (error) {
      console.error("[ProductPhotosInput] upload:", error);
      toast.error("No pudimos subir una de las fotos. Intenta de nuevo.");
    } finally {
      // What did go up is kept even if a later file failed. No slice: at most `caben`
      // files went up, so the list cannot pass the cap from here.
      if (subidas.length) onChange([...value, ...subidas]);
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
      if (cameraInputRef.current) cameraInputRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">Fotos (opcional)</span>
        {/* «4/2» would read as a mistake, so a product over the cap shows its count alone. */}
        <span className="text-xs text-muted-foreground">
          {sobreElTope ? `${value.length} fotos` : `${value.length}/${MAX_PRODUCT_PHOTOS}`}
        </span>
      </div>

      {/* 4px AND NOT 6px BETWEEN THUMBNAILS: five 64px photos plus four 6px gaps are 344px,
          one more than the 343px a 375px phone leaves, so the fifth wrapped to a second row.
          Measured 2026-11-12 on the capture; the frame draws one row. Still true for a
          product that kept five photos from before the cap of two. */}
      <div className="flex flex-wrap gap-1">
        {value.map((path, i) => (
          <div key={path} className="relative size-16 shrink-0">
            <ProductThumbnail
              path={path}
              alt={i === 0 ? "Portada del producto" : `Foto ${i + 1} del producto`}
              width={64}
              height={64}
              className="size-16 rounded-lg border"
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
            className={TILE}
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

        {/* «TOMAR FOTO», PUT BACK ON 2026-11-15 AT THE OWNER'S REQUEST. The single-photo
            input this component replaced in v0.6.0 (`product-photo-input.tsx`) had it,
            and the replacement dropped it without anyone deciding to: «Se eliminó la
            opción de tomar foto del producto, al crear un producto, se debe volver a
            incluir». It is also what led to his rule that nothing existing is removed
            unless he asks.

            A TILE NEXT TO «AGREGAR», labelled «Foto» with a camera: owner's request of
            2026-11-15, the same day, with a capture of the first version (a full-width
            outline button under the thumbnails) and an arrow pointing beside «Agregar».
            With the cap at two the row holds at most three tiles (one photo, «Agregar»,
            «Foto»), so nothing wraps on a 375px phone any more; with five it wrapped.

            A SECOND INPUT, NOT THE ONE BELOW, because `multiple` is what hides the
            camera: Android's picker drops «Cámara» from the list when several files may
            be chosen. `capture="environment"` opens the rear camera straight away, and a
            capture returns exactly one image, so this input has no `multiple`.

            PHONES ONLY, as before: a desktop browser ignores `capture` and would open the
            same file dialog as «Agregar», which reads as a broken button. */}
        {isMobile && !lleno ? (
          <button
            type="button"
            disabled={disabled || uploading}
            onClick={() => cameraInputRef.current?.click()}
            className={TILE}
          >
            {uploading ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <>
                <Camera className="size-5" />
                <span className="text-[10px]">Foto</span>
              </>
            )}
          </button>
        ) : null}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        onChange={(e) => handleFiles(e.target.files)}
      />
      {isMobile && !lleno ? (
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={(e) => handleFiles(e.target.files)}
        />
      ) : null}

      <p className="text-xs text-muted-foreground">
        {sobreElTope
          ? `Este producto conserva sus ${value.length} fotos. El máximo ahora es ${MAX_PRODUCT_PHOTOS}: para agregar otra, quita fotos hasta que quede 1.`
          : lleno
            ? `Llegaste al máximo de ${MAX_PRODUCT_PHOTOS} fotos. Quita una para agregar otra.`
            : `La primera es la portada de tu catálogo. Puedes subir hasta ${MAX_PRODUCT_PHOTOS}.`}
      </p>
    </div>
  );
}
