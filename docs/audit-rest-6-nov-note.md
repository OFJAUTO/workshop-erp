# The rest of the audit list – 6 November 2026

From `docs/audit-4-nov-2026.md`, after "go for all". C1, H1, H4, M4 and M5 were done earlier today; H2 and M2 were already covered.

| Item | What was done | Live? |
|---|---|---|
| H3 (code half) | The daily Zoho reconciliation reads card-settlement bank transfers for the day before, the day and the day after, and counts each on its OWN date, so Zoho's midnight drift (STL-00006 listed under 2 Nov) no longer makes red days. | Live (needs Zoho's own time zone set too – Mathew, see NEEDS OMAR) |
| M1 | Every deposit, advance and charge proforma splits its VAT through one rule (the VAT setting, half up to the fils); the bodyshop deposit's hard-coded 1.05 is gone. | Live |
| M3 | Credit notes came off the receipt with H1 this morning. A cheque still clearing stays shown with its note and blocks "Paid in full" (the 26 October design). | Live |
| M6 | The bodyshop "REAL PROFIT" card starts from the price after the discount (without VAT) and counts the car's parts. | Live |
| M7 | The job summary's bank fee comes from the one fee rule (the expected payment method), not the old stored maximum. | Live |
| M8 | The customer panel's open balance uses the same money read as the customer page and the money list (all jobs, credit notes off). | Live |
| M13 | The pending-charge proforma message and the 10-day check message go through the send window and are written down (who, when). The warranty card already was. | Live |
| M14 | All 8 live trips without a distance simply had no pin. A new trip now needs the pin or the one-way km typed; the words now say "No map pin with coordinates: type the one-way km by hand". | Live |
| M15 | Not done today: its own fix says "after a quiet week" from 31 October, so the old upload doors come out from 7 November. | Queued |
| L1 | The one orphaned quotation line (MAIN BATTERY AGM 95AH, AED 210) is removed by `20261207140000`. The key to quotations already exists on live; the line came in with keys off (a restore or test clear). | WAITING FOR APPLY |
| L2 | Four dead helpers next to live money code removed (`roundingChoices`, `suggestPromisedDate`, `LinesTable`, `methodOfTerminal`; 91 lines). | Live |
| L3 | The dead "over-payment waits for the owner" buttons and action removed (live holds no such payment). | Live |
| L4 | 33 functions get a fixed search path (`20261207150000`). The busy columns were already indexed. Leaked-password protection is a switch in Supabase (NEEDS OMAR). | WAITING FOR APPLY |
| L6 | The test clean-up also removes Zoho queue rows whose payment is gone. | Tests |
| test:sim rule | `npm run test:sim` joins the end-of-batch runs (CLAUDE.md speed rule 1). | Rule |

Found on the way: since 4 November an advisor could not attach the recovery or fuel bill to an early charge (the "supplier invoices by accounts only" rule caught it too). Fixed: the bill of a charge line is allowed again for advisors; LPO invoices stay accounts-only.
