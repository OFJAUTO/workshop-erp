import "server-only";
import { createAdminClient } from "./supabase/admin";
import { schemaReady } from "./schema-ready";
import { notifyJobAdvisors } from "./notifications";
import { logAppError } from "./app-errors";
import { pendingFilesWords, type PendingSummary } from "./upload-pending-words";

/**
 * Files still on a device (12 November 2026). The tablet tells the server about every file the moment it is saved
 * there (`/api/uploads/announce`), the upload door marks it arrived when it is recorded, so the report can say "4 files
 * still uploading from Mech 3", the customer's report waits for them, and the advisor hears after 15 minutes.
 * Dormant until the migration `upload_pending` is applied.
 */
export const uploadPendingReady = () => schemaReady("upload_pending", "id, arrived_at, removed_at, alerted_at");

export type { PendingSummary };
export { pendingFilesWords };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AnnounceInput = {
  fileId: string;
  target: string;
  scopeId: string;
  itemKey?: string | null;
  kind?: string | null;
  contentType?: string | null;
  size?: number | null;
  staffId?: string | null;
  takenAt?: number | null;
  state?: "waiting" | "sending" | "stopped" | "removed";
  progress?: number | null;
  attempts?: number | null;
  error?: string | null;
  storage?: { quotaMb?: number | null; usedMb?: number | null; persisted?: boolean | null } | null;
};

/** The job a place belongs to (an inspection's job; the job itself for the gate-in, job files and loose items). */
async function placeOf(target: string, scopeId: string): Promise<{ inspectionId: string | null; jobId: string | null }> {
  if (!UUID.test(scopeId)) return { inspectionId: null, jobId: null };
  if (target === "inspection") {
    const { data } = await createAdminClient().from("inspections").select("job_id").eq("id", scopeId).maybeSingle();
    return { inspectionId: data ? scopeId : null, jobId: (data?.job_id as string | null) ?? null };
  }
  if (target === "gate_in" || target === "job_file" || target === "loose_item") return { inspectionId: null, jobId: scopeId };
  return { inspectionId: null, jobId: null };
}

/** One file's news from the device (idempotent by its id). Never throws: the file is still on the device either way. */
export async function recordAnnounce(input: AnnounceInput, device: { id: string; name: string } | null): Promise<boolean> {
  if (!UUID.test(input.fileId) || !(await uploadPendingReady())) return false;
  const admin = createAdminClient();
  const now = new Date().toISOString();
  try {
    const { data: have } = await admin.from("upload_pending").select("id, arrived_at").eq("id", input.fileId).maybeSingle();
    // Already recorded by the upload door: the late news of a file that arrived never brings it back.
    if (have?.arrived_at) return true;
    const live = {
      last_seen_at: now,
      state: input.state ?? "waiting",
      progress: typeof input.progress === "number" && Number.isFinite(input.progress) ? Math.round(input.progress * 10000) / 100 : null,
      attempts: typeof input.attempts === "number" ? Math.max(0, Math.round(input.attempts)) : 0,
      last_error: input.error ? String(input.error).slice(0, 300) : null,
      ...(input.state === "removed" ? { removed_at: now } : {}),
      ...(input.storage
        ? {
            storage_quota_mb: Number.isFinite(input.storage.quotaMb) ? Math.round(Number(input.storage.quotaMb)) : null,
            storage_used_mb: Number.isFinite(input.storage.usedMb) ? Math.round(Number(input.storage.usedMb)) : null,
            storage_persisted: typeof input.storage.persisted === "boolean" ? input.storage.persisted : null,
          }
        : {}),
    };
    if (have) {
      const { error } = await admin.from("upload_pending").update(live).eq("id", input.fileId).is("arrived_at", null);
      if (error) throw error;
      return true;
    }
    const place = await placeOf(input.target, input.scopeId);
    const { error } = await admin.from("upload_pending").insert({
      id: input.fileId,
      target: String(input.target).slice(0, 40),
      scope_id: String(input.scopeId).slice(0, 80),
      inspection_id: place.inspectionId,
      job_id: place.jobId,
      item_key: input.itemKey ? String(input.itemKey).slice(0, 120) : null,
      kind: input.kind ? String(input.kind).slice(0, 40) : null,
      content_type: input.contentType ? String(input.contentType).slice(0, 80) : null,
      size_bytes: typeof input.size === "number" && Number.isFinite(input.size) ? Math.round(input.size) : null,
      staff_id: input.staffId && UUID.test(input.staffId) ? input.staffId : null,
      device_id: device?.id ?? null,
      device_name: device?.name ?? null,
      taken_at: typeof input.takenAt === "number" && Number.isFinite(input.takenAt) ? new Date(input.takenAt).toISOString() : now,
      ...live,
    });
    // Two announces of one file at the same moment: the second insert loses, its news goes on the row.
    if (error && error.code === "23505") {
      await admin.from("upload_pending").update(live).eq("id", input.fileId).is("arrived_at", null);
      return true;
    }
    if (error) throw error;
    return true;
  } catch (e) {
    logAppError("upload-pending.announce", e);
    return false;
  }
}

/** The upload door recorded the file: it is no longer on the way. */
export async function markArrived(fileId: string | null | undefined): Promise<void> {
  if (!fileId || !UUID.test(fileId) || !(await uploadPendingReady())) return;
  const now = new Date().toISOString();
  const { error } = await createAdminClient().from("upload_pending").update({ arrived_at: now, state: "arrived", progress: 100, last_seen_at: now, last_error: null }).eq("id", fileId).is("arrived_at", null);
  if (error) logAppError("upload-pending.arrived", error);
}

