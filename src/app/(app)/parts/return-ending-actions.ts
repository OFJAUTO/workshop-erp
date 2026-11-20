"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { confirmReturnAdvance, correctReturnEnding, setReturnEnding } from "@/lib/return-endings";
import { RETURN_ENDING_KEYS, type ReturnEndingKey } from "@/lib/return-ending-rules";

export type EndingAnswerState = { error?: string; words?: string } | null;

const keyOf = (v: FormDataEntryValue | null): ReturnEndingKey | null => (RETURN_ENDING_KEYS as string[]).includes(String(v ?? "")) ? (String(v) as ReturnEndingKey) : null;
const amountOf = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? "").replace(/,/g, "").trim());
  return String(v ?? "").trim() && Number.isFinite(n) && n > 0 ? n : null;
};

/** "How did this return end?" (the parts desk for advance, before invoicing and exchange; accounts and the owner for any). */
export async function saveReturnEndingAction(partId: string, _s: EndingAnswerState, f: FormData): Promise<EndingAnswerState> {
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "View as is read-only." };
  const key = keyOf(f.get("ending"));
  if (!key) return { error: "Pick how the return ended (nothing is picked for you)." };
  const r = await setReturnEnding(partId, { key, note: String(f.get("note") ?? ""), advanceAed: amountOf(f.get("advance")) }, staff);
  if (!r.error) revalidatePath("/parts", "layout");
  return r;
}

/** "Correct how this return was settled" (accounts and the owner, a reason always). */
export async function correctReturnEndingAction(partId: string, _s: EndingAnswerState, f: FormData): Promise<EndingAnswerState> {
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "View as is read-only." };
  const key = keyOf(f.get("ending"));
  if (!key) return { error: "Pick how the return really ended." };
  const r = await correctReturnEnding(partId, { key, note: "", reason: String(f.get("reason") ?? ""), advanceAed: amountOf(f.get("advance")) }, staff);
  if (!r.error) revalidatePath("/parts", "layout");
  return r;
}

/** Accounts confirm the advance the parts desk asked for. */
export async function confirmReturnAdvanceAction(partId: string, _s: EndingAnswerState, f: FormData): Promise<EndingAnswerState> {
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "View as is read-only." };
  const r = await confirmReturnAdvance(partId, amountOf(f.get("amount")), staff);
  if (!r.error) revalidatePath("/parts", "layout");
  return r;
}
