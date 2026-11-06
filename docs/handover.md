# Handover – 6 November 2026

**Live:** everything up to "Supplier amounts with VAT" (5 Nov). Pushed with this handover: "Plate can be added + no raw database words" (note `docs/plate-can-be-added-6-nov-note.md`) and the cost rules (CLAUDE.md).

**WAITING FOR APPLY:** nothing. All four migrations were applied on 6 Nov (backup `backups/2026-11-06T04-25-07`).

**After the plate deploy:** `npm run check:live`, then the `plate_missing` bells to the advisors of the five no-plate cars (J-00985 Anas; J-00858, J-00860, J-00972 Hamza; J-00988 all advisors). The SQL is in the note's point 10; it is guarded so it runs once.

**Queue, in order:**
1. Advisor on parts pages (Peter): bold "Advisor: <name>" in one shared job header on the parts pages, ask-the-advisor bell and reply, Advisor filter, never on supplier copies → "LIVE: advisor on parts pages".
2. Off-site backups part 2: waits for the owner's "key saved" (Backblaze). Until then the bell rings "Off-site database backup FAILED" each morning.
3. App queue: full part stickers (MERGE into the 50 × 25 sticker), jobs sorting, audit approvals with C1 first.

**Follow-up offered:** 30 other tick boxes could jump back after a refused save (use `KeptCheckbox`).
