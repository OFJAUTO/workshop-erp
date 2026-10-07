import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { createAdminClient } from "./supabase/admin";

export const SETUP_LINK_HOURS = 24;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/** Makes a new 24-hour setup link for a person and retires any older unused ones. Returns the raw token for the link. */
export async function issueSetupToken(staffId: string, createdBy: string | null): Promise<string> {
  const admin = createAdminClient();
  const token = randomBytes(24).toString("base64url");
  await admin
    .from("setup_links")
    .update({ expires_at: new Date().toISOString() })
    .eq("staff_id", staffId)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString());
  const { error } = await admin.from("setup_links").insert({
    staff_id: staffId,
    token_hash: hashToken(token),
    expires_at: new Date(Date.now() + SETUP_LINK_HOURS * 3600 * 1000).toISOString(),
    created_by: createdBy,
  });
  if (error) throw new Error(error.message);
  return token;
}

export type SetupLink = { id: string; staff_id: string; full_name: string; email: string | null };

/** The person behind a setup link, or null if the link is unknown, used or expired. Reading it changes nothing. */
export async function readSetupToken(token: string): Promise<SetupLink | null> {
  if (!token || token.length < 16) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("setup_links")
    .select("id, staff_id, used_at, expires_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (!data || data.used_at || new Date(data.expires_at).getTime() < Date.now()) return null;
  const { data: staff } = await admin.from("staff").select("full_name, is_active").eq("id", data.staff_id).maybeSingle();
  if (!staff || !staff.is_active) return null;
  const { data: user } = await admin.auth.admin.getUserById(data.staff_id);
  return { id: data.id, staff_id: data.staff_id, full_name: staff.full_name, email: user.user?.email ?? null };
}

export async function markSetupTokenUsed(id: string) {
  const admin = createAdminClient();
  await admin.from("setup_links").update({ used_at: new Date().toISOString() }).eq("id", id);
}
