# Handover – list of 21 November 2026 (Edit a charge + Journal Voucher provider details): DONE

**WAITING FOR APPLY:** 1 file, `supabase/migrations/20261221090000_charge_edit_jv_provider.sql` (backup `backups/2026-11-21T06-44-15`). From your phone: turn auto mode off, reply **apply**.

**NEEDS OMAR:**
1. Reply **apply** (switches on Edit on charges and the "No receipt" tag).
2. After apply: the advisor (or accounts) opens J-01030 → Charges → **Edit** on "DELIVERY CHARGES - SHANGAI GLOBAL AUTO PARTS" → corrects the wording → Provider: SHANGHAI GLOBAL AUTO SPARE PARTS CO.LLC → Save the changes → YES, SAVE.
3. Mathew records the Porter parking card (J-01016, 34.10) with provider PORTER TECHNOLOGIES FZCO and its invoice number, or taps "Ask … for the receipt" first.
4. Mathew confirms the way the advance is deducted on the final tax invoice (this morning's urgent fix), and issues J-01013's final tax invoice.
5. The Next.js security-upgrade notice (see the morning report): decide whether to run it.

**Live:** S1 charge edit (bb6c479c, dormant until apply), S2 Journal Voucher fields (1423a24f). Note `docs/charges-jv-21-nov-note.md`.

---

# Handover – urgent: the final tax invoice after an advance (21 November 2026, DONE)

**WAITING FOR APPLY:** nothing (no database change).

**NEEDS OMAR:**
1. Mathew issues the final tax invoice for J-01013: Invoices and payments → search "19805" → the J-01013 row → What to do now → **Generate the final tax invoice** → YES, GENERATE IT. It takes off INV-00037; RCT-00106 (2,000.00) goes onto it by itself. Then the advisor sends it and the car can be gated out.
2. Mathew confirms the way the advance is deducted on the final tax invoice (TOTAL VALUE OF THE WORK / LESS ADVANCE ALREADY INVOICED – INV-… / THIS INVOICE), with the accountant.
3. J-01029 (advance INV-00042, 800.00 = the whole job): when it is Ready, the same button gives a final tax invoice of 0.00 to pay.
4. The Next.js build tool printed a security-upgrade notice (see the report); decide whether to run the upgrade.
5. Items 1-6 of the 20 Nov list below still stand.

**Live:** note `docs/final-invoice-21-nov-note.md`; test `tests/browser/test-final-invoice.mjs` 24/24 on TEST; unit `final-invoice`.

---

# Handover – list of 20 November 2026 (ALL DONE AND APPLIED 21 Nov night; nothing waiting)

**WAITING FOR APPLY:** nothing. The three changes were applied on 21 Nov (backup `backups/2026-11-20T20-24-40`), check:live 33/33.

**NEEDS OMAR:**
1. Reply "apply". Then Mathew corrects LPO-00103-1 (BLEEDING SCREW): Correct how this return was settled → RETURNED BEFORE INVOICING → reason → Save.
2. J-01034: the advisor opens the job card → START THE JOB – LOOSE ITEMS → the quotation from E-00102 opens → Nothing to receive → parts, invoice and payment, Gate out.
3. After "apply": Mathew records AED 243.50 on LPO-00111-2 → ROUNDING. With the accountant, check the two new Zoho mapping accounts (Rounding Off, Discount Received).
4. After "apply": approve the opening stock count in Approvals when the parts desk sends it.
5. Tell me if Deepak should also be able to issue stock (today: view only; Team → Deepak → Stock → Can view stock).
6. Advisors convert their OFJ Additional parts: Q-00001 v1 (J-00016, 31 parts), Q-00030 (J-00609), Q-00039 (J-00969).

**Live:** S1 return endings (48663372), S2 loose-items jobs + JOB CARD (fe006ef6), S3 supplier rounding (307e1d2e), S4 provisional parts (9760fe95), S5 stock page (6ea8257a).

**End of batch:** unit all pass; security all pass; full layout 178 pages / 1,602 views clean; pop-ups 258 all fit; check:live 33/33; simulation 713 of 713.

**Note:** this PC lost IPv6 today; the database scripts use the Supabase pooler when SUPABASE_POOLER_HOST is set (in .env.local and .env.test.local; not a secret). test-p's stock steps are written for the old stock layout.

---

# Handover – second list of 18 November 2026 (ALL DONE; last update 18 Nov, 21:40 Dubai)

**NEEDS OMAR (top first):**
1. Parts: mark LPO-00089 (VEGA, BOSCH BRAKE FLUID) received, so the stock counts it. Its Zoho bill is now AED 16.80 (it read 0.00 because nothing was marked received).
2. Mathew: Sync to Zoho once. RCT-00091 then leaves the queue as "Not sent – cancelled before sync"; the VEGA bill posts at 16.80 before SPAY-00041.
3. Nothing to redo for the AED 45,229.00 settlement: it is STL-00032 (recorded 18 Nov, 11:03). The red line came from the bank report upload, which could not read that file.
4. When merging the two Sparein supplier records, keep SPAREIN AUTOMOTIVE L.L.C (the name on their invoices).
5. Advisors convert their "OFJ Additional" parts: Q-00001 v1 (J-00016, 31 parts, ADARSH), Q-00030 (J-00609, ANAS), Q-00039 (J-00969, Omar), Q-00045 (J-00343, ADARSH).
6. Optional: one Zoho supplier credit per credit note (with several lines) instead of one per part needs a small database change. Reply "credit note lines" if wanted.
7. From the first 18 Nov list: Mathew's cheque tax invoice setting, Mark cleared on cheque 018315, Issue tax invoice now on J-00981 and J-00860, 24 approvals waiting.

**Done:** S1 Zoho bills (77ec8a8e), S2 cancelled documents leave the queue (76e9ebc0), S3 settlement result (f18e194a), S4 purchase returns and credit notes (9fa283f8), S5 + Add a part with a choice (b2e5ef9f). No database change: nothing waiting for apply.

**End of batch:** unit all pass; security all pass; full layout 178 pages / 1,602 views clean; pop-ups 258 all fit (the pop-up check now opens the Add a part choice first; one timing flake re-run clean); simulation 713 of 713; check:live 33 of 33.

**Timing:** S1 75 min, S2 50 min, S3 35 min, S4 85 min, S5 70 min. Tests, builds and checks about 2 h (one production build 10 min, layout 14 min, pop-ups twice 12 min, simulation 70 min, section tests about 20 min). Deploy waits: none.

---

# Handover – list of 18 November 2026 (ALL DONE; last update 18 Nov, 12:00 Dubai)

**NEEDS OMAR (top first):**
1. Mathew chooses when tax invoices are issued for cheque payments: Accounts posting → Cheque tab → "Tax invoices for cheque payments" (now: when the cheque clears).
2. Mathew presses Mark cleared on cheque 018315 once the bank shows it. It clears RCT-00096 and RCT-00097 together; the page now says so first.
3. Tax invoices not made yet, though the jobs are paid in full: J-00981 (PRO-00007, AED 2,325.75) and J-00860 (PRO-00015, AED 2,236.50). Mathew presses "Issue tax invoice now" on each job's Payments and invoice page. J-00493 is due by 20 Nov; J-00460 is 17 days old (due 14 Nov).
4. Approvals: 24 are waiting for you, the oldest 17 days (mostly revisions). The RCT-00062 void (a duplicate, the evidence is on the item) has waited 6 days.
5. The daily approvals email: the first send shows on the Approvals page. If it says it could not send, the free fix is to add the Google Workspace key to Vercel; WhatsApp would cost about USD 1.50 a month at worst. Details in docs/approvals-wait-18-nov-note.md.
6. From 17 Nov, still open: SPAY-00023/24/28/29/33 proofs; AL TAYER's one invoice for LPO-00039-1 + -3; Mathew on how Journal Vouchers go to Zoho; Peter's 34 part numbers; "upgrade Next" if wanted; E-00082 AED 8,000; Mathew's Zoho account for stock bills.

**Done:** status fix (bank day before the receipt day + old refused proofs say where to go, 52459f67); S1 cheque pending + Issue tax invoice now + deadline + setting (136fa972, list layout 257c287f); S2 approvals age + reminders (b27a6adb). No database change: nothing waiting for apply.

**End of batch:** unit all pass; security all pass; full layout 178 pages / 1,602 views + 252 pop-ups (18 problems in the new Tax invoices due list, fixed and re-checked clean); simulation 713 of 713 (one fixed-wait flake in path h made to wait for the database, re-run green); check:live 33 of 33.

**Timing:** status fix 35 min, S1 75 min, S2 40 min. Tests, builds and checks about 2 h (two production builds about 10 min, layout 13 min, simulation about 70 min, section tests about 15 min). Deploy waits: none.

---

# Handover – list of 17 November 2026 (ALL DONE; last update 17 Nov, 13:25 Dubai)

**NEEDS OMAR (top first):**
1. ~~Apply~~ DONE 17 Nov 14:40 Dubai: the Journal Voucher migration is applied on live (backup `backups/2026-11-17T10-37-15`; check:live 33 of 33). Nothing is waiting for apply.
2. **AED 5,030.55 to ARABIAN GULF MECHANICAL CENTRE is NOT recorded** (the proof error stopped it). Supplier payments → Pay any supplier → ARABIAN GULF… → amount, method, "Advance with…" → Add the proof → Record the payment → YES, RECORD.
3. Five supplier payments recorded right after a refused proof still have none: SPAY-00023, -00024, -00028, -00029, -00033 (Payment history → Correct this payment → Add the proof).
4. AL TAYER: enter the one paper for LPO-00039-1 + LPO-00039-3 (Supplier invoices → LPO-00039-1 → Scan & enter → tick LPO-00039-3).
5. Mathew confirms: post Journal Vouchers to Zoho as expenses (built, VAT reclaimable), as supplier bills, or as manual journals.
6. Peter: 34 made-up part numbers on cars in the workshop (Parts → Part number check).
7. Next.js prints a "known security vulnerability" notice on every build here (Vercel builds are fine). An upgrade is its own task with full tests – reply "upgrade Next" to queue it.
8. Still open: the AED 8,000.00 advance for E-00082 (16 Nov list); Mathew picks the Zoho account for stock bills.

**Done (7 of 7), each with its note in `docs/`:** S1 proof belongs to the payment (eab9c83e); S2 one invoice, several LPOs (c8d600dc); S3 payment date + Correct this payment (e6a05b03); S4 change supplier button + advisor approval (a51e6098); S5 draft LPO + Share (03fd7c78); S6 Journal Voucher (41769282, dormant until the apply); S7 part-number check (9b5414cc); end fix (1efa4319).

**End of batch:** unit all pass; security all pass; full layout 178 pages / 1,602 views + 252 pop-ups clean after one phone fix (Journal Voucher pay-later boxes); whole-job simulation 713 of 713; check:live 33 of 33.

**Timing:** S1 28 min, S2 11 min, S3 24 min, S4 9 min, S5 14 min, S6 19 min, S7 11 min. Tests, builds and checks: about 2 h 10 min (three production builds about 15 min each, layout 14 min, simulation about 75 min, pop-ups 6 min, dev-server restarts about 10 min). Deploy waits: none (each push checked the previous one had succeeded).

---

# Handover – list of 16 November 2026 (ALL DONE; last update 16 Nov, 17:45 Dubai)

**NEEDS OMAR (top first):**
1. ~~Apply three database changes~~ **APPLIED 17 Nov morning** (backup `backups/2026-11-17T05-10-01`, live check 33 of 33). Nothing waits for apply. The reference types, the lathe-bill check and the month-end stock snapshots are now switched on.
2. **AED 8,000.00 advance for E-00082 / J-01013 is NOT recorded anywhere** (PRO-00029 issued, no payment): Estimates → Approved → E-00082 → PAYMENTS box → Record advance payment → method, 8,000.00 → Record → Yes (steps in `docs/advance-box-16-nov-note.md`).
3. Mathew chooses the Zoho account for stock purchase bills (Account mapping); and decides whether to post one closing stock figure a month.

**Done (2 of 2):**
- S1 stock stays in the ERP: DONE, pushed (note `docs/stock-erp-only-16-nov-note.md`).
- S2 estimate advance payments: DONE, pushed (note `docs/advance-box-16-nov-note.md`): the PAYMENTS box on every estimate and its job, Record advance payment with no proforma needed, LESS ADVANCE PAID on the final invoice. No database change.

**End of batch:** unit all pass; security all pass; full layout (171 pages, every size, pop-ups, 130% text) clean + 51 document checks; whole-job simulation 713 of 713; check:live 33 of 33. Two stale checks brought up to date (estmoney1 list tab, payanytime link amount).

---

# Handover – list of 15 November 2026 (ALL DONE; last update 15 Nov, 13:40 Dubai)

**NEEDS OMAR (top first):**
1. **Apply two database changes** (Sections 1 and 4): turn auto mode off, reply **"apply"**. Details and backups in `docs/waiting-for-apply.md`. Until then: "Arrived - paperwork pending" already works for every supplier; the reference-type choice, the PRE-PAYMENT / WIP columns, the close/pay block and the lathe-bill check switch on with the apply.
2. **Mathew or Aleemath corrects SPAY-00032 to cash:** Supplier payments → Payment history → SPAY-00032 → Correct this payment → Cash → reason → YES, CORRECT IT.
3. **Mathew confirms which reference types count as the supplier's invoice** (now Invoice yes, Pre-payment yes, WIP no; Settings > Supplier references). After the apply he can change LPO-00079-1's "PP26POR24179" to the Pre-payment type.
4. **Print one battery label and send a photo** (black only now: Labels > Printer > Test label).
5. Still open from earlier: Mathew re-posts the LPO-00076-2 bill with one line per part; the 12 shared tablets' departments and KHADIJA's password; J-00317 brake pad (LPO-00083); Sparein merge; Patrol J-01007 relink; the Zoho rows to fix by hand.

**Done (6 of 6), each with its note in `docs/`:** S1 receiving never blocks (d7120328); S2 each part on one invoice (eff9a347); S3 one proof rule (069a325f); S4 lathe bills through Supplier invoices (7bdd31d5); S5 choose, confirm, correct + nothing money pre-selected (a71099e6); S6 labels black only (5d16ef51); end checks (8e6fffd5).

**End of batch:** unit tests all pass; full layout 174 pages / 1,566 views clean (after fixing 16 word-break and phone-width faults on the job card, money page and parts page); security all pass; whole-job simulation 645 + 182 re-run = all green after bringing 11 steps up to the new rules (nothing pre-selected, lathe bills checked first, a receipt timing wait).

---

# Handover – evening list of 13 November 2026 (ALL DONE; last update 13 Nov, evening, Dubai)

**NEEDS OMAR (top first):**
1. ~~Apply one database change~~ **Done 13 Nov evening:** Section 5 is live (backup `backups/2026-11-13T16-57-44`, live check 33 of 33).
2. **Mathew: Zoho sync page → the LPO-00076-2 bill (1260925425) → "Re-post with one line per part".** It stays at 921.90 and the payment stays applied. The other bills posted as one line get the same button. Side-by-side for him: `docs/zoho-bill-lines-for-mathew.md`.
3. **Set the department on the 12 shared tablets** at Team → Tablets; **give KHADIJA a password** (she logs in by PIN only, which shared tablets now refuse for office roles).
4. **A real test print of the new battery label:** a photo of it on the battery.
5. **J-00317 front brake pad:** approve LPO-00083, or back-order it.
6. **Tell the parts desk:** the supplier invoice number is compulsory at receiving. Mark the "invoice later" suppliers.
7. **Still open from earlier:**
   - Mathew's stock choice (A or B);
   - merge the two Sparein records;
   - relink the Patrol J-01007 lines;
   - the Zoho rows to fix by hand (`docs/stock-zoho-13-nov-note.md`).

**Done (8 of 8), each with its note in `docs/`:**
- S1 work starts on approval (57c1581);
- S2 labels (8552aae);
- S3 shared tablets (6841c9d);
- S4 every warning with its fix (7ea67db);
- S5 desk "+ Add a part" on estimates (7ba83b3, applied, live);
- S6 estimate and quotation lists (0552846);
- S7 Zoho bill lines (e60e121);
- S8 profit on every invoice (a53b7a6).

**End of batch:** unit tests all pass; security all pass; full layout 51/51; whole-job simulation 710/713, the 3 were out-of-date checks (the Labels rename and the plain refusal page), fixed and passing; passkeys 64/64 after 3 out-of-date steps were brought up to the 9 and 11 Nov rules; live check 33/33 on the final deploy. Older suites still out of date (listed, not caused by this batch): test-p, test-v, test-z, test-h, test-notify, test-supplier-invoices B, test-l (2).

---

# Handover – urgent list of 13 November 2026 (last update 13 Nov, afternoon, Dubai)

**APPLIED 13 Nov afternoon:** all 11 database changes (backup `backups/2026-11-13T11-15-32`), live check 33 of 33. Nothing waits for apply. Back orders and the invoice number at receiving are switched on.

**URGENT 1 – Back order (J-00317): built, tested on TEST (38 of 38), pushed and applied: live.** Note: `docs/back-order-13-nov-note.md`.
- J-00317 is already at Pending QC (your override 08:37). Blockers: TRANSMISSION MOUNT (LPO-00058-2, 08 Jan 2027) and FRONT BRAKE PAD (LPO-00083 waits for your approval).

**URGENT 2 – Supplier invoice number at receiving: built, tested on TEST (28 of 28).** Note: `docs/receipts-invoice-number-13-nov-note.md`. Applied: live.

**URGENT 3 – Check before you send: built, tested on TEST (13 of 13).** Note: `docs/check-before-send-13-nov-note.md`. Applied: live, with the log and the approver box.

**Pushed** after the owner's "try again": live as dpl_7cSe73xuSshBnAoJJrz9zZVBp5Fs.

Old failing checks not caused by this work (listed, not fixed): test-p 1 and 2 (the old "Returns and leftovers (n)" words and the accounts tile markup), test-v 2 (sticker 40x30, it is 50x25 since 5 Nov), test-z S1/S2 (technician bell, pasted payment link), test-supplier-invoices B (expects one waiting row; the TEST copy holds 9 real ones).

---

# Handover – overnight list of 13 November 2026 (ALL DONE; last update 13 Nov, 07:40 Dubai)

**NEEDS OMAR (top first):**
1. ~~Push refused~~ **Done 13 Nov:** the owner replied "push". Sections 12 to 15 are live as dpl_AcYDKhdTEnBP17jbzFy8cAwmLXfp (live check 33 of 33).
2. **Apply the database changes** (one go, from your phone): turn auto mode off and reply **"apply"**. The list and the order are in `docs/waiting-for-apply.md` → "Waiting now" (8 items; backups `backups/2026-11-12T21-37-52` and `backups/2026-11-13T00-29-24`).
3. **Before the apply, check the 9-person team move list** in `docs/team-levels-13-nov-note.md`. Five bodyshop labour rates change, because each person moves to their own team's rate.
4. **Mathew chooses before go-live:**
   - A) Zoho also tracks every stock item.
   - B) ERP only, and Zoho holds the value (built, recommended).
