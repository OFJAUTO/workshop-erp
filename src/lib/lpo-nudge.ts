import "server-only";
import { createAdminClient } from "./supabase/admin";
import { notifyRoles } from "./notifications";
import { nudgeDue } from "./lpo-nudge-rules";

/*
 * An LPO waiting for approval nudges accounts (13 November 2026, Section 1): parts and work run side by side, so an LPO
 * that waits holds the parts. After 30 minutes waiting, and every 30 minutes after that, accounts get one bell per LPO.
 * The owner gets no bell (his dashboard shows the count). Runs from the notifications check (at most once a minute per
 * server, while anyone has the app open) and from the hourly job.
 */
let lastRun = 0;


export async function lpoApprovalNudges(opts: { now?: number; force?: boolean } = {}): Promise<number> {
  const now = opts.now ?? Date.now();
  if (!opts.force && now - lastRun < 60000) return 0;
  lastRun = now;
  const admin = createAdminClient();
  const { data: pos } = await admin.from("purchase_orders").select("id, number, job_id, created_at, total_cost_aed").eq("status", "pending_approval").eq("is_active", true);
  let n = 0;
  for (const po of (pos ?? []) as { id: string; number: string; job_id: string | null; created_at: string; total_cost_aed: number | string | null }[]) {
    const href = `/parts/orders/${po.id}`;
    const { data: last } = await admin.from("notifications").select("created_at").eq("type", "po_approval").eq("href", href).ilike("title", "LPO waiting%").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!nudgeDue(po.created_at, (last?.created_at as string | undefined) ?? null, now)) continue;
    const mins = Math.round((now - Date.parse(po.created_at)) / 60000);
    const waited = mins >= 120 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`;
    const { data: job } = po.job_id ? await admin.from("jobs").select("job_number").eq("id", po.job_id).maybeSingle() : { data: null };
    await notifyRoles(["accounts"], { type: "po_approval", title: `LPO waiting for approval ${waited} · ${po.number}`, body: `${job?.job_number ? `${job.job_number}: ` : ""}the parts wait for this approval while the work already started. Approve or refuse it.`, jobId: po.job_id, href });
    n++;
  }
  return n;
}
