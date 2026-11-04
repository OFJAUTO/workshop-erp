# Menu: "Parts management" group (Mathew) — 5 November 2026 (night)

What Mathew asked for (queued 4 November): one menu item that folds the parts paperwork together.

## What changed

1. **One "Parts management" item** in the side menu replaces the four separate items, with the
   four indented underneath in Mathew's order: **LPOs · Supplier invoices · Parts accounts ·
   Suppliers**. A tap on the main item opens or closes the group.
2. **It opens by itself** whenever you are on one of its pages, and the page you are on is
   highlighted. Close it by hand and the main item takes the highlight instead, so you always see
   where you are.
3. **The main item's badge** is the total waiting inside: LPOs waiting for approval, plus
   supplier invoices still to collect, enter or check. The LPOs and Supplier invoices sub-items
   carry their own share of that number. (The badge counts per LPO, so the rare invoice split
   over two LPOs counts twice on the badge while the page groups it — the page is the truth.)
4. **Each role sees only its own sub-items**, exactly as before: the owner and accounts see all
   four; the parts desk sees LPOs, Supplier invoices and Suppliers (no Parts accounts); advisors
   see no group at all. The phone's ☰ menu shows the same group the same way, and every old
   address still works (old links and bookmarks are untouched).
5. **One shared shape** (`NavGroup` in `SidebarNav`): any later menu group is just another entry
   in the same list, drawn by the same component on the computer and the phone alike.

## Proof (`npm run test:partsmenu`, 12 checks)

Accounts on a computer: closed and open, the order, the badge sum, the group opening by itself on
the LPOs page with the page highlighted, the old address working; the phone drawer; a parts login
seeing only its three; an advisor seeing no group. Screenshots in `tests/browser/shots/parts-menu/`.

No database change.
