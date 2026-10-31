import "server-only";
import { getCurrentStaff } from "@/lib/auth";
import { startBodyshopWork } from "@/lib/bodyshop";
import { cleanDamageAfter } from "@/lib/damage";
import { GATE_IN_BUCKET, loadGateInFlags, loadMedia, mediaChecklist } from "@/lib/media";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { authoriseUpload } from "@/lib/upload-auth";
import type { UploadGrant } from "@/lib/upload-grant";
import { NOT_ALLOWED, checkLater, grantActor, isRefusal, refuse, rowExists, signedView, type Actor, type RegisterContext, type TargetSpec, type UploadBody } from "./common";

const KINDS = ["video", "video_exterior", "video_interior", "dashboard_photo", "keys_photo", "keys_photo_front", "keys_photo_back", "damage_photo", "gate_out_photo", "wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr", "car_picture"];

const kindOf = (body: UploadBody) => String(body.kind ?? "");
const captionOf = (body: UploadBody) => (body.caption ? String(body.caption).slice(0, 200) : null);

/**
 * "Damage found after check-in" photos (caption "after:<entry id>"): anyone who may record that damage may add its photos
 * - any member of staff while the car is in, the same rule as `addDamageAfter` - not only the gate-in roles. A photo taken
 * before the car left that arrives after (it waited on a phone) still belongs to its entry.
 */
async function damageAfterAllowed(jobId: string, caption: string | null, takenAt: number, grantIat: number | null = null): Promise<boolean | null> {
  if (!caption?.startsWith("after:")) return false;
  const admin = createAdminClient();
  const [{ data: job, error: jobError }, { data: gi, error: giError }] = await Promise.all([
    admin.from("jobs").select("id, gated_out_at").eq("id", jobId).maybeSingle(),
    admin.from("gate_ins").select("damage_after").eq("job_id", jobId).maybeSingle(),
  ]);
  // The database could not be asked: the file waits (null), never refused for good on a hiccup.
  if (jobError || giError) return null;
  // After the car left: only a file taken before that, under a permit made before that (the browser's clock alone is never trusted).
  if (!job) return false;
  if (job.gated_out_at) {
    const out = Date.parse(String(job.gated_out_at));
    if (grantIat === null || grantIat > out || takenAt > out) return false;
  }
  const id = caption.slice(6);
  return cleanDamageAfter((gi as { damage_after?: unknown } | null)?.damage_after).some((a) => a.id === id);
}

const jobExists = (jobId: string) => rowExists("jobs", jobId);

