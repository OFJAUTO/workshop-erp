import "server-only";
import { createAdminClient } from "./supabase/admin";

/** The buckets that hold files belonging to jobs, cars and customers. Staff photos and the backups stay. */
export const JOB_BUCKETS = ["gate-in-media", "inspection-media", "job-files", "parts-diagrams", "scan-reports", "vehicle-photos"] as const;

export type ClearResult = { backupPath: string; backedUpRows: number; deleted: Record<string, number>; filesDeleted: Record<string, number> };

/** Every row of every table, saved as JSON files in the private backups bucket before anything is cleared. */
async function backupToStorage(stamp: string): Promise<{ path: string; rows: number }> {
  const admin = createAdminClient();
  const { data: tables, error } = await admin.rpc("list_public_tables");
  if (error) throw new Error(`Could not list the tables: ${error.message}`);
  let total = 0;
  for (const t of (tables ?? []) as { table_name: string }[]) {
    const rows: unknown[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error: e } = await admin.from(t.table_name).select("*").range(from, from + 999);
      if (e) throw new Error(`Could not read ${t.table_name}: ${e.message}`);
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    total += rows.length;
    const { error: up } = await admin.storage.from("backups").upload(`${stamp}/${t.table_name}.json`, Buffer.from(JSON.stringify(rows)), { contentType: "application/json", upsert: true });
    if (up) throw new Error(`Could not save the backup of ${t.table_name}: ${up.message}`);
  }
  return { path: `backups/${stamp}`, rows: total };
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

async function clearBucket(bucket: string): Promise<number> {
  const admin = createAdminClient();
  const paths = await listAll(bucket);
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await admin.storage.from(bucket).remove(paths.slice(i, i + 100));
    if (error) throw new Error(`Could not remove files from ${bucket}: ${error.message}`);
  }
  return paths.length;
}

/**
 * Backs up every table to storage, empties every table that holds test jobs, cars and customers (the
 * database function does that in one transaction and restarts the numbering), then removes the files
 * of those jobs from storage. Staff, settings, lists and the change log stay.
 */
export async function clearTestData(actor: { id: string; display_name: string }): Promise<ClearResult> {
  const admin = createAdminClient();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backup = await backupToStorage(stamp);
  const { data, error } = await admin.rpc("clear_test_data");
  if (error) throw new Error(`Could not clear the tables: ${error.message}`);
  const deleted = (data ?? {}) as Record<string, number>;
  const filesDeleted: Record<string, number> = {};
  for (const b of JOB_BUCKETS) filesDeleted[b] = await clearBucket(b);
  await admin.from("audit_log").insert({ table_name: "system", record_id: stamp, action: "clear_test_data", changed_by: actor.id, new_data: { by: actor.display_name, backup: backup.path, deleted, filesDeleted } });
  return { backupPath: backup.path, backedUpRows: backup.rows, deleted, filesDeleted };
}
