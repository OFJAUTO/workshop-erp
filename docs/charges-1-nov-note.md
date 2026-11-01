# Early charges + Pending charges (1 November 2026, B2; J-00971)

Both use ONE set of charge lines and ONE form (`ChargeLinesEditor`). Each line has:

- a COST: what we pay (the provider from the saved list or typed, the supplier's TRN, and the bill attached);
- a CHARGE: what the customer pays, before VAT, or Free.

Free follows the complimentary rule: the owner approves it, and his own are approved at once.

## Early charges (on a car)

- **Where:** the job card, card "Charges (recovery, fuel, other)". The owner, the advisors and accounts can add them any time, before or after the check-in approval.
  - Recovery: provider, type and trips.
  - Fuel: litres and the receipt.
  - Other: parking, toll, towing extra.
- **Cost counts at once.** The job card shows the cost, the charge and the profit so far. A cost above its charge tells the owner. The bill or receipt is attached on the line.
- **Before the approval:** the customer's VEHICLE CHECK-IN shows "CHARGES ALREADY INCURRED", e.g. "RECOVERY – FULL DOWN, TWO WAYS: AED 630.00 including VAT (AED 600 + VAT)", in English and Arabic. The approval text adds "…and agree to pay the charges listed above, even if no further work is approved." Approving agrees them, and they are kept in the approval's snapshot.
- **After the approval:** the charge goes into the quotation (the open one, or a revision through the usual rule). It never goes silently onto the invoice.
- **"Customer declined all work":** the invoice carries the inspection fee (if any) plus every charge agreed on the check-in, even when there is no fee.
- **The final invoice** carries every agreed charge exactly once. Once invoiced, a line is locked (corrections by credit note).
- **The quotation's "+ Inspection fee" button** follows this job's fee choice: hidden for a free-inspection job (J-00971), otherwise this job's own amount.

## Pending charges (no gate-in)

- **Where:** menu > Pending charges, with the count next to it (never on the dashboard).
- **New entry:**
  - the customer: found by name or mobile, or a quick new one;
  - the car: picked, a quick new one (plate and make), or "No car on record";
  - the job, if the car came and went (optional);
  - the service date and the lines.
- **Saving makes its own PROFORMA:** own number, "This is not a tax invoice". It is never added to another job's bill. The advisor sends the link on WhatsApp (message ready, with Copy).
- **Payments:** pending → paid. Accounts record payments through the Record payment window, where the pending charge appears as a place for the money ("Allocate to Pending charge · … balance"). Part payments show as "AED 300 of 630 paid". Paid in full, the TAX INVOICE is issued by itself, with the payments moved onto it. Accounts can also "Issue tax invoice" earlier with a reason (logged).
- **Cancel** only with a reason (logged), and never once money was paid or a tax invoice exists.
- **The list:** "Pending X days", filters Pending / Paid / All, customer, provider and dates, totals ("Pending: 4 · AED 2,310.00"), and Export to Excel.
- **Reminder:** after the set number of days (Setting `pending_charges_reminder_days`, 7), the advisor who added it is reminded in Waiting on you (the owner and accounts see them all).
- **"Pending charge: AED 630.00 (recovery 12 Oct) – collect it"** shows on the gate-in, the quotation and the customer panel. It stays a separate bill.

## Fixed on the way

**Recording a second payment for the same place in the same tab was refused** ("This form was already used for RCT-…", even after a reload). The Record payment window's "recorded" screen took the form away before the form could renew its key. The window now renews it (`spendFormKey`). The payments-anytime test (69 checks) still passes.

**Customer pages scrolled sideways on phones since the capitals push.** The legal name, kept on one line, pushed the tax number off the screen. On a phone the tax number now sits under the name.

## Not finished

- **The charges' supplier bills do not post to Zoho yet.** A new kind is needed in the Zoho outbox.
- **On the profit page,** "Pending charges" are not a separate section yet. Their tax invoice counts like any invoice once issued.
- **A pending charge with no job** keeps no bill file (bill files belong to a job). A charge linked to a job does.

## For Mathew (VAT timing)

A pending charge's proforma can stay unpaid for a long time; the tax invoice is issued when it is paid in full (or by hand earlier). Please confirm that issuing the tax invoice at payment is right for VAT when the service (the recovery) was supplied weeks earlier, or whether the tax invoice must be issued within a set time of the service date.

## Database (WAITING FOR APPLY)

Migration `20261202150000_charges.sql` adds:

- the tables `charge_entries` and `charge_lines` (server only, audit trigger, no delete);
- `approval_requests.charges_snapshot`;
- the reminder setting.

Until it is applied, the Charges card, the check-in section and the Pending charges page say they switch on with the update.

## Proof

`npm run test:charges` (test database, 30 checks), screenshots in `tests/browser/shots/charges/`.
