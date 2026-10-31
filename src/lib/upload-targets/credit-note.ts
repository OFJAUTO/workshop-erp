import "server-only";
import { getCurrentStaff } from "@/lib/auth";
import { PARTS_BUCKET } from "@/lib/quote-data";
import { can, type RoleId } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UploadGrant } from "@/lib/upload-grant";
import { checkLater, grantActor, isRefusal, refuse, rowExists, signedView, type Actor, type RegisterContext, type TargetSpec } from "./common";

const ONLY = "Only Parts or the owner add a credit note scan.";
const mayFile = (roleId: string | null) => roleId === "owner" || (!!roleId && can(roleId as RoleId, "managePurchaseOrders"));

const partExists = (partId: string) => rowExists("part_items", partId);

/**
 * The supplier's credit note for a part sent back (the parts bucket). Parts or the owner. It goes with "where the part
 * goes"; one that arrives after that was saved (it waited on the phone) lands on the part by itself.
 */
export const creditNoteTarget: TargetSpec = {
  target: "credit_note",
  bucket: PARTS_BUCKET,
  types: { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" },

  async authorise(partId) {
    const staff = await getCurrentStaff();
    if (!staff) return refuse("Signed out. Sign in again and it will send.", false, 401);
    if (staff.viewingAs || !mayFile(staff.role_id)) return refuse(ONLY, true);
    const there = await partExists(partId);
    if (there === null) return checkLater();
    if (!there) return refuse("This part no longer exists.", true, 404);
    return { staffId: staff.id, roleId: staff.role_id, via: "login" } satisfies Actor;
  },

  async authoriseGrant(partId, grant: UploadGrant) {
    const actor = await grantActor(grant);
    if (isRefusal(actor)) return actor;
    if (!mayFile(actor.roleId)) return refuse(ONLY, true);
    const there = await partExists(partId);
    if (there === null) return checkLater();
    if (!there) return refuse("This part no longer exists.", true, 404);
    return actor;
  },

  path(partId, fileId, ext) {
    return `credit-notes/${partId}/${fileId}.${ext}`;
  },

  owns(partId, path) {
    const head = `credit-notes/${partId}/`;
    return path.startsWith(head) && !path.slice(head.length).includes("/");
  },

  async register({ scopeId: partId, path, actor }: RegisterContext) {
    const admin = createAdminClient();
    const { data: part } = await admin.from("part_items").select("id, disposition, credit_note_path").eq("id", partId).maybeSingle();
    if (!part) return refuse("This part no longer exists.", true, 404);
    let attached = part.credit_note_path === path;
    // Only a part really sent back takes a late scan (never one moved to stock after the scan was picked).
    if (!attached && part.disposition === "returned" && !part.credit_note_path) {
      const { error } = await admin.from("part_items").update({ credit_note_path: path, updated_by: actor.staffId }).eq("id", partId);
      if (error) return refuse("Couldn't attach the scan – it will try again by itself.", false, 500);
      attached = true;
    }
    return { ok: true, id: null, path, url: await signedView(PARTS_BUCKET, path), attached };
  },
};
