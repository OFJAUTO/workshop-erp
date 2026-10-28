# Bank fees, card settlements and the settlement report (29 October 2026)

## Section 1 – Fee settings

Network International charges, per transaction (the bank's own figures from the two Merchant Transaction Reports):

| Method | MSF (before VAT) | Fee per transaction | VAT | Example |
|---|---|---|---|---|
| Card machine (POS) | 2.15% | none | 5% of the fees | AED 1,470.00 → MSF 31.61 + VAT 1.58 = 33.19, net 1,436.81 |
| Payment link | 1.75% | AED 1.00 | 5% of the fees | AED 10,000.00 → MSF 175.00 + fee 1.00 + VAT 8.80 = 184.80, net 9,815.20 |

- Rounding: each fee to the fils, half up (31.605 → 31.61), VAT on the rounded fees.
- The old card rate of 2.26% was 2.15% with its VAT.
- The VAT on bank fees is reclaimable input VAT, so a job's cost is MSF + fee only.
- Where to change them: Card settlements → Bank fees per payment method (owner and accounts); also behind "Bank fees" on the money list. Settings links there.
- Each new card or link payment stores the estimate in parts: `fee_msf_aed`, `fee_txn_aed`, `fee_vat_aed`; `bank_charge_aed` = MSF + fee.

## Section 2 – Profit without VAT, recalculated

Job profit, the advisor bonus, the daily target and the profit page all count MSF + fee without VAT, from the same rule. Before a payment is recorded the estimate comes from the way the customer is expected to pay, applied to the invoice (or approved quotation) total. The approved quotation's hidden fee line is frozen at approval with the old rate, so it is no longer used.

Recalculated on 28 October 2026 (evening): the 18 open jobs (no job was gated out in the last 35 days).

| Job | Car | Paid by | Bank fee before → after | Profit before → after |
|---|---|---|---|---|
| J-00017 | Dubai E 55138 | payment link | AED 367.50 → 368.50 | AED 12,711.82 → 12,710.82 |
| J-00460 | Dubai M 60248 | payment link | AED 152.25 → 153.25 | AED 3,428.46 → 3,427.46 |

- Both changes are the payment link's AED 1.00 per transaction, which the old 1.75% rate left out.
- The deposit RCT-00036 (J-00017, payment link, AED 10,000, auth 756117) now carries MSF 175.00 + fee 1.00 = 176.00 as cost and VAT 8.80 apart.
- Five draft quotations on open jobs took the new hidden fee line.
- No card machine payment exists in the ERP yet: the AED 1,470 card payment of 24 October (auth 219769) has not been recorded.
