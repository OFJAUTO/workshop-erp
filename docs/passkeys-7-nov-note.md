# Login security upgrade (passkeys), 7 November 2026

## The decision

Supabase has passkeys only as an experimental beta (since 28 May 2026), with open reports of registration failing on
Windows and iPhone, no way to require Face ID / fingerprint, and any signed-in person able to add or delete their own
passkeys from the browser. The owner chose our own passkeys (7 November 2026):

- **SimpleWebAuthn** (`@simplewebauthn/server` 13.3.3, `@simplewebauthn/browser` 13.3.0, exact versions; v14 skipped,
  its newest release was a day old).
- Public keys in our own server-only table; the Supabase session is opened the way the PIN login always has (admin
  magic link verified on the server). Supabase's `passkey_enabled` stays false.
- PIN no longer signs a passkey user in once a phone is set up (still signs hand-overs).
- Sign-in lasts **12 hours** after login for passkey users ("Keep me signed in" ignored for them).
- Password sign-in by someone who has a phone: logged, and the owner gets a bell.

## Who

`PASSKEY_ROLES` in `src/lib/passkey-rules.ts`: owner, service_advisor, parts, gate_in, accounts, qc_inspector,
workshop_manager — except a workshop manager on the bodyshop side (`sideOfPerson`). Team leaders, technicians and the
bodyshop manager keep everything as it was. `settings.passkeys_rollout`: `owner` (only the owner, the migration's
start) or `all`, switched by the owner at Team › Sign-ins.

## Where

- Rules (pure): `src/lib/passkey-rules.ts`, `src/lib/password-rules.ts` (THE password rule and its words).
- Server: `src/lib/passkey-server.ts` (relying party: live `erp.ofjauto.com`, the test server `localhost`, none for a
  dev server on the live database; challenges; the "approved with a phone" cookie for adding another phone; opening the
  session; the two logs), `src/lib/sign-in-data.ts` (log and overview reads).
- Routes: `/api/auth/passkey/options|login|register|confirm|skip`; `/api/auth/login` (12 h, backup bell, setup
  redirect), `/api/auth/pin` (refuses a passkey user with a phone), `/api/auth/setup/[token]` (rule, then the setup).
- Screens: `/login` (passkey button first), `/passkey/setup` ("Set up your phone", "Not now" logged), `/account/sign-in`
  (My sign-in, from the menu under the name), `/team/sign-ins` (owner: rollout, people, the log), the "Sign-in phones"
  card on `/team/[id]` (owner: Remove with a reason, Reset), the tablet name tap (`PinLogin`), `PasswordBox` on the
  setup-link and change-password screens.
- Proxy: a sign-in of a passkey user that ends more than 12 h from now is cut back (checked at most hourly per long
  sign-in, cookie `erp_cap_checked`; nothing happens before the migration because the settings row is missing).
- Housekeeping step 30 removes passkey challenges older than a day.
- Migration `20261208090000_passkeys.sql`: `staff_passkeys`, `passkey_challenges`, `sign_in_events`,
  `sign_in_changes` (all server-only; in the security test's SERVER_ONLY), setting `passkeys_rollout`.
- Supabase Auth settings (Management API PATCH `/config/auth`): `password_min_length` 10,
  `password_required_characters` lower:upper:digits, `password_hibp_enabled` true. ON on the TEST project since
  7 November; on live with the owner's apply.

## Proven on TEST

`npm run test:passkeys` (64 checks, Edge's virtual passkey through Chrome DevTools WebAuthn): sign-in page; first
password sign-in → setup; 12 h even with "Keep me signed in"; Face ID required (`userVerification: required`);
"Use my phone" asks the browser for the phone first (`hints: ["hybrid"]`); setup, logs and both bells; passkey
sign-in; password backup + bell; a second phone only after approving with the first; owner removes a phone (reason,
log, the phone refused with words); reset; gate-in "Not now", PIN refused once a phone exists, the tablet passkey
button; bodyshop manager and technician unchanged and refused; a 30-day sign-in cut to 12 h; change password (rule,
leaked password refused, log); rollout `owner` leaves others as before; a new person: setup link → password →
phone setup. Also proven by hand on TEST: admin and user password paths both enforce the rule and the leak check, and a
password set before the rule still signs in.

Proof screenshots: `docs/proof/2026-11-07-passkeys/` (01 login, 02–03 setup on a PC, 04 My sign-in with two phones,
05 owner's Sign-ins, 06 the person's card, 07 setup on a phone, 08 tablet passkey, 09 change password).

## Bluetooth

Every office PC where someone uses their phone as the passkey needs Bluetooth on (and the phone needs internet). A
desktop without Bluetooth needs a USB Bluetooth adapter. Phones and tablets signing in on themselves need nothing.
Android phones can be remembered by the PC after the first QR code; iPhones scan the QR code each time.

## Lessons

- Supabase's new auth settings take about a minute to apply; tests in that minute see the old rule.
- `String.replace` with a replacement holding `$$` writes `$` (it broke a `do $$` block in the clean-up SQL): patch
  with split/join.
- Playwright's full-page screenshot drops the touch emulation for the capture, so a `(pointer: coarse)` screen flips to
  its PC look in the picture; the setup also takes the browser's own word (phone UA), and an iPad (which says Mac) by
  its touch screen.
