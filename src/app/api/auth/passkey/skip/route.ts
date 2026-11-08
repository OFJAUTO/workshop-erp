import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { logSignInChange, safeNext } from "@/lib/passkey-server";

/** "Not now": the person goes on with their password sign-in; the setup is asked again at the next sign-in. Logged. */
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const next = safeNext(form.get("next"));
  const staff = await getCurrentStaff();
  if (staff && !staff.viewingAs && !staff.actingAs) {
    await logSignInChange({ staffId: staff.id, kind: "setup_skipped", by: staff.id });
  }
  return NextResponse.redirect(new URL(next, request.nextUrl.origin), { status: 303 });
}
