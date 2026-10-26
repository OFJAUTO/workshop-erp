# Zoho Books integration — the plan (26 October 2026)

Accounting moves to Zoho Books. **The ERP stays where staff work; Zoho is the accountant's book.** The sync is
**one-way, ERP → Zoho**. Nothing in Zoho ever changes the ERP, and nobody types invoices into Zoho by hand.

## The two organizations

| | Name | ID | Role |
|---|---|---|---|
| REAL | O F J AUTOMOTIVE WORKS LLC | **942979945** | The real book. **Read-only** until the owner declares go-live. |
| TEST | OFJ TEST | read from `GET /organizations` after connecting | Where every write goes until go-live. Settings cloned from REAL. |

A switch in Settings (owner only, `zoho_live_enabled`) stays **OFF**. While it is off, any code path that would
write to organization 942979945 refuses — the guard is in the one Zoho client (`assertWritable`), not in each
caller, so nothing can slip past it.

- Zoho plan: **Elite**, data centre **.com** → accounts at `accounts.zoho.com`, API at `https://www.zohoapis.com/books/v3`.
- The Zoho user is the accounts admin login.
- UAE edition, VAT registered, TRN 100520937200003.

## API limits (from the current docs, checked 26 October 2026)

- **10,000 requests per day** on Elite; **100 requests per minute per organization**; **10 concurrent calls** (HTTP 429 / code 1070 beyond that).
- Access tokens live **1 hour**; the refresh token lives until revoked (Zoho keeps at most ~20 refresh tokens per user per app, oldest dropped — we store exactly one).
- Our client stays far inside this: **one call at a time, at most ~90 per minute**, with a backoff retry on 429.
  A normal day (a handful of invoices, receipts and bills) is well under 200 calls.

## VAT decision (the owner's ruling)

**Deposits carry NO VAT.** A deposit is recorded in Zoho as a **customer advance without tax** (a customer
payment not applied to any invoice). VAT is charged **only on the final tax invoice**, on the full amount, and
the advance is applied to that invoice so the balance matches the ERP. (Zoho's "tax on advance receipts"
option stays off; the accountant confirms this treatment with the FTA adviser.)

---

## 1. Mapping, ERP → Zoho

| ERP | Zoho Books | Notes |
|---|---|---|
| Customer | **Contact** (customer) | Name, mobile, email, **TRN** (`tax_reg_no`), tax treatment `vat_registered` when a TRN exists else `vat_not_registered`, **place of supply Dubai (DU)**. The Zoho contact ID is stored on `customers.zoho_contact_id`. |
| Tax invoice (INV-xxxxx) | **Invoice** | **The same number**: `invoice_number` sent explicitly with auto-numbering ignored (`ignore_auto_number_generation: true` — verified against OFJ TEST in Phase 1). Line per ERP line with the 5% VAT tax id, the line's income account, quantity, rate and the per-line discount. The quotation's total discount goes on as Zoho's invoice-level discount so the totals land to the fil. |
| Package line | One invoice line | One line, the package price, the include-list in the line description (exactly as the ERP prints it). |
| Complimentary / included line | Line at 0 | Rate 0 with the word in the description. Zoho accepts zero lines; cost stays an ERP-side figure. |
| Deposit / advance | **Customer payment with no invoice** (unused amount = customer advance), **no tax** | `payment_mode` + `account_id` by actual method (table below), `reference_number` = the ERP receipt number RCT-xxxxx. Applied to the final invoice with `POST /invoices/{id}/credits` (`invoice_payments`) the moment the ERP issues the tax invoice. |
| Payment / receipt (RCT-xxxxx) | **Customer payment** applied to the invoice | `invoices: [{ invoice_id, amount_applied }]`, `bank_charges` = the ERP's bank-charge figure, `reference_number` = RCT-xxxxx. |
| Cheque | Customer payment, mode `check` | Posted **only when the cheque clears** (the ERP already treats a pending cheque as unpaid). A bounced cheque after posting = the payment is deleted in TEST? No — **a reversal journal/refund by the accountant**; the sync posts nothing on bounce, it flags the row on the sync page. |
| Credit note (CN-xxxxx) | **Credit note** | Same number, same lines, linked to the invoice. |
| Supplier | **Vendor** | Name, TRN, phone. `suppliers.zoho_vendor_id`. |
| Supplier invoice (on an LPO) | **Bill** | Bill number = the supplier's own invoice number, date = the supplier invoice date, lines from the LPO at net cost + 5% VAT, **the scan attached** (`POST /bills/{id}/attachment`). |
| Supplier payment ("Mark supplier paid") | **Vendor payment** | Mode + paid-through account, reference. |
| Commission payment (CPV-xxxxx) | **Expense** (account: Sales commission) | Recommended: **expense**, not a bill — it is paid at once with a voucher, there is no credit period. Reference CPV-xxxxx, the voucher/slip attached. |
| Recovery trip payout / monthly payout | **Expense** (account: Recovery & transport) | One expense per monthly payout per driver/company (the locked month), the Excel attached. Our own truck's trips cost fuel/salary already in the books — only **external** payouts post. |
| Courier / freight (supplier charges) | Part of the **Bill** | They already sit on the supplier's LPO/invoice in the ERP, so they go inside that bill as a line (account: Freight & courier), not as separate expenses. |
| Inspection fee kept (declined work) | Invoice line | On the charge invoice the ERP already raises, account: Inspection fees. |

