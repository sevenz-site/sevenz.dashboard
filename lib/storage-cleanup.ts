import { createServiceClient } from "@/lib/supabase/service";

// ── THE NIGHTLY CLEANUP OF ABANDONED LOGOS AND PRODUCT PHOTOS ─────────────
//
// `DM-12`, built on 2026-11-02. Migration 182 holds the rule and explains it;
// this file only carries it out, in four steps:
//
//   1. read the switch (`storage_cleanup_settings`);
//   2. ask the database which files nobody uses (`storage_orphan_candidates`);
//   3. write them to `storage_cleanup_log` -- every night, watching or not;
//   4. only if `enforce` is on: re-check each name a moment before deleting it
//      (`storage_orphan_recheck`) and delete through the Storage API.
//
// THE RE-CHECK IS NOT REDUNDANT. Between step 2 and step 4 a shopkeeper can
// save a product whose photo was an orphan until that second -- a draft from
// the wizard, finished at night. Without the re-check that photo would go.
//
// A FAILURE STOPS THE RUN, IT NEVER WIDENS IT. If the switch cannot be read,
// nothing is deleted. If the re-check fails, that bucket is skipped. A night
// with no cleanup costs nothing: the next one does it.

export const CLEANUP_BUCKETS = ["logos", "product-photos"] as const;

type Candidate = {
  bucket_id: string;
  name: string;
  size_bytes: number | null;
  file_created_at: string;
};

export type CleanupResult = {
  mode: "observe" | "enforce";
  found: number;
  foundBytes: number;
  deleted: number;
  deletedBytes: number;
  skipped: string[];
};

export async function runStorageCleanup(): Promise<CleanupResult> {
  const db = createServiceClient();

  const { data: settings, error: settingsError } = await db
    .from("storage_cleanup_settings")
    .select("enforce, min_age, max_per_run, scope_owner")
    .eq("id", true)
    .single();
  if (settingsError || !settings) {
    throw new Error(`storage_cleanup_settings: ${settingsError?.message ?? "sin fila"}`);
  }

  const { data: found, error: findError } = await db.rpc("storage_orphan_candidates", {
    p_min_age: settings.min_age,
    p_limit: settings.max_per_run,
    p_scope_owner: settings.scope_owner,
  });
  if (findError) throw new Error(`storage_orphan_candidates: ${findError.message}`);
  const candidates = (found ?? []) as Candidate[];

  const now = new Date().toISOString();
  if (candidates.length > 0) {
    // `first_seen_at` is left out so a file seen again keeps the night it was
    // first found; only `last_seen_at` moves.
    const { error: logError } = await db.from("storage_cleanup_log").upsert(
      candidates.map((c) => ({
        bucket_id: c.bucket_id,
        name: c.name,
        size_bytes: c.size_bytes,
        file_created_at: c.file_created_at,
        last_seen_at: now,
      })),
      { onConflict: "bucket_id,name" },
    );
    // Logging is the whole output of a watching night, so a failed log stops
    // an enforcing one too: nothing is deleted that was not written down.
    if (logError) throw new Error(`storage_cleanup_log: ${logError.message}`);
  }

  const result: CleanupResult = {
    mode: settings.enforce ? "enforce" : "observe",
    found: candidates.length,
    foundBytes: candidates.reduce((s, c) => s + (c.size_bytes ?? 0), 0),
    deleted: 0,
    deletedBytes: 0,
    skipped: [],
  };
  if (!settings.enforce) return result;

  for (const bucket of CLEANUP_BUCKETS) {
    const names = candidates.filter((c) => c.bucket_id === bucket).map((c) => c.name);
    if (names.length === 0) continue;

    const { data: still, error: recheckError } = await db.rpc("storage_orphan_recheck", {
      p_bucket: bucket,
      p_names: names,
    });
    if (recheckError) {
      console.error("[storage-cleanup] recheck failed, bucket skipped", bucket, recheckError.message);
      result.skipped.push(bucket);
      continue;
    }
    const toDelete = (still ?? []) as string[];
    if (toDelete.length === 0) continue;

    const { data: removed, error: removeError } = await db.storage.from(bucket).remove(toDelete);
    if (removeError) {
      console.error("[storage-cleanup] remove failed", bucket, removeError.message);
      result.skipped.push(bucket);
      continue;
    }
    // Storage answers with the objects it actually removed; only those are
    // marked, so a name it could not find stays visible in the log.
    const removedNames = (removed ?? []).map((o) => o.name);
    if (removedNames.length > 0) {
      const { error: markError } = await db
        .from("storage_cleanup_log")
        .update({ deleted_at: now })
        .eq("bucket_id", bucket)
        .in("name", removedNames);
      if (markError) console.error("[storage-cleanup] could not mark deleted rows", bucket, markError.message);
    }
    result.deleted += removedNames.length;
    result.deletedBytes += candidates
      .filter((c) => c.bucket_id === bucket && removedNames.includes(c.name))
      .reduce((s, c) => s + (c.size_bytes ?? 0), 0);
  }

  return result;
}
