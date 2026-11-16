import Image, { type ImageProps } from "next/image";
import { cn } from "@/lib/utils";
import { getPublicProductPhotoUrl } from "@/lib/supabase/storage";

// HOW A PRODUCT PHOTO SITS IN ITS BOX, on every screen of both sides of the app: the WHOLE
// product, never a crop. Owner's decision of 2026-11-15, with two of his own captures of
// «Agua oxigenada» side by side: *«la vista del cliente es la correcta porque permite ver
// el producto completo»*, and asked whether that should hold everywhere even if the photo
// leaves bands at its sides: *«Sí, siempre el producto entero, también en web»*.
//
// WHAT IT REPLACES. Every screen drew its photo with `object-cover`, which fills the box
// and cuts whatever sticks out. In the square catalogue cards a 3:4 photo only loses some
// background; in the wide, low boxes -- the sale's product sheet (200px tall at full
// width), the order sheet, the order line editor, the «verify» step of the product form
// -- a portrait photo kept only its middle band, which on a bottle is the label: the
// «zoom» the owner saw. Twenty screens set their fit by hand, so they could only drift.
//
// THE BANDS ARE `bg-muted`, on the image itself and not on its box: several screens draw
// the photo as a bare `<img>` with its own border and no box around it, and there the
// bands would otherwise show the white of the page and read as a broken image.
//
// LAST IN `cn`, ON PURPOSE: `twMerge` keeps the last of two conflicting classes, so a
// caller that still passes `object-cover` cannot win. `qa:fotos` 8d checks it stays last.
export const PRODUCT_PHOTO_FIT = "object-contain bg-muted";

// THE BOX OF A LARGE PRODUCT PHOTO on the owner's side: the product page, the sale's product
// sheet, the order sheets and the «verify» step of the product form. Owner's decisions of
// 2026-11-15: «todo el mismo componente», then «componentes separados para web y mobile»,
// and for web «Cuadrado con tope, centrado».
//
//   phone: a square across the full width, the same box as the customer's product page;
//   web (`md`, 768px and up): the same square, capped at 400px and centred.
//
// It replaced a 200px-tall strip (120px in the form) that each screen drew by hand. With
// the whole product inside (`PRODUCT_PHOTO_FIT`) that strip left a portrait photo small
// between two wide bands, 1024x200 on the web product page.
//
// THE CUSTOMER'S PRODUCT PAGE KEEPS ITS OWN SQUARE (full width, up to 672px on web): the
// owner called that view «la correcta», and it is drawn from its approved frame.
export const PRODUCT_PHOTO_BOX = "aspect-square w-full md:mx-auto md:max-w-[400px]";

type Props = Omit<ImageProps, "src" | "unoptimized"> & {
  // The photo's path in the `product-photos` bucket, as saved on the product.
  path: string;
};

// THE FULL PHOTO, for the screens that show one product large: its sheet in the sale, its
// gallery, the order sheets, the product form. Grids and lists draw the 400px thumbnail
// instead, through `ProductThumbnail`, which applies the same fit.
//
// `unoptimized`: a Supabase public URL of a photo already resized on the device; without
// it `next/image` demands the Supabase host in `next.config.ts` and throws while rendering.
export function ProductPhoto({ path, alt, className, ...props }: Props) {
  return (
    <Image
      {...props}
      alt={alt}
      unoptimized
      src={getPublicProductPhotoUrl(path)}
      className={cn(className, PRODUCT_PHOTO_FIT)}
    />
  );
}
