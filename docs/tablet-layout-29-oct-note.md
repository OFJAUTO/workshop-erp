# Tablet layout – 29 October 2026 (batch section 2)

What the staff see on a tablet held upright, a tablet sideways, a phone and a computer.

## The menu

- Below about 1,100 px wide (a tablet held upright, a phone, a small laptop window) the left menu is gone and a
  black bar sits at the top: ☰ · OFJ logo · search · bell.
- ☰ slides the menu in over the page. ✕, a tap on the darkened page, the back button or Escape closes it; picking a
  page opens it and closes the menu. The menu also carries the name, the role and Sign out at the bottom.
- 1,100 px and wider (a tablet sideways at 1,280, every computer) keeps the left menu exactly as before.
- One layout for everyone: `src/components/Shell.tsx` (the sidebar, `nav:` breakpoint = 68.75rem in
  `globals.css`) and `src/components/MobileTopBar.tsx` (the black bar and the sliding menu). The bell is the one
  `NotificationBell`, moved by `BellDock` into the top bar (`#topbar-bell-slot`) or the page header
  (`#header-bell-slot`).

## The car card

- ONE component, `src/components/CarCard.tsx`, draws a car on the dashboard, Jobs, My jobs, To assign, Car wash and
  the bodyshop board (Going out and every section).
- The card measures itself, not the window: narrow = photo on the left; plate on one line; make and model in
  capitals; "customer · condition · job number" (the customer's name starts with a capital, `nameCase` in
  `src/lib/name-case.ts`); chips that wrap. Full width underneath: what the car waits on, the warning chips, the slim
  stage bar. Wide (a computer) = photo, details and the status side by side.
- The slim stage bar is `src/components/StageBar.tsx`: eight steps, done black, the current step in its timing
  colour with a bold label, later steps grey; short labels on a narrow card (Gate, Insp., Quote, Appr., Parts,
  Work, QC, Wash), full labels on a wide one.
- Words never break in the middle: `src/components/Words.tsx` keeps "J-00494", "Mercedes-Benz" and "G-Class" whole
  (a browser would otherwise break after the hyphen).
- The whole card opens the car; buttons inside it (the "2 quotations ▾" picker, the wash buttons) work on their own.
- Not a car card on purpose: the Parts desk (`/parts`) is a list of tasks (to price, to order, to receive) grouped by
  LPO and supplier, not a list of cars.

## The rules every page is checked against

`npm run test:layout` (`tests/browser/layout-check.mjs` with the rules in `tests/browser/layout-rules.mjs`) opens
every menu page for every role, the staff job pages of a seeded car and the customer pages (quotation, proforma,
invoice, report, approval) at 1920×1080, 1440×900, 1366×768, 1280×800, 1024×768, 800×1280, 768×1024 and 390×844, and
once at 800×1280 with the text at 130%. It fails on:

- the page scrolling sideways (wide tables scroll inside their own box);
- a control overlapping another, or cut off at the right edge;
- text on top of other text;
- text clipped by its box (a deliberate "…" is allowed);
- a word broken across two lines;
- anything sticking out of its card;
- on touch screens, a button, picker or box under 40 px tall (44 px by design).

The pop-up check (`tests/browser/popup-check.mjs`, 26 pop-ups) runs with it at 1440×900, 1280×800, 1024×768,
800×1280, 768×1024 and 390×844. `ROLE=<role>` runs one role, `ROLE=customer` the customer pages, `ROLE=popups` the
pop-ups alone, `PART=1/3` a third of a role's pages.

A word may still wrap at its own hyphen the way English text does ("one-" / "way"), but never inside a piece, never
inside a code, number or date ("J-" / "00016", "2026-" / "10-27") and never leaving a piece of one or two letters
("G-" / "Class").

## Fixed by the check

- Every compact 36 px control (the filter and view buttons on Calendar, Invoices and LPOs, the supplier filter,
  the boxes in the Parts table and the quotation editor) is 44 px on a touch screen: one rule in `globals.css`
  (`@media (pointer: coarse)` makes `h-9`/`min-h-9` 44 px). A computer keeps the compact size.
- Calendar and Invoices filters are 44 px everywhere.
- The gate-in buttons ("Existing customer, new car") ran into each other at 130% text: their words now wrap inside
  the button.
- Car numbers and makes broke after the hyphen on Jobs: kept whole.
- Zoho page: the review date reads "27 Oct 2026" instead of the split "2026-10-27"; "until go-live" reads "until the
  books go live".
