export function getPublicLogoUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, "");
  return `${base}/storage/v1/object/public/logos/${path}`;
}
