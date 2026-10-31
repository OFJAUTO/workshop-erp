import "server-only";
import { getCurrentStaff } from "@/lib/auth";
import { GATE_IN_BUCKET } from "@/lib/media";
import { can, type RoleId } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UploadGrant } from "@/lib/upload-grant";
import { NOT_ALLOWED, UUID_RE, checkLater, grantActor, isRefusal, refuse, rowExists, signedView, type Actor, type RegisterContext, type TargetSpec, type UploadBody } from "./common";

const itemOf = (body: UploadBody) => String(body.itemId ?? "");

async function itemOnJob(jobId: string, itemId: string): Promise<boolean | null> {
  if (!UUID_RE.test(itemId)) return false;
  return rowExists("job_items", itemId, { job_id: jobId });
}

/** A photo of one loose item (wheels, a bumper, a gearbox) under its own line: gate-in people (permission gateIn). */
export const looseItemTarget: TargetSpec = {
  target: "loose_item",
  bucket: GATE_IN_BUCKET,
  types: { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" },

  async authorise(jobId, body) {
    const staff = await getCurrentStaff();
    if (!staff) return refuse("Signed out. Sign in again and it will send.", false, 401);
    if (staff.viewingAs || !can(staff.role_id as RoleId, "gateIn")) return refuse(NOT_ALLOWED, true);
    const there = await itemOnJob(jobId, itemOf(body));
    if (there === null) return checkLater();
    if (!there) return refuse("That item is not on this job any more.", true, 404);
    return { staffId: staff.id, roleId: staff.role_id, via: "login" } satisfies Actor;
  },

  async authoriseGrant(jobId, grant: UploadGrant, body) {
    const actor = await grantActor(grant);
    if (isRefusal(actor)) return actor;
    if (!actor.roleId || !can(actor.roleId as RoleId, "gateIn")) return refuse(NOT_ALLOWED, true);
    const there = await itemOnJob(jobId, itemOf(body));
    if (there === null) return checkLater();
    if (!there) return refuse("That item is not on this job any more.", true, 404);
    return actor;
  },

  path(jobId, fileId, ext, body) {
    const itemId = itemOf(body);
    if (!UUID_RE.test(itemId)) return refuse("That item is not on this job any more.", true, 400);
    return `${jobId}/items/${itemId}-${fileId}.${ext}`;
  },

  owns(jobId, path) {
    const head = `${jobId}/items/`;
    return path.startsWith(head) && !path.slice(head.length).includes("/");
  },

  async register({ scopeId: jobId, path, actor, body, takenAt }: RegisterContext) {
    const itemId = itemOf(body);
    if (!path.slice(`${jobId}/items/`.length).startsWith(`${itemId}-`)) return refuse(NOT_ALLOWED, true);
    const admin = createAdminClient();
    const { data: had } = await admin.from("gate_in_media").select("id, job_id, uploaded_by").eq("storage_path", path).maybeSingle();
    if (had && (had.job_id !== jobId || had.uploaded_by !== actor.staffId)) return refuse(NOT_ALLOWED, true);
    let id = (had?.id as string | undefined) ?? null;
    if (!had) {
      const { data: row, error } = await admin.from("gate_in_media").insert({ job_id: jobId, kind: "item_photo", item_id: itemId, storage_path: path, taken_at: takenAt, uploaded_by: actor.staffId, created_by: actor.staffId, updated_by: actor.staffId }).select("id").single();
      if (error || !row) {
        const { data: again } = await admin.from("gate_in_media").select("id").eq("storage_path", path).maybeSingle();
        if (!again) return refuse("Couldn't record the photo – it will try again by itself.", false, 500);
        id = again.id as string;
      } else {
        id = row.id as string;
      }
    }
    return { ok: true, id, path, url: await signedView(GATE_IN_BUCKET, path), itemId };
  },
};
