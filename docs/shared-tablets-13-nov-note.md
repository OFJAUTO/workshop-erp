# Section 3 – Shared tablets: workshop-floor staff only (13 November 2026, evening list)

## Read-only check on live, before the change

**Office people who could sign in by tile and PIN:**

| Name | Role | How they log in |
|---|---|---|
| KHADIJA | accounts | PIN only |
| Mathew | accounts | password and PIN |
| DEEPAK | gate-in | password and PIN |
| PETER | parts | password and PIN |

From this change, none of them shows on a shared tablet, and the server refuses their PIN there. DEEPAK, Mathew and PETER keep their password, and their own phone or PC. **KHADIJA has PIN only:** see NEEDS OMAR.

**Registered devices: all 12 have the department "not set".**
- Shared: Bodyshop shared, Mech 3, Mechanic 1, Mechanic Tablet 1, Mechanic Tablet 2, Mechanical 2, Test tablet.
- Personal: Ahmad Team Leader, AKHIL PAINT, Arsalan Khan, BODYSHOP MANAGER, SABIRE TEAM LEADER.

**The PIN lock** was 5 wrong PINs → 5 minutes, with no alert.

## What changed

- **A shared tablet shows only floor staff:** technicians (electricians and helpers have the technician role), team leaders, QC, and the workshop and bodyshop managers.
  - Office roles (accounts, advisors, gate-in, parts, owner) never appear as a tile, not even behind "Someone else?".
  - "How this person logs in" on the Team form still decides PIN / password / both.
- **The server refuses** an office login's PIN on a shared tablet: "Office logins never sign in on a shared tablet: use your own PC or phone." It is logged in the sign-in log.
  - A personal device keeps its own person, whatever their role (gate-in on their own phone still works).
- **Five wrong PINs** lock that tile for **15 minutes**, and you get a bell: "PIN locked: <name>".

## Proof (TEST only)

- `npm run test:s3-tablets`: **9 of 9**, on a registered shared tablet at 800 × 1280 and 1440 × 900. It covers:
  - no office tiles, not even behind "Someone else?";
  - accounts refused on the server;
  - the 15-minute lock and your bell.
- The passkey suite now uses gate-in's own personal device, which is the right setup under this rule.
- Screenshots: `docs/proof/2026-11-13-tablets/`.

## Assumptions

- Workshop and bodyshop managers stay on the shared tablets: they work on the floor and sign work there. Say if you want them off too.
- The lock is at least 15 minutes. The "minutes" setting can make it longer, never shorter.

## NEEDS OMAR

1. **Set each tablet's department:** left menu **Team → Tablets** (`/team/tablets`). For each tablet, tap **Workshop**, **Bodyshop** or **Both** under "Department". Suggested:
   - Mech 3, Mechanic 1, Mechanic Tablet 1, Mechanic Tablet 2, Mechanical 2 → **Workshop**;
   - Bodyshop shared → **Bodyshop**;
   - Test tablet → your choice.
   - The five personal devices can stay as they are: they show their own person only.
2. **KHADIJA (accounts) has "PIN only"**, so with this rule she has no way in on a shared tablet. Give her a password: **Team → KHADIJA → How this person logs in: Password** (or Both), then **Send setup link**.
