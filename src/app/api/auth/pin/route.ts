import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getCurrentDevice } from "@/lib/devices";
import { getSettings } from "@/lib/settings";
import { PIN_PATTERN, verifyPin } from "@/lib/pin";
import { cookies } from "next/headers";
import { LOGIN_KIND_COOKIE, SESSION_UNTIL_COOKIE, sessionCookieOptions, sessionWindow } from "@/lib/session";

/**
 * Tablet login: name + 4-digit PIN. Only works from a registered tablet.
 * Wrong PINs are counted; too many lock the name for a few minutes.
 */
export async function POST(request: NextRequest) {
  const device = await getCurrentDevice();
  if (!device) {
    return NextResponse.json({ error: "This tablet is not registered. Ask the owner." }, { status: 403 });
  }

  let body: { staffId?: string; pin?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const staffId = String(body.staffId ?? "");
  const pin = String(body.pin ?? "");
  if (!staffId || !PIN_PATTERN.test(pin)) {
    return NextResponse.json({ error: "Enter your 4-digit PIN." }, { status: 400 });
  }

  const admin = createAdminClient();
  const settings = await getSettings();

  const { data: staff } = await admin
    .from("staff")
    .select("id, display_name, login_type, is_active")
    .eq("id", staffId)
    .maybeSingle();
  if (!staff || !staff.is_active || staff.login_type !== "pin") {
    return NextResponse.json({ error: "This name cannot log in with a PIN." }, { status: 403 });
  }

  const { data: priv } = await admin
    .from("staff_private")
    .select("pin_hash, pin_failed_attempts, pin_locked_until")
    .eq("staff_id", staffId)
    .maybeSingle();

  const now = Date.now();
  if (priv?.pin_locked_until && new Date(priv.pin_locked_until).getTime() > now) {
    const minutes = Math.max(1, Math.ceil((new Date(priv.pin_locked_until).getTime() - now) / 60000));
    return NextResponse.json(
      { error: `Too many wrong PINs. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` },
      { status: 423 },
    );
  }

  if (!priv?.pin_hash) {
    return NextResponse.json({ error: "No PIN set yet. Ask the owner to set one." }, { status: 403 });
  }

  if (!verifyPin(pin, priv.pin_hash)) {
    const attempts = (priv.pin_failed_attempts ?? 0) + 1;
    const maxAttempts = Number(settings.pin_max_attempts) || 5;
    if (attempts >= maxAttempts) {
      const lockMinutes = Number(settings.pin_lock_minutes) || 5;
      await admin
        .from("staff_private")
        .update({
          pin_failed_attempts: 0,
          pin_locked_until: new Date(now + lockMinutes * 60000).toISOString(),
        })
        .eq("staff_id", staffId);
      return NextResponse.json(
        { error: `Too many wrong PINs. ${staff.display_name} is locked for ${lockMinutes} minutes.` },
        { status: 423 },
      );
    }
    await admin.from("staff_private").update({ pin_failed_attempts: attempts }).eq("staff_id", staffId);
    const left = maxAttempts - attempts;
    return NextResponse.json(
      { error: `Wrong PIN. ${left} attempt${left === 1 ? "" : "s"} left.` },
      { status: 401 },
    );
  }

  // Correct PIN: clear the counter, then open a session for this person.
  await admin
    .from("staff_private")
    .update({ pin_failed_attempts: 0, pin_locked_until: null })
    .eq("staff_id", staffId);

  const { data: userData, error: userError } = await admin.auth.admin.getUserById(staffId);
  if (userError || !userData.user?.email) {
    return NextResponse.json({ error: "Login record missing. Ask the owner." }, { status: 500 });
  }

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: userData.user.email,
  });
  if (linkError || !link.properties?.hashed_token) {
    return NextResponse.json({ error: "Could not start a session. Try again." }, { status: 500 });
  }

  const supabase = await createClient();
  const { error: sessionError } = await supabase.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "magiclink",
  });
  if (sessionError) {
    return NextResponse.json({ error: "Could not start a session. Try again." }, { status: 500 });
  }

  // Tablet sessions last one working day at most; the idle lock ends them sooner.
  const { untilMs, maxAgeSeconds } = sessionWindow(null);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_UNTIL_COOKIE, String(untilMs), sessionCookieOptions(maxAgeSeconds));
  cookieStore.set(LOGIN_KIND_COOKIE, "pin", sessionCookieOptions(maxAgeSeconds));

  await admin
    .from("devices")
    .update({ last_seen_at: new Date().toISOString(), last_staff_id: staffId })
    .eq("id", device.id);

  return NextResponse.json({ ok: true });
}
