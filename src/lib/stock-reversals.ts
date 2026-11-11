import { createAdminClient } from "@/lib/supabase/admin";
import { schemaReady } from "@/lib/schema-ready";
import { notifyStaff } from "@/lib/notifications";
import { recordStockMovement, type StockActor } from "@/lib/stock";
import { round2 } from "@/lib/money";

/**
 * STOCK: REVERSE A MISTAKEN ENTRY (10 November 2026, Section 8). Parts ask, with a compulsory reason, to reverse a
 * stock movement that came in by mistake (an "Opening stock +5"), or to move it to the job it was bought for so the
 * cost lands on the car. The owner approves (bell). Approved: the opposite movement "−5 → 0 · reversed: <reason> ·
 * approved by Omar" (quantity and value corrected), or the issue to the job; the history stays, nothing is deleted.
 * Blocked when some of it was already issued (the jobs are named). An item with no stock can be archived.
 */
export type Reversal = { id: string; movement_id: string; stock_item_id: string; kind: "reverse" | "move_to_job"; job_id: string | null; quantity: number; reason: string; status: "pending" | "approved" | "refused"; decision_note: string | null; decided_at: string | null; created_at: string; created_by: string | null };
const COLS = "id, movement_id, stock_item_id, kind, job_id, quantity, reason, status, decision_note, decided_at, created_at, created_by";

export async function reversalsReady(): Promise<boolean> {
  return schemaReady("stock_reversals", "id, movement_id, kind, status");
}

/** The movements that can be reversed: stock that came IN (opening stock, a delivery, a return to the shelf, a count up). */
export const reversible = (m: { kind: string; quantity: number | string }) => ["in", "return", "count", "adjust"].includes(m.kind) && Number(m.quantity) > 0;

export async function loadReversals(): Promise<Reversal[]> {
  if (!(await reversalsReady())) return [];
  const { data } = await createAdminClient().from("stock_reversals").select(COLS).eq("is_active", true).order("created_at", { ascending: false }).limit(100);
  return ((data ?? []) as Reversal[]).map((r) => ({ ...r, quantity: Number(r.quantity) }));
}

/** What was issued from this item since the entry: the jobs it went to. Reversing more than is still on the shelf is refused. */
export async function issuedSince(movementId: string): Promise<{ blocked: boolean; onShelf: number; quantity: number; jobs: string[] }> {
  const admin = createAdminClient();
  const { data: m } = await admin.from("stock_movements").select("id, stock_item_id, quantity, created_at").eq("id", movementId).maybeSingle();
  if (!m) return { blocked: true, onShelf: 0, quantity: 0, jobs: [] };
  const { data: item } = await admin.from("stock_items").select("quantity").eq("id", m.stock_item_id).maybeSingle();
  const { data: outs } = await admin.from("stock_movements").select("job_id, quantity").eq("stock_item_id", m.stock_item_id).eq("kind", "out").eq("is_active", true).gt("created_at", m.created_at);
  const jobIds = Array.from(new Set((outs ?? []).map((o) => o.job_id as string | null).filter((x): x is string => !!x)));
  const { data: jobs } = jobIds.length ? await admin.from("jobs").select("id, job_number").in("id", jobIds) : { data: [] };
  const onShelf = Number(item?.quantity) || 0;
  const quantity = Number(m.quantity) || 0;
  return { blocked: onShelf + 0.0005 < quantity, onShelf, quantity, jobs: (jobs ?? []).map((j) => j.job_number as string) };
}

async function ownerIds(): Promise<string[]> {
  const { data } = await createAdminClient().from("staff").select("id").eq("is_active", true).eq("role_id", "owner");
  return (data ?? []).map((s) => s.id as string);
}

