# Team form with two clean levels – 13 November 2026 (Section 12)

**The form (Team › Add staff member, and each person's page):**
- **Department** has three choices: Mechanical, Bodyshop, Office.
- **Team** sits inside it and shows only that department's teams:
  - Mechanical: Technicians, Electricians, Helpers.
  - Bodyshop: Dismantle & refit, PPF and tint, Painting, Detailing & cleaning.
  - Office: no box. The team follows the role (Advisors, Accounts, Parts, Gate-in, Management).
- **Bodyshop manager** is its own role choice. It is saved as a workshop manager on the bodyshop side, and it reads "Bodyshop manager" on the Team list (its own group), the person's page and the menu. ARSLAN KHAN reads Bodyshop manager now, with no data change.
- **Fields that do not apply are hidden:**
  - "Colour on the calendar": owner and advisors only.
  - "Own break": hands-on roles only (technician, team leader, managers, QC).
  - "Head accountant": accounts only.
- **The red "Choose a role."** goes as soon as a role is picked.
- **A team from another department is refused** in plain words ("Pick a Bodyshop team.").
- **Behind the scenes:** the saved department keeps its finer value (Bodyshop › Painting = "paint"). Labour rates, bodyshop sections and team-leader scopes read that value, so nothing else changes. It is worked out from the team, never typed.
- **Break times stay per department**, as before.
- **Tablets:** a shared tablet set to Bodyshop shows every bodyshop team first, judged by the person's team. A PPF installer filed under Mechanical used to be hidden behind "Someone else?".

**Moving existing people (WAITING FOR APPLY, data fix `supabase/data-fixes/2026-11-13-team-levels.sql`, backup `backups/2026-11-13T00-29-24`). Please check this list:**

| Person | Role | Now | After | Labour cost rate (AED/h) |
|---|---|---|---|---|
| ABDUL GHANI | technician | Bodyshop, team Painting | Bodyshop › Painting | 45 → 42 |
| ARSLAN AHMAD | technician | Bodyshop, team Painting | Bodyshop › Painting | 45 → 42 |
| DILWAR | technician | Bodyshop, team PPF | Bodyshop › PPF and tint | 45 → 50 |
| KAMRUL | technician | Bodyshop, team Detailing | Bodyshop › Detailing & cleaning | 45 → 40 |
| NAJMUL | technician | Bodyshop, team Detailing | Bodyshop › Detailing & cleaning | 45 → 40 |
| SHA ALOM | technician | Mechanical, team PPF | Bodyshop › PPF and tint | 50 → 50 |
| SUFIYAN | technician | Detailing, team Technicians | Bodyshop › Detailing & cleaning | 40 → 40 |
| JOSHUA | technician | Mechanical, no team | Mechanical › Technicians | 50 → 50 |
| ALEEMATH | accounts | Mechanical | Office · Accounts | (not a workshop rate) |

- **Labour rate:** the rate per department (Settings) now matches each person's real team. The five bodyshop technicians move from the general Bodyshop rate (45) to their team's rate. If you prefer one bodyshop rate, set the four bodyshop rates the same in Settings.
- **Unchanged:** everyone else already agrees, including the three team leaders, the bodyshop manager (Bodyshop › Dismantle & refit) and the QC inspector (Mechanical, no team).

**Proof (TEST):**
- `npm run test:s13-12` passes 13 of 13:
  - the red message and it clearing;
  - the Team box per department;
  - fields hidden per role;
  - the Office team from the role;
  - the Bodyshop manager choice;
  - an edit saving Bodyshop › Painting;
  - the Bodyshop manager title on the list and the page.
- Unit `team-levels` (14 checks, includes the tablet rule).
- Layout check on Team and Add staff member at 800 × 1280 and 1440 × 900: clean.
- Screenshots: `docs/proof/2026-11-13-team-form/`.

**Assumptions:**
- Office teams are not stored. The role is the team.
- A person whose team and department disagreed follows the team. The exception is a mechanical team in a bodyshop department, which was a slip; the department wins there.
