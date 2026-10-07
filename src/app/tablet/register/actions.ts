"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { DEVICE_COOKIE, deviceCookieOptions, hashDeviceToken, newDeviceToken } from "@/lib/devices";

/** Owner only, done on the device itself. Shared devices show the name grid; personal ones open straight to one person's PIN. */
export async function registerThisTablet(formData: FormData) {
  const owner = await requirePermission("manageTablets");

  const name = String(formData.get("name") ?? "").trim();
  const kind = String(formData.get("kind") ?? "shared");
  const location = String(formData.get("location") ?? "workshop");
  const staffId = String(formData.get("staff_id") ?? "");
  if (name.length < 2) redirect("/tablet/register?error=" + encodeURIComponent("Give the device a name."));
  if (!["shared", "personal"].includes(kind)) redirect("/tablet/register?error=" + encodeURIComponent("Choose shared or personal."));
  if (kind === "shared" && !["workshop", "bodyshop", "office"].includes(location)) {
    redirect("/tablet/register?error=" + encodeURIComponent("Choose where the device lives."));
  }

  const admin = createAdminClient();
  if (kind === "personal") {
    const { data: person } = await admin.from("staff").select("id, login_type, is_active").eq("id", staffId).maybeSingle();
    if (!person || !person.is_active || person.login_type === "password") {
      redirect("/tablet/register?error=" + encodeURIComponent("Choose a person who has handheld login."));
    }
  }

  const token = newDeviceToken();
  const { error } = await admin.from("devices").insert({
    name,
    kind,
    location: kind === "personal" ? "personal" : location,
    staff_id: kind === "personal" ? staffId : null,
    token_hash: hashDeviceToken(token),
    registered_by: owner.id,
    created_by: owner.id,
    updated_by: owner.id,
  });
  if (error) redirect("/tablet/register?error=" + encodeURIComponent("Could not register: " + error.message));

  const cookieStore = await cookies();
  cookieStore.set(DEVICE_COOKIE, token, deviceCookieOptions());

  // The owner's own session must not stay on the device.
  const supabase = await createClient();
  await supabase.auth.signOut();

  redirect("/tablet");
}
