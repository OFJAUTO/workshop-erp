import "server-only";
import { dbWords, logAppError } from "./app-errors";
import { createAdminClient } from "./supabase/admin";
import { jobAdvisorIds, notifyRoles, notifyStaff } from "./notifications";
import { formatDateTime } from "./format";
import { schemaReady } from "./schema-ready";
import { absorbOf, changeLine, changeProblem, needsOwner, profitOf, type PartFacts, type PriceChoice } from "./part-change-rules";

/*
 * 13 November 2026, Section 3: THE change of a part's supplier, cost, delivery time or part number, IN PLACE.
 * The part keeps its row (its quotation line, its job, the technician's request); the history keeps old > new.
 *   - Not ordered yet: the part changes; on a quotation still being prepared its line follows.
 *   - On an LPO waiting for approval: the part and that line change.
 *   - On an approved LPO, not received: that line is cancelled with the old supplier (the reason in its notes, Parts
 *     told to cancel it) and the part goes on the new supplier's LPO in the same step.
 *   - Received: never from here (a purchase return only).
 *   - Cost up or another part type: waits for the owner (Approvals); his own change applies at once.
 *   - The customer's approved price never changes here: keep it (we absorb the difference) or revise the quotation.
 */

export type ChangeActor = { id: string; display_name: string; role_id: string };
export type ChangeInput = { supplier: string; cost: number; days: number | null; inStock: boolean; partNumber: string | null; partType: string | null; reason: string; choice: PriceChoice | null };
export type ChangeAnswer = { error?: string; ok?: boolean; pending?: boolean; words?: string };

export async function partChangesReady(): Promise<boolean> {
  return schemaReady("part_changes", "id, status, before, after");
}

const COLS = "id, job_id, description, supplier, cost_aed, availability, delivery_date, part_number, part_type, quantity, confirmed_quantity, received_qty, order_status, po_id, po_line_id, is_active, removed_at, issue_status";
type Part = { id: string; job_id: string; description: string; supplier: string | null; cost_aed: number | string | null; availability: string | null; delivery_date: string | null; part_number: string | null; part_type: string | null; quantity: number | string; confirmed_quantity: number | string | null; received_qty: number | string | null; order_status: string; po_id: string | null; po_line_id: string | null; is_active: boolean; removed_at: string | null; issue_status: string | null };

