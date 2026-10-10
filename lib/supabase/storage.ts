export function getPublicLogoUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, "");
  return `${base}/storage/v1/object/public/logos/${path}`;
}

export function getPublicClientProfilePictureUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, "");
  return `${base}/storage/v1/object/public/client-profile-pictures/${path}`;
}

// A product's photo. Bucket `product-photos`, created by migration 084 and
// public for the same reason `logos` is: the catalogue page is opened by
// somebody with no session and has to be able to render it.
export function getPublicProductPhotoUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, "");
  return `${base}/storage/v1/object/public/product-photos/${path}`;
}
