# Section 1 (17 November 2026): a supplier advance's proof belongs to the payment

**The case:** Supplier payments → Pay ARABIAN GULF MECHANICAL CENTRE L.L.C, AED 5,030.55, kept as an advance. Attaching the proof failed with "This LPO no longer exists" and "1 file could not be sent".

## Why it happened

- **No LPO was deleted.** LPOs cannot be deleted: a database rule refuses it, and the change log shows 0 LPO deletions ever. Old references are never broken by a number change either: everything points at the LPO's id, and the number ("LPO-00059 V2") is only a label.
- **The cause:** on the Supplier payments page, the proof box was given the **supplier's** id where an LPO id was expected. The server looked for an LPO with that id, found none, and refused the file. That has happened 12 times since 12 November: 10 for ALEEMATH, and 2 this morning (17 Nov, 08:45 and 08:53 Dubai).
- **The AED 5,030.55 advance was never recorded.** There is no supplier payment of that amount. It is on NEEDS OMAR.

## What changed

- **The proof belongs to the payment (the SPAY record), never to an LPO.** It uses one proof box in every place a supplier is paid:
  - the Supplier payments box;
  - "Pay in advance" on an LPO;
  - the LPO's own payment box;
  - "Correct this payment".
  - The form makes the payment's id before it is saved. So a proof picked before "Record" joins the payment, and so does one that arrives afterwards, whichever lands first.
- **An advance with no LPO takes its proof like any other payment.** "Correct this payment" on an advance now has the proof box; before, it had none, because an advance paid no LPO.
- **A proof added after the payment** goes straight onto the payment. Its history says "Proof of payment added". Zoho attaches it at the next Sync to Zoho (OFJ TEST until go-live).
- **A failed upload never holds up the payment.** It says so in red: "This file could not be sent. The payment is NOT held up: record it now, then add the proof later from Payment history → Correct this payment (or tap Try again)."
- **Linking an advance to an LPO is optional:**
  - When the amount is kept as an advance, the box asks "An advance for one LPO? (optional)", and the starting choice is "Not for an LPO (kept with the supplier)".
  - "Pay in advance" on an LPO still names that LPO.
- **The link follows the LPO:**
  - If the LPO was replaced (sent again as "… V2", or its parts moved to another LPO of the same supplier), the advance now follows the new LPO. The history says "LPO-x → LPO-y".
  - If it was cancelled with nothing to follow, the advance stays with the supplier, not linked. The history says "LPO-x was cancelled: the advance stays with <supplier>, not linked to an LPO", and the payment row shows "Kept with the supplier (no LPO)".
  - This is checked each time the Supplier payments page opens, and every hour by the clean-up job.
  - The money never moves: only the link.
- **"Proof missing – upload"** on a paid LPO (the LPO page and Supplier invoices) puts the file on the payment that paid it.

## Read-only check on live

- **Payments, lines or files pointing at an LPO that is not there: none.**
  - 0 advances name a missing LPO.
  - 0 payment lines name a missing LPO.
  - 0 stored proofs sit in a folder of a missing LPO.
- **The refused proofs:** 12 refusals since 12 November, all from the Supplier payments page.
- **Payments recorded right after a refused proof, still with no proof (5):**

| Payment | Supplier | AED | Paid on |
|---|---|---|---|
| SPAY-00023 | GARGASH ENTERPRISES L.L.C | 16.29 | 5 Nov |
| SPAY-00024 | AL TAYER MOTORS LLC (advance) | 4,998.00 | 12 Nov |
| SPAY-00028 | PREMIER AUTO PARTS L.L.C | 1,258.95 | 13 Nov |
| SPAY-00029 | PREMIER AUTO PARTS L.L.C | 147.00 | 13 Nov |
| SPAY-00033 | ALI & SONS COMPANY (advance) | 189.79 | 15 Nov |

  (11 of the 42 recorded supplier payments have no proof yet.) Each proof can be added now from Supplier payments → Payment history → **Correct this payment**.

## Proof (TEST)

- `npm run test:s17-1` passes 13 of 13, signed in as accounts. It covers the advance with its proof picked before Record, a proof added later, Correct this payment on an advance, the link following a replaced LPO, the unlinked advance after a cancellation, and the parts desk refused.
- Screenshots in `docs/proof/2026-11-17-advance-proof/` (1440 and 800 wide).

No database change.
