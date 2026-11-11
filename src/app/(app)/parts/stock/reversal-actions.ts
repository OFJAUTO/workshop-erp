"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { archiveStockItem, askReversal, decideReversal } from "@/lib/stock-reversals";

/** STOCK: REVERSE A MISTAKEN ENTRY (10 November 2026, Section 8). The answer shows at the reversals card. */
const back = (kind: "message" | "error", words: string): never => redirect(`/parts/stock?${kind}=${encodeURIComponent(words)}#reversals`);

/** Parts (and the owner): ask to reverse a stock entry, or to move it to the job it was bought for. */
export async function askReversalAction(movementId: string, formData: FormData) {
  const staff = await requirePermission("manageStock");
  if (staff.viewingAs) return back("error", "View as is read-only.");
  const kind = String(formData.get("kind") ?? "reverse") === "move_to_job" ? "move_to_job" : "reverse";
  const r = await askReversal(movementId, { kind, reason: String(formData.get("reason") ?? ""), jobId: String(formData.get("job_id") ?? "") || null }, staff);
  revalidatePath("/parts/stock");
  return r.error ? back("error", r.error) : back("message", r.words ?? "Sent to the owner ✓");
}

/** The owner approves or refuses. */
export async function decideReversalAction(id: string, formData: FormData) {
  const staff = await requirePermission("manageStock");
  if (staff.role_id !== "owner" || staff.viewingAs) return back("error", "Only the owner approves a stock reversal.");
  const decision = String(formData.get("decision") ?? "") === "refuse" ? "refuse" : "approve";
  const r = await decideReversal(id, decision, String(formData.get("note") ?? "").trim() || null, staff);
  revalidatePath("/parts/stock");
  return r.error ? back("error", r.error) : back("message", r.words ?? "Done ✓");
}

/** An item with no stock left: archive it (hidden, never deleted). */
export async function archiveStockItemAction(itemId: string) {
  const staff = await requirePermission("manageStock");
  if (staff.viewingAs) return back("error", "View as is read-only.");
  const r = await archiveStockItem(itemId, staff);
  revalidatePath("/parts/stock");
  redirect(`/parts/stock?${r.error ? `error=${encodeURIComponent(r.error)}` : `message=${encodeURIComponent("Archived ✓ The item is hidden from the lists; its history stays.")}`}`);
}
