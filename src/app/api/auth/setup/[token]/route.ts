import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { markSetupTokenUsed, readSetupToken } from "@/lib/setup-links";
import { LOGIN_KIND_COOKIE, SESSION_UNTIL_COOKIE, sessionCookieOptions, sessionWindow } from "@/lib/session";

/** Saves the new password, marks the link used, and signs the person in. Nothing is used up before the password is saved. */
export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const origin = request.nextUrl.origin;
  const back = (message: string) =>
    NextResponse.redirect(`${origin}/auth/setup/${token}?error=${encodeURIComponent(message)}`, { status: 303 });

  const form = await request.formData();
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  if (password.length < 8) return back("Use at least 8 characters.");
  if (password !== confirm) return back("The two passwords do not match.");

  const link = await readSetupToken(token);
  if (!link || !link.email) return back("This link has expired or was already used. Ask the owner for a new one.");

  const admin = createAdminClient();
  const { error: pwError } = await admin.auth.admin.updateUserById(link.staff_id, { password, email_confirm: true });
  if (pwError) return back("Could not save the password: " + pwError.message);
  await markSetupTokenUsed(link.id);

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
  return NextResponse.redirect(`${origin}/home`, { status: 303 });
}