const dubaiToday = () => new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => new Date(new Date(`${iso}T12:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
function daysOf(p: Part): number | null {
  if (p.availability === "in_stock") return null;
  if (!p.delivery_date) return null;
  return Math.max(0, Math.round((new Date(`${p.delivery_date}T12:00:00Z`).getTime() - new Date(`${dubaiToday()}T12:00:00Z`).getTime()) / 86400000));
}
export function factsOfPart(p: Part): PartFacts {
  return { supplier: p.supplier, cost: p.cost_aed === null ? null : Number(p.cost_aed), days: daysOf(p), availability: p.availability, partNumber: p.part_number, partType: p.part_type, quantity: Number(p.confirmed_quantity ?? p.quantity) || 1 };
}

/** The part's line on an approved quotation (the customer's price), and its selling price per unit. */
async function customerLineOf(jobId: string, partId: string): Promise<{ quotationId: string; number: string; version: number; status: string; sellEach: number } | null> {
  const admin = createAdminClient();
  const { data: lines } = await admin.from("quotation_lines").select("quotation_id, quantity, line_total, unit_price").eq("part_item_id", partId).eq("is_active", true);
  const ls = (lines ?? []) as { quotation_id: string; quantity: number | string; line_total: number | string | null; unit_price: number | string | null }[];
  if (!ls.length) return null;
  const { data: qs } = await admin.from("quotations").select("id, number, version, status").in("id", ls.map((l) => l.quotation_id)).eq("job_id", jobId).eq("is_active", true).order("version", { ascending: false });
  const rows = (qs ?? []) as { id: string; number: string; version: number; status: string }[];
  const q = rows.find((x) => ["approved", "urgent_requested"].includes(x.status)) ?? rows.find((x) => x.status !== "superseded") ?? null;
  if (!q) return null;
  const l = ls.find((x) => x.quotation_id === q.id)!;
  const qty = Number(l.quantity) || 1;
  const sellEach = l.line_total !== null && l.line_total !== undefined ? Number(l.line_total) / qty : Number(l.unit_price ?? 0);
  return { quotationId: q.id, number: q.number, version: q.version, status: q.status, sellEach: Math.round(sellEach * 100) / 100 };
}

/** What the window shows before saving: the customer's price each, the profit now and after, what we would absorb. */
export async function changePreview(jobId: string, partId: string): Promise<{ sellEach: number | null; approved: boolean; quote: string | null; before: PartFacts } | null> {
  const { data } = await createAdminClient().from("part_items").select(COLS).eq("id", partId).eq("job_id", jobId).maybeSingle();
  if (!data) return null;
  const line = await customerLineOf(jobId, partId);
  return { sellEach: line?.sellEach ?? null, approved: !!line && ["approved", "urgent_requested"].includes(line.status), quote: line ? `${line.number} v${line.version}` : null, before: factsOfPart(data as Part) };
}

function afterFacts(p: Part, input: ChangeInput): PartFacts {
  return { supplier: input.supplier.trim(), cost: Math.round(Number(input.cost) * 100) / 100, days: input.inStock ? null : input.days, availability: input.inStock ? "in_stock" : "to_order", partNumber: (input.partNumber ?? "").trim() || null, partType: (input.partType ?? "").trim() || null, quantity: Number(p.confirmed_quantity ?? p.quantity) || 1 };
}

/** THE entry point: the parts desk or the owner asks for the change. */
export async function requestPartChange(jobId: string, partId: string, input: ChangeInput, by: ChangeActor): Promise<ChangeAnswer> {
  if (!(await partChangesReady())) return { error: "Changing a part in place needs the database update first (waiting for apply)." };
  if (!["owner", "parts"].includes(by.role_id)) return { error: "Only the parts desk or the owner can change a part's supplier or price." };
  const admin = createAdminClient();
  const { data } = await admin.from("part_items").select(COLS).eq("id", partId).eq("job_id", jobId).maybeSingle();
  const p = data as Part | null;
  if (!p || !p.is_active || p.removed_at) return { error: "That part is no longer on the job." };
  if (Number(p.received_qty) > 0 || ["received", "partly_received"].includes(p.order_status) || p.issue_status === "confirmed") {
    return { error: `${p.description.toUpperCase()} is already received: it can only go back as a purchase return (⋯ → Remove: not needed → Return to supplier).` };
  }
  const { data: pending } = await admin.from("part_changes").select("id").eq("part_item_id", partId).eq("status", "pending").eq("is_active", true).limit(1);
  if (pending?.length) return { error: "A change of this part is already waiting for the owner." };
  const before = factsOfPart(p);
  const after = afterFacts(p, input);
  const line = await customerLineOf(jobId, partId);
  const approved = !!line && ["approved", "urgent_requested"].includes(line.status);
  const problem = changeProblem(before, after, input.reason, input.choice, approved);
  if (problem) return { error: problem };
  const owner = needsOwner(before, after);
  const now = new Date();
  const words = changeLine(p.description, before, after, by.display_name, formatDateTime(now.toISOString()), input.reason);
  const choice = approved && owner ? input.choice : null;
  const absorb = choice === "keep" ? absorbOf(before, after) : null;
  const row = { job_id: jobId, part_item_id: partId, before, after, reason: input.reason.trim(), price_choice: choice, absorb_aed: absorb, words, created_by: by.id, updated_by: by.id };
  // Cost up or another type: the owner decides first (his own change applies at once).
  if (owner && by.role_id !== "owner") {
    const { error } = await admin.from("part_changes").insert({ ...row, status: "pending" });
    if (error) return { error: dbWords(error, "lib/part-change") };
    const { data: job } = await admin.from("jobs").select("job_number").eq("id", jobId).maybeSingle();
    await admin.from("job_events").insert({ job_id: jobId, event_type: "part_change_asked", note: `Waiting for the owner: ${words}`, created_by: by.id });
    await notifyRoles(["owner"], { type: "part_change", title: `Part change to approve · ${job?.job_number ?? ""}`, body: `${words}${choice === "keep" ? ` · keep the customer's price: we absorb AED ${absorb?.toFixed(2)}` : choice === "revise" ? " · revise the quotation" : ""}`, href: "/approvals", jobId });
    return { ok: true, pending: true, words: `Sent to the owner: ${words}` };
  }
  const { data: made, error } = await admin.from("part_changes").insert({ ...row, status: "applied", decided_by: by.id, decided_at: now.toISOString() }).select("id").maybeSingle();
  if (error || !made) return { error: error ? dbWords(error, "lib/part-change") : "Couldn't save the change." };
  return applyChange(String(made.id), by);
}

/** The owner's decision on a waiting change (Approvals). */
export async function decidePartChange(changeId: string, approve: boolean, note: string, by: ChangeActor): Promise<ChangeAnswer> {
  if (by.role_id !== "owner") return { error: "Only the owner decides a part change." };
  const admin = createAdminClient();
  const { data: c } = await admin.from("part_changes").select("id, job_id, words, status, created_by").eq("id", changeId).maybeSingle();
  if (!c || c.status !== "pending") return { error: "That change is no longer waiting." };
  const now = new Date().toISOString();
  if (!approve) {
    const { data: done } = await admin.from("part_changes").update({ status: "refused", decided_by: by.id, decided_at: now, decision_note: note.trim() || null, updated_by: by.id }).eq("id", changeId).eq("status", "pending").select("id");
    if (!done?.length) return { error: "That change is no longer waiting." };
    await admin.from("job_events").insert({ job_id: c.job_id, event_type: "part_change_refused", note: `Refused by ${by.display_name}${note.trim() ? ` (${note.trim()})` : ""}: ${c.words}`, created_by: by.id });
    if (c.created_by) await notifyStaff([String(c.created_by)], { type: "part_change", title: "Part change refused", body: `${c.words}${note.trim() ? ` · ${note.trim()}` : ""}`, href: `/parts/${c.job_id}`, jobId: c.job_id as string });
    return { ok: true, words: "Refused. The part stays as it was." };
  }
  const { data: claimed } = await admin.from("part_changes").update({ status: "applied", decided_by: by.id, decided_at: now, decision_note: note.trim() || null, updated_by: by.id }).eq("id", changeId).eq("status", "pending").select("id");
  if (!claimed?.length) return { error: "That change is no longer waiting." };
  const r = await applyChange(changeId, by);
  if (c.created_by && r.ok) await notifyStaff([String(c.created_by)], { type: "part_change", title: "Part change approved", body: String(c.words), href: `/parts/${c.job_id}`, jobId: c.job_id as string });
  return r;
}

/** Applies a change already stored (status applied): the part in place, its LPO line, the quotation and the proforma. */
async function applyChange(changeId: string, by: ChangeActor): Promise<ChangeAnswer> {
  const admin = createAdminClient();
  const { data: c } = await admin.from("part_changes").select("id, job_id, part_item_id, before, after, reason, price_choice, absorb_aed, words").eq("id", changeId).maybeSingle();
  if (!c) return { error: "Couldn't find the change." };
  const jobId = String(c.job_id);
  const after = c.after as PartFacts;
  const before = c.before as PartFacts;
  const { data: raw } = await admin.from("part_items").select(COLS).eq("id", c.part_item_id).maybeSingle();
  const p = raw as Part | null;
  if (!p || !p.is_active) return { error: "That part is no longer on the job." };
  const extra: string[] = [];
  const patch: Record<string, unknown> = {
    supplier: after.supplier,
    cost_aed: after.cost,
    part_number: after.partNumber,
    part_type: after.partType,
    availability: after.availability === "in_stock" ? "in_stock" : "to_order",
    delivery_date: after.availability === "in_stock" || after.days === null ? null : addDays(dubaiToday(), after.days),
    updated_by: by.id,
  };
  // On an LPO: waiting for approval = the line follows; approved and not received = cancel with the old supplier, then
  // the part goes on the new supplier's LPO.
  let moveToNewLpo = false;
  if (p.po_id && p.po_line_id) {
    const { data: po } = await admin.from("purchase_orders").select("id, number, status, kind, notes, supplier_name").eq("id", p.po_id).maybeSingle();
    const supplierChanged = (before.supplier ?? "").trim().toLowerCase() !== (after.supplier ?? "").trim().toLowerCase();
    if (po && !(po.status === "pending_approval" && po.kind === "main") && (supplierChanged || Math.abs((before.cost ?? 0) - (after.cost ?? 0)) > 0.004)) {
      await admin.from("purchase_order_lines").update({ is_active: false, updated_by: by.id }).eq("id", p.po_line_id);
      const note = `Cancelled: ${p.description.toUpperCase()} – ${supplierChanged ? `moved to ${after.supplier}` : `new price ${after.cost?.toFixed(2)}`}: ${c.reason}`;
      await admin.from("purchase_orders").update({ notes: [String(po.notes ?? "").trim(), note].filter(Boolean).join("\n"), updated_by: by.id }).eq("id", po.id);
      const { retotalPo } = await import("./lpo");
      const t = await retotalPo(po.id as string, by.id);
      if (!t.lines) {
        await admin.from("purchase_orders").update({ status: "cancelled", updated_by: by.id }).eq("id", po.id);
        const { releaseCharges } = await import("./supplier-charges");
        await releaseCharges(po.id as string, by.id);
      }
      patch.po_id = null;
      patch.po_line_id = null;
      patch.order_status = "to_order";
      moveToNewLpo = true;
      extra.push(`${po.number}: the line was cancelled${po.status === "ordered" || p.order_status === "ordered" ? ` – tell ${po.supplier_name ?? before.supplier} to cancel it` : ""}.`);
      await notifyRoles(["parts"], { type: "part_change", title: `Cancel with ${po.supplier_name ?? before.supplier ?? "the supplier"}: ${p.description.toUpperCase()}`, body: `${po.number}: ${note}`, href: `/parts/orders/${po.id}`, jobId });
    }
  }
  const { error } = await admin.from("part_items").update(patch).eq("id", p.id).eq("is_active", true);
  if (error) {
    await logAppError("part-change: apply", error, { staffId: by.id, jobId });
    return { error: dbWords(error, "lib/part-change") };
  }
  await admin.from("job_events").insert({ job_id: jobId, event_type: "part_changed", from_stage: `part:${p.id}`, note: String(c.words), created_by: by.id });
  try {
    if (moveToNewLpo) {
      // On the LPO waiting for approval when there is one, else its own new LPO for the new supplier (one step).
      const { addPartsToOpenLpo, createMainLpo } = await import("./lpo");
      const actor = { id: by.id, display_name: by.display_name };
      const r = await addPartsToOpenLpo(jobId, actor, { partIds: [p.id] });
      const made = r.added ? null : await createMainLpo(jobId, actor, { partIds: [p.id], note: `Moved to ${after.supplier}: ${c.words}` });
      extra.push(r.added ? `It is on ${r.number ?? "the LPO"} for ${after.supplier}, waiting for approval.` : made?.number ? `It is on ${made.number} for ${after.supplier}, waiting for approval.` : `Send it on an LPO to ${after.supplier}${made?.error ? ` (${made.error})` : ""}.`);
    } else if (p.po_id) {
      const { refreshPendingLpoLine } = await import("./lpo");
      await refreshPendingLpoLine(p.id, { id: by.id, display_name: by.display_name });
    }
  } catch (e) {
    await logAppError("part-change: lpo", e, { staffId: by.id, jobId });
  }
  // The quotation: before the customer's approval its line follows; after it, the customer's price is kept or revised.
  try {
    const line = await customerLineOf(jobId, p.id);
    const approved = !!line && ["approved", "urgent_requested"].includes(line.status);
    if (!approved) {
      const { syncPartLine } = await import("./quote-versions");
      await syncPartLine(jobId, p.id, by.id);
    } else if (c.price_choice === "revise" && line) {
      const { askOwnerForRevision } = await import("./quote-versions");
      const { data: q } = await admin.from("quotations").select("id, number, job_id, revision_requested_at, revision_status").eq("id", line.quotationId).maybeSingle();
      if (q) await askOwnerForRevision({ id: q.id as string, number: q.number as string, job_id: jobId, pending: !!q.revision_requested_at && q.revision_status === "pending" }, by.id, by.display_name, `Part changed: ${c.words}`, "parts", { partIds: [p.id] });
      extra.push(`${line.number}: the owner is asked to allow a revision.`);
      await notifyStaff(await jobAdvisorIds(jobId), { type: "part_change", title: `Revise ${line.number}: a part changed`, body: String(c.words), href: `/jobs/${jobId}`, jobId });
    } else if (c.price_choice === "keep") {
      extra.push(`The customer's price stays${Number(c.absorb_aed) > 0 ? `: we absorb AED ${Number(c.absorb_aed).toFixed(2)}` : ""}.`);
    }
  } catch (e) {
    await logAppError("part-change: quotation", e, { staffId: by.id, jobId });
  }
  // A live proforma's internal cost of the part follows (job profit right at once; the customer's price untouched).
  try {
    const { data: pro } = await admin.from("invoices").select("id").eq("job_id", jobId).eq("kind", "proforma").eq("status", "issued").eq("is_active", true).is("converted_to", null);
    const ids = ((pro ?? []) as { id: string }[]).map((x) => x.id);
    if (ids.length && after.cost !== null) await admin.from("invoice_lines").update({ cost_aed: Math.round(after.cost * after.quantity * 100) / 100, updated_by: by.id }).in("invoice_id", ids).eq("part_item_id", p.id).eq("is_active", true);
  } catch (e) {
    await logAppError("part-change: proforma", e, { staffId: by.id, jobId });
  }
  return { ok: true, words: [`Changed: ${c.words}`, ...extra].join(" ") };
}

