import "server-only";
import { getCurrentStaff } from "@/lib/auth";
import type { UploadGrant } from "@/lib/upload-grant";
import { JOB_FILES_BUCKET } from "@/lib/work-data";
import { checkLater, grantActor, isRefusal, refuse, rowExists, signedView, UUID_RE, type Actor, type RegisterContext, type TargetSpec, type UploadBody } from "./common";

const SENDERS = ["service_advisor", "owner"];
const ONLY = "Payments are sent to accounts by the advisors.";

/** The estimate must still be a live one (any status: the slip may arrive moments after an approval). */
const estimateExists = (id: string) => rowExists("quotations", id, { kind: "estimate" });

const reportIdOf = (body: UploadBody): string | null => {
  const id = String(body.reportId ?? "");
  return UUID_RE.test(id) ? id : null;
};

/**
 * The slip photo of an advisor's "Payment received – send to accounts" on an ESTIMATE (4 November 2026,
 * money from the estimate). There is no job yet, so no job_files row: the photo lives in the job-files
 * bucket under the report's own browser-made id, and createPaymentReport reads the folder when the
 * report is sent. Advisors and the owner only, like the job reports.
 */
export const estimateReportTarget: TargetSpec = {
  target: "estimate_report",
  bucket: JOB_FILES_BUCKET,
  types: { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" },

  async authorise(estimateId) {
    const staff = await getCurrentStaff();
    if (!staff) return refuse("Signed out. Sign in again and it will send.", false, 401);
    if (staff.viewingAs || !SENDERS.includes(staff.role_id)) return refuse(ONLY, true);
    const there = await estimateExists(estimateId);
    if (there === null) return checkLater();
    if (!there) return refuse("This estimate no longer exists.", true, 404);
    return { staffId: staff.id, roleId: staff.role_id, via: "login" } satisfies Actor;
  },

  async authoriseGrant(estimateId, grant: UploadGrant) {
    const actor = await grantActor(grant);
    if (isRefusal(actor)) return actor;
    if (!actor.roleId || !SENDERS.includes(actor.roleId)) return refuse(ONLY, true);
    const there = await estimateExists(estimateId);
    if (there === null) return checkLater();
    if (!there) return refuse("This estimate no longer exists.", true, 404);
    return actor;
  },

  path(estimateId, fileId, ext, body) {
    const reportId = reportIdOf(body);
    if (!reportId) return refuse("Reload the page and try again.", true, 400);
    return `estimate-reports/${estimateId}/${reportId}/${fileId}.${ext}`;
  },

  owns(estimateId, path) {
    const head = `estimate-reports/${estimateId}/`;
    return path.startsWith(head) && path.slice(head.length).split("/").length === 2;
  },

  async register({ path }: RegisterContext) {
    // No row to write: the report row is made when the advisor presses Send, and it reads this folder.
    return { ok: true, id: null, path, url: await signedView(JOB_FILES_BUCKET, path) };
  },
};
