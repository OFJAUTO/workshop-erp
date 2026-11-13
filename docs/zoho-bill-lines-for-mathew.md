# Supplier bills in Zoho: one line per part (for Mathew, 13 November 2026)

From today, a supplier bill reaches Zoho with **one line per part**, as the supplier invoiced it.

**Each part line carries:**
- the part's name, quantity and unit cost before VAT;
- the part number, the LPO, the job and the plate (shown here as "(plate)"), in the line's description;
- its own account: parts purchases, or stock value for a stock order. Courier and freight lines go on the courier account.

**The bill's order number (reference) is the LPO.**

**When the supplier's paper gives a discount or a round-off on the total, it is its own line:**
- "Invoice discount / round-off" when it lowers the total;
- "Invoice round-off" when it raises it.

**VAT and the total:**
- VAT is 5% per line, which Zoho works out.
- The few fils between that and the VAT printed on the paper go in the bill's adjustment, so the bill's total is the paper's to the fils.
- Nothing changes in the totals: every bill below keeps exactly the total it had.

**Bills already posted with the old single line** have, on the Zoho sync page, a button **"Re-post with one line per part"**.
- It changes that one bill in place, and the total stays the same.
- A payment already applied to it stays applied.
- If Zoho ever showed less paid after the change, the row turns red and says so.

**This is for supplier bills only.** Invoices, payments and expenses are unchanged.

Below: three real bills, as they were posted and as they post now. The figures were read from the ERP, read-only; Zoho was not touched to make this page.

## LPO-00076-2 · bill 1260925425 · PREMIER AUTO PARTS L.L.C · J-01007

**Before (one summary line):**

| Line | Qty | Rate | Account | VAT |
|---|---|---|---|---|
| Parts per LPO-00076-2 – 3 items | 1 | 878.00 | Parts purchases | 5% |

**Now (one line per part):**

| Line | Description | Qty | Rate | Amount | Account | VAT |
|---|---|---|---|---|---|---|
| spark plugs | Part no. S&S · LPO-00076-2 · J-01007 · (plate) | 8 | 67.00 | 536.00 | Parts purchases | 5% |
| WIPER BLADE | Part no. BLADE · LPO-00076-2 · J-01007 · (plate) | 1 | 110.00 | 110.00 | Parts purchases | 5% |
| DIFFERENTIAL OIL | Part no. FLUID · LPO-00076-2 · J-01007 · (plate) | 4 | 58.00 | 232.00 | Parts purchases | 5% |

Order number (reference): **LPO-00076-2**. Before VAT **878.00**, VAT **43.90**, total **921.90** – the same total as before.

## LPO-00044-1 · bill 25630196-10670443 · GARGASH ENTERPRISES L.L.C · J-00979

**Before (one summary line):**

| Line | Qty | Rate | Account | VAT |
|---|---|---|---|---|
| Parts per LPO-00044-1 – 3 items | 1 | 1,746.51 | Parts purchases | 5% |

**Now (one line per part):**

| Line | Description | Qty | Rate | Amount | Account | VAT |
|---|---|---|---|---|---|---|
| ENGINE MOUNTING LH | Part no. A4632400600 · LPO-00044-1 · J-00979 · (plate) | 1 | 703.56 | 703.56 | Parts purchases | 5% |
| ENGINE MOUNTING RH | Part no. A4632400500 · LPO-00044-1 · J-00979 · (plate) | 1 | 719.55 | 719.55 | Parts purchases | 5% |
| Transmission mounts | Part no. A1672407100 · LPO-00044-1 · J-00979 · (plate) | 1 | 323.40 | 323.40 | Parts purchases | 5% |

Order number (reference): **LPO-00044-1**. Before VAT **1,746.51**, VAT **87.33**, total **1,833.84** – the same total as before.

## LPO-00086-2 · bill 262817422 · DUBLIN AUTO SPARE PARTS LLC BR · J-01002

**Before (one summary line):**

| Line | Qty | Rate | Account | VAT |
|---|---|---|---|---|
| Parts per LPO-00086-2 – 4 items | 1 | 419.05 | Parts purchases | 5% |

**Now (one line per part):**

| Line | Description | Qty | Rate | Amount | Account | VAT |
|---|---|---|---|---|---|---|
| Engine oil filter | Part no. OIL FILTER · LPO-00086-2 · J-01002 · (plate) | 1 | 14.29 | 14.29 | Parts purchases | 5% |
| AIR FILTER | Part no. AIR FILTER · LPO-00086-2 · J-01002 · (plate) | 1 | 133.33 | 133.33 | Parts purchases | 5% |
| Gasket, Valve cover | Part no. GASKET · LPO-00086-2 · J-01002 · (plate) | 1 | 42.86 | 42.86 | Parts purchases | 5% |
| BRAKE PADS | Part no. PAD · LPO-00086-2 · J-01002 · (plate) | 1 | 228.57 | 228.57 | Parts purchases | 5% |

Order number (reference): **LPO-00086-2**. Before VAT **419.05**, VAT **20.95**, total **440.00** – the same total as before.

