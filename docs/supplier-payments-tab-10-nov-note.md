# Supplier payments tab (10 November 2026, Section 5)

- New tab **Parts management → Supplier payments**, between Supplier invoices and Parts accounts. Owner and accounts only: the menu hides it from everyone else and the server answers "not found" for the page and "not allowed" for the export.
- Content: what is due by supplier (oldest first, with VAT), "Record payment" opens the existing payment box for that supplier (method, amount, date, proof, one payment across several invoices, advance or fee), advances per supplier, the payment history (date filter) and **Export to Excel** (two sheets: due by supplier, payment history).
- The parts desk sees nothing about payments: no payment box on the LPO page, no "Paid to supplier" badge or date, no unpaid or "paid without proof" filters, chips or pay buttons on Supplier invoices ("Paid" reads as "Checked by accounts"), no unpaid, advance or credit-to-use chips on the suppliers list.

No database change. Test: `test:sim` path d5 (10 checks). Proof: `docs/proof/2026-11-10-supplier-payments-tab/`.
