# Resend the vehicle check-in link anytime — 4 November 2026 (night)

What the owner asked for (queue of 4 November): the check-in link can always be sent again — on
the job card and on the gate-in details page, by the owner, advisors AND gate-in staff, before and
after approval — and after approval the link opens as a read-only record that never changes.

**Database change:** one settings row (`20261204150000_checkin_copy_template.sql`, the WhatsApp
wording for a post-approval resend) is on the WAITING FOR APPLY list with its backup
(`backups/2026-11-04T19-40-57`). Until applied the built-in wording is used; everything else works.

## What staff see

1. **Resend is always there** while the job is open:
   - On the job card's approval box: before approval the usual "Send again" / "Create a new link
     for someone else"; AFTER approval a new button — **"Resend the check-in link (opens
     read-only)"**.
   - On the **gate-in details page** (`/jobs/<id>/gate-in`): the same send control, now for
     gate-in staff too (they can open this page now; phones and money stay hidden from them under
     the customer-privacy rules).
2. **"Someone else…"** in the send window: pick the customer or type any number and name (a
   driver, the office) — exactly who it went to is logged every time.
3. **A resend EXPIRES the earlier links** (never an approved one): the old link's page says
   **"This link has expired – ask OFJ for a new one"** with a Call OFJ button, its PDF refuses
   too, and the server refuses an approval through it. Only the newest link works — same
   check-in, fresh link.
4. **After approval every link is read-only**: the photos, videos, damage list and agreed charges
   (from the approval's own snapshot), with "Approved by <name> … on <date>" — and NO approve
   button, whichever link the customer opens, including a brand-new one sent later. Nothing can
   ever be approved twice (the server checks the job, not just the link).
5. The post-approval resend message is its own Settings template ("WhatsApp: check-in link resent
   after approval") — the read-only copy wording, not the approval ask.

## Tests

`npm run test:resendcheckin` — 19 checks through the screens: create → resend to a typed number →
the old link's page/PDF/approval all refuse with the expired words → approve on the new link →
the post-approval resend with the copy wording → the fresh link read-only with the approver's
name and the videos → the gate-in details control for the advisor AND a real gate-in login.
Regressions: test-checkin and sim path a.
