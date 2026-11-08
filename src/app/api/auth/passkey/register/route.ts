import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { verifyRegistrationResponse, type RegistrationResponseJSON } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { getCurrentStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAppError } from "@/lib/app-errors";
import { notifyStaff } from "@/lib/notifications";
import { cleanPasskeyName, defaultPasskeyName } from "@/lib/passkey-rules";
import { clearConfirmed, isConfirmed, logSignInChange, ownerIds, passkeyCount, passkeyOnFor, passkeyRp, passkeysReady, takeChallenge } from "@/lib/passkey-server";

export const dynamic = "force-dynamic";

/**
 * Step 2 of adding a phone: the new passkey is checked (Face ID / fingerprint required) and kept. The first phone
 * needs only the signed-in session; any further phone needs a fresh approval with a phone already set up. The owner
 * and the person are both told, so a phone added by someone else is noticed at once.
 */
export async function POST(request: NextRequest) {
  const rp = passkeyRp();
  if (!rp || !(await passkeysReady())) return NextResponse.json({ error: "Passkeys are not switched on here." }, { status: 404 });
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (staff.viewingAs || staff.actingAs) return NextResponse.json({ error: "Leave View as / Act as first." }, { status: 403 });
  if (!(await passkeyOnFor(staff))) return NextResponse.json({ error: "Passkeys are not used for your login." }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as { challengeId?: string; response?: RegistrationResponseJSON; name?: string };
  if (!body.challengeId || !body.response?.id) return NextResponse.json({ error: "Bad request." }, { status: 400 });

  try {
    const existing = await passkeyCount(staff.id);
    if (existing > 0 && !(await isConfirmed(staff.id))) {
      return NextResponse.json({ error: "First approve with a phone you already set up.", needConfirm: true }, { status: 403 });
    }
    const challenge = await takeChallenge(body.challengeId, "register", staff.id);
    if (!challenge) return NextResponse.json({ error: "That took too long. Press the button again." }, { status: 400 });

    let info;
    try {
      const result = await verifyRegistrationResponse({
        response: body.response,
        expectedChallenge: challenge,
        expectedOrigin: rp.origins,
        expectedRPID: rp.rpID,
        requireUserVerification: true,
      });
      if (!result.verified || !result.registrationInfo || !result.registrationInfo.userVerified) {
        return NextResponse.json({ error: "Approve with Face ID, fingerprint or the phone's PIN, then try again." }, { status: 400 });
      }
      info = result.registrationInfo;
    } catch (err) {
      await logAppError("passkey.register.verify", err, { staffId: staff.id });
      return NextResponse.json({ error: "The phone's answer could not be checked. Try again." }, { status: 400 });
    }

    const ua = ((await headers()).get("user-agent") ?? "").slice(0, 300);
    const name = cleanPasskeyName(body.name) ?? defaultPasskeyName(ua, info.aaguid);
    const admin = createAdminClient();
    const { data: row, error } = await admin
      .from("staff_passkeys")
      .insert({
        staff_id: staff.id,
        credential_id: info.credential.id,
        public_key: isoBase64URL.fromBuffer(info.credential.publicKey),
        counter: info.credential.counter,
        transports: body.response.response?.transports ?? info.credential.transports ?? [],
        device_type: info.credentialDeviceType,
        backed_up: info.credentialBackedUp,
        aaguid: info.aaguid,
        name,
        user_agent: ua || null,
        created_by: staff.id,
        updated_by: staff.id,
      })
      .select("id")
      .single();
    if (error || !row) {
      if (error?.code === "23505") return NextResponse.json({ error: "This phone is already set up for you." }, { status: 409 });
      await logAppError("passkey.register.insert", error ?? new Error("no row"), { staffId: staff.id });
      return NextResponse.json({ error: "Couldn't save – nothing was recorded. Try again or tell the owner." }, { status: 500 });
    }
    await clearConfirmed();
    await logSignInChange({ staffId: staff.id, kind: "passkey_added", detail: name, passkeyId: row.id as string, by: staff.id });

    await notifyStaff([staff.id], {
      type: "passkey_added",
      title: `Phone added to your sign-in: ${name}`,
      body: "If this was not you, tell the owner straight away.",
      href: "/account/sign-in",
    });
    if (staff.role_id !== "owner") {
      await notifyStaff(await ownerIds(), {
        type: "passkey_added",
        title: `${staff.display_name} set up a phone to sign in: ${name}`,
        body: existing > 0 ? `Phone number ${existing + 1}, approved with a phone already set up.` : "Their first phone.",
        href: `/team/${staff.id}#sign-in`,
      });
    }
    return NextResponse.json({ ok: true, name });
  } catch (err) {
    await logAppError("passkey.register", err, { staffId: staff.id });
    return NextResponse.json({ error: "Couldn't save – nothing was recorded. Try again or tell the owner." }, { status: 500 });
  }
}
