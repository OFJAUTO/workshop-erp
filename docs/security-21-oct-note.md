# Security lockdown — 21 October 2026

Supabase's advisor email (17 October) warned about two things: a public table with Row-Level Security off, and sensitive columns reachable through the API. Here is what the audit found, what was already fixed, what was fixed tonight, and the proof.

## What the audit found (before tonight)

- **RLS was already ON for all 91 public tables** — the advisor's `rls_disabled_in_public` warning referred to the recovery tables (`recovery_trips`, `recovery_drivers`, `recovery_payouts`), which were fixed in the 19 October batch, two days after the email.
- **No policy let the public key (anon) through anywhere.** A live probe with the anon key — the key every browser holds — could not read a single row of any table: customers, payments, staff, settings, tokens, all answered "permission denied" or empty.
- **But the surface was untidy:** anon still *held* dormant grants on 40 tables (old Supabase defaults; RLS was the only thing stopping it), six views ran as their owner (a way around RLS), every database function was executable by any key, and five server-only token tables were reachable by any logged-in session (RLS returned no rows, but they didn't need to be reachable at all).

## Was any secret exposed?

**No credential, token or key was ever readable.** Specifically checked, by name:
- `staff_private.pin_hash` (PINs are stored hashed) — owner-only policies, never readable by anon or other staff.
- `google_mailbox_tokens.refresh_token_enc` (the scans-mailbox token) — no grants, no policies, and the value is additionally encrypted at rest. **No need to disconnect/reconnect the mailbox**; doing it anyway is one click on /scans if you want a fresh token for peace of mind.
- Payment links, setup links, quick codes, invoice/quotation tokens, the service key — none reachable by anon; the service key exists only in server code and Vercel, never in `NEXT_PUBLIC_` (checked: the only `NEXT_PUBLIC_` values are the site address, the Supabase address and the public anon key — all public by design).

**What WAS exposed, historically:** until the 19 October fix, the three recovery tables had RLS off with grants present, so anyone holding the app's public key could have read **recovery driver names and phone numbers, trip prices, and customer delivery location pins**. No way to tell from logs whether anyone did. Nothing in those tables is a credential.

## What tonight changed (migrations `20261111200000` + `20261111210000`)

1. **anon can touch nothing**: every grant removed from all public tables, sequences and functions, and the default privileges changed so future tables never grant anon again.
2. **The six owner views are gone** (`customer_public`, `customer_vip_flags`, `workshop_board`, `gate_in_amendments`, `part_items_technician`, `quotation_part_lines`). The screens read the same narrow columns server-side instead — same behaviour, no RLS bypass left in the database.
3. **Server-only token tables are dark**: `short_links`, `payment_requests`, `payment_links`, `setup_links`, `quick_codes`, `google_mailbox_tokens` grant nothing to anon or authenticated; only server code with the service key touches them.
4. **Functions**: executable by signed-in staff and the server only (they power the row-level policies), not by the public key.

## The standing rules from now on

- **Every migration that creates a table** must itself: enable RLS, add the role policies, and grant explicitly (`authenticated` only when the user client touches it, `service_role` always, `anon` never). Supabase stops auto-granting on 30 October 2026 — our template already does it right: `supabase/migration-template.sql`. The rule is in CLAUDE.md.
- **`npm run test:security`** runs after every batch together with `npm run test:layout`. It fails if: any public table has RLS off, anon holds any grant or matches any policy, any function is anon-executable, any owner-view exists, a token table becomes reachable, or a live anon probe reads a row or a sensitive column (PIN hash, mailbox token, phone numbers, pay links, tokens).

## Proof

- Advisor-equivalent lints after the change: `rls_disabled_in_public` **0** · `policy_exists_rls_disabled` **0** · owner views **0** · anon grants **0 of 91 tables** · anon-executable functions **0**.
- Live anon probes after: every table "permission denied", the six views gone (404).
- `npm run test:security`: **all checks passed** (the same run before the change failed 9).
- The full after-table (every table: RLS, policies, grants): `docs/security-table-after.md`.
- App unchanged: 9 screens smoke-tested, `test:perms` 33/33, `test:live` 5/5, `test:paypage` 14/14.
- Backup taken first: `backups/2026-10-21T03-20-01` (91 tables, 127,413 rows).
