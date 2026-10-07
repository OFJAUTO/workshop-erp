import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { LOGIN_KIND_COOKIE, SESSION_UNTIL_COOKIE } from "@/lib/session";

/** Signs the current person out. Tablet users go back to the PIN screen. */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let destination = "/login";
  if (user) {
    const { data } = await supabase.from("staff").select("login_type").eq("id", user.id).maybeSingle();
    if (data?.login_type === "pin") destination = "/tablet";
    await supabase.auth.signOut();
  } else if (request.cookies.get(LOGIN_KIND_COOKIE)?.value === "pin") {
    destination = "/tablet";
  }

  const res = NextResponse.redirect(new URL(destination, request.nextUrl.origin), { status: 303 });
  res.cookies.delete(SESSION_UNTIL_COOKIE);
  res.cookies.delete(LOGIN_KIND_COOKIE);
  return res;
}
