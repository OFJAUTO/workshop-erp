# 11 November 2026 list: proof per section (final, 12 November 2026)

LIVE = the production deployment is built from commit d7a17a6, the newest code commit, which carries every section. All database changes were applied 11 November at night (backup `backups/2026-11-11T19-35-14`).

Behaviour is proven on the TEST copy, through a production build of the same code. Tests never sign in on live (standing rule 7). On live: read-only checks only (`npm run check:live` 33/33, `npm run check:live:sections` 22/22).

| # | Section | Behaviour proof (final build, TEST) | Live proof (read-only) | Screenshots |
|---|---|---|---|---|
| 1 | Stock LPOs in supplier invoices and payments | sim e1 | deployed; stock LPOs on live | `docs/proof/2026-11-11-stock-lpo` |
| 2 | Parts belong to one quote | sim e2 | `for_quote` columns + rule; 417 parts tagged | `parts-per-quote` |
| 3 | Supplier advances | sim e3 | `applied_later` column | `supplier-advances` |
| 4 | Approval box + Approvals page | sim e4 | deployed | `approvals` |
| 5 | Duplicate receipt void, cheque cap | sim e5 | void request + cheque total columns | `cheque-void` |
| 6 | Lathe bills | sim e6 | lathe v2 columns | `lathe-bills` |
| 7 | Free item in one tap | sim e7 | deployed | `comp-one-tap` |
| 8 | Department tablets | sim e8 | `devices.department`; 7 tablets still to set (NEEDS OMAR) | `department-tablets` |
| 9 | Jobs to do | sim e9 | `job_line_ticks` | `jobs-to-do` |
| 10 | Inspection type, could not check | sim e10 + path a | scope columns + setting | `inspection-type` |
| 11 | Car-card dashboards, VIN | sim e11 | deployed | `car-card-dashboards` |
| 12 | Stickers tab + QR page | sim e12 + sec5 | a label opened signed out shows only the sentence (200, no redirect); /stickers asks to sign in | `stickers-tab` (shots signed in and signed out) |
| 13 | Neat pages | sim e13; layout 168 pages × 9 sizes clean | 44 px buttons in the live build | `neat-pages` (estimate, quotation, job, LPO; computer and tablet) |
| 14 | Password sign-in alerts | sim e14 | old pile: 0 unread on live | `password-alerts` |
| 15 | HR | sim e15 | 3 HR tables + private bucket; no login-role grants; file link refuses signed-out | `hr` |
| 16 | Speed | `npm run test:speed` before/after on the TEST server (dashboards −35 to −50%) | deployed (c9fd475 inside d7a17a6); server code in bom1 next to the database | `speed` + `docs/speed-11-nov-note.md` |

Final runs on the final build:
- The 17 simulation paths of this list: 240/240.
- Full layout check: clean.
- Document test: 51/51 (it now builds its own package-only quotation instead of relying on TEST's copy of Q-00039).
- Security: all passed.
- Unit tests: all passed.

What cannot be shown without signing in on live: each section's signed-in screens on the live site, and live signed-in page times for Section 16. Live times are estimated from measured live round trips (a page with one database read: 142 ms; the sign-in page: 105 ms).
