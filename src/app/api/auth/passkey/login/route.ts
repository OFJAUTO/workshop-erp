import { NextResponse, type NextRequest } from "next/server";
import { verifyAuthenticationResponse, type AuthenticationResponseJSON, type AuthenticatorTransportFuture } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAppError } from "@/lib/app-errors";
import { passkeyPerson } from "@/lib/passkey-rules";
import { logSignIn, openSessionFor, passkeyByCredential, passkeyRollout, passkeyRp, passkeysReady, safeNext, takeChallenge } from "@/lib/passkey-server";

export const dynamic = "force-dynamic";

/**
 * Step 2 of a passkey sign-in: the phone's signed answer is checked here (Face ID / fingerprint required), then the
 * session is opened for the person the phone belongs to. Every outcome is written to sign_in_events.
 */
export async function POST(request: NextRequest) {
  const rp = passkeyRp();
  if (!rp || !(await passkeysReady())) return NextResponse.json({ error: "Passkeys are not switched on here." }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { challengeId?: string; response?: AuthenticationResponseJSON; next?: string };
  const response = body.response;
  if (!body.challengeId || !response?.id) return NextResponse.json({ error: "Bad request." }, { status: 400 });

  try {
    const challenge = await takeChallenge(body.challengeId, "login", null);
    if (!challenge) return NextResponse.json({ error: "That took too long. Press the button again." }, { status: 400 });

    const key = await passkeyByCredential(response.id);
    if (!key) {
      return NextResponse.json({ error: "This passkey is not known to the ERP. Sign in with your password, then set up your phone." }, { status: 401 });
    }
    if (key.removed_at) {
      await logSignIn({ staffId: key.staff_id, method: "passkey", ok: false, reason: "phone removed by the owner", passkeyId: key.id });
      return NextResponse.json({ error: "This phone was removed from your sign-in by the owner. Sign in with your password, then set up your phone again." }, { status: 401 });
    }

    const admin = createAdminClient();
    const { data: staff } = await admin.from("staff").select("id, role_id, team, department_id, is_active").eq("id", key.staff_id).maybeSingle();
    if (!staff || !staff.is_active) {
      await logSignIn({ staffId: key.staff_id, method: "passkey", ok: false, reason: "account disabled", passkeyId: key.id });
      return NextResponse.json({ error: "This account is disabled. Ask the owner." }, { status: 403 });
    }
    if (!passkeyPerson(staff, await passkeyRollout())) {
      await logSignIn({ staffId: staff.id, method: "passkey", ok: false, reason: "passkeys not on for this login", passkeyId: key.id });
      return NextResponse.json({ error: "Passkeys are not used for your login. Sign in the usual way." }, { status: 403 });
    }

    let verified = false;
    let newCounter = Number(key.counter) || 0;
    try {
      const result = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: rp.origins,
        expectedRPID: rp.rpID,
        credential: { id: key.credential_id, publicKey: isoBase64URL.toBuffer(key.public_key), counter: Number(key.counter) || 0, transports: key.transports as AuthenticatorTransportFuture[] },
        requireUserVerification: true,
      });
      verified = result.verified && result.authenticationInfo.userVerified;
      newCounter = result.authenticationInfo.newCounter;
    } catch (err) {
      await logSignIn({ staffId: staff.id, method: "passkey", ok: false, reason: "check failed: " + String((err as Error)?.message ?? err).slice(0, 120), passkeyId: key.id });
      return NextResponse.json({ error: "The phone's answer could not be checked. Try again." }, { status: 401 });
    }
    if (!verified) {
      await logSignIn({ staffId: staff.id, method: "passkey", ok: false, reason: "not verified with Face ID, fingerprint or the phone's PIN", passkeyId: key.id });
      return NextResponse.json({ error: "Approve with Face ID, fingerprint or the phone's PIN, then try again." }, { status: 401 });
    }

    await admin.from("staff_passkeys").update({ counter: newCounter, last_used_at: new Date().toISOString(), updated_by: staff.id }).eq("id", key.id);
    const opened = await openSessionFor(staff.id, "passkey");
    if (!opened.ok) {
      await logSignIn({ staffId: staff.id, method: "passkey", ok: false, reason: "session not opened", passkeyId: key.id });
      return NextResponse.json({ error: opened.words }, { status: 500 });
    }
    await logSignIn({ staffId: staff.id, method: "passkey", ok: true, passkeyId: key.id });
    return NextResponse.json({ ok: true, next: safeNext(body.next) });
  } catch (err) {
    await logAppError("passkey.login", err);
    return NextResponse.json({ error: "Couldn't sign in – try again." }, { status: 500 });
  }
}
