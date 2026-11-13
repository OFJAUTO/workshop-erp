# Approvals stand-in – 13 November 2026 (Section 15)

Not needed for this trip. It is ready for when you want it, and nothing changes until you set it.

**Where:** Settings › Approvals (the page of "Approvals while I'm away"), card **"Send my approvals to a person"**.
- **Send my approvals to:** pick the person (workshop managers, the bodyshop manager, accounts, advisors, Parts).
- **From / Until:** both dates. It **ends by itself** after the end date. **End now** ends it with one tap.
- **Which approvals go to them:** tick the types. Each has a **cost limit per item**: above it, the request still comes to you. An empty limit means any amount.
- **Nobody approves their own request:** a stand-in's own request always waits for you.

**How the stand-in works:**
- **The same Approvals page and the same Approve / Refuse box** as yours, with the same decision door. No second approval screen was built.
- They see "Approvals" in their menu with a count, showing only the requests sent to them.
- Every decision is **logged as "approved by <name> on behalf of the owner"**. It shows in the job's history, on the quotation, and on your Approvals page under "Decided by the stand-in".
- **Bells:**
  - The team gets one short notice: "Approvals go to <name> until <date>".
  - The stand-in hears when more requests wait for them.
  - You get **one summary each evening**: "<name> today: 3 approved, 1 refused on your behalf", with the list.
- **Auto-approve:** both work side by side. Auto-approve answers what you ticked there; the stand-in decides the rest of what you sent them; anything else still comes to you.

**No database change:** the choice and the log are two settings rows, made on the first save.

**Proof (TEST):**
- `npm run test:s13-15` passes 11 of 11:
  - set up on the settings page, and the team notice;
  - the stand-in sees and approves a AED 3,000 quotation;
  - the decision is logged "on behalf of the owner";
  - above the AED 5,000 limit and their own request stay with you;
  - your banner and the stand-in's list;
  - End now removes it at once.
- Unit `standin` passes 10 of 10.
- Screenshots: `docs/proof/2026-11-13-standin/`.

**Assumption:** a decision the stand-in makes is saved by the system as your decision (it passes your checks) and is named "<name> on behalf of the owner". The stand-in cannot change your settings or any switch.
