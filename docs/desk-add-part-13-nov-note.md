# Section 5: the parts desk's "+ Add a part" on an estimate (13 November 2026, evening list, E-00092)

## What it does

**On the estimate's parts page (`/parts/estimate/<id>`) the parts desk now has "+ Add a part".**
- It opens the same part picker as a job's parts page: the parts list, search, and "Custom part".
- A small window then asks **"For job:"**. Tap one of the estimate's jobs (labour or service lines), or "Not for one job". Then tap **Add**.
- The answer shows in that same window.

**While the estimate is still being prepared** (draft, or waiting for you):
- The part goes onto the estimate's lines, tagged **"Added by Parts"**.
- It is **left off** (not counted) until the advisor decides. The desk prices it on the same row as any other estimate part.
- The advisor in charge gets one bell: "Parts added a part to E-…".

**On the estimate page, the advisor (or you) sees an "Added by Parts" card** with two buttons:
- **Accept onto the estimate**: the part is counted, and the totals update.
- **Decline**: it stays off.

The desk gets a bell either way. On the desk page each part reads:
- "Added by Parts · for job: … · waiting for the advisor";
- then "**Accepted by <advisor>**";
- or "**Declined by <advisor>**".

**When the estimate was already sent or approved:**
- Nothing is changed on the customer's estimate.
- The window says it needs a revision.
- The advisor gets one bell, "Revise E-…: Parts want to add a part". The request is logged in the estimate's history.

## Who

- **Add:** the parts desk and you.
- **Accept or Decline:** advisors and you.
- Both checks are on the server, and View as can do neither.

## Database

**One small change, on WAITING FOR APPLY:** `20261216120000_desk_added_parts.sql`, five columns on `quotation_lines`.
- Until it is applied, the button and the card stay hidden on live.
- A backup was taken first: `backups/2026-11-13T13-13-55`.

## Proof (TEST only)

**`npm run test:s5-deskparts`: 11 of 11.** It signs in as the parts desk to add the parts, and as an advisor to accept and decline them.
- Screenshots are in `docs/proof/2026-11-13-desk-add-part/`:
  - the For job window;
  - the desk row, at desktop and tablet size;
  - the advisor's card at tablet size, before and after deciding.
- **The names in the TEST screenshots are the test copy's stand-ins.**

## Assumptions

- **"For job:" lists the estimate's own labour and service lines.** A part can also be for no particular job.
- **A declined part stays on record as declined** (left off); it is never deleted. The desk still sees it in the "Added by Parts" list, but it no longer counts as "to price".
- **While a desk-added part waits**, it counts as a part to price on the desk's estimate list, like a part the advisor sent.
