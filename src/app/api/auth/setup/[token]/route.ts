import { logAppError } from "@/lib/app-errors";
import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { markSetupTokenUsed, readSetupToken } from "@/lib/setup-links";
import { LOGIN_KIND_COOKIE, SESSION_UNTIL_COOKIE, sessionCookieOptions, sessionWindow } from "@/lib/session";
import { passwordProblem, PASSWORDS_DIFFER_WORDS, supabasePasswordWords } from "@/lib/password-rules";
import { logSignIn, logSignInChange, passkeyOnFor } from "@/lib/passkey-server";

/** Saves the new password, marks the link used, and signs the person in. Nothing is used up before the password is saved. */
export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const origin = request.nextUrl.origin;
  const back = (message: string) =>
    NextResponse.redirect(`${origin}/auth/setup/${token}?error=${encodeURIComponent(message)}`, { status: 303 });

  const form = await request.formData();
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  const problem = passwordProblem(password);
  if (problem) return back(problem);
  if (password !== confirm) return back(PASSWORDS_DIFFER_WORDS);

  const link = await readSetupToken(token);
  if (!link || !link.email) return back("This link has expired or was already used. Ask the owner for a new one.");

  const admin = createAdminClient();
  const { error: pwError } = await admin.auth.admin.updateUserById(link.staff_id, { password, email_confirm: true });
  if (pwError) {
    const words = supabasePasswordWords(pwError as { code?: string; message?: string; reasons?: string[] });
    if (!words) await logAppError("api/auth/setup/[token]", pwError, { staffId: link.staff_id });
    return back(words ?? "Could not save the password. Try again or ask the owner for a new link.");
  }
  await markSetupTokenUsed(link.id);
  await logSignInChange({ staffId: link.staff_id, kind: "password_set", by: link.staff_id });

  // Sign them in straight away.
  const { data: ml, error: mlError } = await admin.auth.admin.generateLink({ type: "magiclink", email: link.email });
  if (mlError || !ml.properties?.hashed_token) {
    return NextResponse.redirect(`${origin}/login?message=${encodeURIComponent("Password saved. Please sign in.")}`, { status: 303 });
  }
  const supabase = await createClient();
  const { error: sessionError } = await supabase.auth.verifyOtp({ token_hash: ml.properties.hashed_token, type: "magiclink" });
  if (sessionError) {
    return NextResponse.redirect(`${origin}/login?message=${encodeURIComponent("Password saved. Please sign in.")}`, { status: 303 });
  }
  const { untilMs, maxAgeSeconds } = sessionWindow(null);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_UNTIL_COOKIE, String(untilMs), sessionCookieOptions(maxAgeSeconds));
  cookieStore.set(LOGIN_KIND_COOKIE, "pc", sessionCookieOptions(maxAgeSeconds));
  await logSignIn({ staffId: link.staff_id, method: "setup_link", ok: true });
  // A new passkey user sets up their phone straight away (7 November 2026).
  const { data: person } = await admin.from("staff").select("id, role_id, team, department_id").eq("id", link.staff_id).maybeSingle();
  if (person && (await passkeyOnFor(person))) return NextResponse.redirect(`${origin}/passkey/setup?next=%2Fhome`, { status: 303 });
  return NextResponse.redirect(`${origin}/home`, { status: 303 });
}