5. **Mathew merges the two Sparein records** (expected: one supplier, two unpaid invoices, AED 1,197.00).
6. **NISSAN PATROL J-01007:** relink the 5 re-added lines with "This replaces…". The list is in `docs/part-change-13-nov-note.md`.
7. **Zoho rows to fix by hand** (bill 9275779 waits for the apply; the 1-fils and part-paid rows): see `docs/stock-zoho-13-nov-note.md`.

**Done (15 of 15):**
- **Live:**
  - S1 screen sweep (d1dd53c).
  - S5 gate-out (dca0f9b).
  - S6 advance proforma (cacc8bd).
  - S7 estimate paid → parts desk (f102884).
  - S9 Zoho tab (5e5657a).
  - S10 Labels + battery label (e34f6d7).
  - S11 warranty details (63bb3bd).
- **Live, part waiting for the apply:**
  - S2 stock to Zoho (c6587ec).
  - S3 change part in place (8fb0a60).
  - S4 LPO advance (dbb93b3).
  - S8 supplier merge (ee92155).
- **Committed, push refused:**
  - S12 team form (337adfa).
  - S13 HR list and person page (8c92e45).
  - S14 PCV and fuel injectors (9b33b07).
  - S15 approvals stand-in (7e29a49).
- One note per section: `docs/*-13-nov-note.md`. Proof: `docs/proof/2026-11-13-*`.

