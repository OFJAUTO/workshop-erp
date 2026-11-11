# Handover – 11 November 2026, 09:55 Dubai (10 Nov list, in progress)

**NEEDS OMAR (now):**
1. Reply **"apply"** when convenient for the one waiting database change (several invoices per LPO); see WAITING FOR APPLY below.
2. **J-00490 (comeback):** the car has no earlier job in the ERP (its record was made on 26 Oct). The original work was before the ERP, so the comeback screen (Section 9) will offer "original job not in the ERP" with the old invoice number.

**Live (10 Nov list):** S1 paid means paid (deafd90) · S2 Autel post-scan (c6b74c2) · S3 several invoices per LPO (6ebd1f0, switched on after apply) · S4 send LPO for owner approval (switched on after apply) · S5 supplier payments tab · S6 proof on every payment method. Last push 11 Nov 09:55 Dubai.

**WAITING FOR APPLY:** 1 `20261212090000_lpo_invoices.sql` · 2 `20261212100000_lpo_owner_review.sql` (backup `backups/2026-11-11T03-53-15`).

**Working on:** Section 7 (clocking Start / Pause / Stop after the PIN). Then 8 to 10.

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
