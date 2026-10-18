import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { LOGIN_KIND_COOKIE, SESSION_UNTIL_COOKIE, sessionCookieOptions } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const PHONE_SESSION_SECONDS = 2 * 3600;

/**
 * Scanned from a phone: a quick code made on the tablet signs the same person in on the phone for
 * two hours and opens the car's screen. One use; dead after a minute.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ code: string }> }) {
  const { code } = await context.params;
  const origin = request.nextUrl.origin;
  const fail = (message: string) => NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(message)}`);
  const admin = createAdminClient();
  const { data: qc } = await admin.from("quick_codes").select("id, job_id, target, created_by, expires_at, used_at").eq("code", code).maybeSingle();
  if (!qc || !qc.created_by) return fail("This code is not valid.");
  if (qc.used_at) return fail("This code was already used. Make a new one on the tablet.");
  if (Date.parse(qc.expires_at) < Date.now()) return fail("This code ran out. Make a new one on the tablet.");
  const { error: useError } = await admin.from("quick_codes").update({ used_at: new Date().toISOString() }).eq("id", qc.id).is("used_at", null);
  if (useError) return fail("This code could not be used. Make a new one.");

  const { data: userData } = await admin.auth.admin.getUserById(qc.created_by);
  if (!userData.user?.email) return fail("Login record missing. Ask the owner.");
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email: userData.user.email });
  if (linkError || !link.properties?.hashed_token) return fail("Could not start a session. Try again.");
  const supabase = await createClient();
  const { error: sessionError } = await supabase.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (sessionError) return fail("Could not start a session. Try again.");
  const cookieStore = await cookies();
  cookieStore.set(SESSION_UNTIL_COOKIE, String(Date.now() + PHONE_SESSION_SECONDS * 1000), sessionCookieOptions(PHONE_SESSION_SECONDS));
  cookieStore.set(LOGIN_KIND_COOKIE, "quick", sessionCookieOptions(PHONE_SESSION_SECONDS));

  const anchor = qc.target && qc.target !== "inspection" ? `#item-${qc.target}` : "";
  return NextResponse.redirect(`${origin}/my-jobs/${qc.job_id}${anchor}`);
}
