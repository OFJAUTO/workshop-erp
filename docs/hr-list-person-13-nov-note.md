# HR: list page and person page – 13 November 2026 (Section 13)

Still for the owner and the head accountant only, with a phone sign-in, checked on the server (as built on 11 November).

**List page (Team › HR):**
- **Search bar:** name, role, department or phone. It filters as you type.
- **Tiles as filters:** Expired (n), Expiring in 60 days (n), Documents missing (n), On probation (n). Tap a tile to filter, tap it again to clear.
- **Groups:**
  - Grouped by department and team ("Mechanical · Technicians", "Bodyshop · Painting", "Office · Accounts"), with counts. Each group folds, and chips at the top jump to a group.
  - Support staff (office boys, cleaners, drivers) form their own group.
- **Each row:** photo, name, role, one status line and "5 of 7 documents". The status line reads:
  - green "All documents valid";
  - amber "Visa expires in 23 days";
  - red "Passport expired";
  - grey "3 documents missing".
- **Sort:** "Needs attention first" (default) or A-Z.
- **"+ Add person"** for staff with no ERP login, with a role from a list (the Team roles plus Office boy, Cleaner, Driver) and a department/team from the same list as the Team form.
- **"Download expiry list"**: an Excel file of every document with an expiry, soonest first. It has no ID numbers. Same access rule, and every download is logged.
- **Menu:** HR (and Sign-ins) sit indented under Team. Only the open one is lit.

**Person page:**
- **A fixed row per document:** Personal photo, Emirates ID, Passport, Visa, Labour card, Health insurance card, Driving licence.
  - Not uploaded: "Missing" with **Attach**.
  - Uploaded: the thumbnail(s), the number masked until tapped, the expiry date, the days left in green/amber/red, View (one per file) and **Replace**.
  - **Replacing keeps the old files** under "Replaced documents".
- **"Other document"** at the bottom, with its own name. It waits for the apply (item 7 on the list).
- **The Attach window** replaces the browser's "Choose File":
  - On a phone or tablet: **Take photo** or **Choose file**. On a computer: Choose file.
  - **Several files per document** (Emirates ID front and back, passport pages), each previewed before saving.
  - **Large photos are reduced on the device**: a 4.5 MB camera photo is saved, not refused.
- **Role and department are read from the Team record** for anyone with an ERP login (with a link to change them on Team). People with no login pick from the same lists.
- **Fixed on the way:** the "masked" ID number used to travel to the browser in full (it was only hidden by the display). Now the page sends only the masked number, and the real one comes from the server on the tap, which is logged.

**Proof (TEST):**
- `npm run test:s13-13` passes 22 of 22.
- The simulation's HR path follows the new Attach window.
- Layout check of the HR pages at 800 × 1280 and 1440 × 900: clean.
- Screenshots: `docs/proof/2026-11-13-hr/`.

**Assumptions:**
- "Expiring in 60 days" counts documents not yet expired.
- Support staff are found by the role words (office boy, cleaner, driver, tea boy, messenger, security).
- Up to 8 files per document, about 3.8 MB together (photos are reduced; a large PDF has to be saved smaller).
