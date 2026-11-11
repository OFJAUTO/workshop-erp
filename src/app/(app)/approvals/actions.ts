"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadApprovals, type ApprovalKind } from "@/lib/approvals";
import { decideOverpayment } from "@/lib/payments";
import { decideCommission, decideQuoteApproval, decideRevision } from "@/app/(app)/quotes/actions";
import { decideInvoiceCheck, decidePurchaseOrder } from "@/app/(app)/parts/order-actions";
import { decideDiscountApproval } from "@/app/(app)/parts/remove-actions";
import { decideReversalAction } from "@/app/(app)/parts/stock/reversal-actions";
import { decideInspectionFee } from "@/app/(app)/jobs/actions";
import { decideFreeChargeAction } from "@/app/(app)/jobs/charge-actions";
import { decideInspectionChange } from "@/app/(app)/jobs/inspection-actions";
import { confirmComeback } from "@/app/(app)/jobs/comeback-actions";
import { runMoreDecision } from "@/lib/approval-decisions";

export type ApprovalAnswer = { ok?: boolean; error?: string; message?: string } | null;

/** A decision that answers with a redirect: its ?error= / ?message= words come back to the box instead of a new page. */
function wordsOfRedirect(e: unknown): ApprovalAnswer | null {
  const digest = (e as { digest?: string } | null)?.digest;
  if (typeof digest !== "string") return null;
  if (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK")) return { error: "Only the owner decides this." };
  if (!digest.startsWith("NEXT_REDIRECT;")) return null;
  const url = digest.split(";")[2] ?? "";
  const q = new URLSearchParams(url.includes("?") ? url.slice(url.indexOf("?") + 1).split("#")[0] : "");
  const err = q.get("error") ?? q.get("resend_error") ?? q.get("charge_error");
  if (err) return { error: err };
  if (url.startsWith("/login")) return { error: "Sign in again, then decide." };
  return { ok: true, message: q.get("message") ?? q.get("charge_message") ?? "Done." };
}

async function run(fn: () => Promise<unknown>): Promise<ApprovalAnswer> {
  try {
    const r = (await fn()) as { error?: string; ok?: boolean; message?: string } | undefined | void;
    if (r && typeof r === "object" && "error" in r && r.error) return { error: r.error };
    return { ok: true, message: (r && typeof r === "object" && r.message) || "Done." };
  } catch (e) {
    const w = wordsOfRedirect(e);
    if (w) return w;
    throw e;
  }
}

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

/**
 * THE one decision door of the approvals (11 November 2026, Section 4): Approve or Refuse (with a reason) on any kind,
 * from its own page's yellow box or from the Approvals list. Each kind's own decision runs, with its own rules; the
 * answer comes back to the box. A refusal always needs a reason.
 */
export async function decideApprovalAction(kind: ApprovalKind, id: string, decision: "approve" | "refuse", reason: string, seen: string | null = null): Promise<ApprovalAnswer> {
  const staff = await requireStaff();
  if (staff.viewingAs) return { error: "View as is read-only – use Act as to decide." };
  const note = reason.trim().slice(0, 500);
  if (decision === "refuse" && note.length < 3) return { error: "Write why you refuse (a few words): the person who asked sees it." };
  const yes = decision === "approve";
  let answer: ApprovalAnswer;
  switch (kind) {
    case "quote": {
      // The reason the owner SAW goes with the answer (B3): a box left open never approves figures that changed since.
      const { data: q } = seen === null ? await createAdminClient().from("quotations").select("owner_approval_reason").eq("id", id).maybeSingle() : { data: null };
      answer = await run(() => decideQuoteApproval(id, fd({ decision: yes ? "approve" : "refuse", note, seen: seen ?? String(q?.owner_approval_reason ?? "") })));
      break;
    }
    case "revision":
      answer = await run(() => decideRevision(id, fd({ decision: yes ? "allow" : "decline", note })));
      break;
    case "commission":
      answer = await run(() => decideCommission(id, fd({ decision: yes ? "approve" : "decline", note })));
      break;
    case "lpo":
      answer = await run(() => decidePurchaseOrder(id, fd({ decision: yes ? "approve" : "refuse", note, reason: note || "Refused", override_reason: note || "Approved by the owner from the Approvals list" })));
      break;
    case "discount":
      answer = await run(() => decideDiscountApproval(id, fd({ decision: yes ? "approve" : "refuse", note })));
      break;
    case "fee":
      answer = await run(() => decideInspectionFee(id, fd({ decision: yes ? "approve" : "refuse", note })));
      break;
    case "price":
      answer = await run(() => decideInvoiceCheck(id, fd({ decision: yes ? "accept" : "dispute", note })));
      break;
    case "free_charge": {
      const [jobId, lineId] = id.split(":");
      answer = await run(() => decideFreeChargeAction(jobId, lineId, fd({ decision: yes ? "approve" : "refuse", note })));
      break;
    }
    case "inspection_change": {
      const [jobId, reqId] = id.split(":");
      answer = await run(() => decideInspectionChange(jobId, reqId, fd({ decision: yes ? "approved" : "refused", decision_note: note })));
      break;
    }
    case "stock_reversal":
      answer = await run(() => decideReversalAction(id, fd({ decision: yes ? "approve" : "refuse", note })));
      break;
    case "comeback":
      answer = await run(() => confirmComeback(id, fd({ free: yes ? "yes" : "no", note, deduct: "yes" })));
      break;
    case "overpayment":
      if (staff.role_id !== "owner") return { error: "Only the owner decides this." };
      answer = await run(() => decideOverpayment(id, staff, yes, note || null));
      break;
    default:
      answer = await runMoreDecision(kind, id, yes, note, staff);
  }
  // Was it really decided? The item leaves the list only when its own decision went through.
  if (answer?.ok) {
    const still = (await loadApprovals()).some((i) => i.key === `${kind}:${id}`);
    if (still) answer = { error: answer.message && answer.message !== "Done." ? answer.message : "Not decided: open the page and look." };
  }
  revalidatePath("/approvals");
  revalidatePath("/dashboard");
  return answer;
}