/** Parts: "Reverse this entry" or "Move to a job instead", with the reason. The owner is asked (bell). */
export async function askReversal(movementId: string, input: { kind: "reverse" | "move_to_job"; reason: string; jobId?: string | null }, by: { id: string; display_name: string }): Promise<{ error?: string; words?: string }> {
  if (!(await reversalsReady())) return { error: "Reversing a stock entry switches on once the database change is applied." };
  const reason = input.reason.trim();
  if (reason.length < 5) return { error: "Write why the entry is wrong (at least 5 characters)." };
  const admin = createAdminClient();
  const { data: m } = await admin.from("stock_movements").select("id, stock_item_id, kind, quantity, note, created_at").eq("id", movementId).eq("is_active", true).maybeSingle();
  if (!m || !reversible({ kind: m.kind as string, quantity: m.quantity as number })) return { error: "Only stock that came in can be reversed." };
  const { data: open } = await admin.from("stock_reversals").select("id, status").eq("movement_id", movementId).eq("is_active", true).in("status", ["pending", "approved"]);
  if ((open ?? []).some((r) => r.status === "approved")) return { error: "This entry was already reversed." };
  if ((open ?? []).length) return { error: "This entry is already waiting for the owner." };
  if (input.kind === "move_to_job" && !input.jobId) return { error: "Pick the job it was bought for." };
  const used = await issuedSince(movementId);
  if (used.blocked) return { error: `Some of it was already issued (${used.jobs.join(", ") || "to jobs"}): only ${used.onShelf} left on the shelf of the ${used.quantity} entered. Correct those jobs first.` };
  const { data: item } = await admin.from("stock_items").select("name").eq("id", m.stock_item_id).maybeSingle();
  const { error } = await admin.from("stock_reversals").insert({ movement_id: movementId, stock_item_id: m.stock_item_id, kind: input.kind, job_id: input.kind === "move_to_job" ? input.jobId : null, quantity: Number(m.quantity), reason: reason.slice(0, 500), created_by: by.id, updated_by: by.id });
  if (error) return { error: "Couldn't send it to the owner – nothing was changed. Try again." };
  const what = `${item?.name ?? "Stock"} +${Number(m.quantity)}`;
  await notifyStaff(await ownerIds(), { type: "stock_reversal", title: `${input.kind === "reverse" ? "Reverse a stock entry" : "Move stock to a job"}: ${what}`, body: `${by.display_name}: ${reason}`, href: "/parts/stock#reversals" });
  return { words: `Sent to the owner ✓ ${what} is reversed once he approves.` };
}

