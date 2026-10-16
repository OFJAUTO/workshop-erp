# 16 October 2026, evening: approved quotations are locked

Delivery note for the owner. Migration `20261103090000_lock_approved_quotes.sql` (backup `backups/2026-10-16T15-15-01` taken first). Proof test `npm run test:x` (27 checks).

## What was wrong

Nothing on an approved version had ever been changed: the database shows no line changed or removed on any approved quotation after the customer's approval (Q-00001 v1, Q-00005 v1 and v2, Q-00012 v1), and no discount, deposit or rounding changed either. What advisors could do was press **Revise quotation** on the approved quotation: that made the next version as an open draft, and on that draft every line could be removed or changed. On Q-00012 (J-00265, plate 1972, now in QC) Adarsh pressed Revise 39 seconds after the customer approved version 1 (16 Oct, 11:46 Dubai time); version 2 has stood as an editable draft since, and this afternoon (18:55) two lines were removed on it: "Cabin air filter removal and replacement" by Omar’s account and "Tire replacement" by Adarsh’s account, 25 seconds apart. The 16 October D3 rule ("Ask owner to revise") closed the Revise button for advisors earlier today; this round closes every other door and locks the approved version itself.

## The rules now

1. **Approved by the customer: locked for everyone.** On the quotation page every figure is plain text: no boxes, no delete buttons, no three-dot menus, no "+ Add line", no deposit or discount controls. A banner at the top reads **"Approved by the customer on 16 Oct. Locked. Ask the owner to revise."** (the owner reads "… Locked. Revise to change it: a new version goes to the customer."). The only way to change the work is a new version: the owner presses **Revise quotation**; an advisor presses **Ask owner to revise** with a reason and the owner allows one revision or declines (the 16 October D3 flow). The approved version itself never changes, not even for the owner: the new version is where the work happens, and it goes to the customer again.
2. **Enforced on the server, whatever the screen.** Every path that writes a quotation asks the lock first: the editor's save route (lines, header, parts requests, reorder), the quotation actions (complete, reopen, round, urgent-only, add missing parts, revise), the Parts desk (a priced or changed part never lands on an approved version; it asks the owner as before), and the owner's Allow. A refused attempt is written in the quotation's history and on the job's history: "Refused: Adarsh (service advisor) tried to remove a line on Q-00012 v1 from the quotation editor. This quotation is locked: approved by the customer on 16 Oct. Ask the owner to revise." The database holds the same rule in a trigger: on an approved (or replaced) quotation no line can be added, changed or deleted and the discount, deposit, rounding, VAT, validity, note and payment choices cannot change, whoever asks and from wherever, including a direct database query. Only bookkeeping stays free (the recomputed stored total, the customer's approval mark, status changes, the system's flags).
3. **Stricter once a document is out.** With a **proforma** issued for the job the banner reads "… Locked. Proforma PRO-00012 issued: only the owner can revise." Advisors have no Ask button; the owner's Revise still works, and when the customer approves the revised version the old proforma is cancelled and a new one issued from the approved lines with every payment carried across (the customer's link follows). With a **tax invoice** issued the banner reads "… Locked. Tax invoice INV-00012 issued: changes only by credit note." Nobody can revise, the owner's Allow is refused with the same words, and a Parts change on such a job tells the owner "tax invoice already issued" to settle by credit note on the invoice page.
4. **The banner** sits at the top of every locked quotation; a replaced version reads "Replaced by a newer version. Locked, kept for the record."

## Check of every approved quotation (point 5)

| Quotation | Approved | Lines changed or removed after approval | Other changes after approval |
|---|---|---|---|
| Q-00001 v1 (J-00021) | 14 Oct, 10:22 | None | None |
| Q-00005 v1 → v2 | v1 14:31 on 15 Oct; v2 approved 20:45 | None on either approved version | v2 was a revision made by Omar (owner) and approved again by the customer: in order. |
| Q-00012 v1 (J-00265, plate 1972) | 16 Oct, 11:45 | None on v1 | **Version 2 draft started by Adarsh at 11:46:35, 39 seconds after the approval, without the owner's permission (the D3 rule did not exist yet).** On that draft: "Cabin air filter removal and replacement" (AED 70) removed by Omar’s account at 18:55:28, "Tire replacement" (AED 450) removed by Adarsh’s account at 18:55:53. Nothing else differs from v1. The draft was marked complete and owner-approved at 11:47 but never sent; v1 remains the approved quotation and the work order follows v1. |

Nothing was changed back. Q-00012 v2 still stands as a draft; say "cancel Q-00012 v2" and it is marked cancelled (v1 stays the approved record), or "keep it" and it stays as it is for you to send after your own check.

## Tests (point 6)

`npm run test:x`: as an advisor, remove a line, change a price, change the discount and add a line on an approved quotation through the editor's save route: all four refused (423) with the lock message, nothing changed, five refusals (the owner's in-place try included) written in the quotation's history and the job's history. Straight in the database: a line update, a line removal, a new line and a discount change on the approved quotation all refused by the trigger; the stored total can still be recomputed. The advisor's screen: the banner, no boxes, no delete buttons, no menus, no Revise, "Ask owner to revise" works and is written down. The owner: the banner offers Revise; Revise makes version 2 as a draft (logged "version 2 started by Omar"), version 1 untouched and still approved, version 2 editable. With a proforma out: the advisor reads "only the owner can revise" and has no Ask button, the owner keeps Revise. With a tax invoice out: nobody has Revise, "changes only by credit note". The 15 October (55), 15 October evening (42), deposit (61), payment (51), 12 October (67) and notification (55) suites were re-run and pass. The notification suite had been clicking the VIN’s Copy button (added to every car header on 16 October) instead of the send window’s Copy: the VIN button is now labelled "Copy the VIN" for screen readers and the test looks inside the send window.

## Assumptions

- "Locked for everyone except the owner" is read as: the owner changes it by making a new version (the D3 flow), never by editing the approved version in place. The approved version is the record of what the customer agreed; editing it in place would change that record.
- A replaced (superseded) version is locked the same way, forever.
- A deposit receipt or deposit tax invoice does not count as "a tax invoice exists"; only the job's proforma or tax invoice for the work does. A cancelled or converted document does not count.
- When a revised quotation is approved after the proforma went out, the proforma is remade and the payments move across; if the balance is already covered the tax invoice follows at once, as it would have.
- The owner's "Allow one revision" is refused once a tax invoice exists; the credit note on the invoice page is the way.
- The refusal is logged, not sent as a notification; the quotation's history and the job's history show it.
- Q-00012 v2 is left as it is until you decide.
