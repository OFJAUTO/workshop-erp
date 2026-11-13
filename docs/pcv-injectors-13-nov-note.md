# Inspection report: PCV valve and fuel injectors – 13 November 2026 (Section 14)

**Where:** the Engine bay section, right after "Intake manifold".

**PCV valve:**
- Answers: **OK** / **Faulty, replace**. "Could not check" is the usual not-checked answer.
- Optional tick: **"Built into the valve cover"**.
- What to look at (under the name): "engine running: whistling or hissing, oil in the intake, rough idle, cap suction".

**Fuel injectors:**
- Answers: **OK** / **Needs service and further check** / **Replace**.
- Optional: **which cylinders** (1 to 8, or All), shown once a fault is picked.
- What to look at: "engine running: misfire, rough idle, fuel smell or leaks at the rail".

**Rules:**
- **Both need the engine running.** When the car does not start, they get "Could not check – engine not running" by themselves, like the other engine-running items.
- **Hidden on electric cars:** an electric car's checklist leaves both out (from the car's fuel type).
- **A fault shows in the quotation's "Nothing quoted yet for" list.** That means Faulty, replace; Needs service and further check; or Replace. The details travel with it ("Built into the valve cover", "Cylinders 1, 3") on the quotation strip and the inspection report.
- **No written remark needed:** a PCV answer, or injectors with their cylinders picked, describes the item, so the technician is not asked for one.
- **Settings › Inspection:** the answer-style button cycles through the two new styles as well.

**WAITING FOR APPLY:** `supabase/migrations/20261215140000_pcv_injectors.sql` (item 8). It allows the two answer styles and adds the two items to the stored checklist. Until it is applied, new inspections on live do not show them. The code is live and ready.

**Proof (TEST, migration applied there):**
- `npm run test:s13-14` passes 5 of 5:
  - the two items with their styles;
  - the answers on the tablet;
  - the details saved;
  - an electric car without them.
- Unit `pcv-injectors` passes 10 of 10, including the automatic "Could not check" and the quotation list.
- Screenshots: `docs/proof/2026-11-13-pcv-injectors/` (tablet 800 and desktop 1440).
