# Departments per line (1 November 2026, J-00969)

## What was wrong with J-00969

J-00969 (MERCEDES-BENZ S 580, Q-00039) was already set to "Both" on live, but its lines had no team:

- painting of the chrome parts;
- PDR dent;
- remove and refit the front end;
- programming and coding;
- smart paint.

They were typed as plain labour or services, so the planning counted them as mechanical work and showed "Workshop · Mert" only, with only mechanics to pick.

The planning's "Advisor" circle showed whoever gated the car in (Deepak) instead of the advisor in charge (Omar).

The customer request was just ".".

## What changed

- **A team on every line:** Mechanical · Electrical (programming, coding, resets) · Dismantle & refit · Paint · PPF · Detailing & cleaning · Outside work (another company, e.g. PDR).
  - Each line gets a default team from the service and its words: "paint" → Paint, "remove and refit" → Dismantle & refit, "programming / coding / reset / calibration / radar" → Electrical, "PDR" → Outside work.
  - The job's department keeps the default on its side. On a mechanical job, "remove and refit" stays the technicians' work. Electrical and outside work stay what they are on any car.
- **"Department and teams" on the job card:**
  - Department Mechanical / Bodyshop / Both is one tap, for the owner, the advisors and the managers. The change is logged and both managers are told.
  - Each line has a team dropdown, which saves at once (also on an approved quotation, because the team is not money).
  - People already on the car who no longer fit are listed under "Needs reassigning". They are never taken off by themselves.
  - It shows which team has the car right now ("With Paint now").
- **Planning shows every team with its leader,** e.g. "Dismantle & refit · Arsalan", "Paint · AKHIL", "Electrical · Mert". The Advisor circle is the advisor in charge.
- **Each side offers only the teams its lines need:**
  - the bodyshop side of J-00969 offers Dismantle & refit and Paint (not PPF or detailing);
  - the workshop side offers only the electricians for the coding line;
  - the server refuses anyone else with words.
  - A team nobody is in yet does not block a car. On live, nobody is set as an electrician yet, so the technicians can take a coding line until you set it (see "To do" below).
- **Order of work:** the bodyshop stages come from the line teams in the order of work: strip → paint → (PPF) → refit → electrical / coding → QC → handover. The bodyshop manager can still move or add stages as before.
- **Work order:** the workshop's work order on a mixed car carries only the mechanical-side lines (mechanical work, coding). Paint, refit, PPF and outside work never go on it.
- **The lists:**
  - the car is on the Bodyshop board (with its planned stages from the teams) and on the Workshop list;
  - the Work step of the job card's bar reads "Bodyshop + Electrical" on a mixed car.
- **Gate-in:** at least one real customer request, three letters or more. "." or an empty box is refused with words.

## J-00969 fix (in the migration)

- Department stays Both.
- The paint lines go to Paint, remove and refit to Dismantle & refit, programming and coding to Electrical, and PDR to Outside work. The advisor can move PDR to the bodyshop with one pick.
- The planning then shows Arsalan, AKHIL and the electrical side.

## Database (WAITING FOR APPLY)

Migration `20261202120000_line_teams.sql`:

- adds `quotation_lines.team` (with its check);
- lets the line lock pass a team change on approved quotations;
- sets J-00969's teams.

Until it is applied:

- every line works on its default team, so the planning, the pickers, the stages, the work order, the Work step, the department change and the gate-in rule already work;
- only choosing a team by hand waits for it.

## To do (owner or Mert)

- Set the team "Electricians" on the electricians (Team page). Until then a coding line can be given to any technician.

## Proof

- `npm run test:teams` (test database, 21 checks), screenshots in `tests/browser/shots/teams/`.
- `tests/unit/line-teams.test.mjs` (22 checks, inside `npm run test:unit`).
