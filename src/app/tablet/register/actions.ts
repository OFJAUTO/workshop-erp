"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { DEVICE_COOKIE, deviceCookieOptions, hashDeviceToken, newDeviceToken } from "@/lib/devices";

export async function registerThisTablet(formData: FormData) {
  const owner = await requirePermission("manageTablets");

  const name = String(formData.get("name") ?? "").trim();
  const location = String(formData.get("location") ?? "");
  if (name.length < 2) {
    redirect("/tablet/register?error=" + encodeURIComponent("Give the tablet a name."));
  }
  if (!["workshop", "bodyshop", "office"].includes(location)) {
    redirect("/tablet/register?error=" + encodeURIComponent("Choose where the tablet lives."));
  }

  const token = newDeviceToken();
  const admin = createAdminClient();
  const { error } = await admin.from("devices").insert({
    name,
    location,
    token_hash: hashDeviceToken(token),
    registered_by: owner.id,
    created_by: owner.id,
    updated_by: owner.id,
  });
  if (error) {
    redirect("/tablet/register?error=" + encodeURIComponent("Could not register: " + error.message));
  }

  const cookieStore = await cookies();
  cookieStore.set(DEVICE_COOKIE, token, deviceCookieOptions());

  // The owner's own session must not stay on a shared tablet.
  const supabase = await createClient();
  await supabase.auth.signOut();

  redirect("/tablet");
}
