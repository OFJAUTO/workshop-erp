# Overnight batch, 22 to 23 October 2026

Eight sections, done in order, each pushed and checked live before the next one started.

| # | Section | Commit | Proof |
|---|---------|--------|-------|
| 1 | Supplier import fix + safety lock (verify) | 9fcd51f (22 Oct, before this batch) | test:import 63/63, test:importlock 30/30 |
| 2 | Parts markup as % or AED (verify) | 22 Oct (before this batch) | test:markup 15/15 |
| 3 | Recovery: change the price of a queried trip | 826db14 | test-recovery3 14/14 |
| 4 | Estimates: delete drafts, cancel, expire, no duplicates | f2819d0 | test-estimates4 18/18 |
| 5 | Spell check everywhere | b57bbb9 | test-spell5 14/14 |
| 6 | One A/C gas item + duplicate items merged | 44550c6 | test-inspection6 17/17 |
| 7 | Bodyshop findings in the inspection | 29406be | test-body7 18/18 |
| 8 | OFJ Bespoke PPF + cutting-method labels | 9678155 | test-ppfcut10 15/15, test-warranty12 30/30, test-i 55/55 |

Migrations (database backed up before each one): `20261117090000_recovery_price_change`, `20261117100000_estimate_cancel_copy`, `20261117110000_inspection_merge_ac`, `20261117120000_bodyshop_findings`, `20261117130000_spell_words`, `20261117140000_seed_missing_settings`, `20261117150000_ac_leak_values`, `20261117160000_ofj_bespoke_ppf`. Data script: `scripts/migrate-inspection-merge-23-oct.mjs` (already run: 2 reports, 10 answers folded, 11 service suggestions moved).

## 3. Recovery: change the price

