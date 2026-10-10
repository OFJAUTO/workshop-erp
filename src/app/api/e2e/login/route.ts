import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { LOGIN_KIND_COOKIE, SESSION_UNTIL_COOKIE, sessionCookieOptions, sessionWindow } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Signs the test script in as one staff member on the local server, so it can read every page. Never in production. */
export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production" || !process.env.E2E_SECRET || request.headers.get("x-e2e-secret") !== process.env.E2E_SECRET) {
    return NextResponse.json({ error: "Not available." }, { status: 404 });
  }
  const body = (await request.json().catch(() => ({}))) as { role?: string; id?: string };
  const admin = createAdminClient();
  const { data: staff } = body.id ? await admin.from("staff").select("id, display_name").eq("id", body.id).maybeSingle() : await admin.from("staff").select("id, display_name").eq("role_id", body.role ?? "owner").eq("is_active", true).order("display_name").limit(1).maybeSingle();
  if (!staff) return NextResponse.json({ error: "No such person." }, { status: 400 });
  const { data: userData } = await admin.auth.admin.getUserById(staff.id);
  if (!userData.user?.email) return NextResponse.json({ error: "No login record." }, { status: 400 });
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: userData.user.email });
  if (error || !link.properties?.hashed_token) return NextResponse.json({ error: error?.message ?? "No link." }, { status: 500 });
  const supabase = await createClient();
  const { error: sessionError } = await supabase.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (sessionError) return NextResponse.json({ error: sessionError.message }, { status: 500 });
  const { untilMs, maxAgeSeconds } = sessionWindow(null);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_UNTIL_COOKIE, String(untilMs), sessionCookieOptions(maxAgeSeconds));
  cookieStore.set(LOGIN_KIND_COOKIE, "pc", sessionCookieOptions(maxAgeSeconds));
  return NextResponse.json({ ok: true, name: staff.display_name });
}
