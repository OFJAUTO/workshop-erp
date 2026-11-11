# Comeback at our cost (10 November 2026, Section 9)

Built on the existing Comebacks page and the complimentary lines (nothing built twice).

- **Comeback – at our cost** on any open job card (owner, advisors, managers): pick the ORIGINAL job from this car's earlier jobs (found by VIN), or **Original job not in the ERP** with its old invoice number; a compulsory reason (what went wrong, who did the original work). The owner gets a bell.
- The owner approves on the card: **At our cost (warranty repair)** or The customer pays, plus **Take the cost off the original job** (default) or not.
- Approved: no inspection fee (when the check-in was not approved yet); every line of the quotation being prepared, and every new line, is **At our cost** (price 0, real cost counted); a line can be switched to Charged from its ⋯ menu. The customer sees **"COVERED BY OFJ WARRANTY – NO CHARGE"** and no price on those lines; they still approve the check-in. An all-free quotation is approved by itself on sending; one with a charged line goes to the customer as usual.
- Nothing at our cost is invoiced (no tax invoice, no VAT, no payment step for those lines); charged lines are invoiced as usual. The VAT setting `comeback_vat_mode` is "no_vat" (warranty repair) until accounts confirm.
- Profit: the comeback's cost shows as a loss on the Comebacks page and is **taken off the original job's profit** (shown on the original job card) **and its advisor bonus**. When that bonus period is already approved, it comes off the current period as its own line.
- Comebacks page: each comeback with the original job (or the old invoice number), the reason, technician, the original job's advisor and the cost; totals per technician and per advisor (owner).

**J-00490:** this car has no earlier job in the ERP (its record was created on 26 October 2026, the only document is the draft Q-00066). The original work was done before the ERP: mark it with "Original job not in the ERP" and the old invoice number.

Not built here (needs the owner and the accountant): posting the at-our-cost cost to a "Warranty / rework" expense in Zoho (the account name, and a live run on OFJ TEST).

Switches on once `20261212120000_comeback_at_our_cost.sql` is applied. Test: `test:sim` path d9 (8 checks). Proof: `docs/proof/2026-11-10-comeback-at-our-cost/`.
