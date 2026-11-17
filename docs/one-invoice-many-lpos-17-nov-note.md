# Section 2 (17 November 2026): one supplier invoice for several LPOs

**The case:** AL TAYER MOTORS LLC. LPO-00039-1 (AED 3,385.20) and LPO-00039-3 (AED 668.85), both for J-00940, are both received and both "Invoice missing". The supplier sent ONE invoice for both: AED 4,054.05 with VAT, AED 3,861.00 before VAT.

## How Dublin's INV 262817342 came to cover two LPOs

- It was entered on **LPO-00076-1** as that LPO's own invoice.
- Then, on 14 Nov at 10:41, someone used **"Split this invoice" on LPO-00076-4** and typed the same number for the second part. The system accepts the same number on another LPO of the same supplier as "the same paper".
- So it worked, but only through a hidden route. Nothing on the screen offered it.

## What changed

- **Entering a supplier invoice now has a visible step, "THIS INVOICE ALSO COVERS…".**
  - It is in the one invoice box, so it shows on Supplier invoices → Scan & enter, and on the LPO page.
  - It lists that supplier's other open LPOs (not cancelled, no invoice yet): number, car, status, the reference typed at receiving, and the amount.
  - Tick the ones on the same paper. The total is then checked against the LPOs **together**, for example "Together: AED 3,861.00 before VAT (LPO-00039-1 AED 3,224.00 + LPO-00039-3 AED 637.00)". The usual 5% question applies to that total.
  - On save, every ticked LPO gets the same number, date and scan, plus its own share of the typed total. The share follows each LPO's own total and lands on the typed total to the fils.
  - Every ticked LPO's "Invoice missing" clears, and each car's history says so.
- **On an invoice already saved: "Add another LPO to this invoice".**
  - It is on the opened invoice in Supplier invoices (and Parts accounts), and on the LPO page in the card "One invoice, several LPOs".
  - Pick the LPO, type the paper's total before VAT, confirm. The total is shared again across every LPO on the paper, and the invoice goes back to unchecked so accounts look again.
  - The answer shows right next to the button.
  - It is refused, in plain words, when one of those LPOs is already paid: void the payment first.
- **Each part stays on exactly one invoice** (the rule of the 14 Nov list, Section 2):
  - Each LPO keeps its own parts and its own share.
  - An LPO that already has an invoice of its own, or a split invoice, is never offered.
  - One invoice can hold several LPOs, and one LPO's parts can still sit on several invoices (Split this invoice). A part is never on two.
- **Supplier invoices shows it as ONE invoice** covering the LPOs, as before. The match, totals and paid lines are worked out over all of them.
- **Accounts and the owner only.** The parts desk sees no add button.
- **Zoho (OFJ TEST until go-live):**
  - One invoice for several LPOs posts as **ONE bill**. The oldest LPO carries it, with every LPO's own lines (each line names its LPO, job and plate). The bill's reference reads "LPO-a + LPO-b".
  - The other LPOs point at that bill. Before, the second LPO turned red: "the accountant combines them in Zoho by hand".
  - A supplier payment over them pays that one bill once.
  - If an LPO is added after the bill already reached Zoho, the bill turns red for the accountant to add the lines by hand.
  - The TEST server has no Zoho connection, so the first real posting is seen at Mathew's next Sync to Zoho.

## Read-only check on live: suppliers with several LPOs waiting for their invoice

- **AL TAYER MOTORS LLC:** LPO-00039-1 (3,224.00), LPO-00039-3 (637.00), LPO-00081-1 (113.00).
- **ARABIAN GULF MECHANICAL CENTRE L.L.C:** LPO-00025-4 (165.00), LPO-00098-2 (4,650.00).

To enter AL TAYER's paper:
1. Supplier invoices → the waiting row LPO-00039-1 → Scan & enter.
2. Tick LPO-00039-3 under "This invoice also covers…".
3. Type the paper's number, its date and 3,861.00 → Save the invoice.

## Proof (TEST)

- `npm run test:s17-2` passes 10 of 10, signed in as accounts (and the parts desk for the hidden button).
- `tests/unit/invoice-cover.test.mjs` (the share-out to the fils) passes 8 of 8.
- Screenshots in `docs/proof/2026-11-17-one-invoice/` (1440 and 800 wide).

No database change.