/** The history of every part on a job: newest first, with the change still waiting for the owner. */
export async function partChangeHistory(jobId: string): Promise<Map<string, { words: string; status: string; at: string }[]>> {
  const out = new Map<string, { words: string; status: string; at: string }[]>();
  if (!(await partChangesReady())) return out;
  const { data } = await createAdminClient().from("part_changes").select("part_item_id, words, status, created_at").eq("job_id", jobId).eq("is_active", true).order("created_at", { ascending: false });
  for (const r of (data ?? []) as { part_item_id: string; words: string; status: string; created_at: string }[]) {
    if (!out.has(r.part_item_id)) out.set(r.part_item_id, []);
    out.get(r.part_item_id)!.push({ words: r.words, status: r.status, at: r.created_at });
  }
  return out;
}

/** Profit of the line now and after, for the window (pure figures from the stored facts). */
export function previewProfits(sellEach: number | null, before: PartFacts, after: PartFacts) {
  return { now: profitOf(sellEach, before), after: profitOf(sellEach, after), absorb: absorbOf(before, after) };
}

/* ---- The repair: "This replaces…" (a part removed and added again, before this window existed) ---- */

/** Removed parts of the job this new part can replace: removed or not needed, on an approved quotation, no replacement yet. */
export async function replaceTargets(jobId: string, partId: string): Promise<{ id: string; words: string }[]> {
  const admin = createAdminClient();
  const { approvedPartIds } = await import("./parts-changes-data");
  const approved = (await approvedPartIds([jobId])).get(jobId) ?? new Set<string>();
  // An empty id is never sent to a uuid column (it fails the whole read).
  const base = admin.from("part_items").select("id, description, supplier, cost_aed, removed_at, not_needed_at, is_active, replacement_part_id, quantity, confirmed_quantity").eq("job_id", jobId);
  const { data } = await (partId ? base.neq("id", partId) : base);
  const rows = (data ?? []) as { id: string; description: string; supplier: string | null; cost_aed: number | null; removed_at: string | null; not_needed_at: string | null; is_active: boolean; replacement_part_id: string | null; quantity: number; confirmed_quantity: number | null }[];
  return rows
    .filter((r) => (r.removed_at || r.not_needed_at || r.is_active === false) && !r.replacement_part_id && approved.has(r.id))
    .map((r) => ({ id: r.id, words: `${r.description.toUpperCase()} × ${Number(r.confirmed_quantity ?? r.quantity) || 1}${r.supplier ? ` · ${r.supplier}` : ""}${r.cost_aed !== null ? ` · AED ${Number(r.cost_aed).toFixed(2)}` : ""}` }));
}

