import { NextResponse, type NextRequest } from "next/server";
import { ACT_AS_COOKIE, VIEW_AS_COOKIE } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * A tab tells the server which mode it is in: { kind: "view" | "act", id } or { kind: "none" }. Only the
 * owner's own login may do this; the cookie then follows the tab that is in front.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const admin = createAdminClient();
  const { data: me } = await admin.from("staff").select("role_id, is_active").eq("id", user.id).maybeSingle();
  if (!me || !me.is_active || me.role_id !== "owner") return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { kind?: string; id?: string };
  const res = NextResponse.json({ ok: true });
  res.cookies.set(VIEW_AS_COOKIE, "", { path: "/", maxAge: 0 });
  res.cookies.set(ACT_AS_COOKIE, "", { path: "/", maxAge: 0 });
  if ((body.kind === "view" || body.kind === "act") && body.id && body.id !== user.id) {
    const { data: other } = await admin.from("staff").select("id").eq("id", body.id).eq("is_active", true).maybeSingle();
    if (other) res.cookies.set(body.kind === "view" ? VIEW_AS_COOKIE : ACT_AS_COOKIE, body.id, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 4 });
  }
  return res;
}
