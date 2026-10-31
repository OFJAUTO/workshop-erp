import "server-only";
import { getCurrentStaff } from "@/lib/auth";
import { logAppError } from "@/lib/app-errors";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UploadGrant } from "@/lib/upload-grant";
import { isUuid } from "@/lib/uuid";
import { JOB_FILES_BUCKET } from "@/lib/work-data";
import { reopenZoho } from "@/lib/zoho-sync";
import { NOT_ALLOWED, checkLater, grantActor, isRefusal, refuse, rowExists, signedView, type Actor, type RegisterContext, type TargetSpec, type UploadBody } from "./common";

/** The kinds of job file (the same list as the job_files_kind_check constraint: a new kind needs both). */
export const JOB_FILE_KINDS = ["work_photo", "additional_work", "wash_photo", "gate_out_photo", "delivery_photo", "handover_photo", "supplier_invoice", "qc_postscan", "return_photo", "bodyshop_photo", "bodyshop_removed", "payment_proof", "odometer_out"];

const kindOf = (body: UploadBody) => String(body.kind ?? "");

const jobExists = (jobId: string) => rowExists("jobs", jobId);

/** A team leader adds bodyshop photos only (the rule of /api/files/register), and the film plotter photo of the Materials card. */
function kindAllowed(roleId: string | null, kind: string, caption?: unknown): boolean {
  // Payment proofs belong to whoever records payments: accounts and the owner.
  if (kind === "payment_proof") return roleId === "owner" || roleId === "accounts";
  return roleId !== "team_leader" || kind === "bodyshop_photo" || (kind === "work_photo" && String(caption ?? "").startsWith("Film plotter"));
}

/**
 * Files on a job after the inspection: work and bodyshop photos, payment proofs, supplier invoices, the gate-out km photo,
 * handover photos, the QC post-scan. Any signed-in member of staff (not viewing as someone else) on an existing job; a
 * team leader only bodyshop photos. Bucket job-files.
 */