/** The car's gate-in media: photos, videos, damage close-ups, the car picture. Bucket gate-in-media. */
export const gateInTarget: TargetSpec = {
  target: "gate_in",
  bucket: GATE_IN_BUCKET,
  types: { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/webm": "webm", "video/mp4": "mp4", "video/quicktime": "mov" },

  async authorise(jobId, body) {
    if (!KINDS.includes(kindOf(body))) return refuse("That kind of photo is not part of the gate-in.", true, 400);
    const who = await authoriseUpload(jobId, body.token ? String(body.token) : null);
    if (who) {
      const staff = who.via === "login" ? await getCurrentStaff() : null;
      return { staffId: who.staffId, roleId: staff?.role_id ?? null, via: who.via } satisfies Actor;
    }
    // Damage found after check-in: any member of staff (not viewing as someone else) while the car is in.
    const staff = await getCurrentStaff();
    const after = staff && !staff.viewingAs && kindOf(body) === "damage_photo" ? await damageAfterAllowed(jobId, captionOf(body), Date.now()) : false;
    if (after === null) return checkLater();
    if (staff && after) return { staffId: staff.id, roleId: staff.role_id, via: "login" };
    if (!staff && !body.token) return refuse("Signed out. Sign in again and it will send.", false, 401);
    return refuse(body.token ? "The phone link has expired. Ask for a new QR code." : NOT_ALLOWED, true);
  },

  async authoriseGrant(jobId, grant: UploadGrant, body, _contentType, takenAt) {
    if (!KINDS.includes(kindOf(body))) return refuse("That kind of photo is not part of the gate-in.", true, 400);
    const actor = await grantActor(grant);
    if (isRefusal(actor)) return actor;
    const there = await jobExists(jobId);
    if (there === null) return checkLater();
    if (!there) return refuse("This car's record no longer exists.", true, 404);
    // A gate-in person or a phone link may add any gate-in file; anyone else only the photos of damage found after
    // check-in, while the car is still in.
    const gateInRole = grant.via === "link" || (!!actor.roleId && can(actor.roleId as RoleId, "editGateIn"));
    if (!gateInRole) {
      const after = kindOf(body) === "damage_photo" ? await damageAfterAllowed(jobId, captionOf(body), takenAt, grant.iat) : false;
      if (after === null) return checkLater();
      if (!after) return refuse("The car has left: no more damage photos can be added.", true);
    }
    return actor;
  },

  path(jobId, fileId, ext, body) {
    return `${jobId}/${kindOf(body)}-${fileId}.${ext}`;
  },

  owns(jobId, path) {
    return path.startsWith(`${jobId}/`) && !path.slice(jobId.length + 1).includes("/");
  },

  async register({ scopeId: jobId, path, actor, body, takenAt }: RegisterContext) {
    const kind = kindOf(body);
    if (!KINDS.includes(kind)) return refuse("That kind of photo is not part of the gate-in.", true, 400);
    const admin = createAdminClient();
    // A second register of the same file (the answer was lost on the way back) answers with the first one.
    const { data: had } = await admin.from("gate_in_media").select("id, job_id, kind, uploaded_by").eq("storage_path", path).maybeSingle();
    let id: string | null = (had?.id as string | undefined) ?? null;
    if (had && (had.job_id !== jobId || had.kind !== kind || had.uploaded_by !== actor.staffId)) return refuse(NOT_ALLOWED, true);
    if (!had) {
      const { data: row, error } = await admin
        .from("gate_in_media")
        .insert({
          job_id: jobId,
          kind,
          storage_path: path,
          duration_s: body.duration ? Math.round(Number(body.duration)) : null,
          caption: captionOf(body),
          taken_at: takenAt,
          uploaded_by: actor.staffId,
          created_by: actor.staffId,
          updated_by: actor.staffId,
        })
        .select("id")
        .single();
      if (error || !row) {
        // Two sends of the same file at the same moment: the other one won, which is fine.
        const { data: again } = await admin.from("gate_in_media").select("id").eq("storage_path", path).maybeSingle();
        if (!again) return refuse("Couldn't record the file – it will try again by itself.", false, 500);
        id = again.id as string;
      } else {
        id = row.id as string;
      }
      if (kind === "car_picture") await copyCarPicture(jobId, path, takenAt);
    }
    const checklist = mediaChecklist(await loadMedia(jobId), await loadGateInFlags(jobId));
    // A bodyshop car with an approved quotation: the stages start by themselves once the gate-in photos are complete.
    if (checklist.complete) {
      const { data: j } = await admin.from("jobs").select("department, status, bodyshop_started_at").eq("id", jobId).maybeSingle();
      if (j?.department === "bodyshop" && !j.bodyshop_started_at && ["gate_in_pending", "pending_approval"].includes(String(j.status))) await startBodyshopWork(jobId, null, await getSettings()).catch(() => null);
    }
    return { ok: true, id, path, url: await signedView(GATE_IN_BUCKET, path), checklist };
  },
};

/**
 * The car's picture for the Cars page, the dashboard and the job card: a copy in the car's own folder. A picture that
 * waited on a phone never replaces a newer one taken meanwhile (the newest capture wins).
 */
async function copyCarPicture(jobId: string, path: string, takenAt: string) {
  const admin = createAdminClient();
  const { data: newer } = await admin.from("gate_in_media").select("id").eq("job_id", jobId).eq("kind", "car_picture").is("removed_at", null).gt("taken_at", takenAt).neq("storage_path", path).limit(1);
  if ((newer ?? []).length) return;
  const { data: job } = await admin.from("jobs").select("vehicle_id").eq("id", jobId).maybeSingle();
  if (!job?.vehicle_id) return;
  const dest = `${job.vehicle_id}/profile-${Date.now()}.jpg`;
  let { error: copyError } = await admin.storage.from(GATE_IN_BUCKET).copy(path, dest, { destinationBucket: "vehicle-photos" });
  if (copyError) {
    const { data: file } = await admin.storage.from(GATE_IN_BUCKET).download(path);
    copyError = file ? (await admin.storage.from("vehicle-photos").upload(dest, Buffer.from(await file.arrayBuffer()), { contentType: file.type || "image/jpeg", upsert: false })).error : copyError;
  }
  if (!copyError) await admin.from("vehicles").update({ photo_path: dest }).eq("id", job.vehicle_id);
}
