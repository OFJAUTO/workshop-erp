# Zoho to the fils – 6 November 2026 (Section 5)

## The cause (one line)

LPO-00045-1 (Al Tayer, J-00986): Peter typed the supplier's two prices 586.59 + 376.26 = **962.85**, and the supplier's own total **962.86**; the bill sync took the typed total only when it was more than 5 fils away from the line sum, so Zoho got 962.85 + 48.14 = 1,010.99 instead of 1,011.00 – and the "matches the ERP to the fils" words were printed without comparing.

## What changed

- **The supplier's typed total always wins, to the fils.** The VAT typed from the paper wins too; if Zoho's own 5% comes out a few fils different, the difference rides as the bill's *adjustment* ("VAT rounding as printed on the supplier's invoice"), so the bill's total is the paper's.
- **The true check.** After posting, the ERP reads the bill back and compares **before VAT, VAT and total**. Only when all three are equal does it say "matches the ERP to the fils". Otherwise the row reads in red: **"Zoho differs: 1,010.99 vs 1,011.00 (−0.01)"** with a red "Posted · differs" badge. Tax invoices (total + VAT) and credit notes (now total + VAT) are checked the same way; payments were already checked by amount.
- **A posted bill is compared with what the ERP computes today**, so a bill posted before this fix shows red too.
- **"Check again in Zoho"** (owner and accounts) on a red posted bill or tax invoice: it finds the same document in Zoho by its id and corrects it once (never a second bill). A bill already part paid in Zoho is left to the accountant, in words.

## Every mismatch in OFJ TEST (read-only check of the live records, 6 November 2026)

18 posted documents checked; **1 differs**:
- Bill 11768267 (LPO-00045-1): Zoho 962.85 + 48.14 = 1,010.99 · ERP 962.86 + 48.14 = 1,011.00 (−0.01).

To fix it: Zoho Books page → Posted → the red LPO-00045-1 row → **Check again in Zoho** (NEEDS OMAR or Mathew – it writes to the live records, so I did not press it).

## STL-00012 (payment link, AED 997.50, bank charges 24.61)

Not an ERP guess. It was typed by hand on the Card settlements page (no Network International report uploaded), from the bank statement line "NETWORK COLLECTION POSTING ON 04/11/2026" (ref 031126455340246): 997.50 paid, **972.89 arrived**, so the bank really kept **24.61**. The form split it as MSF 22.44 + fee 1.00 + VAT 1.17, which works out at **2.25%** + AED 1 + VAT – not the 1.75% + AED 1 + VAT the ERP expects for payment links (its own estimate for RCT-00044 was 19.38). Nothing to fix in the ERP's figures; the question for Network International is why this link payment was charged 2.25% (an international card is the usual reason). If links really cost 2.25%, change the rate on Card settlements → Bank fees.

## Proof (TEST database)

- `test:sim` path s (4 checks): the red "Zoho differs: 1,010.99 vs 1,011.00 (−0.01)", no "matches" words, the Check again button, and green "matches to the fils" once Zoho holds 1,011.00. Screenshot `docs/proof/2026-11-06-zoho-fils/s-zoho-differs-1440.png`.
- Unit `zoho-sync-rules` (12 new checks), `test:zoho3` 51/51.
- Not proven here: the actual correction in OFJ TEST (the test server has no Zoho connection, and live pressing is yours).

## Section 4 follow-up in the same push

The supplier payment box got back two things the old form had: the **proof** picker (bank slip, card slip, link receipt, cheque copy; a proof finishing its upload during the save still joins the payment) and the **"Paid from in Zoho"** line for each method.
