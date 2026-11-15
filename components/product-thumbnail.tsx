"use client";

import { useEffect, useRef, useState } from "react";
import Image, { type ImageProps } from "next/image";
import { getProductThumbnailUrl, getPublicProductPhotoUrl } from "@/lib/supabase/storage";

// THE SMALL PHOTO OF A PRODUCT, IN EVERY GRID AND LIST, on both sides of the app: the
// shopkeeper's catalogue, sale, orders and reports, and the customer's catalogue and cart.
//
// ONE COMPONENT BECAUSE THE FALLBACK HAS TO BE THE SAME EVERYWHERE (CLAUDE.md, «Un valor
// visual que sale en más de una pantalla NACE en un componente»). Eleven places drew this
// image by hand with the same four props; a fallback added to ten of them leaves one
// screen with broken images, and it would be whichever one nobody opened that day.
//
// WHAT IT DRAWS: the stored 400px thumbnail (`getProductThumbnailUrl`), and when that
// file is not there, the photo itself. A thumbnail is missing for every photo uploaded
// before 2026-11-15 until the nightly pass reaches it, and for any whose thumbnail failed
// to upload on a weak phone. The photo is heavier, never wrong.
//
// IT NEVER ASKS SUPABASE TO RESIZE. v0.7.0 did, and each distinct photo served that way
// is billed once per billing cycle; see `getProductThumbnailUrl`.
//
// THE ERROR CAN HAPPEN BEFORE REACT IS LISTENING, AND THAT CASE IS HANDLED ON PURPOSE.
// These images are in server-rendered HTML: the browser starts loading them at once, and
// a missing thumbnail can fail before hydration attaches `onError`. That event is never
// replayed, so the image would stay broken for good. The effect below looks at the
// element once mounted: finished loading with no pixels means it failed already.
//
// `unoptimized` IS NOT OPTIONAL: without it `next/image` demands the Supabase host in
// `next.config.ts` and THROWS while rendering if it is missing -- not a broken image, the
// whole screen. The callers used to pass it one by one; it lives here now.
type Props = Omit<ImageProps, "src" | "unoptimized" | "onError"> & {
  // The photo's path in the `product-photos` bucket, as saved on the product.
  path: string;
};

export function ProductThumbnail({ path, alt, ...props }: Props) {
  const ref = useRef<HTMLImageElement>(null);
  // Which path already fell back, rather than a boolean: a list that reuses this element
  // for another product must start that one from its thumbnail again.
  const [fellBackFor, setFellBackFor] = useState<string | null>(null);
  const fellBack = fellBackFor === path;

  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) setFellBackFor(path);
  }, [path]);

  return (
    <Image
      {...props}
      ref={ref}
      alt={alt}
      unoptimized
      src={fellBack ? getPublicProductPhotoUrl(path) : getProductThumbnailUrl(path)}
      // Only the first failure switches. If the photo itself is gone too, the image
      // stays broken, exactly as a missing photo looked before thumbnails existed.
      onError={() => {
        if (!fellBack) setFellBackFor(path);
      }}
    />
  );
}