/** Links the new part to the removed one it replaced: it inherits the quotation line and the customer's approval. */
export async function linkReplacement(jobId: string, newId: string, oldId: string, by: ChangeActor): Promise<ChangeAnswer> {
  if (!["owner", "parts"].includes(by.role_id)) return { error: "Only the parts desk or the owner can link a replacement." };
  const admin = createAdminClient();
  const targets = await replaceTargets(jobId, newId);
  const target = targets.find((t) => t.id === oldId);
  if (!target) return { error: "That removed part cannot be linked (it is not on the approved quotation, or it already has a replacement)." };
  const { data: n } = await admin.from("part_items").select("id, description, replaced_part_id, order_status, cost_aed, is_active").eq("id", newId).eq("job_id", jobId).maybeSingle();
  if (!n || !n.is_active) return { error: "That part is no longer on the job." };
  if (n.replaced_part_id) return { error: "This part already replaces another one." };
  const priced = n.cost_aed !== null && Number(n.cost_aed) > 0;
  const { error } = await admin.from("part_items").update({ replaced_part_id: oldId, ...(priced && n.order_status === "none" ? { order_status: "to_order" } : {}), updated_by: by.id }).eq("id", newId);
  if (error) return { error: dbWords(error, "lib/part-change") };
  await admin.from("part_items").update({ replacement_part_id: newId, updated_by: by.id }).eq("id", oldId);
  const words = `${String(n.description).toUpperCase()} replaces ${target.words} (linked by ${by.display_name}): it keeps the customer's approval.`;
  await admin.from("job_events").insert({ job_id: jobId, event_type: "part_relinked", note: words, created_by: by.id });
  return { ok: true, words: priced ? `${words} It is approved – to order.` : words };
}
