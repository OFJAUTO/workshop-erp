import "server-only";
import { getCurrentStaff } from "@/lib/auth";
import { canEditBody } from "@/lib/bodyshop-findings";
import { INSPECTION_BUCKET, inspectionLocked, type InspectionRow } from "@/lib/inspection-data";
import { technicianOnJob } from "@/lib/job-technicians";
import { can, type RoleId } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UploadGrant } from "@/lib/upload-grant";
import { NOT_ALLOWED, checkLater, grantActor, isRefusal, refuse, signedView, type Actor, type RegisterContext, type Refusal, type TargetSpec, type UploadBody } from "./common";

type Insp = { id: string; job_id: string; technician_id: string | null; status: InspectionRow["status"]; unlocked_until: string | null; submitted_at: string | null; approved_at: string | null; bodyshop_checked_at: string | null };
type Person = { id: string; role_id: string; department_id?: string | null; viewingAs?: unknown };

const KINDS = ["photo", "video", "pdf"];
const itemKeyOf = (body: UploadBody) => (body.itemKey ? String(body.itemKey) : "");

/** The inspection, null when it is gone, "error" when the database could not be asked (the file then waits). */
async function loadInspection(id: string): Promise<Insp | null | "error"> {
  const { data, error } = await createAdminClient().from("inspections").select("id, job_id, technician_id, status, unlocked_until, submitted_at, approved_at, bodyshop_checked_at").eq("id", id).maybeSingle();
  if (error) return "error";
  return (data as Insp | null) ?? null;
}

type Closed = "submitted" | "locked" | "checked" | null;

/**
 * Who may add a file to an inspection right now. The assigned technician (or one on the car), a workshop manager, an
 * advisor or QC while the report is open; the technician's own photos stop at Submit (the pre-scan PDF may still come).
 * Once approved the report is locked, except: the owner (his direct edit), the bodyshop findings for those who may still
 * change them (`canEditBody`), and road-test photos for the road-test roles while the car is in.
 * Returns the reason when not, and whether it is "closed" (a late file taken before it closed may still come in).
 */
async function allowed(p: Person, insp: Insp, body: UploadBody, contentType: string | null): Promise<true | { closed: Closed }> {
  if (p.viewingAs) return { closed: null };
  const role = p.role_id as RoleId;
  const key = itemKeyOf(body);
  if (role === "owner") return true;
  if (key.startsWith("body.")) {
    if (await canEditBody(p, insp)) return true;
    // Why the findings closed for this person - a photo taken before that still joins them when it lands late.
    if (insp.bodyshop_checked_at) return { closed: "checked" };
    if (inspectionLocked(insp)) return { closed: "locked" };
    if (insp.status === "submitted" || insp.status === "approved") return { closed: "submitted" };
    return { closed: null };
  }
  const onCar = role === "technician" && (insp.technician_id === p.id || (await technicianOnJob(insp.job_id, p.id)));
  const roadTester = key.startsWith("road.") && (can(role, "roadTest") || can(role, "approveInspections"));
  if (!(onCar || can(role, "approveInspections") || role === "service_advisor" || role === "qc_inspector" || roadTester)) return { closed: null };
  if (roadTester) {
    const { data: job } = await createAdminClient().from("jobs").select("is_open").eq("id", insp.job_id).maybeSingle();
    return job?.is_open ? true : { closed: null };
  }
  if (insp.status === "submitted" && role === "technician" && contentType !== "application/pdf") return { closed: "submitted" };
  if (inspectionLocked(insp)) return { closed: "locked" };
  return true;
}

function refusalOf(closed: Closed): Refusal {
  if (closed === "checked") return refuse("The bodyshop check is done. Ask the bodyshop manager to add the photo.", true);
  if (closed === "submitted") return refuse("The report was already sent to the manager. Ask the manager to add the photo.", true);
  if (closed === "locked") return refuse("The report is approved and locked. Ask the owner to add the photo.", true);
  return refuse(NOT_ALLOWED, true);
}

