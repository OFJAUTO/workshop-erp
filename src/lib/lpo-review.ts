import { createAdminClient } from "@/lib/supabase/admin";
import { schemaReady } from "@/lib/schema-ready";
import { notifyStaff } from "@/lib/notifications";
import { workingHoursBetween } from "@/lib/working-time";
import { workingTimeOf } from "@/lib/jobs";
import { lpoApproverIds } from "@/lib/lpo";
import { lpoAmounts } from "@/lib/supplier-vat";
import { formatDateTime } from "@/lib/format";

/**
 * LPO "SEND FOR OWNER APPROVAL" (10 November 2026, Section 4). When accounts are unsure about an LPO (or one supplier
 * of a request) they send it to the owner with a compulsory note. The owner approves, refuses (with a reason) or
 * replies to accounts. An optional accounts approval limit (off by default) sends LPOs above it to the owner by
 * itself ("Above accounts limit"). Server-only table `lpo_owner_reviews`, dormant until the migration is applied.
 */
export type LpoReview = {
  id: string;
  po_id: string;
  supplier: string | null;
  status: "waiting" | "replied" | "decided";
  auto: boolean;
  note: string;
  reply: string | null;
  replied_at: string | null;
  replied_by: string | null;
  decision: "approved" | "refused" | null;
  decision_note: string | null;
  decided_at: string | null;
  decided_by: string | null;
  reminded_at: string | null;
  created_at: string;
  created_by: string | null;
};

export const REVIEW_REMIND_HOURS = 4;
const COLS = "id, po_id, supplier, status, auto, note, reply, replied_at, replied_by, decision, decision_note, decided_at, decided_by, reminded_at, created_at, created_by";

export async function lpoReviewReady(): Promise<boolean> {
  return schemaReady("lpo_owner_reviews", "id, supplier, status, auto");
}

