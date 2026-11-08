import { NextResponse, type NextRequest } from "next/server";
import { verifyAuthenticationResponse, type AuthenticationResponseJSON, type AuthenticatorTransportFuture } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { getCurrentStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAppError } from "@/lib/app-errors";
import { markConfirmed, passkeyByCredential, passkeyOnFor, passkeyRp, passkeysReady, takeChallenge } from "@/lib/passkey-server";

export const dynamic = "force-dynamic";

/** Approve with a phone already set up: allows adding another phone in the next five minutes. */
export async function POST(request: NextRequest) {
  const rp = passkeyRp();
  if (!rp || !(await passkeysReady())) return NextResponse.json({ error: "Passkeys are not switched on here." }, { status: 404 });
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (staff.viewingAs || staff.actingAs) return NextResponse.json({ error: "Leave View as / Act as first." }, { status: 403 });
  if (!(await passkeyOnFor(staff))) return NextResponse.json({ error: "Passkeys are not used for your login." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { challengeId?: string; response?: AuthenticationResponseJSON };
  if (!body.challengeId || !body.response?.id) return NextResponse.json({ error: "Bad request." }, { status: 400 });

  try {
    const challenge = await takeChallenge(body.challengeId, "confirm", staff.id);
    if (!challenge) return NextResponse.json({ error: "That took too long. Press the button again." }, { status: 400 });
    const key = await passkeyByCredential(body.response.id);
    if (!key || key.removed_at || key.staff_id !== staff.id) return NextResponse.json({ error: "Use a phone that is already set up for you." }, { status: 401 });
    try {
      const result = await verifyAuthenticationResponse({
        response: body.response,
        expectedChallenge: challenge,
        expectedOrigin: rp.origins,
        expectedRPID: rp.rpID,
        credential: { id: key.credential_id, publicKey: isoBase64URL.toBuffer(key.public_key), counter: Number(key.counter) || 0, transports: key.transports as AuthenticatorTransportFuture[] },
        requireUserVerification: true,
      });
      if (!result.verified || !result.authenticationInfo.userVerified) return NextResponse.json({ error: "Approve with Face ID, fingerprint or the phone's PIN." }, { status: 401 });
      await createAdminClient().from("staff_passkeys").update({ counter: result.authenticationInfo.newCounter, last_used_at: new Date().toISOString(), updated_by: staff.id }).eq("id", key.id);
    } catch {
      return NextResponse.json({ error: "The phone's answer could not be checked. Try again." }, { status: 401 });
    }
    await markConfirmed(staff.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    await logAppError("passkey.confirm", err, { staffId: staff.id });
    return NextResponse.json({ error: "Couldn't check – try again." }, { status: 500 });
  }
}
