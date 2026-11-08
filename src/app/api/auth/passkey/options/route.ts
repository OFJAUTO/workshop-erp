import { NextResponse, type NextRequest } from "next/server";
import { generateAuthenticationOptions, generateRegistrationOptions } from "@simplewebauthn/server";
import { isoUint8Array } from "@simplewebauthn/server/helpers";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/server";
import { getCurrentStaff } from "@/lib/auth";
import { logAppError } from "@/lib/app-errors";
import { isConfirmed, passkeyOnFor, passkeyRp, passkeysOf, passkeysReady, saveChallenge } from "@/lib/passkey-server";

export const dynamic = "force-dynamic";

const transportsOf = (t: string[]) => t as AuthenticatorTransportFuture[];

/**
 * Step 1 of every passkey ceremony: the browser asks for options and gets a one-time challenge.
 *   login    - anyone (sign-in page, tablet); a tablet name tap passes staffId so only that person's phones answer.
 *   confirm  - a signed-in person approves with a phone already set up (before adding another phone).
 *   register - a signed-in person adds a phone: the first freely, any further one only after "confirm".
 */
export async function POST(request: NextRequest) {
  const rp = passkeyRp();
  if (!rp || !(await passkeysReady())) return NextResponse.json({ error: "Passkeys are not switched on here." }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { purpose?: string; staffId?: string; where?: string };

  try {
    if (body.purpose === "login") {
      let allow: { id: string; transports: AuthenticatorTransportFuture[] }[] | undefined;
      if (body.staffId && /^[0-9a-f-]{36}$/i.test(body.staffId)) {
        const mine = await passkeysOf(body.staffId);
        if (mine.length) allow = mine.map((p) => ({ id: p.credential_id, transports: transportsOf(p.transports) }));
      }
      const options = await generateAuthenticationOptions({ rpID: rp.rpID, userVerification: "required", allowCredentials: allow, timeout: 120_000 });
      const challengeId = await saveChallenge("login", options.challenge, null);
      return NextResponse.json({ challengeId, options });
    }

    const staff = await getCurrentStaff();
    if (!staff) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
    if (staff.viewingAs || staff.actingAs) return NextResponse.json({ error: "Leave View as / Act as first: a phone is only ever set up by its own person." }, { status: 403 });
    if (!(await passkeyOnFor(staff))) return NextResponse.json({ error: "Passkeys are not used for your login." }, { status: 403 });
    const mine = await passkeysOf(staff.id);

    if (body.purpose === "confirm") {
      if (!mine.length) return NextResponse.json({ error: "You have no phone set up yet." }, { status: 400 });
      const options = await generateAuthenticationOptions({
        rpID: rp.rpID,
        userVerification: "required",
        allowCredentials: mine.map((p) => ({ id: p.credential_id, transports: transportsOf(p.transports) })),
        timeout: 120_000,
      });
      const challengeId = await saveChallenge("confirm", options.challenge, staff.id);
      return NextResponse.json({ challengeId, options });
    }

    if (body.purpose === "register") {
      if (mine.length > 0 && !(await isConfirmed(staff.id))) {
        return NextResponse.json({ error: "First approve with a phone you already set up.", needConfirm: true }, { status: 403 });
      }
      if (mine.length >= 10) return NextResponse.json({ error: "You already have 10 phones set up. Ask the owner to remove one you no longer use." }, { status: 400 });
      const options = await generateRegistrationOptions({
        rpName: rp.rpName,
        rpID: rp.rpID,
        userName: staff.email ?? staff.display_name,
        userDisplayName: staff.full_name,
        userID: isoUint8Array.fromUTF8String(staff.id),
        attestationType: "none",
        excludeCredentials: mine.map((p) => ({ id: p.credential_id, transports: transportsOf(p.transports) })),
        authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "required" },
        supportedAlgorithmIDs: [-7, -257],
        // On a PC the browser offers "use a phone" (the QR code) first; on a phone or tablet the device itself.
        preferredAuthenticatorType: body.where === "phone" ? "remoteDevice" : body.where === "here" ? "localDevice" : undefined,
        timeout: 180_000,
      });
      const challengeId = await saveChallenge("register", options.challenge, staff.id);
      return NextResponse.json({ challengeId, options });
    }
  } catch (err) {
    await logAppError("passkey.options", err, { detail: { purpose: body.purpose } });
    return NextResponse.json({ error: "Couldn't start – try again." }, { status: 500 });
  }
  return NextResponse.json({ error: "Bad request." }, { status: 400 });
}
