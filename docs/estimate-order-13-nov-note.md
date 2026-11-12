# Estimate approved or paid: accounts and the parts desk – 13 November 2026 (Section 7)

**Built (no database change):**
- **Accounts:**
  - "Proformas waiting for payment" is a new filter on Invoices and payments (`?show=proforma_waiting`). It lists every proforma still waiting for its money, from a job or from an estimate.
  - Each row has Pay (the one Record payment window): method, amount and proof. Less than asked = part paid; more = the extra is an advance.
  - Cheques and transfers wait in Accounts posting until confirmed (the 9 November rule).
  - The tax invoice for the advance is issued on payment.
- **The parts desk's alert:** "ORDER PARTS: E-… · car · n parts · …", sent to the parts desk and the advisor in charge. It sends:
  - **at the customer's acceptance** when no deposit was asked ("no deposit asked");
  - **only once the money is recorded** when a deposit was asked ("advance received"). Until then the parts desk sees "Approved: waiting for deposit" on the estimate's parts page;
  - **when the advance is a cheque not cleared yet:** the alert says so, and ordering needs the owner (the LPO approval's no-advance gate).
  - Each alert goes once (a quotation event marks it).
- **Where the parts desk orders:**
  - The alert opens the estimate's parts page at "Order the parts", where the parts desk now presses **Order parts now** itself (before, only advisors and the owner could).
  - The parts dashboard has **"Ready to order (n)"**: accepted estimates with priced parts, each with its state.
- **End to end (checked):**
  - parts ordered against an estimate before the car is here make a held job with an LPO for approval;
  - at gate-in the held job, its LPOs and the money move onto the job.
  - This is `test-estmoney1`, sections G and L, now green again.

**Proof (TEST):**
- `npm run test:s13-7` passes 9 of 9:
  - accepted with no deposit asked → ORDER PARTS · no deposit asked, opening the order button;
  - Ready to order on the dashboard;
  - the parts desk orders → held job with an LPO;
  - deposit asked → no alert, "Approved: waiting for deposit";
  - Proformas waiting for payment.
- `test-estmoney1` passes 89 of 89. It had been stale since 9–11 November and was brought up to date:
  - its made-up VINs and plates now pass the VIN rules and no longer clash with TEST's copy of live cars;
  - it presses the bill-to company choice first;
  - the steps that prove "pay → tax invoice at once" pay by card, because a transfer waits in Accounts posting.
- Screenshots: `docs/proof/2026-11-13-estimate-order/`.