export const jobFileTarget: TargetSpec = {
  target: "job_file",
  bucket: JOB_FILES_BUCKET,
  types: { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/webm": "webm", "video/mp4": "mp4", "video/quicktime": "mov", "application/pdf": "pdf" },

  async authorise(jobId, body) {
    if (!JOB_FILE_KINDS.includes(kindOf(body))) return refuse("That kind of file is not accepted here.", true, 400);
    const staff = await getCurrentStaff();
    if (!staff) return refuse("Signed out. Sign in again and it will send.", false, 401);
    if (staff.viewingAs) return refuse("You are viewing as someone else: files can't be added.", true);
    if (!kindAllowed(staff.role_id, kindOf(body), body.caption)) return refuse(NOT_ALLOWED, true);
    const there = await jobExists(jobId);
    if (there === null) return checkLater();
    if (!there) return refuse("This car's record no longer exists.", true, 404);
    return { staffId: staff.id, roleId: staff.role_id, via: "login" } satisfies Actor;
  },

  async authoriseGrant(jobId, grant: UploadGrant, body) {
    if (!JOB_FILE_KINDS.includes(kindOf(body))) return refuse("That kind of file is not accepted here.", true, 400);
    const actor = await grantActor(grant);
    if (isRefusal(actor)) return actor;
    if (!actor.staffId || !kindAllowed(actor.roleId, kindOf(body), body.caption)) return refuse(NOT_ALLOWED, true);
    // A section tablet's PIN permit opens only what its PIN step was for: the bodyshop photo.
    if (grant.via === "pin" && kindOf(body) !== "bodyshop_photo") return refuse(NOT_ALLOWED, true);
    const there = await jobExists(jobId);
    if (there === null) return checkLater();
    if (!there) return refuse("This car's record no longer exists.", true, 404);
    return actor;
  },

  path(jobId, fileId, ext) {
    return `${jobId}/${fileId}.${ext}`;
  },

  owns(jobId, path) {
    return path.startsWith(`${jobId}/`) && !path.slice(jobId.length + 1).includes("/");
  },

  async register({ scopeId: jobId, path, actor, body, takenAt, contentType }: RegisterContext) {
    const kind = kindOf(body);
    if (!JOB_FILE_KINDS.includes(kind)) return refuse("That kind of file is not accepted here.", true, 400);
    // ref_id is a uuid column: a file is tied to a payment, an LPO, a work line or a panel's own key (a uuid).
    const refId = body.refId ? String(body.refId) : null;
    if (refId && !isUuid(refId)) {
      await logAppError("upload register: reference is not a uuid", new Error(`ref_id ${String(body.refId).slice(0, 80)}`), { staffId: actor.staffId, jobId, detail: { kind } });
      return refuse("Couldn't attach the file – nothing was saved. Tell the owner.", true, 400);
    }
    const admin = createAdminClient();
    const caption = body.caption ? String(body.caption).slice(0, 200) : null;
    // A second register of the same file (the answer was lost on the way back) answers with the first one.
    const { data: had } = await admin.from("job_files").select("id, job_id, kind, uploaded_by").eq("storage_path", path).maybeSingle();
    // A repeat answers only the person who recorded it, for the same kind (never someone else's file and its address).
    if (had && (had.job_id !== jobId || had.kind !== kind || had.uploaded_by !== actor.staffId)) return refuse(NOT_ALLOWED, true);
    let id = (had?.id as string | undefined) ?? null;
    if (!had) {
      const { data: row, error } = await admin
        .from("job_files")
        .insert({ job_id: jobId, kind, ref_id: refId, storage_path: path, content_type: contentType ? contentType.slice(0, 80) : null, caption, taken_at: takenAt, uploaded_by: actor.staffId, created_by: actor.staffId, updated_by: actor.staffId })
        .select("id")
        .single();
      if (error || !row) {
        const { data: again } = await admin.from("job_files").select("id").eq("storage_path", path).maybeSingle();
        if (!again) {
          await logAppError("upload register: job file insert", error ?? new Error("no row"), { staffId: actor.staffId, jobId, detail: { kind } });
          return refuse("Couldn't attach the file – it will try again by itself.", false, 500);
        }
        id = again.id as string;
      } else {
        id = row.id as string;
        // Zoho Books phase 2: a supplier-invoice scan added AFTER the bill posted attaches on the next sync run.
        if (kind === "supplier_invoice" && refId) {
          const { data: zpo } = await admin.from("purchase_orders").select("id, zoho_bill_id").eq("id", refId).maybeSingle();
          if ((zpo as { zoho_bill_id?: string | null } | null)?.zoho_bill_id) await reopenZoho("bill", refId);
        }
        // A QC post-scan PDF that arrived after the inspector moved on: it becomes the open round's post-scan when it has none
        // - only the round it was taken in (never the next round, after a failed check).
        if (kind === "qc_postscan" && (actor.roleId === "owner" || actor.roleId === "qc_inspector")) await admin.from("qc_checks").update({ postscan_path: path, postscan_waived_reason: null, updated_by: actor.staffId }).eq("job_id", jobId).eq("status", "open").is("postscan_path", null).lte("started_at", takenAt);
        // A payment proof that waited on the phone while the payment was recorded with another one: it joins that payment.
        if (kind === "payment_proof" && refId) {
          const { data: pay } = await admin.from("payments").select("id, job_id, proof_path").eq("client_key", refId).maybeSingle();
          if (pay && (!pay.job_id || pay.job_id === jobId)) {
            await admin.from("job_files").update({ ref_id: pay.id }).eq("id", id);
            if (!pay.proof_path) await admin.from("payments").update({ proof_path: path, updated_by: actor.staffId }).eq("id", pay.id);
          }
        }
      }
    }
    return { ok: true, id, path, url: await signedView(JOB_FILES_BUCKET, path), kind, caption, refId };
  },
};
