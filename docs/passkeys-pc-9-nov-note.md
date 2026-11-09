# Passkeys on the office PCs: why the phone hangs on "Connecting…" (9 November 2026)

**Short answer to your question:** yes. Today someone with a passkey can still sign in with their **email and password**. It is their backup: every use is logged, and you get a bell. The only thing refused today is the 4-digit **PIN** on a tablet for a person who has a phone set up (they see "Sign in with passkey" instead). Once you tick a role under **Require passkey**, people in that role who have a passkey can no longer use the password.

## How "phone signs in on the PC" works

When the PC shows the QR code and the phone scans it, the two use **two paths at the same time**. Both must work:

1. **Bluetooth Low Energy (BLE)**: the phone proves it is physically next to the PC. The PC only *listens* for the phone's short Bluetooth signal; nothing is paired.
2. **The internet**: the phone and the PC exchange the actual sign-in through a relay server.
   - Google's relay (used by Edge and Chrome on Windows): `cable.ua5v.com`.
   - Apple's relay (an iPhone): `cable.auth.com`.

"Connecting…" that never finishes means one of the two paths is blocked. Bluetooth, Wi-Fi, iCloud Keychain, PIN and Face ID being on (all fine on your side) is not enough when the PC itself can't receive Bluetooth LE, or the office network blocks the relay.

## What to change, in order (on one office PC first)

1. **Check the PC's Bluetooth supports "Bluetooth Low Energy".**
   - Open Device Manager › Bluetooth.
   - A very old or USB-dongle adapter often cannot receive the phone's signal.
   - Test: on that PC go to Settings › Bluetooth & devices and add any Bluetooth LE device (a mouse or earbuds). If the PC never finds anything, the adapter is the problem: a cheap Bluetooth 5.0 USB adapter fixes it.
2. **Windows settings**:
   - Settings › Bluetooth & devices: Bluetooth **On**.
   - Settings › Bluetooth & devices › Devices › "Bluetooth devices discovery": **Advanced**.
   - Settings › Accounts › Passkeys (Windows 11): leave it on.
3. **The office network or firewall must let the PC and the phone reach the relays.** This is the most common cause in an office.
   - Allow outgoing **HTTPS / secure WebSocket (port 443)** to `cable.ua5v.com` and `cable.auth.com`.
   - If the office Wi-Fi blocks "unknown" websites or uses web filtering, add both names to the allowed list.
   - Test: put the phone on **mobile data** (Wi-Fi off) and try again.
     - If it works on mobile data, the office network is blocking the phone.
     - If the PC is the one blocked, open `https://cable.ua5v.com` in Edge on the PC. A blank or error page is normal; a "blocked by policy/firewall" page is the problem.
4. **Edge and Chrome up to date** (Settings › About). Older versions had passkey bugs over Bluetooth.
5. **The iPhone**:
   - Settings › Passwords › Password Options › allow filling from **Passwords** (iCloud Keychain).
   - Bluetooth on in Settings (not just the Control Centre toggle, which only disconnects devices).

## Until the PCs are fixed

The ERP now shows the steps after 30 seconds. The simplest way is to set the passkey up **on the phone itself**: open erp.ofjauto.com on the phone, sign in, Add passkey. Signing in on the phone then works at once. On the PC the password stays the backup until you switch on Require passkey for that role.
