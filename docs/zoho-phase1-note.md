# Zoho Books — Phase 1 delivered (26 October 2026)

**What this is:** the ERP now posts customers, deposits, tax invoices and payments into Zoho Books — into
**OFJ TEST only**. The real book (O F J AUTOMOTIVE WORKS LLC) stays read-only until you declare go-live.
One-way: the ERP writes to Zoho; nothing is ever read back except Zoho's own id and the figures used to prove
the match.

## What to look at (exact clicks)

1. **The sync page** — menu → **Zoho Books** (you and Mathew see it). Every document shows as
   *Waiting* (amber), *Posted ✓* (green, with Zoho's total, VAT and balance next to the ERP's) or
   *Failed* (red, with the reason in plain words and a **Retry** button). **Open in Zoho** jumps to the
   document in Zoho Books. The sync runs by itself every five minutes; **Sync now** runs it at once.
2. **The account mapping** — Settings → Zoho Books → **Account mapping** (or the button on the sync page).
   Six income accounts (mechanical labour, spare parts, bodyshop & PPF, recovery, inspection fee, other),
   five deposit-to accounts (cash, card machine, payment link, bank transfer, cheque), the bank-charges
   account and the customer-advances account. I pre-filled the suggested names — **Mathew reviews and
   changes them here**; the boxes list the live Zoho chart. A name that does not exist yet is created in
   OFJ TEST automatically at the first sync; in the real book the accountant creates it first.
3. **Backfill** — on the sync page (owner only): one button queues everything already in the ERP
   (customers, recorded deposits, issued tax invoices, recorded payments).
4. **Failed items** — they also appear amber on Mathew's **Waiting on you** box, pointing at the sync page.
5. **Background jobs** — Settings shows the "Zoho sync" job line: when it last ran and what it did; it rings
   you once if it stops running.

## The rules it keeps (and proves)

- **Writes go to OFJ TEST (944122733) only.** The write-guard sits inside the one function that talks to
  Zoho: a write aimed at the real book is refused while the go-live switch is off. A test proves the refusal.
- **Never twice.** Every posted record stores its Zoho id. A retry first looks the document up in Zoho (by
  invoice number, by receipt number, by the customer's mobile) and ADOPTS what it finds. A number that exists
  in Zoho with different figures is never overwritten — the row fails in plain words for the accountant.
- **Same numbers.** The Zoho invoice carries the same INV-xxxxx; payments carry the RCT-xxxxx as the
  reference.
- **Totals to the fils.** Lines go with quantity, rate and the line's own discount; the quotation's total
  discount goes as Zoho's invoice-level discount (before tax); the round-off goes as a taxed "Round-off"
  line so the VAT matches too. After posting, the worker compares Zoho's total and VAT with the ERP's —
  one corrective pass, then **FAILED with both figures, never "synced" with a difference**.
- **Deposits are advances without VAT** — a payment on the customer's account, applied to the tax invoice
  automatically when the invoice posts.
- **Cheques count the day they clear.** A pending cheque is not posted; clearing queues it.
- **Bank charges ride along** (card 2.26%, payment link 1.75%) on the Zoho payment.
- **Internal things never leave the ERP:** hidden lines, the bank-charge fee line, part numbers, costs and
  staff names are not sent; a complimentary line posts at 0 with the word on it.
- **After the fact:** a void, a bounced cheque or a credit note on something already in Zoho turns the row
  red — "remove it in Zoho by hand" — because deleting in someone's books is the accountant's decision,
  not the computer's. (Credit notes post automatically in Phase 2.)

## Proof

- `npm run test:zoho1` — 27 local checks: the REAL write guard refusal, the money screens queue every
  recorded payment exactly once, a pending cheque is not queued and a cleared one is, the sync page, the
  mapping screen, the amber Waiting row, Retry.
- `npm run test:zoho1live` — 22 checks against the live site and OFJ TEST, all green:
  (a) a deposit by payment link posted as an advance without VAT (bank charge 1.75% carried), the invoice
  posted with the exact same number, the advance applied, the final cash payment applied, Zoho balance 0;
  (b) a line discount + the quotation discount + the round-off landed 1,600.00 with VAT 76.19 to the fils,
  labour and parts each in their own income account; (c) a bodyshop package posted as one line with the
  item list, the complimentary line at 0, the bodyshop account; (d) card 2.26% and transfer 0% bank charges,
  both applied, balance 0; (e) a forced failure read "Mapping missing: Bodyshop & PPF", Retry posted it, and
  with the stored id wiped the worker ADOPTED the existing Zoho invoice — same id, never a second copy;
  (f) a write aimed at the REAL organization is refused by the guard before any network work.
- **Backfill done**: the 14 customers and the RCT-00036 deposit (AED 10,000, bank charge 175.00) already in
  the ERP were queued and posted to OFJ TEST — 15 posted, 0 failed. (No tax invoices existed to backfill;
  the test data had just been cleared.)
- Screenshots in `tests/browser/shots/`: `zoho1-sync-posted.png` (every row green with Zoho's figures
  matching the ERP's), `zoho1-erp-invoice-1/2/3.png` (the three ERP invoices), `zoho1-mapping.png`,
  `zoho1-sync-page.png` (a failed row with the reason and Retry).

## What I need from you / Mathew

1. **Mathew:** open Settings → Zoho Books → Account mapping and review the pre-filled names (they are my
   suggestions, not his chart). Change anything; Save.
2. **Mathew:** before go-live, create the same account names in the REAL organization (the mapping stores
   names, so it carries over by itself).
3. **You:** when you want the existing ERP data in OFJ TEST, press **Backfill** on the sync page once.
4. Credit notes, supplier bills and expenses (commissions, recovery, courier) are Phase 2.
