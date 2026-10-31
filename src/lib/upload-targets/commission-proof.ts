import "server-only";
import { getCurrentStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UploadGrant } from "@/lib/upload-grant";
import { JOB_FILES_BUCKET } from "@/lib/work-data";
import { reopenZoho } from "@/lib/zoho-sync";
import { checkLater, grantActor, isRefusal, refuse, rowExists, signedView, type Actor, type RegisterContext, type TargetSpec } from "./common";

const MONEY_ROLES = ["owner", "accounts"];
const ONLY = "Only accounts or the owner add the commission proof.";

const paymentExists = (id: string) => rowExists("commission_payments", id);

/**
 * The signed voucher photo or the bank slip of a commission payment (section 2 of 21 October). Accounts and the owner.
 * It lands on the payment at once; an expense already in Zoho runs once more to attach it.
 */
export const commissionProofTarget: TargetSpec = {
  target: "commission_proof",
  bucket: JOB_FILES_BUCKET,
  types: { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" },

  async authorise(paymentId) {
    const staff = await getCurrentStaff();
    if (!staff) return refuse("Signed out. Sign in again and it will send.", false, 401);
    if (staff.viewingAs || !MONEY_ROLES.includes(staff.role_id)) return refuse(ONLY, true);
    const there = await paymentExists(paymentId);
    if (there === null) return checkLater();
    if (!there) return refuse("This commission payment no longer exists.", true, 404);
    return { staffId: staff.id, roleId: staff.role_id, via: "login" } satisfies Actor;
  },

  async authoriseGrant(paymentId, grant: UploadGrant) {
    const actor = await grantActor(grant);
    if (isRefusal(actor)) return actor;
    if (!actor.roleId || !MONEY_ROLES.includes(actor.roleId)) return refuse(ONLY, true);
    const there = await paymentExists(paymentId);
    if (there === null) return checkLater();
    if (!there) return refuse("This commission payment no longer exists.", true, 404);
    return actor;
  },

  path(paymentId, fileId, ext) {
    return `commission-payments/${paymentId}/${fileId}.${ext}`;
  },

  owns(paymentId, path) {
    const head = `commission-payments/${paymentId}/`;
    return path.startsWith(head) && !path.slice(head.length).includes("/");
  },

  async register({ scopeId: paymentId, path, actor }: RegisterContext) {
    const admin = createAdminClient();
    const { data: pay } = await admin.from("commission_payments").select("id, number, proof_path").eq("id", paymentId).maybeSingle();
    if (!pay) return refuse("This commission payment no longer exists.", true, 404);
    if (pay.proof_path !== path) {
      const { error } = await admin.from("commission_payments").update({ proof_path: path, proof_uploaded_at: new Date().toISOString(), proof_uploaded_by: actor.staffId, updated_by: actor.staffId }).eq("id", paymentId);
      if (error) return refuse("Couldn't attach the proof – it will try again by itself.", false, 500);
      // Zoho Books phase 2: a proof uploaded after the expense posted attaches on the next sync run.
      await reopenZoho("commission", paymentId);
    }
    return { ok: true, id: null, path, url: await signedView(JOB_FILES_BUCKET, path), number: pay.number };
  },
};