**Not synced:** proforma invoices (not a tax document — the accountant does not want drafts), quotations,
estimates, job cards, internal notes, staff names. **Deletes never sync** — the ERP never deletes financial
rows anyway (void/credit note only).

### Income accounts by ERP line type

The accountant creates these in the REAL organization's chart of accounts; the sync reads them **by name** once
and stores the IDs (Settings → Zoho shows what it found; missing ones are listed in red).

| ERP line type | Zoho income account (suggested name) |
|---|---|
| Labour (mechanical, hours × rate) | `Sales - Labour` |
| Services (fixed-price own services) | `Sales - Services` |
| Spare parts | `Sales - Parts` |
| Bodyshop / PPF / tint / detailing (incl. packages) | `Sales - Bodyshop & PPF` |
| Recovery charged to the customer | `Sales - Recovery` |
| Inspection fee | `Sales - Inspection fees` |
| Other / outside work | `Sales - Other` |

Expense side: `Sales commission`, `Recovery & transport`, `Freight & courier`, `Bank charges` (for the
bank-charge figure on customer payments). Purchases side: parts purchases land on the bill's default COGS/
inventory account the accountant chooses (suggested `Purchases - Parts`).

### Payment modes and deposit-to accounts (by ACTUAL method)

| ERP method | Zoho `payment_mode` | Deposit-to account (created by the accountant) |
|---|---|---|
| Cash | `cash` | `Cash in hand` (then a banking transfer when banked) |
| Card (machine) | `creditcard` | `Card machine clearing` |
| Payment link (N-Genius) | `others` (shown "Payment Link") | `Payment link clearing` |
| Bank transfer | `banktransfer` | The bank account |
| Cheque | `check` | The bank account (posted on clearance) |

Bank charges on card/link go in the payment's `bank_charges` field so the gateway's net deposit reconciles.

## 2. Numbering

**The ERP is the only numbering source.** INV-xxxxx, CN-xxxxx and RCT-xxxxx are created by the ERP
(database-side, gap-free) and sent to Zoho as the document's own number with auto-numbering turned off for
that call. Zoho's own sequences are never used; if Zoho ever refuses a number as taken, the sync marks the row
**failed — needs a look** rather than letting Zoho pick a different number. The daily reconciliation (below)
compares the two sides number by number, so a mismatch cannot stay hidden.

## 3. Sync design (BUILT in Phase 1, 26 October 2026 — `src/lib/zoho-sync.ts`)

- **Outbox table** `zoho_outbox`: one row per document to post (kind, ERP id, payload hash, status
  pending/sent/failed, attempts, last_error, zoho_id). Writers (issue tax invoice, record payment, receive
  supplier invoice…) only insert an outbox row — never call Zoho inline, so a Zoho outage never slows staff.
- **A worker on the hourly cron + a "Sync now" button** drains the queue one call at a time (well under the
  100/min limit), oldest first, dependencies respected (contact before invoice, invoice before payment).
- **Never twice:** every ERP record carries its Zoho ID (`zoho_invoice_id`, `zoho_payment_id`…). A row with an
  ID is never re-posted; retries re-read the outbox row and check Zoho by reference number first (and the
  one-at-a-time worker means no parallel double-post).
- **No edits after a tax invoice:** the ERP already locks approved/invoiced documents; corrections are credit
  notes, which sync as credit notes. The sync never updates a posted invoice (voiding in Zoho is a manual,
  accountant decision).
- **Reconciliation report, daily:** the hourly job (first run after midnight) compares yesterday per the ERP
  (invoices total, payments total, credit notes) with Zoho (same, by date) and writes one line per day;
  a difference rings the owner's and accounts' bell once. Page: Settings → Zoho → Reconciliation.
