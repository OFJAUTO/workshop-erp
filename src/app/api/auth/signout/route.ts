import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

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
  }

  return NextResponse.redirect(new URL(destination, request.nextUrl.origin), { status: 303 });
}
