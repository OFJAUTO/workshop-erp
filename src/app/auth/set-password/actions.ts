"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function setPassword(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 8) {
    redirect("/auth/set-password?error=" + encodeURIComponent("Use at least 8 characters."));
  }
  if (password !== confirm) {
    redirect("/auth/set-password?error=" + encodeURIComponent("The two passwords do not match."));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    redirect("/auth/set-password?error=" + encodeURIComponent(error.message));
  }

  redirect("/home");
}
