import "server-only";
import { createAdminClient } from "./supabase/admin";

export type BucketUsage = { bucket: string; files: number; bytes: number };

/** Adds up file sizes in each storage area (walks folders one level deep, which is how files are stored). */
export async function storageUsage(): Promise<BucketUsage[]> {
  const admin = createAdminClient();
  const out: BucketUsage[] = [];
  for (const bucket of ["gate-in-media", "vehicle-photos", "staff-photos"]) {
    let files = 0;
    let bytes = 0;
    const { data: folders } = await admin.storage.from(bucket).list("", { limit: 1000 });
    for (const f of folders ?? []) {
      if (f.id) {
        files++;
        bytes += Number((f.metadata as { size?: number } | null)?.size ?? 0);
        continue;
      }
      const { data: inner } = await admin.storage.from(bucket).list(f.name, { limit: 1000 });
      for (const x of inner ?? []) {
        files++;
        bytes += Number((x.metadata as { size?: number } | null)?.size ?? 0);
      }
    }
    out.push({ bucket, files, bytes });
  }
  return out;
}

export function formatBytes(n: number) {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
