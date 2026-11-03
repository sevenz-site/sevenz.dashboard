// ── DOES THE FILE A SAVE IS ABOUT TO POINT AT STILL EXIST? ────────────────
//
// `DM-12`, 2026-11-02. The nightly cleanup (migration 182) deletes a logo or a
// product photo nobody references once it is 7 days old. Two flows hold a
// reference that no row knows about yet: the product wizard keeps its draft in
// the browser, and «Mi negocio» holds a freshly uploaded logo until «Guardar
// cambios». Either can outlive 7 days -- a tab left open, a draft finished a
// week later -- and then the save would write a path to a deleted file: a
// broken image in the app, the catalogue and the receipts, with no error.
//
// So the three doors that write those paths (`createProduct`, `updateProduct`,
// `updateBusinessSettings`) ask this first, ONLY when the path is new for the
// row. A path already saved is referenced, and the cleanup never touches it.
//
// It asks the bucket's PUBLIC URL with a HEAD request, not the Storage API: both
// buckets are public, and the public URL needs no read policy on
// `storage.objects` for the owner's session.
//
// IT FAILS OPEN. A network error answers "exists": refusing a save over a
// check that could not run would block the shopkeeper for nothing, and the
// worst case of letting it through is a broken image -- what happens today
// without the check.
export async function storageFileExists(bucket: "logos" | "product-photos", path: string): Promise<boolean> {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, "");
  const url = `${base}/storage/v1/object/public/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`;
  try {
    const res = await fetch(url, { method: "HEAD", cache: "no-store" });
    if (res.ok) return true;
    // Storage answers a missing object with 400 or 404. Anything else (5xx,
    // rate limits) is not an answer about the file.
    return !(res.status === 400 || res.status === 404);
  } catch (error) {
    console.error("[storageFileExists] check failed, allowing the save", bucket, error);
    return true;
  }
}
