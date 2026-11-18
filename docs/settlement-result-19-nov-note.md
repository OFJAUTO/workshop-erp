# Card settlement: a clear result (19 November 2026, Section 3)

## The real case, read on live (read-only)
The AED 45,229.00 settlement **was recorded**: **STL-00032**, payment link, in bank 18/11/2026, by ALEEMATH at 11:03 Dubai on 18 Nov.
- Receipts: RCT-00093 (1,980.00), RCT-00094 (11,550.00), RCT-00095 (21,899.00), RCT-00098 (9,800.00).
- Figures: net 44,393.71, MSF 791.51, transaction fee 4.00, VAT 39.78, statement 171126455340246. Its Zoho entry waits for the next Sync to Zoho.
- The red "The report has no transactions in it" came from the **bank report upload** beside it. That file could not be read, so nothing was saved from it. It never touched the typed settlement.
- Nothing for accounts to redo. The bank report is not needed for STL-00032.

## What changed
- After **Record the settlement**, a centre window says **RECORDED – STL-000xx – AED 45,229.00**, with the details under it and OK. If it was not recorded, the words start with **NOT RECORDED –** and give the plain reason.
- The bank report upload answers one of three:
  - **Could not read this file** (name). Accepted: the bank's settlement report as PDF, CSV or Excel (.xlsx, .xls). It adds that the typed settlement is not affected.
  - **Every transaction in this report is already recorded** (STL-…). Nothing more to do.
  - **n transactions found**: check each line, then Record.
- The upload and the typed settlement are separate forms: a report problem never blocks a settlement whose figures balance (already so; now said in words).
- Record pressed twice, even from a second tab, never records the same receipts twice. The second press says "NOT RECORDED – RCT-… is already in another settlement".

Test: `npm run test:s19-3` (6 checks, accounts, TEST). Proof: `docs/proof/2026-11-19-settlement-result/`.
