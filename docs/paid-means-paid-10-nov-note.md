# Paid means paid – 10 November 2026 (Section 1)

**Cause:** while a proforma had not been sent yet, the job card always offered "Send the proforma". That window asked "How will the customer pay?" and offered a payment link, even when the money was already in or a cheque was waiting to clear. The customer's page offered Pay now while a cheque was pending.

**Now:** THE still-due figure (`src/lib/still-due.ts`, `stillDueOf`) is used by the "car is ready" window and its message (`readyTemplateFor`), the job card, the money page, the customer's proforma page, Pay now (`ensureAutoPayLink`, `openPaymentLink`), the advisor's payment link and payment report (`stillOwes`) and the server actions (`prepareProformaSend`, `markReadySent`, `preparePaymentLink`).

- **Fully paid:** no payment choice and no link. The message reads "Your car is ready – fully paid, thank you". The page shows Paid with the receipts, and the tax invoice once it is issued.
- **Part paid:** only the remaining figure is offered.
- **Cheque or transfer waiting to clear:** "Payment received – waiting to clear". No new link, and no Pay now.

Proof: test:sim path d1 (11 checks); screenshot `docs/proof/2026-11-10-paid-means-paid/d1-paid-car-ready-message-1440.png`.

## The real cases (read on live, nothing changed)

| Job | Amount | What was offered | Link actually sent? |
|---|---|---|---|
| **J-00981** | PRO-00007, AED 2,325.75. Cheque RCT-00071 for the whole amount is waiting to clear. | The proforma was never sent, so the job card offered "Send the proforma" with the payment choices. This is most likely the reported case. | No |
| **J-00860** | PRO-00015, AED 2,236.50, paid before the send. | Sent 9 Nov 12:54 as a payment request ("expected: cash"). | No link made |

No other job was offered or sent a payment link after it was paid.
