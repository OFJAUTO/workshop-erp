# Jobs list: sorting and filters – 6 November 2026 (Section 6)

Live, no database change.

On **Jobs** (open and closed):
- **Newest opened first** by default (the gate-in time, else when the job was made).
- **Sort:** Newest · Oldest · Most urgent (overdue first, then the longest in its stage) · Stage · Promised date.
- **Filters:** Any time / Opened today / Last 7 days · Mechanical / Bodyshop / Both · High priority · Overdue · Ready to collect · Stage, Advisor and Technician lists. The count reads "12 of 37" while a filter is on.
- **Search:** plate (with or without spaces), VIN, job number, make and model.
- **Recently viewed:** the last 5 job cards you opened, as one-tap buttons above the list.
- **Remembered:** each person's sort and filters come back next time on that device (a shared tablet keeps each person's own). "Clear all" goes back to the default.
- Who sees which jobs is unchanged (the same access rules).

Proof (TEST, `test:sim` path t, 6 checks; unit `job-list`, 17 checks): `docs/proof/2026-11-06-jobs-sorting/t1-newest-first-1440.png`, `t2-last7-advisor-1440.png` ("1 of 30"), `t5-tablet-800.png`.
