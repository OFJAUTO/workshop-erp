# Proof on every payment method (10 November 2026, Section 6)

- Every method (cash, card, payment link, cheque, bank transfer) has **Add proof** and **Scan document**, wherever a payment is recorded: the job's money page, the Record a payment window (the J-00981 case), the deposit window and the new proof box in "Receive payment from the customer" (one payment for several cars; the one proof goes on every receipt of it).
- **Cheque: the photo of the cheque is compulsory** (Record waits for it; the server refuses without it). Card slip and transfer proof stay compulsory. Cash and payment link are optional.
- The receipt line shows the proof as a thumbnail (or a PDF tile) that opens it, on the money page and on the invoice page.
- ONE rule: `src/lib/payment-proof.ts` (`proofRequired`, `proofLabel`, `proofMissingWords`); one picker for forms that send the file with the form: `src/components/ProofFileInput.tsx`.

No database change. Test: `test:sim` path d6 (9 checks); sec3 and test-paymethods now attach the cheque photo. Proof: `docs/proof/2026-11-10-payment-proof/`.