**End-of-batch checks (TEST):**
- Full layout check: 174 pages, 1,566 page views and 252 pop-ups. It found 59 problems (mostly amounts split across two lines on phones). All are fixed, and the failed pages were re-checked clean (commit 36b8f78).
- Security: all passed.
- Unit tests: all passed.
- Whole-job simulation: 713 of 713.
- Live read-only check: 33 of 33.

**Timing (Dubai):**
- S1 00:55–01:28.
- S2 –01:40.
- S3 –02:04.
- S4 –02:17.
- S5 –02:35.
- S6 –02:46.
- S7 –03:21.
- S8 –03:31.
- S9 –03:40.
- S10 –03:55.
- S11 –04:20.
- S12 –04:32.
- S13 –04:49.
- S14 –04:59.
- S15 –05:08.
- End checks 05:10–07:35: full layout 12 min, fixes and re-checks about 30 min, simulation about 85 min.
- Builds: about 3 min each, 12 builds.
- Deploy waits: none (pushes after S11 refused).

**WAITING FOR APPLY (8):**
1. Stock-use migration.
2. Stock-value mapping data fix.
3. part_changes.
4. lpo_advance.
5. supplier_merge.
6. Team moves (data).
7. HR "Other document".
8. PCV and injectors.

---

# Handover – 12 November 2026, 16:05 Dubai (upload_pending applied)