/** The owner approves or refuses. Approved: the opposite movement (quantity and value corrected) or the issue to the job. */
export async function decideReversal(id: string, decision: "approve" | "refuse", note: string | null, by: { id: string; display_name: string }): Promise<{ error?: string; words?: string }> {
  const admin = createAdminClient();
  const { data: r } = await admin.from("stock_reversals").select(COLS).eq("id", id).eq("is_active", true).maybeSingle();
  if (!r || r.status !== "pending") return { error: "This request is no longer waiting." };
  const at = new Date().toISOString();
  const tell = async (title: string) => { if (r.created_by && r.created_by !== by.id) await notifyStaff([r.created_by as string], { type: "stock_reversal", title, body: note ?? null, href: "/parts/stock#reversals" }); };
  const { data: item } = await admin.from("stock_items").select("id, name, quantity, unit_cost").eq("id", r.stock_item_id).maybeSingle();
  const { data: mv } = await admin.from("stock_movements").select("id, unit_cost, quantity").eq("id", r.movement_id).maybeSingle();
  if (!item || !mv) return { error: "The stock entry is gone." };
  if (decision === "refuse") {
    const { error } = await admin.from("stock_reversals").update({ status: "refused", decision_note: note, decided_at: at, decided_by: by.id, updated_by: by.id }).eq("id", id).eq("status", "pending");
    if (error) return { error: "Couldn't save – try again." };
    await tell(`Not reversed: ${item.name} +${Number(r.quantity)}`);
    return { words: "Refused ✓ The entry stays." };
  }
  const used = await issuedSince(r.movement_id as string);
  if (used.blocked) return { error: `Some of it was already issued since (${used.jobs.join(", ") || "to jobs"}): only ${used.onShelf} left. Nothing was changed.` };
  // Claim it first, so a second tap never writes two movements.
  const { data: claimed } = await admin.from("stock_reversals").update({ status: "approved", decision_note: note, decided_at: at, decided_by: by.id, updated_by: by.id }).eq("id", id).eq("status", "pending").select("id");
  if (!claimed?.length) return { error: "Already decided." };
  const qty = Number(r.quantity);
  const actor: StockActor = { id: by.id, display_name: by.display_name };
  let moveId: string | null = null;
  if (r.kind === "move_to_job" && r.job_id) {
    const { data: job } = await admin.from("jobs").select("id, job_number").eq("id", r.job_id).maybeSingle();
    await admin.from("stock_issues").insert({ stock_item_id: item.id, job_id: r.job_id, quantity: qty, unit_cost: Number(mv.unit_cost ?? item.unit_cost) || 0, issued_by: by.id, confirmed_by: by.id, confirmed_at: at, created_by: by.id, updated_by: by.id });
    const res = await recordStockMovement(item.id as string, { kind: "out", quantity: qty, jobId: r.job_id as string, note: `moved to ${job?.job_number ?? "the job"}: ${r.reason} · approved by ${by.display_name}` }, actor);
    if (res.error) {
      await admin.from("stock_reversals").update({ status: "pending", decided_at: null, decided_by: null, updated_by: by.id }).eq("id", id);
      return { error: res.error };
    }
    await admin.from("job_events").insert({ job_id: r.job_id, event_type: "stock_issued", note: `${qty} × ${item.name} moved from stock to this car (${r.reason}), approved by ${by.display_name}`, created_by: by.id });
  } else {
    // The opposite movement; the value comes off at the entry's own cost (the average is corrected).
    const before = Number(item.quantity) || 0;
    const cost = Number(mv.unit_cost ?? item.unit_cost) || 0;
    const res = await recordStockMovement(item.id as string, { kind: "adjust", quantity: -qty, note: `reversed: ${r.reason} · approved by ${by.display_name}` }, actor);
    if (res.error) {
      await admin.from("stock_reversals").update({ status: "pending", decided_at: null, decided_by: null, updated_by: by.id }).eq("id", id);
      return { error: res.error };
    }
    const left = round2(before - qty);
    const avg = left > 0.0005 ? round2(Math.max(0, (before * (Number(item.unit_cost) || 0) - qty * cost) / left)) : Number(item.unit_cost) || 0;
    await admin.from("stock_items").update({ unit_cost: avg, updated_by: by.id }).eq("id", item.id);
  }
  const { data: last } = await admin.from("stock_movements").select("id").eq("stock_item_id", item.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  moveId = (last?.id as string | undefined) ?? null;
  if (moveId) await admin.from("stock_reversals").update({ result_movement_id: moveId }).eq("id", id);
  await tell(`${r.kind === "move_to_job" ? "Moved to the job" : "Reversed"}: ${item.name} ${r.kind === "move_to_job" ? "" : "−"}${qty}`);
  return { words: r.kind === "move_to_job" ? `Approved ✓ ${qty} × ${item.name} moved to the job; its cost is on the car.` : `Approved ✓ ${item.name} −${qty}: reversed.` };
}

/** An item with no stock left can be archived: hidden from the lists, never deleted. */
export async function archiveStockItem(itemId: string, by: { id: string }): Promise<{ error?: string }> {
  const admin = createAdminClient();
  const { data: item } = await admin.from("stock_items").select("id, quantity").eq("id", itemId).maybeSingle();
  if (!item) return { error: "Item not found." };
  if (Math.abs(Number(item.quantity) || 0) > 0.0005) return { error: "Only an item with no stock left can be archived." };
  const ready = await schemaReady("stock_items", "archived_at");
  const { error } = await admin.from("stock_items").update({ is_active: false, ...(ready ? { archived_at: new Date().toISOString(), archived_by: by.id } : {}), updated_by: by.id }).eq("id", itemId);
  return error ? { error: "Couldn't archive it – try again." } : {};
}