type OpenRow = { inspection_id: string | null; job_id: string | null; device_name: string | null; created_at: string; state: string };

function summarise(rows: OpenRow[]): PendingSummary {
  const devices = Array.from(new Set(rows.map((r) => r.device_name || "a tablet")));
  const oldest = rows.reduce<string | null>((m, r) => (!m || r.created_at < m ? r.created_at : m), null);
  return { count: rows.length, stopped: rows.filter((r) => r.state === "stopped").length, devices, oldest };
}

/** Files still on the way for each inspection (only those with some). */
export async function pendingForInspections(ids: string[]): Promise<Map<string, PendingSummary>> {
  const out = new Map<string, PendingSummary>();
  const list = Array.from(new Set(ids.filter((x) => UUID.test(x))));
  if (!list.length || !(await uploadPendingReady())) return out;
  const { data, error } = await createAdminClient().from("upload_pending").select("inspection_id, job_id, device_name, created_at, state").in("inspection_id", list).is("arrived_at", null).is("removed_at", null);
  if (error) {
    logAppError("upload-pending.read", error);
    return out;
  }
  const by = new Map<string, OpenRow[]>();
  for (const r of (data ?? []) as OpenRow[]) if (r.inspection_id) by.set(r.inspection_id, [...(by.get(r.inspection_id) ?? []), r]);
  for (const [k, rows] of by) out.set(k, summarise(rows));
  return out;
}

export async function pendingForInspection(id: string | null | undefined): Promise<PendingSummary | null> {
  if (!id) return null;
  return (await pendingForInspections([id])).get(id) ?? null;
}

/** Files of a job still on the way (the inspection's and the job's own: gate-in, job files). */
export async function pendingForJob(jobId: string): Promise<PendingSummary | null> {
  if (!UUID.test(jobId) || !(await uploadPendingReady())) return null;
  const { data, error } = await createAdminClient().from("upload_pending").select("inspection_id, job_id, device_name, created_at, state").eq("job_id", jobId).is("arrived_at", null).is("removed_at", null);
  if (error || !data?.length) return null;
  return summarise(data as OpenRow[]);
}

export const LATE_UPLOAD_MINUTES = 15;

/**
 * Every five minutes (the mailbox cron): files saved on a tablet more than 15 minutes ago that have not arrived ring the
 * bell of the car's advisors, once per car and wave. Returns how many cars were told.
 */
export async function alertLateUploads(now = Date.now(), opts: { jobIds?: string[] } = {}): Promise<number> {
  if (!(await uploadPendingReady())) return 0;
  const admin = createAdminClient();
  const cutoff = new Date(now - LATE_UPLOAD_MINUTES * 60_000).toISOString();
  let q = admin
    .from("upload_pending")
    .select("id, job_id, inspection_id, device_name, created_at, state")
    .is("arrived_at", null)
    .is("removed_at", null)
    .is("alerted_at", null)
    .lt("created_at", cutoff)
    .not("job_id", "is", null)
    // Inspection files (the report waits for them); other places say what is waiting on their own screens.
    .eq("target", "inspection")
    .limit(500);
  // A test names its own jobs (real cars are never told from a test).
  if (opts.jobIds) q = q.in("job_id", opts.jobIds.length ? opts.jobIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data, error } = await q;
  if (error) {
    logAppError("upload-pending.late", error);
    return 0;
  }
  const rows = (data ?? []) as (OpenRow & { id: string })[];
  if (!rows.length) return 0;
  const byJob = new Map<string, (OpenRow & { id: string })[]>();
  for (const r of rows) byJob.set(r.job_id as string, [...(byJob.get(r.job_id as string) ?? []), r]);
  const jobIds = Array.from(byJob.keys());
  const { data: jobs } = await admin.from("jobs").select("id, job_number, vehicle_id").in("id", jobIds);
  const vehicleIds = (jobs ?? []).map((j) => j.vehicle_id).filter(Boolean) as string[];
  const { data: cars } = vehicleIds.length ? await admin.from("vehicles").select("id, plate_code, plate_number").in("id", vehicleIds) : { data: [] };
  const plateOf = new Map((cars ?? []).map((v) => [v.id as string, [v.plate_code, v.plate_number].filter(Boolean).join(" ")]));
  let told = 0;
  for (const [jobId, list] of byJob) {
    const job = (jobs ?? []).find((j) => j.id === jobId);
    const s = summarise(list);
    const where = [job?.job_number, job?.vehicle_id ? plateOf.get(job.vehicle_id as string) : null].filter(Boolean).join(" · ");
    const inspection = list.some((r) => r.inspection_id);
    try {
      await notifyJobAdvisors(jobId, {
        type: "uploads_late",
        title: `${s.count} ${inspection ? "inspection " : ""}file${s.count === 1 ? "" : "s"} not arrived after ${LATE_UPLOAD_MINUTES} minutes · ${where}`,
        body: `Still on ${s.devices.join(", ")}. Ask the technician to open the ERP on that tablet with Wi-Fi on; the files send by themselves. The report cannot go to the customer until they arrive.`,
        href: inspection ? `/jobs/${jobId}/inspection` : `/jobs/${jobId}`,
      });
      await admin.from("upload_pending").update({ alerted_at: new Date(now).toISOString() }).in("id", list.map((r) => r.id));
      told += 1;
    } catch (e) {
      logAppError("upload-pending.late.notify", e);
    }
  }
  return told;
}
