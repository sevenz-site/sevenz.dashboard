import { createServiceClient } from "@/lib/supabase/service";
import {
  PRODUCT_THUMBNAIL_QUALITY,
  PRODUCT_THUMBNAIL_WIDTH,
  productThumbnailPath,
} from "@/lib/supabase/storage";

// ── THE NIGHTLY PASS THAT MAKES THE THUMBNAILS THAT ARE MISSING ───────────
//
// Owner's decision of 2026-11-15, option B («Aprobado B con las soluciones para peores
// escenarios»): a product photo's thumbnail is a stored file, uploaded by the browser
// next to the photo (`lib/products/upload-photo.ts`). Two kinds of photo have none:
//
//   - every photo uploaded before that (305 in use in production that day);
//   - any whose thumbnail the phone could not make or send.
//
// The screens survive both -- `ProductThumbnail` draws the photo itself -- but at the
// photo's full weight, which is what thumbnails exist to avoid. This pass closes the gap
// from the server: it asks the database which photos in use have no thumbnail
// (`product_photos_missing_thumbnail`, migration 209), resizes each one and uploads it.
//
// IT RESIZES HERE, WITH `sharp`, AND NEVER THROUGH SUPABASE'S `/render/image/`. That
// endpoint is the billed one this whole change walks away from. `sharp` was already in
// `package.json` (Next uses it for its own image optimizer); this is the first file that
// imports it, so the first deploy has to confirm it loads on Vercel. If it does not, the
// pass fails, says so in its result, and nothing else is affected.
//
// THAT LAST SENTENCE IS ONLY TRUE BECAUSE `sharp` IS IMPORTED INSIDE THE PASS, not at the
// top of this file. A static import is resolved when the route's module loads: a native
// binary missing on Vercel would then take the whole route down, the cleanup with it,
// every night and with nothing in the response to say why. It was a static import until
// 2026-11-15, caught before release: the preview's cron secret is not the local one, so
// this pass could not be run on Vercel ahead of production, and the first real run is the
// production night. Do not hoist the import back.
//
// IT DELETES NOTHING AND OVERWRITES NOTHING: `upsert: false`, so a thumbnail the
// shopkeeper's phone uploaded a second earlier wins and this one is counted as present.
//
// ONE BAD PHOTO NEVER STOPS THE REST. Each photo is its own try; a failure is counted
// and logged. The database hands the batch out in random order, so a photo that can
// never be resized does not sit at the head of the queue every night.
//
// IT STOPS ON A CLOCK, NOT ONLY ON A COUNT. The route has a fixed time to answer; photos
// not reached tonight are tomorrow's. `remaining` in the result is not "how many are
// left in total" -- only how many of tonight's batch the clock cut off.

const CONCURRENCY = 4;

export type ThumbnailResult = {
  // How many photos the database handed out tonight.
  missing: number;
  made: number;
  // Already there when the upload arrived: made by the phone in the meantime.
  present: number;
  failed: number;
  // Handed out and not reached before the deadline.
  remaining: number;
};

// The nightly entry point: reads the switch and runs the pass.
//
// ITS OWN READ OF THE SETTINGS, apart from the cleanup's, on purpose: the column
// `thumbnails_per_run` arrives with migration 209, and the cleanup must keep working on a
// database where 209 has not run. There this throws, the route reports it under
// `thumbnails.error`, and the cleanup's own result is untouched.
export async function runThumbnailPass(deadlineMs: number): Promise<ThumbnailResult> {
  const db = createServiceClient();
  const { data: settings, error } = await db
    .from("storage_cleanup_settings")
    .select("thumbnails_per_run, scope_owner")
    .eq("id", true)
    .single();
  if (error || !settings) throw new Error(`storage_cleanup_settings: ${error?.message ?? "sin fila"}`);
  return makeMissingThumbnails({
    limit: settings.thumbnails_per_run as number,
    scopeOwner: (settings.scope_owner as string | null) ?? null,
    deadlineMs,
  });
}

export async function makeMissingThumbnails(options: {
  limit: number;
  scopeOwner: string | null;
  deadlineMs: number;
}): Promise<ThumbnailResult> {
  const result: ThumbnailResult = { missing: 0, made: 0, present: 0, failed: 0, remaining: 0 };
  if (options.limit <= 0) return result;

  const db = createServiceClient();
  const { data, error } = await db.rpc("product_photos_missing_thumbnail", {
    p_limit: options.limit,
    p_scope_owner: options.scopeOwner,
  });
  if (error) throw new Error(`product_photos_missing_thumbnail: ${error.message}`);
  const names = ((data ?? []) as unknown[]).map((row) =>
    typeof row === "string" ? row : String(Object.values(row as Record<string, unknown>)[0]),
  );
  result.missing = names.length;
  if (names.length === 0) return result;

  // Loaded here and not at the top of the file: see the header.
  const { default: sharp } = await import("sharp");

  const bucket = db.storage.from("product-photos");
  const queue = [...names];

  async function worker() {
    for (;;) {
      if (Date.now() > options.deadlineMs) return;
      const name = queue.shift();
      if (!name) return;
      try {
        const { data: file, error: downloadError } = await bucket.download(name);
        if (downloadError || !file) throw new Error(downloadError?.message ?? "sin archivo");
        const thumbnail = await sharp(Buffer.from(await file.arrayBuffer()))
          // The photo was drawn on a canvas before upload, so it carries no EXIF
          // orientation; `rotate()` with no angle applies one if a file ever does.
          .rotate()
          .resize({ width: PRODUCT_THUMBNAIL_WIDTH, withoutEnlargement: true })
          .jpeg({ quality: PRODUCT_THUMBNAIL_QUALITY })
          .toBuffer();
        const { error: uploadError } = await bucket.upload(productThumbnailPath(name), thumbnail, {
          contentType: "image/jpeg",
          cacheControl: "31536000",
          upsert: false,
        });
        if (!uploadError) result.made += 1;
        else if (/exists|duplicate/i.test(uploadError.message)) result.present += 1;
        else throw new Error(uploadError.message);
      } catch (e) {
        result.failed += 1;
        console.error("[product-thumbnails] failed", name, e instanceof Error ? e.message : e);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  result.remaining = queue.length;
  return result;
}
