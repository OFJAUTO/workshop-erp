import "server-only";
import { getCurrentStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UploadGrant } from "@/lib/upload-grant";
import { JOB_FILES_BUCKET } from "@/lib/work-data";
import { reopenZoho } from "@/lib/zoho-sync";
import { checkLater, grantActor, isRefusal, refuse, rowExists, signedView, type Actor, type RegisterContext, type TargetSpec } from "./common";

const MONEY_ROLES = ["owner", "accounts"];
const ONLY = "Only accounts or the owner add the proof of a supplier payment.";

const poExists = (poId: string) => rowExists("purchase_orders", poId);

/**
 * The proof of paying a supplier (bank slip, card slip, signed receipt, cheque copy) on an LPO, with the payment or after
 * it. Accounts and the owner. On an LPO already marked paid it lands on the LPO at once (and a payment already in Zoho
 * runs once more to attach it); before that it waits for "Paid to supplier", which takes its path.
 */
export const supplierProofTarget: TargetSpec = {
  target: "supplier_proof",
  bucket: JOB_FILES_BUCKET,
  types: { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" },

  async authorise(poId) {
    const staff = await getCurrentStaff();
    if (!staff) return refuse("Signed out. Sign in again and it will send.", false, 401);
    if (staff.viewingAs || !MONEY_ROLES.includes(staff.role_id)) return refuse(ONLY, true);
    const there = await poExists(poId);
    if (there === null) return checkLater();
    if (!there) return refuse("This LPO no longer exists.", true, 404);
    return { staffId: staff.id, roleId: staff.role_id, via: "login" } satisfies Actor;
  },

  async authoriseGrant(poId, grant: UploadGrant) {
    const actor = await grantActor(grant);
    if (isRefusal(actor)) return actor;
    if (!actor.roleId || !MONEY_ROLES.includes(actor.roleId)) return refuse(ONLY, true);
    const there = await poExists(poId);
    if (there === null) return checkLater();
    if (!there) return refuse("This LPO no longer exists.", true, 404);
    return actor;
  },

  path(poId, fileId, ext) {
    return `supplier-payments/${poId}/${fileId}.${ext}`;
  },

  owns(poId, path) {
    const head = `supplier-payments/${poId}/`;
    return path.startsWith(head) && !path.slice(head.length).includes("/");
  },

  async register({ scopeId: poId, path, actor }: RegisterContext) {
    const admin = createAdminClient();
    const { data: po } = await admin.from("purchase_orders").select("id, number, supplier_paid_at, supplier_paid_proof_path").eq("id", poId).maybeSingle();
    if (!po) return refuse("This LPO no longer exists.", true, 404);
    let attached = po.supplier_paid_proof_path === path;
    if (!attached && po.supplier_paid_at) {
      const { error } = await admin.from("purchase_orders").update({ supplier_paid_proof_path: path, supplier_paid_proof_at: new Date().toISOString(), supplier_paid_proof_by: actor.staffId, updated_by: actor.staffId }).eq("id", poId);
      if (error) return refuse("Couldn't attach the proof – it will try again by itself.", false, 500);
      await reopenZoho("billpayment", poId);
      attached = true;
    }
    return { ok: true, id: null, path, url: await signedView(JOB_FILES_BUCKET, path), attached, number: po.number };
  },
};
