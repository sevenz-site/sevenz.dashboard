import type { SupabaseClient } from "@supabase/supabase-js";
import { fileToPhotoAndThumbnail } from "@/lib/image";
import {
  PRODUCT_THUMBNAIL_QUALITY,
  PRODUCT_THUMBNAIL_WIDTH,
  productThumbnailPath,
} from "@/lib/supabase/storage";

// UPLOADS ONE PRODUCT PHOTO AND ITS THUMBNAIL, from the browser, with the shopkeeper's
// own session. Returns the photo's path, which is what gets saved on the product.
//
// ONE FUNCTION FOR EVERY DOOR. Two inputs upload product photos -- the wizard's
// (`product-photos-input.tsx`) and the quick sheet's inside a sale
// (`product-photo-input.tsx`) -- and each had its own copy of these lines. A thumbnail
// added to one copy only would leave every product created from the other door without
// one, with nothing looking wrong (CLAUDE.md, «Un campo nuevo entra por TODAS las puertas
// de su acción»).
//
// THE OWNER'S OWN FOLDER, which is what the storage policy checks and what `ownPhotoPath`
// on the server re-checks before writing any path.
//
// THE PHOTO FIRST, THE THUMBNAIL SECOND, AND THE THUMBNAIL NEVER FAILS THE UPLOAD. A
// thumbnail that could not be made or sent is logged and dropped: the screens draw the
// photo instead (`ProductThumbnail`), and the nightly pass makes the missing one
// (`lib/product-thumbnails.ts`). Failing the whole upload for it would cost the
// shopkeeper a photo he took with the customer in front of him, over a file nobody sees.
//
// A YEAR OF CACHE ON THE THUMBNAIL: its name carries the photo's uuid and it is never
// rewritten, so a phone on a weak signal does not ask for it again.
export async function uploadProductPhoto(supabase: SupabaseClient, ownerId: string, file: File): Promise<string> {
  const { photo, thumbnail } = await fileToPhotoAndThumbnail(file, {
    width: PRODUCT_THUMBNAIL_WIDTH,
    quality: PRODUCT_THUMBNAIL_QUALITY,
  });
  const path = `${ownerId}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from("product-photos").upload(path, photo, {
    contentType: "image/jpeg",
  });
  if (error) throw error;

  if (thumbnail) {
    try {
      const { error: thumbnailError } = await supabase.storage
        .from("product-photos")
        .upload(productThumbnailPath(path), thumbnail, { contentType: "image/jpeg", cacheControl: "31536000" });
      if (thumbnailError) console.error("[uploadProductPhoto] thumbnail:", thumbnailError.message);
    } catch (thumbnailError) {
      console.error("[uploadProductPhoto] thumbnail threw:", thumbnailError);
    }
  }
  return path;
}