- `recovery_trips.original_price_aed` (the driver's own figure, written once) and `price_history` (jsonb: from, to, reason, who, when).
- `src/lib/recovery.ts`: `DEFAULT_RECOVERY_RATES`, `recoveryRatesOf`, `rateKindOf` (our truck / external flatbed / closed box), `expectedPrice` = the larger of the minimum and km × rate, rounded to AED 5; `priceFlagOf` (above the flag percent → "AED 120 vs expected ~AED 85 for 12.7 km"), `priceHistoryOf`, `priceChangeMessage`.
- `changeTripPrice` and `saveRecoveryRates` in `src/app/(app)/jobs/delivery-actions.ts`. `/recovery`: the flag, "Change price" with the reason chips (context `recovery_price`), the old price crossed out, "Tell the driver" (WhatsApp + Copy). The driver's page shows the change. The Excel lists the claimed price, the final price and the reason.
- Settings > Recovery rates (`recovery_rates`, `recovery_flag_percent`). The trip keeps its status (Claimed/Queried) after a price change; Approve then pays the new price.

## 4. Estimates

- `quotations.cancelled_at/by`, `cancel_reason`, `deleted_at/by`, `copied_from_id`, `extended_at/by`.
- `src/app/(app)/estimates/actions.ts`: `deleteEstimateDraft` (never sent; the advisor who made it or the owner), `cancelEstimate` (sent, with a reason), `extendEstimate` (fresh validity, opens WhatsApp), `copyEstimate` (no commission); `EstimateMenu.tsx` on the list and the page. An accepted estimate offers Copy only.
- Duplicate check on `/estimates/new` (`CustomerCarStartForm` dialog: Open it / Create a new one anyway).
- Expiry: the hourly clean-up and the customer's own visit to the link. The customer's link says "withdrawn" for a cancelled estimate.

## 5. Spell check

- `src/lib/spell-rules.ts` (pure: `WORKSHOP_WORDS`, `isMash`, `tokens` which blanks links and email addresses, `replaceWord`), `src/lib/spell.ts` (two Hunspell checkers, British and American, through `nspell`; a word is right if either accepts it; extra words from `spell_words`, `known_words` and the makes/models list), `src/lib/spell-docs.ts` (the texts behind each customer document and `applySpellFix`).
- `/api/spell` (check) and `/api/spell/fix` (fix in place, owner's Add to dictionary). `SpellCheckPanel` inside `SendLinkDialog` (`spell` prop) for the report, quotation/estimate and proforma/invoice sends. A reminder, never a block.
- `Input`/`Textarea`: spellCheck, autoCorrect, autoCapitalize sentences. Settings > Workshop dictionary (`spell_words`).
- Fixed on the way: Settings could not be saved (Premium brands box empty); 17 settings without a stored row seeded with their defaults.

## 6. Inspection: one A/C gas item and the duplicates

- New answer style `gas` (Good / Low / Empty / N/A). Low or Empty asks Leak? (No / Sweating / Dripping / Heavy leak) and the repairs (seal, hose or pipe, condenser, compressor, evaporator, expansion valve; each adds its part), ticks Recharge needed by itself, gas R134a / R1234yf and grams (chips 500 · 600 · 700 · 800 · 1000 or typed). No litres, no approval spec.
- `inspection_items.service_due`, `recharge_needed`, `merged_into`; `needsAttention` in `src/lib/inspection.ts` is the one rule the report, its PDF and the quotation strip read.
- Duplicate pairs found and merged:
  - A/C gas level + A/C gas recharge → A/C gas
  - Engine oil level + Engine oil service due → Engine oil (Service due? switch)
  - Brake fluid + Brake fluid change due → Brake fluid (Service due?)
  - Coolant tank + Coolant change due → Coolant (Service due?)
  - Transmission / differential fluid + Transmission oil service due → Transmission and differential fluid (Service due?)
- Looked at and kept apart (different jobs): software update / reset / coding; wheel alignment and wheel balancing; front differential oil leak and oil leaks; shock mounts and shock absorbers; brake fluid pipes and brake fluid; oil coolers.

## 7. Bodyshop findings

- Table `bodyshop_findings` (RLS on, read policy for staff, service_role grant, audit + no-delete triggers); `inspections.bodyshop_opened_at/by`, `airbags_deployed`, `structural_damage`, `bodyshop_notified_at`, `bodyshop_checked_at/by`; `quotation_lines.side`; `gate_ins.damage_panels`; `jobs.prework_panels`, `prework_checked_at/by`.
- One outline: `src/lib/car-outline.ts` (panels, damage types, severities, actions, `toneOf`, `cleanPanelMarks`, `marksWords`), `src/components/CarOutline.tsx` (screen) and `src/lib/pdf/car-outline-pdf.tsx` (PDF). `PanelMarker` reuses it at gate-in (photo step and the gate-in details page) and for the PPF pre-work check on `/bodyshop/[jobId]`.
- `src/lib/bodyshop-findings.ts` (`loadBodyState`, `canEditBody`, `notifyBodyshopAssessment`, `bodyProblems` = a photo per finding before submit), route `/api/inspection/body`, notification `bodyshop_assessment`.
- `startQuotation` adds a BODYSHOP line per finding at the bodyshop rate (urgent when severe) and sets the job to Both.

## 8. OFJ Bespoke PPF

- "OFJ Bespoke" is the product name, so the cutting methods drop the word: Hand-cut – edges wrapped, seamless finish (default, Recommended) / Machine pre-cut – computer-cut pattern / Mixed. Badges HAND-CUT / PRE-CUT / MIXED.
- `ppf_brand_name` default and stored value "OFJ Bespoke PPF"; the PPF warranty wording renamed the same way; the surcharge line is "Hand-cut surcharge". `ppfWarrantyWords` adds "· 10-year warranty" when the years are known. The owner's package names were not changed.

## Assumptions

- Recovery default rates: our truck minimum AED 60 + AED 4/km, external flatbed AED 80 + AED 6.5/km, closed box AED 150 + AED 10/km; flag at 25%. All editable in Settings.
- A price change keeps the trip's status; it does not approve it.
- Estimates expire through the hourly clean-up and when the customer opens the link.
- Only the owner adds words to the workshop dictionary from the send window; everyone can "Keep as is".
- The technician edits bodyshop findings until the report is submitted or the bodyshop manager marks them checked; after that bodyshop staff and the owner only. Team leaders cannot add parts to a finding.
- A job becomes Both when the quotation is started with bodyshop findings; body lines use the bodyshop hourly rate.
