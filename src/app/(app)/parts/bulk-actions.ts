"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { can, type RoleId } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncLineForPart } from "./actions";

/** A part already ordered, received, issued or fitted is never deleted in bulk. */
const LOCKED_ORDER = ["to_order", "ordered", "partly_received", "received"];

async function partsStaff() {
  const staff = await getCurrentStaff();
  if (!staff || staff.viewingAs) return null;
  if (!can(staff.role_id as RoleId, "priceParts")) return null;
  return staff;
}

export type BulkDeleteResult = { error?: string; deleted?: number; kept?: number; batch?: string };

/**
 * "Delete all" on the Parts table: the ticked rows, or every row of the job when none is ticked. Parts already
 * ordered, received or fitted are kept and counted. Deleted parts and requests go inactive at once (they vanish from
 * every list and the quotation) under one batch id, so Undo can bring the whole batch back for a minute.
 */
export async function bulkDeleteParts(jobId: string, keys: { partIds: string[]; requestIds: string[] } | null): Promise<BulkDeleteResult> {
  const staff = await partsStaff();
  if (!staff) return { error: "Not allowed." };
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("id, is_open").eq("id", jobId).maybeSingle();
  if (!job || !job.is_open) return { error: "This job is closed." };
  const batch = randomUUID();
  const now = new Date().toISOString();

  let partsQ = admin.from("part_items").select("id, part_request_id, order_status, issue_status, fitted_at, received_qty").eq("job_id", jobId).eq("is_active", true);
  let reqQ = admin.from("part_requests").select("id").eq("job_id", jobId).eq("is_active", true);
  if (keys && (keys.partIds.length || keys.requestIds.length)) {
    partsQ = partsQ.in("id", keys.partIds.length ? keys.partIds : ["00000000-0000-0000-0000-000000000000"]);
    reqQ = reqQ.in("id", keys.requestIds.length ? keys.requestIds : ["00000000-0000-0000-0000-000000000000"]);
  }
  const [{ data: parts }, { data: reqs }] = await Promise.all([partsQ, reqQ]);
  type P = { id: string; part_request_id: string | null; order_status: string | null; issue_status: string | null; fitted_at: string | null; received_qty: number | null };
  const all = (parts ?? []) as P[];
  const locked = all.filter((p) => LOCKED_ORDER.includes(p.order_status ?? "") || !!p.fitted_at || (p.issue_status && p.issue_status !== "none") || Number(p.received_qty ?? 0) > 0);
  const free = all.filter((p) => !locked.some((l) => l.id === p.id));
  // A request whose parts are all going (or that has none) goes with them; one with a kept part stays.
  const keptRequestIds = new Set(locked.map((p) => p.part_request_id).filter((x): x is string => !!x));
  const requestIds = Array.from(new Set([...(reqs ?? []).map((r) => r.id as string), ...free.map((p) => p.part_request_id).filter((x): x is string => !!x)])).filter((id) => !keptRequestIds.has(id));
  if (!free.length && !requestIds.length) return { deleted: 0, kept: locked.length, batch };

  if (free.length) {
    const { error } = await admin.from("part_items").update({ is_active: false, deleted_at: now, deleted_by: staff.id, delete_batch: batch, updated_by: staff.id }).in("id", free.map((p) => p.id));
    if (error) return { error: error.message };
  }
  if (requestIds.length) {
    // Only requests with no other live part are deleted.
    const { data: live } = await admin.from("part_items").select("part_request_id").eq("job_id", jobId).eq("is_active", true).in("part_request_id", requestIds);
    const stillLive = new Set((live ?? []).map((p) => p.part_request_id as string));
    const toDelete = requestIds.filter((id) => !stillLive.has(id));
    if (toDelete.length) {
      const { error } = await admin.from("part_requests").update({ is_active: false, deleted_at: now, deleted_by: staff.id, delete_batch: batch, updated_by: staff.id }).in("id", toDelete);
      if (error) return { error: error.message };
    }
  }
  // Their lines come off the open quotation.
  for (const p of free) await syncLineForPart(jobId, p.id, staff.id);
  const deleted = free.length + requestIds.filter((id) => !free.some((p) => p.part_request_id === id)).length;
  await admin.from("job_events").insert({ job_id: jobId, event_type: "parts_bulk_deleted", note: `${deleted} part${deleted === 1 ? "" : "s"} deleted from the Parts table by ${staff.display_name}${locked.length ? `; ${locked.length} ordered kept` : ""}`, created_by: staff.id });
  revalidatePath(`/parts/${jobId}`);
  return { deleted, kept: locked.length, batch };
}

/** Undo within the minute: everything deleted under the batch comes back, lines and all. */
export async function undoBulkDelete(jobId: string, batch: string): Promise<{ error?: string; restored?: number }> {
  const staff = await partsStaff();
  if (!staff) return { error: "Not allowed." };
  const admin = createAdminClient();
  const { data: parts } = await admin.from("part_items").select("id").eq("job_id", jobId).eq("delete_batch", batch);
  const ids = (parts ?? []).map((p) => p.id as string);
  if (ids.length) {
    const { error } = await admin.from("part_items").update({ is_active: true, deleted_at: null, deleted_by: null, delete_batch: null, updated_by: staff.id }).in("id", ids);
    if (error) return { error: error.message };
  }
  const { data: reqs, error: re } = await admin.from("part_requests").update({ is_active: true, deleted_at: null, deleted_by: null, delete_batch: null, updated_by: staff.id }).eq("job_id", jobId).eq("delete_batch", batch).select("id");
  if (re) return { error: re.message };
  for (const id of ids) await syncLineForPart(jobId, id, staff.id);
  const restored = ids.length + (reqs ?? []).length;
  await admin.from("job_events").insert({ job_id: jobId, event_type: "parts_bulk_restored", note: `${restored} deleted part${restored === 1 ? "" : "s"} put back by ${staff.display_name}`, created_by: staff.id });
  revalidatePath(`/parts/${jobId}`);
  return { restored };
}
