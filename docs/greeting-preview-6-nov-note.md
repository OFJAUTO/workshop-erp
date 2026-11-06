# Small preview + one greeting – 6 November 2026 (Section 7)

## Link preview
Every customer link (check-in, report, quotation, estimate, invoice, receipt, payment, progress, warranty, short links) now shows ONE small square picture: the OFJ logo in black on white with room around it, 200 × 200, 3.6 KB (`public/og/ofj-logo-200.png`, public https). Titles stay as they were; no customer name, plate or amount. New file name, so WhatsApp fetches it afresh (links already sent may keep their old preview in chats).

## Greeting
One rule for every customer message (`greetingNameOf`):
1. the customer's saved **"How to address in messages"** (e.g. "Dr Dhia") – a new box on the customer form for the owner and advisors; it switches on when you apply `20261207120000_customer_address_as.sql` (WAITING FOR APPLY);
2. otherwise the **title and surname in normal case**: "DR DHIA YAHYA DHIA AL DIN JAFFAR" → **"Dear Dr Jaffar,"**;
3. no title typed → the **first name** in normal case ("Dear Dhia,") – the ERP never guesses Mr or Ms;
4. a company: its contact person by the same rule, else the company name without LLC.
Contacts picked in the send window follow the same rule. Live now (2–4); 1 after the apply.

Assumption: without a title the first name is used; if you prefer something else (e.g. the full name in normal case), say so.

Proof (TEST, `test:sim` path u, 5 checks; unit `greeting`, 10 checks): the job card's messages and the quotation both say "Dear Dr Jaffar,"; after saving "Dr Dhia" both say "Dear Dr Dhia,"; the preview is a 200 × 200 PNG. Files: `docs/proof/2026-11-06-greeting/preview-200.png`, `u-how-to-address-1440.png`.