**Applied on live:** `20261214090000_upload_pending.sql` (backup `backups/2026-11-12T12-02-42`). Switched on by itself: "4 files still uploading from Mech 3" on the report and the job card, the customer's report held back while files are still on a tablet, and the advisor's bell after 15 minutes. Live check 33/33.

**WAITING FOR APPLY:** nothing.

**NEEDS OMAR:**
1. Switch auto-approve ON before you travel: Settings > "Approvals while I'm away" > ON > end date (optional) > Save.
2. Test on a real workshop tablet (steps in the report).

---

# Handover – 12 November 2026, 12:45 Dubai (URGENT: auto-approve while the owner travels)

**Live after this push (no database change, no apply needed):**
- Settings > "Approvals while I'm away" (owner only): one ON/OFF switch with an optional end date. It has a tick and an optional cost limit per type; only the free items are pre-ticked.
- A ticked request is approved at once and the advisor carries on. It is logged "AUTO-APPROVED (OWNER AWAY)" with no bell to the owner.
- Requests already waiting are approved when the switch goes ON.
- The Approvals page has an "Auto-approved" list, the dashboard shows an amber line while ON, and one evening summary bell is sent.
- Note: `docs/auto-approve-12-nov-note.md`.

**Tests:** test:autoapprove 18/18, unit, lint, security, test:charges 32/32, and a clean layout on the changed pages (390, 800, 1440). The upload fix's full simulation was 713/713.

