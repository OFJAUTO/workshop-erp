# Stale browser tests, 2 November 2026

For each failing test: was the test wrong, or the screen? Then the one that was wrong was fixed.

| Test | What failed | Wrong side | Fix |
|---|---|---|---|
| test-m | Payment-link fee 16.54 expected | Test | Since 29 Oct a payment link costs 1.75% + AED 1.00 (945 → 17.54). The test now expects that. |
| test-m | A pasted link "https://pay.example.test/abc" did not replace the automatic order | Test | Since 1 Nov (B1) only the gateway's own pay page is accepted. The test now pastes an N-Genius sandbox link. |
| test-zoho2 | "A write at the REAL book is refused" said not refused | Test route | The guard works. Since 30 Oct the test server refuses the REAL organization with its own words, which the local test route did not recognise. The route now accepts both refusals. |
| test-zoho2 | "Entering the invoice queued the bill" | Test | Since 1 Nov (Supplier invoices tab) the bill goes to Zoho when accounts mark the invoice checked. The test now checks that nothing is queued before that, then presses Mark checked. |
| test-zoho2 | "The purchases card carries five boxes" | Test | Since 27 Oct the card also has "paid from" per method (nine boxes). The test now checks each box by name. |
| test-h | The Priced chip was not found on the car | Test | Since 29 Oct the car card's own link sits under the content, so the chips are in the card, not in the link. The test reads the card. |
| test-h | "Labour at cost (… estimate × AED …)" | Test | Since 30 Oct (one profit calculation) the internal box shows "Labour at cost" with "3 h estimate × AED 50" on its own line. The test reads that row. |
| test-h | The LPO approval did nothing | Test | Since tonight (B3) Approve opens a question first. The test now presses "Yes, approve the LPO". |
| test-i | The gate-out did not close the job | Test | Since 30 Oct the final km and the instrument-cluster photo are required at gate-out. The test now enters both. |
| test-tint11 | The "above the legal limit" words | Test | The roof is now called "Sunroof / glass roof" (it was "Sunroof / panoramic roof"). |
| test-tint11 | The package cost line was not found | Test | Since 30 Oct the cost lives in the one internal box. The test now proves the windows and the double layer count: unticking the roof's double layer lowers the tint cost by a sixth (2 → 1.67 cars) and changes the labour. |
| test-zoho3 | A bill posted WITH VAT did not stay red after the supplier's VAT switch moved | **Screen (tonight's C1)** | The new "retry when the TRN changes" put the flagged bill straight back in the queue. The retry now only touches rows that never reached Zoho. |
| test-zoho3 | "Once live, the switch refuses to run again" went through | Test | The test database copy has no `zoho_went_live_at` row; live has it, so the guard works there. The test now creates the row inside its rolled-back step. |
| test-oldparts | The Gate-in details button was not found | Test | Since 21 Oct the gate-in/gate-out record is its own page, `/jobs/[id]/gate-in`. The test opens it. |

## Also found stale, not fixed tonight: test-t

8 of 47 checks fail on rules that changed after it was written:
- The deposit question at "Quotation complete" changed on 16 and 20 October. Section 2 depends on it.
- The services list depends on the data copied from live.
- The way long part names wrap changed on 20 October.

None of these is about tonight's work. It needs its own rewrite.
