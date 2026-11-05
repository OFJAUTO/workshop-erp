# Supplier amounts with VAT — 5 November 2026 (Mathew)

## The causes (one line each)

- **The LPO tab counts:** every tab counted with the tab you were on instead of its own, so all tabs showed the same
  number (the Supplier invoices tab of the LPO page included). Parts accounts' **Supplier invoices** tab counted with
  the shared search filter instead of its own list's filters, so its number could differ from what opened; it now
  counts exactly its own list.
- **LPO-00041 showing 4.48 and LPO-00042 showing 0.00:** the two ways an LPO gets cancelled store it differently — a
  refused LPO keeps its total and its line (4.48), an LPO whose last part was cancelled with the supplier is re-totalled
  to 0 with the line switched off (0.00). Both are now shown at their **original** amount, struck through with
  "Cancelled", and never counted.

## What was built

- **One rule** (`supplierChargesVat` in `src/lib/supplier-rules.ts`): VAT only from a supplier that is VAT registered
  **and** has its 15-digit TRN on file — no TRN, no VAT. "Our stock" never has VAT.
- **One calculation** (`src/lib/supplier-money.ts`): VAT is 5% of the **LPO total**, rounded half up to the fils (never
  line by line). An entered supplier invoice's own figures replace the estimate (its amount before VAT and its typed
  VAT). A supplier without VAT stays at 0 even if VAT was typed — the edit box says to add the TRN first.
- **One display** (`src/components/SupplierAmount.tsx`): **"AED 1,011.15 incl. VAT"** with **"963.00 + VAT 48.15"**
  small and grey under it; or **"AED 963.00"** with **"No VAT – supplier not VAT-registered"**. A cancelled LPO: the
  original amount struck through with **Cancelled**. Each figure once.
- Used everywhere a supplier amount shows: the LPO list; the owner's and accounts' "Waiting on you" line for each LPO
  to approve; the Parts page's "to order" summary; the LPO page (the Lines box total, the main LPO's per-supplier
  subtotals and grand total on the approval screen, the Approve question, the pay box and the Record line); the supplier
  LPO cards on the Parts page, the parts desk and the LPO page (and their Copy text for WhatsApp); Supplier invoices (the
  rows, the opened invoice, the edit box); Parts accounts (LPOs, payments to suppliers, credits due); the suppliers
  list (the unpaid balance and a "No VAT – supplier not VAT-registered" badge); the Parts page's "Our cost" bar and its
  Print / PDF; the supplier copy PDF (Total before VAT · VAT 5% · Total incl. VAT, printed once — the per-line VAT
  columns and the repeated "Order subtotal" row are gone); and the public LPO check page behind the QR code.
- **Profit is unchanged**: it counts our costs before VAT.
- Zoho Books is unchanged: bills post through Zoho's own VAT rules (it also needs the supplier's TRN).

## Suppliers with no TRN on live (read-only, nothing changed)

| Supplier | VAT registered ticked | Open LPOs | Amount |
|---|---|---|---|
| OFJ Additional | yes | 1 | AED 1.00 (the placeholder supplier on Q-00039's grill moulding) |
| Auto Vivo Italian Luxury Car Parts | yes | 0 | – |

Every other supplier has its TRN, so their amounts gain no change. Adding a TRN on Parts > Suppliers turns VAT on for
that supplier at once (the "VAT registered but no TRN" filter lists them).

## Assumptions

- The LPO list shows what we owe: an LPO whose supplier invoice is entered shows the invoice's figures; the LPO page's
  Lines box keeps the LPO's own total (the "Approved → Invoiced" line already shows the difference).
- A cancelled LPO's original amount = every line it ever had (quantity × agreed cost); it is never in any total, balance
  or export sum.
- The supplier purchase totals page (what was bought from each supplier) stays before VAT, as its title says.

## Proof

`test:sim` path **l** at 1440×900 and 800×1280: a VAT supplier (963.00 → AED 1,011.15 incl. VAT) and a no-TRN supplier
(AED 100.00, no VAT) through the Parts cost bar, the approval screen, the Approve question, the LPO list, both LPO pages
and cards, and both supplier PDFs; every LPO tab counted against its own list (and the Supplier invoices tab); a
cancelled LPO re-totalled to 0 and a refused one that kept 4.48 both at their original amount struck through with
"Cancelled"; the no-TRN list. Unit test `supplier-money`. Screenshots `tests/browser/shots/sim/l*.png`.