- **"Zoho sync" page** (owner + accounts): pending / sent / failed with the reason in plain words and a Retry
  button per row; a red count chip in the menu when anything has failed.

## 4. Phases and effort

| Phase | What | Effort |
|---|---|---|
| **0 — now** | Plan + OAuth connection, org picker (REAL read-only / TEST writable), read-only listing (orgs, taxes, chart of accounts, payment modes/bank accounts), mirror REAL's taxes+accounts into TEST. Nothing writes to REAL. | done with this batch |
| **1** | Customers + tax invoices + payments/deposits → **OFJ TEST**. Outbox, worker (five-minute cron `/api/cron/zoho` + Sync now), mapping screen, sync page `/zoho`, number checks, apply-advances, backfill. **Done 26 October 2026** (`npm run test:zoho1` 27 local checks, `npm run test:zoho1live` 22 live checks against OFJ TEST, all green; the existing ERP data backfilled). Credit notes moved to Phase 2 — until then a credit note on a posted invoice turns its sync row red for manual entry. The daily reconciliation report stays in Phase 4. | done |
| **2** | Suppliers, bills with attachments, vendor payments, expenses (commissions, recovery, bank charges). Still TEST. | 1 overnight batch |
| **3** | Accountant reviews OFJ TEST side by side with the ERP; fixes; then **go-live**: the owner turns `zoho_live_enabled` ON, the sync re-points at 942979945 and replays from the agreed start date (nothing posted to REAL before that date). | half a batch + accountant time |
| **4** | Daily reconciliation live, alerts, and the monthly close checklist (bank, card clearing and payment-link clearing accounts reconciled). | half a batch |

## 5. What exists after Phase 0 (this batch)

- **Connect Zoho Books** card in Settings (owner only) → Zoho's own sign-in → the refresh token stored
  server-side, sealed (AES-256-GCM, key derived from the client secret), in a table nothing in the browser can
  read (`zoho_tokens`: RLS on, no policies, service_role only — enforced by the security test).
- Organization picker: REAL (942979945) marked **read-only**; the TEST org chosen as the write target; writing
  to REAL is refused in code while the go-live switch is off.
- Read-only test on Settings → Zoho: both organizations with their taxes, chart of accounts and payment
  modes/bank accounts, straight from the API.
- **Mirror into OFJ TEST**: one button copies REAL's tax rates and chart-of-account names into TEST (create
  missing only, never delete, never touch REAL).

## 6. Verified against OFJ TEST on 26 October 2026 (test:zoho1live, all green)

- `ignore_auto_number_generation=true` keeps our numbers exactly (Zoho carries the ERP's number verbatim).
- A customer payment with **no `invoices` array is accepted** as an advance (unapplied), and
  `POST /invoices/{id}/credits` with only `invoice_payments` applies it — but only the payment's **unused**
  amount may be applied (an advance spent on one invoice has nothing left; Zoho refuses with "exceeds the
  total payment"), so the worker reads `GET /customerpayments/{id}` first.
- `rate: 0` lines (complimentary) and a **negative-rate "Round-off" line with the 5% tax id** are accepted;
  entity-level discount before tax + that line land the ERP's rounded total AND VAT to the fils
  (proved: 1,600.00 / VAT 76.19 from lines of 700 + 900-after-line-discount, discount 70, round-off −6.19).
- `line_items.account_id` IS accepted on ad-hoc invoice lines (undocumented but works): each line lands in
  its mapped income account without Zoho Items.
- Payment modes: `cash`, `creditcard`, `banktransfer`, `check`, and `others` for the payment link, with the
  RCT number as `reference_number` and `bank_charges` carried (2.26% card / 1.75% link).
- `GET /invoices?invoice_number=` list rows have NO `tax_total` — read the found invoice in full before
  judging its figures (the adopt pass broke on NaN until then).
- `GET /customerpayments?reference_number=&customer_id=` scopes the adopt search to the customer, so a
  receipt number reused after "Clear test data" never adopts someone else's payment.

## 7. Needed from the owner / accountant

1. **Owner:** create the Zoho API client and the two Vercel variables, then press Connect (exact steps are in
   the batch report, B5).
2. **Accountant:** create the income/expense/clearing accounts listed above in the REAL organization (any
   names — the sync reads what exists; the suggested names keep the mapping obvious), confirm the 5% VAT tax
   exists (UAE edition has it), and confirm the deposit treatment (advance without VAT) with the FTA adviser.
3. **Accountant:** the go-live start date (which month is the first one Zoho owns).
4. **Owner:** confirm commissions/recovery/courier as **expenses** (recommended above) — or say "bills" and
   Phase 2 posts them as bills instead.