/** Inspection photos, videos (up to 60 seconds) and scan PDFs. Bucket inspection-media. */
export const inspectionTarget: TargetSpec = {
  target: "inspection",
  bucket: INSPECTION_BUCKET,
  types: { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/webm": "webm", "video/mp4": "mp4", "video/quicktime": "mov", "application/pdf": "pdf" },

  async authorise(inspectionId, body, contentType) {
    const staff = await getCurrentStaff();
    if (!staff) return refuse("Signed out. Sign in again and it will send.", false, 401);
    const insp = await loadInspection(inspectionId);
    if (insp === "error") return checkLater();
    if (!insp) return refuse("This inspection no longer exists.", true, 404);
    const ok = await allowed(staff, insp, body, contentType);
    return ok === true ? ({ staffId: staff.id, roleId: staff.role_id, via: "login" } satisfies Actor) : refusalOf(ok.closed);
  },

  async authoriseGrant(inspectionId, grant: UploadGrant, body, contentType, takenAt) {
    const actor = await grantActor(grant);
    if (isRefusal(actor)) return actor;
    if (!actor.staffId) return refuse(NOT_ALLOWED, true);
    const insp = await loadInspection(inspectionId);
    if (insp === "error") return checkLater();
    if (!insp) return refuse("This inspection no longer exists.", true, 404);
    const { data: person, error: personError } = await createAdminClient().from("staff").select("id, role_id, department_id").eq("id", actor.staffId).maybeSingle();
    if (personError) return checkLater();
    if (!person) return refuse(NOT_ALLOWED, true);
    const ok = await allowed(person as Person, insp, body, contentType);
    if (ok === true) return actor;
    // A file taken while the report was still open arrives late (no signal, a sleeping tablet): it still belongs to it.
    const closedAt = ok.closed === "submitted" ? insp.submitted_at : ok.closed === "locked" ? insp.approved_at : ok.closed === "checked" ? insp.bodyshop_checked_at : null;
    if (closedAt && takenAt <= Date.parse(closedAt) && takenAt >= grant.iat - 5 * 60_000) return actor;
    return refusalOf(ok.closed);
  },

  path(inspectionId, fileId, ext) {
    return `${inspectionId}/${fileId}.${ext}`;
  },

  owns(inspectionId, path) {
    return path.startsWith(`${inspectionId}/`) && !path.slice(inspectionId.length + 1).includes("/");
  },

  async register({ scopeId: inspectionId, path, actor, body, takenAt }: RegisterContext) {
    const kind = String(body.kind ?? "");
    if (!KINDS.includes(kind)) return refuse("That kind of file is not accepted here.", true, 400);
    const admin = createAdminClient();
    const { data: had } = await admin.from("inspection_media").select("id, inspection_id, uploaded_by").eq("storage_path", path).limit(1);
    const first = (had ?? [])[0] as { id: string; inspection_id: string; uploaded_by: string | null } | undefined;
    if (first && (first.inspection_id !== inspectionId || first.uploaded_by !== actor.staffId)) return refuse(NOT_ALLOWED, true);
    let id = first?.id ?? null;
    if (!first) {
      // A video's picture (a frame taken on the device): kept only when it really arrived in the same folder.
      let posterPath: string | null = null;
      const poster = kind === "video" && body.posterPath ? String(body.posterPath) : "";
      if (poster.startsWith(`${inspectionId}/`) && !poster.slice(inspectionId.length + 1).includes("/") && poster.endsWith(".jpg")) {
        const pName = poster.slice(poster.lastIndexOf("/") + 1);
        const { data: pListed } = await admin.storage.from(INSPECTION_BUCKET).list(inspectionId, { search: pName, limit: 1 });
        if (pListed?.some((f) => f.name === pName)) posterPath = poster;
      }
      const { data: row, error } = await admin
        .from("inspection_media")
        .insert({
          inspection_id: inspectionId,
          item_key: body.itemKey ? String(body.itemKey).slice(0, 120) : null,
          job_request_id: body.requestId ? String(body.requestId) : null,
          kind,
          is_prescan: !!body.isPrescan && kind === "pdf",
          storage_path: path,
          caption: body.caption ? String(body.caption).slice(0, 200) : null,
          duration_s: body.duration ? Math.round(Number(body.duration)) : null,
          poster_path: posterPath,
          taken_at: takenAt,
          uploaded_by: actor.staffId,
          created_by: actor.staffId,
          updated_by: actor.staffId,
        })
        .select("id")
        .single();
      if (error || !row) return refuse("Couldn't record the file – it will try again by itself.", false, 500);
      id = row.id as string;
    }
    return { ok: true, id, path, url: await signedView(INSPECTION_BUCKET, path), kind, isPrescan: !!body.isPrescan && kind === "pdf", caption: body.caption ? String(body.caption).slice(0, 200) : null };
  },
};
