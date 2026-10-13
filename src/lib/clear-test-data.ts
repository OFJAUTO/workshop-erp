import "server-only";
import { gzipSync } from "node:zlib";
import { createAdminClient } from "./supabase/admin";

/** The buckets that hold files belonging to jobs, cars and customers. Staff photos and the backups stay. */
export const JOB_BUCKETS = ["gate-in-media", "inspection-media", "job-files", "parts-diagrams", "scan-reports", "vehicle-photos"] as const;

/** Tables that are never backed up by the button: the change log stays in place (and is far too big for one file). */
const BACKUP_SKIP = new Set(["audit_log"]);
/** Rows per backup file: small, compressed files can never hit the storage size limit. */
const CHUNK_ROWS = 2000;

export type ClearResult = {
  backupPath: string | null;
  backedUpRows: number;
  backupFiles: number;
  /** Tables whose backup did not work; the clear went ahead (testing phase). */
  backupWarnings: string[];
  deleted: Record<string, number>;
  filesDeleted: Record<string, number>;
  /** Buckets that could not be emptied fully; pressing the button again carries on. */
  fileWarnings: string[];
};

/**
 * A quick backup: every table except the change log, read 1000 rows at a time, written as gzip-compressed JSON
 * files of at most 2000 rows each into the private backups bucket. A table that cannot be saved is noted and
 * skipped; nothing here stops the clear while the testing phase is on.
 */
async function backupToStorage(stamp: string): Promise<{ path: string; rows: number; files: number; warnings: string[] }> {
  const admin = createAdminClient();
  const { data: tables, error } = await admin.rpc("list_public_tables");
  if (error) return { path: `backups/${stamp}`, rows: 0, files: 0, warnings: [`Could not list the tables: ${error.message}`] };
  let total = 0;
  let files = 0;
  const warnings: string[] = [];
  for (const t of (tables ?? []) as { table_name: string }[]) {
    if (BACKUP_SKIP.has(t.table_name)) continue;
    try {
      let part = 0;
      let chunk: unknown[] = [];
      const flush = async () => {
        if (!chunk.length) return;
        const body = gzipSync(Buffer.from(JSON.stringify(chunk)));
        const { error: up } = await admin.storage.from("backups").upload(`${stamp}/${t.table_name}-${String(part).padStart(3, "0")}.json.gz`, body, { contentType: "application/gzip", upsert: true });
        if (up) throw new Error(up.message);
        files++;
        part++;
        chunk = [];
      };
      for (let from = 0; ; from += 1000) {
        const { data, error: e } = await admin.from(t.table_name).select("*").range(from, from + 999);
        if (e) throw new Error(e.message);
        chunk.push(...(data ?? []));
        total += (data ?? []).length;
        if (chunk.length >= CHUNK_ROWS) await flush();
        if (!data || data.length < 1000) break;
      }
      await flush();
    } catch (e) {
      warnings.push(`${t.table_name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { path: `backups/${stamp}`, rows: total, files, warnings };
}

/** Every file path in a bucket, folders included. */
async function listAll(bucket: string, prefix = ""): Promise<string[]> {
  const admin = createAdminClient();
  const out: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000, offset });
    if (error) throw new Error(`Could not list ${bucket}: ${error.message}`);
    for (const entry of data ?? []) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null || entry.id === undefined) out.push(...(await listAll(bucket, path)));
      else out.push(path);
    }
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Removes a bucket's files 100 at a time. Whatever was removed before a failure stays removed, so a second press carries on. */
async function clearBucket(bucket: string): Promise<{ removed: number; warning: string | null }> {
  const admin = createAdminClient();
  let removed = 0;
  try {
    const paths = await listAll(bucket);
    for (let i = 0; i < paths.length; i += 100) {
      const slice = paths.slice(i, i + 100);
      const { error } = await admin.storage.from(bucket).remove(slice);
      if (error) throw new Error(`Could not remove files from ${bucket}: ${error.message}`);
      removed += slice.length;
    }
    return { removed, warning: null };
  } catch (e) {
    return { removed, warning: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * The testing-phase clear: a quick compressed backup of every table but the change log (skipped tables are
 * reported, never a reason to stop), then one database call that empties every table belonging to cars,
 * customers and jobs (following the foreign keys) and restarts the numbering, then the files of those jobs
 * removed from storage 100 at a time. Staff, settings, lists, suppliers and discounts, stickers, templates,
 * the logo and the change log stay. Every step is safe to repeat: pressing the button again carries on.
 */
export async function clearTestData(actor: { id: string; display_name: string }): Promise<ClearResult> {
  const admin = createAdminClient();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backup = await backupToStorage(stamp);
  const { data, error } = await admin.rpc("clear_test_data");
  if (error) throw new Error(`Could not clear the tables: ${error.message}`);
  const deleted = (data ?? {}) as Record<string, number>;
  const filesDeleted: Record<string, number> = {};
  const fileWarnings: string[] = [];
  for (const b of JOB_BUCKETS) {
    const r = await clearBucket(b);
    filesDeleted[b] = r.removed;
    if (r.warning) fileWarnings.push(r.warning);
  }
  await admin.from("audit_log").insert({ table_name: "system", record_id: stamp, action: "clear_test_data", changed_by: actor.id, new_data: { by: actor.display_name, backup: backup.path, backupRows: backup.rows, backupWarnings: backup.warnings, deleted, filesDeleted, fileWarnings } });
  return { backupPath: backup.files ? backup.path : null, backedUpRows: backup.rows, backupFiles: backup.files, backupWarnings: backup.warnings, deleted, filesDeleted, fileWarnings };
}
