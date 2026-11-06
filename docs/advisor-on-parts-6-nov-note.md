# Advisor on parts pages – 6 November 2026 (Peter)

- **One shared tag**, "**Advisor: Anas** (quotation by Adarsh)":
  - Where it shows: next to the plate, car and job number on the job's parts page, every car line of the parts desk (every section and All cars), Parts arrivals, the LPO page (also the approval screen) and the supplier-discount approvals.
  - The name is the job's advisor in charge.
  - "(quotation by …)" shows only when someone else made the car's newest quotation.
  - The rule is in `src/lib/job-advisor.ts`; the component is `src/components/JobAdvisorTag.tsx`.
- **Ask the advisor.**
  - Tapping the bold name opens a centre window: pick a part line (optional), type the question, then Send. "Sent to Anas ✓" shows in the window.
  - The advisor's bell opens `/ask/<id>`, which shows the question, the car and the part, with an answer box (the advisor asked, or the owner).
  - The answer rings the asker's bell and shows on the same page.
  - It is stored in the job's history (`job_events`): no new table, nothing to apply.
- **Advisor filter** on the parts desk: All / Adarsh / Anas / … (`?advisor=`). It filters every car section, the LPO cards and the estimates to price.
- **Internal only.** The supplier copy text, the supplier PDF and the supplier's LPO link never carry it; the test proves all three.
- **Tests.** `test:sim` path n, 21 checks:
  - the tag at 1440 × 900 and 800 × 1280 as Parts;
  - the ask → bell → answer → bell round trip;
  - the filter;
  - the supplier copy, PDF and link without the name.

  Also: the layout check on the changed pages, and the Ask window in the pop-up check.
- **Proof** in `docs/proof/2026-11-06-advisor-parts/`.
