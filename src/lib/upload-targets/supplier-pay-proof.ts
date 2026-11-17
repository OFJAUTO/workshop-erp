import "server-only";
import { getCurrentStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UploadGrant } from "@/lib/upload-grant";
import { JOB_FILES_BUCKET } from "@/lib/work-data";
import { reopenZoho } from "@/lib/zoho-sync";
import { grantActor, isRefusal, refuse, signedView, UUID_RE, type Actor, type RegisterContext, type TargetSpec } from "./common";

const MONEY_ROLES = ["owner", "accounts"];
const ONLY = "Only accounts or the owner add the proof of a supplier payment.";

/** The folder of one supplier payment's proof files (the payment's own id, or the key its form will save it under). */
export const SUPPLIER_PAY_PROOF_FOLDER = "supplier-payments/pay";

/**
 * THE proof of a supplier payment (17 November 2026, Section 1): the bank slip, card slip, link receipt or cheque copy
 * belongs to the PAYMENT (the SPAY record), never to an LPO - an advance with no LPO takes its proof like any other.
 *
 * The scope is the payment's id. A NEW payment's form makes that id in the browser before it is saved (the payment is
 * then saved under it), so a proof picked before "Record" is accepted at once and joins the payment the moment both
 * exist - whichever arrives first. An existing payment takes its first proof straight away (logged in its history); a
 * replacement goes through "Correct this payment", with its reason.
 */
export const supplierPayProofTarget: TargetSpec = {
  target: "supplier_pay_proof",
  bucket: JOB_FILES_BUCKET,
  types: { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" },

  async authorise(paymentId) {
    const staff = await getCurrentStaff();
    if (!staff) return refuse("Signed out. Sign in again and it will send.", false, 401);
    if (staff.viewingAs || !MONEY_ROLES.includes(staff.role_id)) return refuse(ONLY, true);
    if (!UUID_RE.test(paymentId)) return refuse("This proof has no payment to go with. Open the payment again and add it there.", true, 400);
    return { staffId: staff.id, roleId: staff.role_id, via: "login" } satisfies Actor;
  },

  async authoriseGrant(paymentId, grant: UploadGrant) {
    const actor = await grantActor(grant);
    if (isRefusal(actor)) return actor;
    if (!actor.roleId || !MONEY_ROLES.includes(actor.roleId)) return refuse(ONLY, true);
    if (!UUID_RE.test(paymentId)) return refuse("This proof has no payment to go with. Open the payment again and add it there.", true, 400);
    return actor;
  },

  path(paymentId, fileId, ext) {
    return `${SUPPLIER_PAY_PROOF_FOLDER}/${paymentId}/${fileId}.${ext}`;
  },

  owns(paymentId, path) {
    const head = `${SUPPLIER_PAY_PROOF_FOLDER}/${paymentId}/`;
    return path.startsWith(head) && !path.slice(head.length).includes("/");
  },

  async register({ scopeId: paymentId, path, actor }: RegisterContext) {
    const url = await signedView(JOB_FILES_BUCKET, path);
    const attached = await attachSupplierPayProof(paymentId, path, actor.staffId, null);
    if (attached === "failed") return refuse("Couldn't attach the proof – it will try again by itself.", false, 500);
    return { ok: true, id: null, path, url, attached: attached === "attached" };
  },
};

/**
 * Puts a proof on a supplier payment when it has none yet (and on the LPOs that payment settled with no proof of their
 * own), keeps a line in the payment's history and lets Zoho attach it. "waiting" = the payment is not saved yet (its form
 * carries the path); "has_one" = it already has a proof (a replacement goes through Correct this payment).
 */
export async function attachSupplierPayProof(paymentId: string, path: string, staffId: string | null, byName: string | null): Promise<"attached" | "has_one" | "waiting" | "failed"> {
  const admin = createAdminClient();
  const { data: pay, error: readErr } = await admin.from("supplier_payments").select("id, number, proof_path, edit_history").eq("id", paymentId).maybeSingle();
  if (readErr) return "failed";
  if (!pay) return "waiting";
  if (pay.proof_path === path) return "attached";
  if (pay.proof_path) return "has_one";
  let name = byName;
  if (!name && staffId) {
    const { data: s } = await admin.from("staff").select("display_name").eq("id", staffId).maybeSingle();
    name = (s?.display_name as string | undefined) ?? null;
  }
  const entry = { at: new Date().toISOString(), by: name ?? "accounts", remark: "Proof of payment added", changes: [{ field: "Proof", old: "none", new: "added" }] };
  const { data: done, error } = await admin
    .from("supplier_payments")
    .update({ proof_path: path, edit_history: [...(((pay.edit_history as unknown[]) ?? []) as unknown[]), entry], updated_by: staffId })
    .eq("id", paymentId)
    .is("proof_path", null)
    .select("id");
  if (error) return "failed";
  if (!done?.length) return "has_one";
  await admin.from("purchase_orders").update({ supplier_paid_proof_path: path, supplier_paid_proof_at: new Date().toISOString(), supplier_paid_proof_by: staffId, updated_by: staffId }).eq("supplier_payment_id", paymentId).is("supplier_paid_proof_path", null);
  await reopenZoho("supplierpay", paymentId).catch(() => null);
  return "attached";
}
