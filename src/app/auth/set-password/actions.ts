"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logAppError } from "@/lib/app-errors";
import { passwordProblem, PASSWORDS_DIFFER_WORDS, supabasePasswordWords } from "@/lib/password-rules";
import { logSignInChange, passkeysReady } from "@/lib/passkey-server";

/** Change my password (THE rule in password-rules.ts; Supabase also refuses passwords found in data leaks). */
export async function setPassword(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const back = (words: string) => redirect("/auth/set-password?error=" + encodeURIComponent(words));

  const problem = passwordProblem(password);
  if (problem) back(problem);
  if (password !== confirm) back(PASSWORDS_DIFFER_WORDS);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    const words = supabasePasswordWords(error as { code?: string; message?: string; reasons?: string[] });
    if (!words) await logAppError("auth/set-password/actions", error, { staffId: user.id });
    back(words ?? "Could not save the password. Try again or tell the owner.");
  }
  await logSignInChange({ staffId: user.id, kind: "password_changed", by: user.id });

  if (await passkeysReady()) redirect("/account/sign-in?message=" + encodeURIComponent("Password changed."));
  redirect("/home");
}
