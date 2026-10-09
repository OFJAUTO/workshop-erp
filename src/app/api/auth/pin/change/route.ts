import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { PIN_PATTERN, hashPin, verifyPin } from "@/lib/pin";
import { createAdminClient } from "@/lib/supabase/admin";

/** The person chooses their own PIN on first use of a temporary one (or any time from the tablet). Nobody else ever sees it. */
export async function POST(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff || staff.viewingAs || staff.actingAs) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  let body: { pin?: string; again?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Enter the new PIN." }, { status: 400 });
  }
  const pin = String(body.pin ?? "");
  if (!PIN_PATTERN.test(pin)) return NextResponse.json({ error: "The PIN is 4 digits." }, { status: 400 });
  if (body.again !== undefined && body.again !== pin) return NextResponse.json({ error: "The two PINs do not match." }, { status: 400 });
  if (/^(\d)\1{3}$/.test(pin) || pin === "1234" || pin === "0000") return NextResponse.json({ error: "Choose a PIN that is harder to guess." }, { status: 400 });
  const admin = createAdminClient();
  const { data: priv } = await admin.from("staff_private").select("pin_hash").eq("staff_id", staff.id).maybeSingle();
  if (priv?.pin_hash && verifyPin(pin, priv.pin_hash)) return NextResponse.json({ error: "That is the temporary PIN. Choose a new one." }, { status: 400 });
  const { error } = await admin.from("staff_private").update({ pin_hash: hashPin(pin), pin_must_change: false, pin_failed_attempts: 0, pin_locked_until: null, pin_updated_at: new Date().toISOString(), updated_by: staff.id }).eq("staff_id", staff.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
