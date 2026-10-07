import "server-only";
import { getCurrentStaff } from "./auth";
import { can, type RoleId } from "./roles";
import { createAdminClient } from "./supabase/admin";

export type Uploader = { jobId: string; staffId: string | null; via: "login" | "link" };

/**
 * Who may add photos or video to a job: a logged-in gate-in user, or a phone
 * holding a valid short-lived upload link. Uploads through a link are recorded
 * under the person who created the link.
 */
export async function authoriseUpload(jobId: string, token: string | null | undefined): Promise<Uploader | null> {
  if (token) {
    const admin = createAdminClient();
    const { data } = await admin
      .from("upload_links")
      .select("id, job_id, expires_at, created_by")
      .eq("token", token)
      .maybeSingle();
    if (!data || data.job_id !== jobId || new Date(data.expires_at).getTime() < Date.now()) return null;
    await admin.from("upload_links").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
    return { jobId, staffId: data.created_by, via: "link" };
  }

  const staff = await getCurrentStaff();
  if (!staff || !can(staff.role_id as RoleId, "editGateIn")) return null;
  return { jobId, staffId: staff.id, via: "login" };
}