/** The accounts approval limit (AED incl. VAT); 0 = off. */
export function accountsLimitOf(settings: Record<string, unknown>): number {
  const n = Number(settings.lpo_accounts_limit_aed ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const sameSupplier = (a: string | null, b: string | null) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

/** Every review of these LPOs, oldest first. */
export async function loadReviews(poIds: string[]): Promise<LpoReview[]> {
  if (!poIds.length || !(await lpoReviewReady())) return [];
  const { data } = await createAdminClient().from("lpo_owner_reviews").select(COLS).in("po_id", poIds).eq("is_active", true).order("created_at");
  return (data ?? []) as LpoReview[];
}

/** The open (not decided) review of an LPO or of one supplier block: the newest one. */
export function openReviewOf(reviews: LpoReview[], poId: string, supplier: string | null = null): LpoReview | null {
  const mine = reviews.filter((r) => r.po_id === poId && r.status !== "decided" && (supplier === null ? true : r.supplier === null || sameSupplier(r.supplier, supplier)));
  return mine.length ? mine[mine.length - 1] : null;
}

/** Words for the LPO list and Waiting on you. */
export function reviewWords(r: LpoReview): string {
  if (r.status === "replied") return "Owner replied – back with accounts";
  return r.auto ? "Waiting for owner · Above accounts limit" : "Waiting for owner";
}

async function names(ids: (string | null)[]): Promise<Map<string, string>> {
  const list = Array.from(new Set(ids.filter((x): x is string => !!x)));
  if (!list.length) return new Map();
  const { data } = await createAdminClient().from("staff").select("id, display_name").in("id", list);
  return new Map((data ?? []).map((s) => [s.id as string, s.display_name as string]));
}

/** The log lines of an LPO's reviews: "Sent for owner approval by Mathew, 10 Nov 14:02: …" and the answers. */
export async function reviewLog(reviews: LpoReview[]): Promise<{ id: string; lines: string[]; open: boolean; supplier: string | null }[]> {
  const who = await names(reviews.flatMap((r) => [r.created_by, r.replied_by, r.decided_by]));
  const n = (id: string | null) => (id ? who.get(id) ?? "someone" : "someone");
  return reviews.map((r) => {
    const lines = [r.auto ? `Sent to the owner by the accounts limit, ${formatDateTime(r.created_at)}: ${r.note}` : `Sent for owner approval by ${n(r.created_by)}, ${formatDateTime(r.created_at)}: ${r.note}`];
    if (r.reply && r.replied_at) lines.push(`Reply to accounts by ${n(r.replied_by)}, ${formatDateTime(r.replied_at)}: ${r.reply}`);
    if (r.decision && r.decided_at) lines.push(`${r.decision === "approved" ? "Approved" : "Refused"} by ${n(r.decided_by)}, ${formatDateTime(r.decided_at)}${r.decision_note ? `: ${r.decision_note}` : ""}`);
    return { id: r.id, lines, open: r.status !== "decided", supplier: r.supplier };
  });
}

async function ownerIds(): Promise<string[]> {
  const { data } = await createAdminClient().from("staff").select("id").eq("is_active", true).eq("role_id", "owner");
  return (data ?? []).map((s) => s.id as string);
}

type Actor = { id: string; display_name: string };
type PoBrief = { id: string; number: string; job_id: string | null; supplier_name: string };

async function logJob(po: PoBrief, note: string, by: string) {
  if (po.job_id) await createAdminClient().from("job_events").insert({ job_id: po.job_id, event_type: "po_owner_review", note, created_by: by });
}

/** Accounts: "Send for owner approval" with the compulsory note. */
export async function sendForOwner(po: PoBrief, supplier: string | null, note: string, by: Actor, opts: { auto?: boolean } = {}): Promise<{ error?: string; words?: string }> {
  if (!(await lpoReviewReady())) return { error: "Send for owner approval switches on once the database change is applied." };
  const text = note.trim();
  if (!opts.auto && text.length < 3) return { error: "Write what you are unsure about: the owner reads it first." };
  const admin = createAdminClient();
  const existing = openReviewOf(await loadReviews([po.id]), po.id, supplier);
  if (existing?.status === "waiting") return { error: "It is already waiting for the owner." };
  const { data, error } = await admin.from("lpo_owner_reviews").insert({ po_id: po.id, supplier, note: text.slice(0, 1000), auto: !!opts.auto, created_by: opts.auto ? null : by.id, updated_by: opts.auto ? null : by.id }).select("id").single();
  if (error || !data) return { error: "Couldn't send it to the owner – nothing was changed. Try again." };
  if (existing) await admin.from("lpo_owner_reviews").update({ status: "decided", decision_note: "Sent to the owner again", updated_by: by.id }).eq("id", existing.id);
  const what = `${po.number}${supplier ? ` · ${supplier}` : ""}`;
  await logJob(po, opts.auto ? `${what}: sent to the owner by the accounts limit (${text})` : `${what}: sent for owner approval by ${by.display_name}: ${text}`, by.id);
  await notifyStaff(await ownerIds(), { type: "po_owner_review", title: `LPO for you: ${what}`, body: opts.auto ? text : `${by.display_name} asks: ${text}`, jobId: po.job_id, href: `/parts/orders/${po.id}#owner-review` });
  return { words: `Sent to the owner ✓ ${what} waits for him; you get a bell with his answer.` };
}

/** The owner: "Reply to accounts" - the LPO goes back to accounts with his answer. */
export async function replyToAccounts(po: PoBrief, reviewId: string, reply: string, by: Actor): Promise<{ error?: string; words?: string }> {
  const text = reply.trim();
  if (text.length < 2) return { error: "Write your answer to accounts." };
  const admin = createAdminClient();
  const { data: r } = await admin.from("lpo_owner_reviews").select(COLS).eq("id", reviewId).eq("po_id", po.id).maybeSingle();
  if (!r || r.status !== "waiting") return { error: "This question is no longer waiting for you." };
  const at = new Date().toISOString();
  const { error } = await admin.from("lpo_owner_reviews").update({ status: "replied", reply: text.slice(0, 1000), replied_at: at, replied_by: by.id, updated_by: by.id }).eq("id", reviewId).eq("status", "waiting");
  if (error) return { error: "Couldn't save the answer – try again." };
  const what = `${po.number}${r.supplier ? ` · ${r.supplier}` : ""}`;
  await logJob(po, `${what}: ${by.display_name} replied to accounts: ${text}`, by.id);
  const to = r.created_by ? [r.created_by as string] : (await lpoApproverIds()).filter((id) => id !== by.id);
  await notifyStaff(to, { type: "po_owner_review", title: `Owner replied: ${what}`, body: text, jobId: po.job_id, href: `/parts/orders/${po.id}#owner-review` });
  return { words: "Answer sent ✓ The LPO is back with accounts." };
}

/** Approve or refuse closes the open review(s) of that LPO (or supplier) and tells whoever asked. */
export async function closeReviews(po: PoBrief, supplier: string | null, decision: "approved" | "refused", note: string | null, by: Actor): Promise<void> {
  if (!(await lpoReviewReady())) return;
  const admin = createAdminClient();
  const open = (await loadReviews([po.id])).filter((r) => r.status !== "decided" && (supplier === null || r.supplier === null || sameSupplier(r.supplier, supplier)));
  if (!open.length) return;
  const at = new Date().toISOString();
  for (const r of open) {
    await admin.from("lpo_owner_reviews").update({ status: "decided", decision, decision_note: note, decided_at: at, decided_by: by.id, updated_by: by.id }).eq("id", r.id);
  }
  const what = `${po.number}${supplier ? ` · ${supplier}` : ""}`;
  await logJob(po, `${what}: ${decision === "approved" ? "Approved" : "Refused"} by ${by.display_name}${note ? `: ${note}` : ""}`, by.id);
  const askers = Array.from(new Set(open.map((r) => r.created_by).filter((x): x is string => !!x && x !== by.id)));
  if (askers.length) await notifyStaff(askers, { type: "po_owner_review", title: `${decision === "approved" ? "Approved" : "Refused"} by ${by.display_name}: ${what}`, body: note ?? (decision === "approved" ? "Parts have been asked to order." : "The parts are back with Parts."), jobId: po.job_id, href: `/parts/orders/${po.id}` });
}

/**
 * The hourly step: LPOs above the accounts limit go to the owner by themselves (once), and a question waiting
 * 4 working hours gets one reminder to the owner.
 */
export async function lpoReviewHourly(settings: Record<string, unknown>, now = new Date()): Promise<{ autoSent: number; reminded: number }> {
  if (!(await lpoReviewReady())) return { autoSent: 0, reminded: 0 };
  const admin = createAdminClient();
  let autoSent = 0;
  const limit = accountsLimitOf(settings);
  if (limit > 0) {
    const { data: pos } = await admin.from("purchase_orders").select("id, number, kind, status, supplier_id, supplier_name, total_cost_aed, job_id").eq("status", "pending_approval").eq("is_active", true);
    const list = (pos ?? []) as { id: string; number: string; kind: string; status: string; supplier_id: string | null; supplier_name: string; total_cost_aed: number; job_id: string | null }[];
    const reviews = await loadReviews(list.map((p) => p.id));
    const amounts = await lpoAmounts(list.map((p) => ({ ...p, total_cost_aed: Number(p.total_cost_aed) || 0 })));
    for (const p of list) {
      const gross = amounts.get(p.id)?.gross ?? 0;
      if (gross <= limit || reviews.some((r) => r.po_id === p.id)) continue;
      const r = await sendForOwner(p, null, `Above accounts limit: AED ${gross.toFixed(2)} incl. VAT (limit AED ${limit.toFixed(2)}).`, { id: "", display_name: "Accounts limit" }, { auto: true });
      if (!r.error) autoSent++;
    }
  }
  let reminded = 0;
  const { data: waiting } = await admin.from("lpo_owner_reviews").select("id, po_id, supplier, created_at").eq("is_active", true).eq("status", "waiting").is("reminded_at", null);
  const wt = workingTimeOf(settings as Parameters<typeof workingTimeOf>[0]);
  const late = (waiting ?? []).filter((r) => workingHoursBetween(r.created_at as string, now, wt) >= REVIEW_REMIND_HOURS);
  if (late.length) {
    const { data: pos } = await admin.from("purchase_orders").select("id, number, job_id").in("id", late.map((r) => r.po_id as string));
    const owners = await ownerIds();
    for (const r of late) {
      const po = (pos ?? []).find((p) => p.id === r.po_id);
      if (!po) continue;
      const { data: marked } = await admin.from("lpo_owner_reviews").update({ reminded_at: now.toISOString() }).eq("id", r.id).is("reminded_at", null).select("id");
      if (!marked?.length) continue;
      await notifyStaff(owners, { type: "po_owner_review", title: `Reminder: ${po.number}${r.supplier ? ` · ${r.supplier}` : ""} still waiting for you`, body: `Accounts sent it ${REVIEW_REMIND_HOURS} working hours ago.`, jobId: po.job_id as string | null, href: `/parts/orders/${po.id}#owner-review` });
      reminded++;
    }
  }
  return { autoSent, reminded };
}