**WAITING FOR APPLY:** still only `20261214090000_upload_pending.sql` (see below).

---

# Handover – 12 November 2026, 10:50 Dubai (URGENT: inspection photos and videos never lost)

**Live after this push:**
- The tablet's idle lock never signs out while a camera, a file picker or the camera app is open, or while files are being prepared.
- Inspection videos record inside the page at 1080p, with the camera app as a backup.
- Three photos send at a time.
- The screen stays on while files send, and the tablet asks before the page is closed.
- The pill reads "7 of 12 uploaded".
- The report is never held up by files still sending.

Cause and lost-media list: `docs/inspection-uploads-12-nov-note.md`.

**Tests:**
- New `npm run test:inspuploads`: 24/24. 10 photos and 1 video, through a screen lock, the page closed, another technician signing in and the network off and on. All arrived on the right items, under the right technician.
- test:uploads 23/23. Layout owner and technician clean at 800×1280 and 1440×900. Security passed. Unit passed.
- Stale and not from today: test-videos2 (it marks several items Bad without remarks; since the 11 Nov inspection-type section only the first registers).

**WAITING FOR APPLY:** 1 – `20261214090000_upload_pending.sql` (backup `backups/2026-11-12T06-24-28`). Until then "4 files still uploading from Mech 3", the customer-report hold and the 15-minute bell are off. Everything else above works now.

**NEEDS OMAR:**
1. Reply "apply".
2. Test on a real workshop tablet. The steps are in the report.

---

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
