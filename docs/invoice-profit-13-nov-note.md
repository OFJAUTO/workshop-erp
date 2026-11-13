# Section 8: profit on every invoice (13 November 2026, evening list; INV-00011, J-00989)

## What you see

**On the tax invoice's page (`/invoices/<id>`) and the car's money page**, a box "Profit on INV-… · internal" shows:
- **Sold before VAT, minus each real cost = the profit, in AED and %.** The costs are:
  - parts;
  - stock and consumables;
  - clocked labour at the cost rate;
  - materials;
  - other costs and charges;
  - recovery;
  - the bank fee;
  - commission;
  - PPF rechecks.
- **PROVISIONAL or FINAL:**
  - **PROVISIONAL** (amber) while a cost is still estimated, with the reasons listed (for example "bank charge estimated until payment", "1 supplier invoice to follow"). It also shows the **worst case**: the bank fee at the dearest way to pay while nothing is paid yet.
  - **FINAL** (green) once nothing is estimated.
- **Expected against actual:**
  - the approved quotation's profit against the real one, for example "Expected 3,200.00 · actual 2,850.00 (−350.00)";
  - then the lines that differ: each part whose cost changed from the quotation, the quoted hours against the clocked hours, and the bank fee.
- **A comeback since** (our workmanship or our part): its loss, its job number, and the profit after it. On a comeback's own invoice, the box says which job it belongs to.

**On the car page**, each visit shows its profit ("Profit AED 2,140.00 (17.1%)", amber while provisional), with the car's **lifetime** above the list.

**On the customer page**, one line gives the total profit from that customer: every visit of every car.

## Who sees it, decided on the server

- **You and accounts:** everything.
- **The job's own advisor** (the advisor in charge, and advisors following the car): the box and that visit's profit. Not the car's lifetime, and not the customer's total, because those add up other advisors' jobs.
- **Everyone else** (other advisors, the parts desk, the workshop): nothing. The figure is not even in their page.
- **A job with no advisor set yet** shows its profit to you and accounts only.

## One calculation

The box uses `jobProfits` in `src/lib/profit.ts`, the same calculation as the Profit report. The test checks that both show the same figure.
- The expected figure is the approved quotations' own profit (`approvedQuoteProfits`).
- The pieces: `src/lib/invoice-profit.ts` (server), `src/lib/invoice-profit-rules.ts` (pure), and ONE component `src/components/InvoiceProfitBox.tsx` (the box and the visit tag).

## Proof (TEST only)

**`npm run test:s8-profit`: 16 of 16.** It covers:
- **Owner:** the box, the % and the worst case while provisional; FINAL after a cash payment; the same box on the money page; the same figure in the Profit report; the car's visits and lifetime; the customer's total.
- **Accounts:** the box.
- **The job's advisor:** the box and the visit's profit, but no lifetime.
- **Another advisor and the parts desk:** nothing, and the figure is not in their page.

Screenshots at desktop and tablet size: `docs/proof/2026-11-13-invoice-profit/`. No database change.

## Assumptions

- **The worst case today covers the bank fee**, the only cost with a known range. Other estimated items, such as a supplier invoice to follow or a driver's price, are counted at their estimate and named in the reasons.
- **The expected figure** is for the whole job. On a job with two tax invoices, the box shows it on each.
- **The box shows on tax invoices only.** A proforma has no profit yet; its car shows the profit once the tax invoice is issued.
