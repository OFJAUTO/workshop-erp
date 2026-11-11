# Handover – 12 November 2026, early morning Dubai (11 Nov list of 16 sections: ALL DONE)

**Done so far:** S1 stock LPOs in Supplier invoices and payments (41df358) · S2 parts belong to one quotation (dormant until apply) · S3 apply supplier advances without a new payment + invoice date check · S4 approvals box + Approvals page · S5 void a duplicate receipt + one cheque never more than its amount · S6 lathe bills · S7 complimentary in one tap · S8 department tablets · S9 jobs to do · S10 inspection type + could not check · S11 car-card dashboards (parts desk, gate-in) + VIN checks · S12 Stickers tab + QR page signed out (57d3df2) · S13 neat pages: one 44 px button, header order, one black button, bell square (b9fbd7c) · S14 password sign-ins: one evening summary, new device at once (4896e5b) · S15 HR under Team, owner and head accountant (9da5dc6, dormant until the apply) · S16 speed: dashboards 35-50% faster, no paid plan needed (c9fd475, docs/speed-11-nov-note.md).

**Tests (end of batch):** full simulation 711 checks, the 2 that failed were the tests (fixed and re-run: 22/22) · full layout check 168 pages × 9 sizes + 252 pop-ups, 4 broken-code wraps fixed and re-checked clean · security all passed · unit all passed · live check 33/33. Re-verified on the final build: all 17 simulation paths of this list 240/240, full layout check clean (168 pages × 9 sizes), live per-section read-only check 22/22 (`npm run check:live:sections`), production built from d7a17a6. Still stale and not from this batch: test-docs Q-00039 checks (6, inside test:layout).

**NEEDS OMAR (11 Nov list):**
- HR (after the apply): you and Mathew (head accountant) both already have a phone sign-in, so HR opens for you both. Open HR, open each person, and upload their documents with the expiry dates.
- Supplier invoice dates to correct (Edit invoice on the LPO page, Mathew): LPO-00043-1 and LPO-00044-1 (GARGASH, dated 11 May 2026: likely 5 November, day and month swapped), LPO-00035-2 (SPARE HUB, dated 29 Oct 2016: likely 2026).
- Mathew checks AL ALI's invoices total AED 6,693.75 (cheques 019383 + 019409), then voids RCT-00062; Omar approves. (On live: cheque 019383 = RCT-00057 2,236.50 + RCT-00058 2,131.50 = 4,368.00, both cleared in STL-00017; RCT-00062 2,236.50 on J-00860 is the duplicate still waiting; 019409 = RCT-00071 2,325.75.) After the apply: Accounts posting > Cheque > RCT-00062 > Void – duplicate.
- Mathew moves KA-673205 to the right shop and ticks its tickets. (On live: KA-673205, AED 630, 9 Nov, is under ABU DHABI MOTORS L.L.C, which is not a lathe shop, and carries one ticket whose shop is KHALID & ALAM LATHE WORKSHOP. After the apply: Parts management > Lathe > KA-673205 > Correct > Lathe shop.)
- After the apply: set each shared tablet's department (Team > Tablets and phones: Workshop / Bodyshop / Both). Today: Test tablet, Mechanic Tablet 1, Mechanic Tablet 2, Mechanic 1, Mechanical 2, Mech 3 and Bodyshop shared read "Department: not set".
- After the apply: set the fee per inspection type if wanted (Settings > Inspection checklist > Inspection types – fee and time allowed); empty keeps today's fee. From the apply an inspection waits until the advisor picks its type on the job card; cars already in inspection show "Type: not set".
- VIN from a photo (Section 11): not built - the barcode scan and typing stay, with the checks (17 characters, no I/O/Q, make from the VIN). Reading a VIN from a photo needs a paid service to be reliable, e.g. Google Cloud Vision text reading: USD 1.50 per 1,000 photos after the first 1,000 free each month; at 30 cars a day about USD 0-2 a month, worst case under USD 5. Say yes if you want it.
- Q-00078 (J-00317): Peter re-links the parts on Q-00078. On live: 13 of the job's priced parts are on the approved Q-00020 and stay there; three (FRONT BRAKE PAD, MAIN BATTERY, TRANSMISSION MOUNT) were priced before Q-00078 existed and are on no quotation: after the apply they show on Q-00078 under "Parts priced for this job on another quote (3) – Add here".
- Zoho mapping: pick the stock account for "Stock purchases (inventory)" on Settings > Zoho Books > Mapping (OFJ TEST makes "Inventory Asset" by itself).

