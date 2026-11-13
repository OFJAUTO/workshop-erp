"use server";

import { revalidatePath } from "next/cache";
import { ownerStandIn, requireStaff } from "@/lib/auth";
import { dubaiToday, logStandInDecision, standInFor } from "@/lib/standin";
import { onBehalfName, standInMay } from "@/lib/standin-rules";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadApprovals, type ApprovalKind } from "@/lib/approvals";
import { clearVoidRequest, decideOverpayment, voidPayment } from "@/lib/payments";
import { decideCommission, decideQuoteApproval, decideRevision } from "@/app/(app)/quotes/actions";
import { decideInvoiceCheck, decidePurchaseOrder } from "@/app/(app)/parts/order-actions";
import { decideDiscountApproval } from "@/app/(app)/parts/remove-actions";
import { decideReversalAction } from "@/app/(app)/parts/stock/reversal-actions";
import { decideInspectionFee } from "@/app/(app)/jobs/actions";
import { decideFreeChargeAction } from "@/app/(app)/jobs/charge-actions";
import { decideInspectionChange } from "@/app/(app)/jobs/inspection-actions";
import { confirmComeback } from "@/app/(app)/jobs/comeback-actions";
import { runMoreDecision } from "@/lib/approval-decisions";
import { voidLatheBill } from "@/lib/lathe";

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
  const real = await requireStaff();
  if (real.viewingAs) return { error: "View as is read-only – use Act as to decide." };
  if (real.role_id === "owner") return decideCore(kind, id, decision, reason, seen, real);
  // 13 November 2026 (Section 15): the owner's stand-in decides through this same door, for the types he sent them,
  // within their limits, never their own request; inside, every check sees "<name> on behalf of the owner".
  const s = await standInFor(real);
  if (!s) return { error: "Only the owner decides this." };
  const item = (await loadApprovals()).find((i) => i.key === `${kind}:${id}`);
  if (!item) return { error: "Already decided, or no longer waiting." };
  const may = standInMay(s, item, real, dubaiToday());
  if (!may.ok) return { error: may.why };
  const asOwner = { ...real, role_id: "owner", display_name: onBehalfName(real.display_name) } as typeof real;
  const answer = await ownerStandIn.run(asOwner, () => decideCore(kind, id, decision, reason, seen, asOwner));
  if (answer?.ok) await logStandInDecision(asOwner.display_name, item, decision === "approve" ? "approved" : "refused").catch(() => null);
  return answer;
}

async function decideCore(kind: ApprovalKind, id: string, decision: "approve" | "refuse", reason: string, seen: string | null, staff: Awaited<ReturnType<typeof requireStaff>>): Promise<ApprovalAnswer> {
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
    case "void": {
      if (staff.role_id !== "owner") return { error: "Only the owner decides a void." };
      const { data: p } = await createAdminClient().from("payments").select("void_request_reason").eq("id", id).maybeSingle();
      if (yes) {
        // The request comes off FIRST: a voided receipt takes no more changes.
        await clearVoidRequest(id, staff, null);
        const r = await voidPayment(id, staff, `Duplicate / entered by mistake: ${String(p?.void_request_reason ?? "")}${note ? ` · owner: ${note}` : ""}`);
        if (r.error) {
          await createAdminClient().from("payments").update({ void_requested_at: new Date().toISOString(), void_request_reason: String(p?.void_request_reason ?? "") }).eq("id", id);
          answer = { error: r.error };
        } else {
          answer = { ok: true, message: `Voided. It stays in the history marked VOID; the balance and Zoho follow.` };
        }
      } else {
        await clearVoidRequest(id, staff, note);
        answer = { ok: true, message: "Kept. Accounts are told why." };
      }
      break;
    }
    case "lathe_void": {
      if (staff.role_id !== "owner") return { error: "Only the owner decides this." };
      const admin = createAdminClient();
      const { data: lb } = await admin.from("lathe_bills").select("bill_number, void_request_reason, void_requested_by").eq("id", id).maybeSingle();
      if (yes) {
        const r = await voidLatheBill(id, `${String(lb?.void_request_reason ?? "")}${note ? ` · owner: ${note}` : ""}`, staff);
        answer = r.error ? { error: r.error } : { ok: true, message: r.words };
      } else {
        await admin.from("lathe_bills").update({ void_requested_at: null, void_requested_by: null, void_request_reason: null, updated_by: staff.id }).eq("id", id);
        if (lb?.void_requested_by) {
          const { notifyStaff } = await import("@/lib/notifications");
          await notifyStaff([String(lb.void_requested_by)], { type: "owner_approval_needed", title: `Void refused · lathe bill ${lb.bill_number}`, body: `${staff.display_name}: ${note}`, href: "/parts/lathe" });
        }
        answer = { ok: true, message: "Kept. Accounts are told why." };
      }
      break;
    }
    case "inspection_type": {
      const { decideScopeRequest } = await import("@/lib/inspection-scope-decide");
      answer = await decideScopeRequest(id, yes, note, staff);
      break;
    }
    case "part_change": {
      // 13 November 2026 (Section 3): a part's supplier or price changed in place, cost up or another type.
      const { decidePartChange } = await import("@/lib/part-change");
      const r = await decidePartChange(id, yes, note, { id: staff.id, display_name: staff.display_name, role_id: staff.role_id });
      answer = r.error ? { error: r.error } : { ok: true, message: r.words ?? "Done." };
      break;
    }
    case "back_order": {
      // 13 November 2026 (URGENT, J-00317): a part fitted on a later visit.
      const { decideBackOrder } = await import("@/lib/back-orders");
      const r = await decideBackOrder(id, yes, note, { id: staff.id, display_name: staff.display_name, role_id: staff.role_id });
      answer = r.error ? { error: r.error } : { ok: true, message: r.words ?? "Done." };
      break;
    }
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
