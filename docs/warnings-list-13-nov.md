# Warnings and blockers on the staff screens (13 November 2026)

Found by `scripts/warning-inventory.mjs` (it reads the screens' code): **11 warnings**, **9 with a fix beside them**, **2 with words only**.

A fix is a button, a link, a form or panel on the same spot, or "Remind <name>". Lines marked **words only** are the ones still to give a button.

| Screen (file:line) | Warning | Fix beside it |
|---|---|---|
| `components/InvoicesNotReceivedCard.tsx:59` | Supplier invoices not received: … | **words only** |
| `wash/page.tsx:56` | : null} {rows.length === 0 ? | **words only** |
| `jobs/[id]/gate-out/CollectItemsForm.tsx:49` | … Only the owner or accounts can approve the release. | yes |
| `jobs/[id]/gate-out/GateOutForm.tsx:307` | … You can release it with a reason (logged). | yes |
| `jobs/[id]/gate-out/GateOutForm.tsx:317` | … Gate-out is blocked until it is paid, or the owner releases it. | yes |
| `jobs/[id]/quote/[qid]/page.tsx:329` | : null} {q.status === "pending_owner" ? | yes |
| `jobs/[id]/work/page.tsx:122` | Not possible yet: …. | yes |
| `parts/orders/[id]/page.tsx:292` | … is ticked VAT registered but has no TRN: its bill cannot go to Zoho Books. Type the 15-digit TRN on | yes |
| `pending-charges/page.tsx:51` | … | yes |
| `road-tests/[jobId]/page.tsx:53` | Gate-in condition: …. If the car cannot be driven, mark the road test not possible. | yes |
| `settings/zoho/mapping/page.tsx:102` | : null} {!configured ? | yes |