**WAITING FOR APPLY:** nothing. All 8 applied 11 Nov night (backup `backups/2026-11-11T19-35-14`), live check 33/33.

---

# Handover – 11 November 2026, 11:30 Dubai (10 Nov list: ALL DONE)

**NEEDS OMAR:**
1. **J-00490:** job card → Comeback – at our cost → tick Original job not in the ERP, old invoice number, what went wrong → Send to the owner → approve At our cost on the same card.
2. **Zoho "Warranty / rework" expense:** the account name from the accountant (posting at-our-cost costs to Zoho is not built yet).
3. **Accounts:** confirm no VAT on warranty repairs (lines at our cost carry none now).
4. **Accounts limit for LPOs** (optional): Settings > Money, "Accounts approve LPOs up to AED …" (0 = off).

**Live (10 Nov list, all ten):** S1 paid means paid · S2 Autel post-scan · S3 several invoices per LPO · S4 send LPO for owner approval · S5 supplier payments tab · S6 proof on every payment method · S7 clocking Start/Pause/Stop · S8 stock reverse · S9 comeback at our cost · S10 view as customer. Notes in docs/*-10-nov-note.md.

**WAITING FOR APPLY:** nothing. Applied 11 Nov morning (backup `backups/2026-11-11T06-28-27`): lpo_invoices, lpo_owner_review, stock_reversals, comeback_at_our_cost; live check 33/33.

**Tests:** full simulation 550/550 (every path, every role) · security all passed · layout check clean · live check 33/33. Known stale: test-docs' Q-00039 checks (TEST's copy of Q-00039 is now an approved AED 37,930 quotation, not the package-only draft it expects) and test-i check 4 (team leader one-tap pick).

**Queue:** empty.

---

# Earlier: 9 November 2026, night

**NEEDS OMAR:**
1. Done: the six items below were applied on 9 Nov night (backup `backups/2026-11-09T19-20-13`).
2. **AL ALI cheque 019383:** on J-00858's money page press "Replace with combined payment" on RCT-00058, tick RCT-00057, RCT-00058 and the duplicate RCT-00062 (J-00860), save. J-00860 left on 9 Nov before the cheque cleared.
3. **J-00974 (Range Rover):** pick the PPF and tint rolls on the car's Warranty details (bells go out with item 4 below).
4. **The BMW job (rear differential oil 3 → 2):** Parts, use "Change the quantity…" on the part.
5. **J-00991:** promised date and advisor still missing.
6. **Office PCs for passkeys:** steps in `docs/passkeys-pc-9-nov-note.md` (Bluetooth, firewall for cable.ua5v.com and cable.auth.com).
7. **Lathe price list:** Parts management → Lathe → Price list (one line per item: `Brake disc | 80`) (now switched on).
8. From before: `OFJ-BACKUP-KEY.txt` on the Desktop (password manager, print, delete); B2 values in `.env.local` (optional); Mathew sets both Zoho orgs to Asia/Dubai; LPO-00045-1 "Check again in Zoho".

**Live (9 Nov evening, the owner's 8 sections):** 1 quantity change after approval (12a77f6) · 2 Accounts posting (ea08217) · 3 one payment for several cars + statement (8808fa5) · 4 passkey rules (4d454b9) · 5 simple part sticker (c3a56fa) · 6 warranty batch only PPF/tint (d2579f1) · 7 clear 1080p videos + archive (711c6bb) · 8 lathe work (4fe5ecf) · layout fixes (3b2f40f).

**WAITING FOR APPLY:** nothing. Applied 9 Nov night (backup `backups/2026-11-09T19-20-13`): 1 accounts_posting · 2 payment_groups · 3 passkey_reset_code · 4 J-00974 batch-missing bells (2 sent) · 5 video_archive · 6 lathe_work; live check 33/33.

**Queue:** empty.

**Tests:** security passed; full layout check (2 findings fixed, re-checked clean); simulation 448 passed, 0 failed (all paths, every role, 71 min); live check 33 passed.
