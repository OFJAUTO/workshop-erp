"use server";
import { dbWords } from "@/lib/app-errors";

import { redirect, unstable_rethrow } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { reconcileDay, reconcileMissingDays } from "@/lib/zoho-reconcile";

const back = (kind: "message" | "error", text: string): never => redirect(`/zoho/reconciliation?${kind}=${encodeURIComponent(text)}`);

/** Re-check one day (after a fix, or on demand). */
export async function recheckDay(day: string, formData: FormData) {
  const staff = await requirePermission("zohoSync");
  if (staff.viewingAs) return back("error", "Viewing only.");
  void formData;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return back("error", "Pick a day.");
  let kind: "message" | "error";
  let words: string;
  try {
    const { status } = await reconcileDay(day);
    kind = "message";
    words = `${day} re-checked: ${status === "green" ? "identical on both sides" : "a difference remains (the row says exactly where)"}.`;
  } catch (e) {
    unstable_rethrow(e);
    kind = "error";
    words = e instanceof Error ? dbWords(e, "zoho/reconciliation/actions") : String(e);
  }
  return back(kind, words);
}

/** Fill every missing day from the first synced document to yesterday (in batches; press again if days remain). */
export async function backfillReconciliation() {
  const staff = await requirePermission("zohoSync");
  if (staff.viewingAs) return back("error", "Viewing only.");
  let kind: "message" | "error";
  let words: string;
  try {
    const r = await reconcileMissingDays(40);
    kind = "message";
    const waiting = r.waitingForSync ? ` ${r.waitingForSync} later day${r.waitingForSync === 1 ? " waits" : "s wait"} until its documents are sent with Sync to Zoho.` : "";
    words = r.done.length
      ? `${r.done.length} day${r.done.length === 1 ? "" : "s"} checked (${r.done[0]} to ${r.done[r.done.length - 1]}).${r.remaining ? ` ${r.remaining} older day${r.remaining === 1 ? "" : "s"} remain: press the button again.` : waiting ? "" : " Every day is covered."}${waiting}`
      : waiting ? waiting.trim() : "Every day is already covered.";
  } catch (e) {
    unstable_rethrow(e);
    kind = "error";
    words = e instanceof Error ? dbWords(e, "zoho/reconciliation/actions") : String(e);
  }
  return back(kind, words);
}
