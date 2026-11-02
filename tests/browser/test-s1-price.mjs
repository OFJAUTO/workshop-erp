// Section 1 of 2 November 2026 (Q-00039 on J-00969): ONE selling-price rule and NOTHING BELOW COST, proved through the
// screens on the TEST server.
//   A. The quotation editor: an advisor's figure below cost stays on the screen, red, and is NOT saved (the server
//      refuses it too); the owner may, with a typed reason, logged with the figures; "Before sending" stops an
//      unapproved line below cost and the owner approves it from the line; an advisor can ask the owner.
//   B. A revision request from Parts (the Q-00039 pattern: the supplier's 55% standard discount taken off a price that
//      was already net): the request labels the figure as the COST; the owner's box shows list, discount, cost and the
//      selling price the part would get, RED because its cost is under half of the same part; Allow needs his reason;
//      the new version prices the part at the quotation's own markup (the twin's 50%), never the bare 5% minimum.
//   C. The part is taken off as a duplicate while the request waits: the request withdraws itself, the bell is read.
//   Review fixes of 2 November 2026 (the four-lens review of this section):
//   D. A package / labour-and-services discount that takes a line below its cost: refused for an advisor (in the
//      discount window and on the server), the owner gives a reason (stamped with the after-discount figure).
//   E. The editor's hold: judged against what the quotation holds, never the unsaved figure; a note typed while a
//      figure is held is saved, the held figure is not; a later price that clears it saves both; a COST typed is
//      never refused (saved, the line turns red, the owner is told); "ask the owner" says asked only when he was.
//   F. Allowing a Parts revision: a part whose cost changed lands on the new version at its NEW cost; the owner's
//      reason stamps only the rows he saw, never another line below cost.
//   G. An advisor's revision request is never withdrawn by Parts taking a part off.
//   H. An early charge waiting for a revision shows in the owner's box (red when below cost) and joins the new version.
// Run: npm run test:s1-price   (test server on :3102, or E2E_BASE=http://localhost:3101 for the dev test server)
import path from "node:path";
import fs from "node:fs";
import { api, base, browserFor, cleanupDb, cookieHeader, go, here, makeChecks, sleep, sql, submitted } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const SHOTS = path.join(here, "shots", "s1-price");
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page, name, loc) => (loc ? loc.screenshot({ path: path.join(SHOTS, `${name}.png`) }) : page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false })).catch((e) => console.log("shot", name, String(e).slice(0, 120)));
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const typeInto = async (loc, text) => { await loc.click({ clickCount: 3 }); await loc.press("Backspace"); await loc.pressSequentially(text); await loc.press("Tab"); };
const supplierOption = async (sel, name) => sel.locator("option").evaluateAll((os, n) => (os.find((o) => (o.textContent ?? "").toLowerCase().startsWith(n.toLowerCase())) ?? {}).value ?? "", name);
const section = async (name, fn) => { console.log(`\n--- ${name}`); try { await fn(); } catch (e) { check(`${name}: ran to the end`, false, String(e?.stack ?? e).slice(0, 400)); } };
const owner = (await sql("select id, display_name from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0];
const ready = (await sql("select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'quotation_lines' and column_name = 'below_cost_reason'"))[0]?.n === 1;
check("0: the TEST database has the below-cost columns (migration 20261203090000)", ready);

/* ---------------- A. The editor: refuse, ask the owner, approve with a reason ---------------- */
await section("A editor", async () => {
  cleanupDb();
  const seed = (await api("/api/e2e/stage", { stage: "quote" })).json;
  const { jobId, quotationId: qid } = seed;
  const other = (await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, unit_cost, markup_percent, created_by, updated_by) values ($1, 30, 'other', 'E2E SPECIAL TOOL HIRE', 'manual', 1, 100, 10, $2, $2) returning id", [qid, owner.id]))[0].id;
  const lineOf = async (id) => (await sql("select markup_percent::float8 as pct, line_total::float8 as total, below_cost_reason, below_cost_sell_aed::float8 as sell, below_cost_cost_aed::float8 as cost, below_cost_by from public.quotation_lines where id = $1", [id]))[0];

  // A1. The server refuses an advisor's figure below cost, whatever the screen does.
  const advCookie = await cookieHeader("service_advisor");
  const refused = await api("/api/quote/save", { quotationId: qid, patchLine: { id: other, markup_percent: -20 } }, advCookie);
  check("A1: the save refuses an advisor's markup that sells below cost (400, plain words)", refused.status === 400 && /would sell at AED 80\.00, below its cost of AED 100\.00/.test(refused.json?.error ?? "") && /only the owner can sell below cost/.test(refused.json?.error ?? ""), `${refused.status} ${refused.json?.error}`);
  check("A1: nothing was saved", (await lineOf(other))?.pct === 10);
  const ownCookie = await cookieHeader("owner");
  const asked = await api("/api/quote/save", { quotationId: qid, patchLine: { id: other, markup_percent: -20 } }, ownCookie);
  check("A1: the owner without a reason is asked for one (409 below_cost, with the figures)", asked.status === 409 && asked.json?.ask === "below_cost" && asked.json?.sell === 80 && asked.json?.cost === 100, `${asked.status} ${JSON.stringify(asked.json)}`);
  const shortReason = await api("/api/quote/save", { quotationId: qid, patchLine: { id: other, markup_percent: -20, below_cost_reason: "ok" } }, ownCookie);
  check("A1: a reason of a word or two is not enough", shortReason.status === 409);

  // A2. The advisor's screen: the figure stays, red, not saved.
  {
    const { browser, page } = await browserFor("service_advisor", { viewport: { width: 1440, height: 900 } });
    await go(page, `${base}/jobs/${jobId}/quote/${qid}`);
    const row = page.locator(`#item-line-${other}`);
    await typeInto(row.locator("input[aria-label='Markup']"), "-20");
    const held = await until(async () => ((await row.locator("[data-below-cost-held]").count()) ? 1 : null), 20, 300);
    check("A2: the advisor's -20% stays on the screen in red: 'Not saved … only the owner can sell below cost'", !!held && /Not saved: E2E SPECIAL TOOL HIRE would sell at AED 80\.00, below its cost of AED 100\.00/.test((await row.locator("[data-below-cost-held]").textContent()) ?? ""), (await row.textContent())?.replace(/\s+/g, " ").slice(0, 200));
    await sleep(2500);
    check("A2: and it is not saved", (await lineOf(other))?.pct === 10);
    await row.scrollIntoViewIfNeeded();
    await shot(page, "a2-advisor-held-1440", row);
    // A line that is below cost without anyone typing (Parts' cost went up): red, a blocker, and "ask the owner".
    const svc = (await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, unit_cost, unit_price, price_per, created_by, updated_by) values ($1, 2, 'package', 'E2E NIGHT SKY PAINTING', 'manual', 1, 1500, 1200, 'job', $2, $2) returning id", [qid, owner.id]))[0].id;
    await go(page, `${base}/jobs/${jobId}/quote/${qid}`);
    const svcRow = page.locator(`#item-line-${svc}`);
    check("A3: a line below its cost is red under the line, with its figures", /Below cost: sells at AED 1,200\.00, costs AED 1,500\.00 \(AED 300\.00 under\)/.test((await svcRow.locator("[data-below-cost-line]").textContent().catch(() => "")) ?? ""));
    const blockersText = (await page.locator("body").textContent()) ?? "";
    check("A3: 'Before sending' stops it: '… below its cost of AED 1,500.00 – raise the price, or the owner approves it'", /E2E NIGHT SKY PAINTING: sells at AED 1,200\.00, below its cost of AED 1,500\.00 – raise the price, or the owner approves it/.test(blockersText));
    await svcRow.locator("[data-below-cost-ask-owner]").click();
    const told = await until(async () => (await sql("select title from public.notifications where type = 'quote_below_cost' and job_id = $1 and title like 'Approve below cost?%' order by created_at desc limit 1", [jobId]))[0], 20, 500);
    check("A3: 'Raise the price, or ask the owner' tells the owner with the figures", !!told && /E2E NIGHT SKY PAINTING/.test(told.title), JSON.stringify(told));
    check("A3: the line says the owner was asked", (await svcRow.locator("[data-below-cost-asked]").count()) === 1);
    await svcRow.scrollIntoViewIfNeeded();
    await shot(page, "a3-advisor-below-cost-line-1440", svcRow);
    await page.setViewportSize({ width: 800, height: 1280 });
    await sleep(600);
    await svcRow.scrollIntoViewIfNeeded();
    await shot(page, "a3-advisor-below-cost-line-800", svcRow);
    await browser.close();
  }

  // A4. The owner: the reason window, the stamp with the figures, the event.
  {
    const { browser, page } = await browserFor("owner", { viewport: { width: 1440, height: 900 } });
    await go(page, `${base}/jobs/${jobId}/quote/${qid}`);
    const row = page.locator(`#item-line-${other}`);
    await typeInto(row.locator("input[aria-label='Markup']"), "-20");
    const dlg = page.locator("[data-below-cost-ask]");
    const opened = await until(async () => ((await dlg.count()) ? 1 : null), 30, 300);
    check("A4: the owner's figure below cost opens 'Sell below cost?' with the figures", !!opened && /E2E SPECIAL TOOL HIRE would sell at AED 80\.00, below its cost of AED 100\.00 \(AED 20\.00 under\)/.test((await dlg.locator("[data-below-cost-figures]").textContent().catch(() => "")) ?? ""));
    check("A4: Approve stays off until a reason is typed", await dlg.locator("[data-below-cost-send]").isDisabled());
    await dlg.locator("[data-below-cost-reason]").fill("Goodwill: the customer's third car this month");
    await shot(page, "a4-owner-reason-window-1440", dlg.locator("div").first());
    await dlg.locator("[data-below-cost-send]").click();
    const stamped = await until(async () => { const r = await lineOf(other); return r?.pct === -20 && r?.below_cost_reason && r?.total === 80 ? r : null; }, 30, 500);
    check("A4: saved at -20% with the owner's reason and the figures he saw (sell 80, cost 100)", !!stamped && stamped.sell === 80 && stamped.cost === 100 && stamped.below_cost_by === owner.id && stamped.total === 80, JSON.stringify(stamped));
    const ev = await until(async () => (await sql("select note from public.quotation_events where quotation_id = $1 and event_type = 'below_cost_approved' order by created_at desc limit 1", [qid]))[0], 20, 500);
    check("A4: logged on the quotation with the figures and the reason", /approved E2E SPECIAL TOOL HIRE selling at AED 80\.00, below its cost of AED 100\.00 \(AED 20\.00 under\): Goodwill/.test(ev?.note ?? ""), ev?.note ?? "");
    check("A4: also on the job's history", (await sql("select 1 from public.job_events where job_id = $1 and event_type = 'below_cost_approved'", [jobId])).length >= 1);
    // The red line on a line nobody typed: the owner approves it from the line.
    const svc = (await sql("select id from public.quotation_lines where quotation_id = $1 and title = 'E2E NIGHT SKY PAINTING'", [qid]))[0].id;
    await go(page, `${base}/jobs/${jobId}/quote/${qid}`);
    const svcRow = page.locator(`#item-line-${svc}`);
    await svcRow.locator("[data-below-cost-approve]").click();
    await page.locator("[data-below-cost-reason]").fill("Showroom display car, agreed with the customer");
    await page.locator("[data-below-cost-send]").click();
    const svcStamp = await until(async () => (await sql("select below_cost_reason from public.quotation_lines where id = $1", [svc]))[0]?.below_cost_reason, 30, 500);
    check("A5: 'Approve below cost…' on the line stamps it with the reason", /Showroom display car/.test(svcStamp ?? ""));
    await go(page, `${base}/jobs/${jobId}/quote/${qid}`);
    check("A5: the line now reads 'approved by <owner>: <reason>'", new RegExp(`approved by ${owner.display_name}: Showroom display car`).test((await page.locator(`#item-line-${svc} [data-below-cost-approved]`).textContent().catch(() => "")) ?? ""));
    check("A5: 'Before sending' no longer stops either line", !/below its cost of AED (1,500|100)\.00 – raise the price/.test((await page.locator("body").textContent()) ?? ""));
    await shot(page, "a5-owner-approved-line-1440", page.locator(`#item-line-${svc}`));
    // A lower price than he approved is not covered.
    const lower = await api("/api/quote/save", { quotationId: qid, patchLine: { id: other, markup_percent: -30 } }, ownCookie);
    check("A6: going lower than the approved figure asks again", lower.status === 409 && lower.json?.ask === "below_cost");
    await browser.close();
  }
});

/* ---------------- B. A revision request from Parts: the figures and the red warning ---------------- */
let limit = 70;
const pricePartAs = async (jobId, partId, discount) => {
  const { browser, page } = await browserFor("parts", { viewport: { width: 1600, height: 1000 } });
  await go(page, `${base}/parts/${jobId}`);
  const row = page.locator("[data-row-key]").filter({ hasText: /front rh brake pads/i }).first();
  await until(async () => ((await row.count()) ? 1 : null), 30, 500);
  await row.locator("input[aria-label='Part number']").fill("PAD-STAGE-1");
  await row.locator("input[aria-label='Part number']").press("Tab");
  await sleep(800);
  await row.locator("select[aria-label='Type']").selectOption("genuine");
  // The list typed is the twin's NET (200), then the supplier's standard discount fills in by itself: the Q-00039 slip.
  await row.locator("input[aria-label='List price']").fill("200");
  await row.locator("input[aria-label='List price']").press("Tab");
  await sleep(1200);
  const supSel = row.locator("select[aria-label='Supplier']");
  await supSel.selectOption(await supplierOption(supSel, "e2e gargash s1"));
  await sleep(1000);
  await row.locator("select[aria-label='Availability']").selectOption({ label: "Next day" });
  const net = Math.round(200 * (1 - discount / 100) * 100) / 100;
  const priced = await until(async () => { const r = (await sql("select cost_aed::float8 as cost, discount_percent::float8 as disc from public.part_items where id = $1", [partId]))[0]; return r?.cost === net ? r : null; }, 40, 500);
  return { browser, page, priced, net };
};
const seedApproved = async () => {
  cleanupDb();
  const s = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const qid = s.quotationId;
  limit = Number((await sql("select value::text as v from public.settings where key = 'supplier_discount_approval_above_percent'"))[0]?.v ?? 70) || 70;
  const discount = Math.min(55, limit - 1);
  await sql("insert into public.suppliers (name, default_discount_percent, discount_by_type, created_by) values ('E2e Gargash S1', $1, '{}'::jsonb, $2) on conflict do nothing", [discount, owner.id]);
  await sql("update public.suppliers set default_discount_percent = $1 where name ilike 'e2e gargash s1'", [discount]);
  const partId = (await sql("insert into public.part_items (job_id, description, quantity, availability, confirm_status, confirmed_at, created_by, updated_by) values ($1, 'E2e front RH brake pads', 1, 'to_order', 'confirmed', now(), $2, $2) returning id", [s.jobId, owner.id]))[0].id;
  return { jobId: s.jobId, qid, partId, discount };
};

await section("B revision request", async () => {
  const { jobId, qid, partId, discount } = await seedApproved();
  const { browser: pb, priced, net } = await pricePartAs(jobId, partId, discount);
  check(`B1: Parts priced it: list 200 less the supplier's ${discount}% = cost ${net}`, !!priced, JSON.stringify(priced));
  const req = await until(async () => { const r = (await sql("select revision_request_reason as reason, revision_request_kind as kind, revision_request_parts as parts from public.quotations where id = $1", [qid]))[0]; return r?.reason ? r : null; }, 40, 500);
  const money = (n) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  check("B1: the request labels the figure as the COST, with the list and the discount", new RegExp(`added E2E FRONT RH BRAKE PADS – cost AED ${money(net)} \\(list AED 200\\.00 less ${discount}%\\)`).test(req?.reason ?? ""), req?.reason ?? "");
  check("B1: the request remembers the part behind it", (req?.parts ?? []).includes(partId), JSON.stringify(req?.parts));
  const bell = (await sql("select title, body from public.notifications where job_id = $1 and type = 'revision_request' order by created_at desc limit 1", [jobId]))[0];
  check("B1: the owner's bell starts 'CHECK THE PRICE' and says why", /^CHECK THE PRICE · /.test(bell?.title ?? "") && /under FRONT BRAKE PADS on this job/.test(bell?.body ?? ""), JSON.stringify(bell));
  check("B1: no new version without the owner", (await sql("select count(*)::int as n from public.quotations where job_id = $1 and kind = 'quotation'", [jobId]))[0].n === 1);
  await pb.close();

  const { browser, page } = await browserFor("owner", { viewport: { width: 1440, height: 900 } });
  await go(page, `${base}/jobs/${jobId}/quote/${qid}?revise=1`);
  const box = page.locator("[data-owner-box]");
  const row = box.locator('[data-revision-row="added"]');
  check("B2: the owner's box lists the part with every figure labelled", (await row.count()) === 1 && (await row.locator("[data-revision-list]").textContent()) === "AED 200.00" && (await row.locator("[data-revision-discount]").textContent()) === `${discount}%` && (await row.locator("[data-revision-cost]").textContent()) === `AED ${money(net)}`, (await row.textContent().catch(() => ""))?.replace(/\s+/g, " "));
  const sell = Math.round(net * 1.5 * 100) / 100;
  check("B2: the selling price it would get: the twin's 50% markup, never the bare 5%", new RegExp(`AED ${money(sell)}`).test((await row.locator("[data-revision-sell]").textContent()) ?? "") && /same as Front brake pads/i.test((await row.locator("[data-revision-sell]").textContent()) ?? ""), (await row.locator("[data-revision-sell]").textContent()) ?? "");
  check("B2: RED: its cost is under half of the same part on the job", /E2E FRONT RH BRAKE PADS: cost AED [\d.,]+ is \d+% under FRONT BRAKE PADS on this job \(AED 200\.00\) – check the Parts price before allowing/.test((await box.locator("[data-revision-red]").textContent().catch(() => "")) ?? ""), (await box.locator("[data-revision-red]").textContent().catch(() => "")) ?? "");
  await box.scrollIntoViewIfNeeded();
  await shot(page, "b2-owner-revision-box-1440", box);
  await page.setViewportSize({ width: 800, height: 1280 });
  await sleep(600);
  await box.scrollIntoViewIfNeeded();
  await shot(page, "b2-owner-revision-box-800", box);
  await page.setViewportSize({ width: 1440, height: 900 });
  // Allow with no reason: the form will not go.
  await box.locator("[data-revision-allow]").click();
  await sleep(2500);
  check("B3: 'Allow one revision' on a red request needs his reason (nothing allowed without it)", !(await sql("select revision_allowed_at from public.quotations where id = $1", [qid]))[0]?.revision_allowed_at && (await sql("select count(*)::int as n from public.quotations where job_id = $1 and kind = 'quotation'", [jobId]))[0].n === 1);
  await box.locator("[data-revision-note]").fill("Checked with Parts: the supplier confirmed this price");
  await box.locator("[data-revision-allow]").click();
  await submitted(page);
  const v2 = await until(async () => (await sql("select id, status from public.quotations where job_id = $1 and kind = 'quotation' and version = 2", [jobId]))[0], 40, 500);
  const line = v2 ? await until(async () => { const r = (await sql("select markup_mode, markup_percent::float8 as pct, line_total::float8 as total, unit_cost::float8 as cost from public.quotation_lines where quotation_id = $1 and part_item_id = $2 and is_active", [v2.id, partId]))[0]; return r && r.total > 0 ? r : null; }, 40, 500) : null;
  check("B3: allowed with his reason: version 2 carries the part at the twin's 50%, never the bare minimum", !!line && line.pct === 50 && line.total === sell && line.cost === net, JSON.stringify(line));
  const ev = (await sql("select note from public.quotation_events where quotation_id = $1 and event_type = 'revision_allowed' order by created_at desc limit 1", [qid]))[0];
  check("B3: the history keeps the reason and what he allowed it despite", /Checked with Parts/.test(ev?.note ?? "") && /allowed despite: .*under FRONT BRAKE PADS/.test(ev?.note ?? ""), ev?.note ?? "");
  const added = (await sql("select note from public.quotation_events where quotation_id = $1 and event_type = 'parts_added' order by created_at desc limit 1", [v2?.id]))[0];
  check("B3: version 2's history says where the markup came from", /at 50% \(same as FRONT BRAKE PADS/i.test(added?.note ?? ""), added?.note ?? "");
  await browser.close();
});

/* ---------------- C. The part taken off while the request waits: it withdraws itself ---------------- */
await section("C withdraw", async () => {
  const { jobId, qid, partId, discount } = await seedApproved();
  const { browser, page } = await pricePartAs(jobId, partId, discount);
  const req = await until(async () => (await sql("select revision_requested_at from public.quotations where id = $1", [qid]))[0]?.revision_requested_at, 40, 500);
  check("C1: the request waits for the owner", !!req);
  const row = page.locator("[data-row-key]").filter({ hasText: /front rh brake pads/i }).first();
  await row.locator("button[aria-label='More for this part']").first().click();
  await page.locator("button", { hasText: /^Remove: not needed$/ }).first().click();
  const dlg = page.locator("[data-remove-dialog]");
  await until(async () => ((await dlg.count()) ? 1 : null), 20, 300);
  await dlg.getByRole("button", { name: "Duplicate" }).click().catch(async () => { await dlg.locator("input, textarea").first().fill("Duplicate"); });
  await dlg.getByRole("button", { name: "Remove", exact: true }).click();
  const gone = await until(async () => { const r = (await sql("select revision_declined_at, revision_decision_note as note from public.quotations where id = $1", [qid]))[0]; return r?.revision_declined_at ? r : null; }, 40, 500);
  check("C2: taken off as a duplicate: the waiting request withdraws itself, saying why", !!gone && /Withdrawn by itself: E2E FRONT RH BRAKE PADS \(Duplicate\) was taken off by Parts/.test(gone.note ?? ""), JSON.stringify(gone));
  const bells = await sql("select read_at from public.notifications where job_id = $1 and type = 'revision_request'", [jobId]);
  check("C2: the owner's bell for it is marked read", bells.length >= 1 && bells.every((b) => !!b.read_at), JSON.stringify(bells));
  check("C2: the history says it was withdrawn", (await sql("select 1 from public.quotation_events where quotation_id = $1 and event_type = 'revision_withdrawn'", [qid])).length === 1);
  check("C2: no new version was made", (await sql("select count(*)::int as n from public.quotations where job_id = $1 and kind = 'quotation'", [jobId]))[0].n === 1);
  await browser.close();
  const { browser: ob, page: op } = await browserFor("owner", { viewport: { width: 1440, height: 900 } });
  await go(op, `${base}/jobs/${jobId}/quote/${qid}`);
  check("C3: the owner's box no longer asks about it", (await op.locator("[data-revision-allow]").count()) === 0);
  await ob.close();
});

/* ---------------- D. The header discount: nothing below cost through a discount either ---------------- */
const rateOf = async () => Number((await sql("select value::text as v from public.settings where key = 'bodyshop_cost_rate_aed'"))[0]?.v?.replace(/"/g, "")) || 50;
await section("D discount", async () => {
  cleanupDb();
  const seed = (await api("/api/e2e/stage", { stage: "quote" })).json;
  const { jobId, quotationId: qid } = seed;
  const rate = await rateOf();
  const cost = 8 * rate;
  const price = cost + 50;
  const svc = (await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, unit_price, installer_hours, price_per, created_by, updated_by) values ($1, 40, 'package', 'E2E PAINT CORRECTION', 'manual', 1, $3, 8, 'job', $2, $2) returning id", [qid, owner.id, price]))[0].id;
  const sell20 = Math.round(price * 0.8 * 100) / 100;
  const money = (n) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const advCookie = await cookieHeader("service_advisor");
  const ownCookie = await cookieHeader("owner");
  const disc = (v) => ({ quotationId: qid, header: { discount_kind: "percent", discount_value: v, discount_percent: 0, discount_scope: "labour_services" } });
  const r1 = await api("/api/quote/save", disc(20), advCookie);
  check(`D1: an advisor's 20% labour-and-services discount that takes the service below its ${money(cost)} cost is refused, in words`, r1.status === 400 && new RegExp(`E2E PAINT CORRECTION would sell at AED ${money(sell20)}, below its cost of AED ${money(cost)}`).test(r1.json?.error ?? ""), `${r1.status} ${r1.json?.error}`);
  check("D1: nothing saved", !(await sql("select discount_value from public.quotations where id = $1", [qid]))[0]?.discount_value);
  const r10 = await api("/api/quote/save", disc(5), advCookie);
  check("D1: a small discount that keeps it above cost is fine", r10.status === 200, `${r10.status} ${r10.json?.error}`);
  const r2 = await api("/api/quote/save", disc(20), ownCookie);
  check("D2: the owner is asked why (409 below_cost, the figures after the discount)", r2.status === 409 && r2.json?.ask === "below_cost" && r2.json?.sell === sell20 && r2.json?.cost === cost && r2.json?.lineId === svc, `${r2.status} ${JSON.stringify(r2.json)}`);
  const r3 = await api("/api/quote/save", { ...disc(20), header: { ...disc(20).header, below_cost_reason: "Launch offer agreed with the customer" } }, ownCookie);
  const st = (await sql("select below_cost_reason, below_cost_sell_aed::float8 as sell, below_cost_cost_aed::float8 as cost from public.quotation_lines where id = $1", [svc]))[0];
  check("D2: with his reason: saved, and the line stamped with the AFTER-discount figure he saw", r3.status === 200 && /Launch offer/.test(st?.below_cost_reason ?? "") && st?.sell === sell20 && st?.cost === cost, `${r3.status} ${JSON.stringify(st)}`);
  const r4 = await api("/api/quote/save", disc(30), advCookie);
  check("D3: going deeper than he approved is refused again", r4.status === 400 && /below its cost/.test(r4.json?.error ?? ""), `${r4.status} ${r4.json?.error}`);
  // The discount window says it before anything is sent.
  await api("/api/quote/save", { quotationId: qid, header: { discount_kind: null, discount_value: 0, discount_percent: 0 } }, ownCookie);
  await sql("update public.quotation_lines set below_cost_reason = null, below_cost_by = null, below_cost_at = null, below_cost_sell_aed = null, below_cost_cost_aed = null where id = $1", [svc]);
  const { browser, page } = await browserFor("service_advisor", { viewport: { width: 1440, height: 900 } });
  await go(page, `${base}/jobs/${jobId}/quote/${qid}`);
  await page.locator("[data-labour-discount]").first().click();
  const dlg = page.locator("[data-labour-discount-dialog]");
  await dlg.getByRole("button", { name: "Labour + services" }).click();
  await typeInto(dlg.locator("input[aria-label='Discount amount']"), "20");
  const said = await until(async () => ((await dlg.locator("[data-discount-below-cost]").count()) ? (await dlg.locator("[data-discount-below-cost]").textContent()) : null), 20, 300);
  check("D4: the discount window says it in red before Apply: 'Not saved … Lower the discount'", /Not saved: E2E PAINT CORRECTION would sell at .*Lower the discount – only the owner can sell below cost/.test(said ?? ""), said ?? "");
  await dlg.locator("[data-discount-apply]").click();
  await sleep(2000);
  check("D4: Apply does nothing: the window stays and nothing is saved", (await dlg.count()) === 1 && !(await sql("select discount_value from public.quotations where id = $1", [qid]))[0]?.discount_value);
  await shot(page, "d4-advisor-discount-below-cost-1440", dlg);
  await page.setViewportSize({ width: 800, height: 1280 });
  await sleep(600);
  await shot(page, "d4-advisor-discount-below-cost-800", dlg);
  await browser.close();
});

/* ---------------- E. The editor's hold: never against the unsaved figure; a cost is never refused ---------------- */
await section("E hold", async () => {
  cleanupDb();
  const seed = (await api("/api/e2e/stage", { stage: "quote" })).json;
  const { jobId, quotationId: qid } = seed;
  const tool = (await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, unit_cost, markup_percent, created_by, updated_by) values ($1, 30, 'other', 'E2E SPECIAL TOOL HIRE', 'manual', 1, 100, 10, $2, $2) returning id", [qid, owner.id]))[0].id;
  const rec = (await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, unit_cost, unit_price, recovery_trips, recovery_provider_kind, recovery_paid_by, created_by, updated_by) values ($1, 31, 'recovery', 'E2E RECOVERY', 'manual', 1, 100, 150, 1, 'ours', 'customer', $2, $2) returning id", [qid, owner.id]))[0].id;
  const toolRow = async () => (await sql("select title, markup_percent::float8 as pct from public.quotation_lines where id = $1", [tool]))[0];
  const { browser, page } = await browserFor("service_advisor", { viewport: { width: 1440, height: 900 } });
  await go(page, `${base}/jobs/${jobId}/quote/${qid}`);
  const row = page.locator(`#item-line-${tool}`);
  await typeInto(row.locator("input[aria-label='Markup']"), "-20");
  await until(async () => ((await row.locator("[data-below-cost-held]").count()) ? 1 : null), 20, 300);
  await typeInto(row.locator("input[aria-label='Charge']"), "E2E tool hire two");
  const titled = await until(async () => { const r = await toolRow(); return r?.title === "E2E TOOL HIRE TWO" ? r : null; }, 30, 500);
  check("E1: a note typed while a figure is held is saved; the held -20% is not", !!titled && titled.pct === 10 && (await row.locator("[data-below-cost-held]").count()) === 1, JSON.stringify(await toolRow()));
  await typeInto(row.locator("input[aria-label='Markup']"), "-15");
  await sleep(1500);
  check("E2: a second figure is judged against what is SAVED (10%), not the unsaved -20%: still held, still not saved", (await toolRow())?.pct === 10 && (await row.locator("[data-below-cost-held]").count()) === 1);
  await typeInto(row.locator("input[aria-label='Markup']"), "30");
  const raised = await until(async () => { const r = await toolRow(); return r?.pct === 30 ? r : null; }, 30, 500);
  check("E3: a figure that clears the cost is saved and the red note goes", !!raised && (await row.locator("[data-below-cost-held]").count()) === 0);
  // A COST is a fact: typed above the price it is saved, the line turns red, the owner is told.
  const recRow = page.locator(`#item-line-${rec}`);
  await typeInto(recRow.locator("input[aria-label='Cost per trip']"), "400");
  const costed = await until(async () => (await sql("select unit_cost::float8 as c from public.quotation_lines where id = $1", [rec]))[0]?.c === 400 ? 1 : null, 30, 500);
  check("E4: the recovery's real cost (400 a trip, priced 150) is saved, never refused", !!costed);
  check("E4: the line shows red under it (not held)", (await recRow.locator("[data-below-cost-line]").count()) === 1 && (await recRow.locator("[data-below-cost-held]").count()) === 0);
  const told = await until(async () => (await sql("select title, body from public.notifications where type = 'quote_below_cost' and job_id = $1 and title like 'Below cost on%' order by created_at desc limit 1", [jobId]))[0], 20, 500);
  check("E4: the owner is told the line is below its cost (the recovery line is titled by its type)", !!told && /RECOVERY.*sell at AED 150\.00, below its cost of AED 400\.00/.test(told.body), JSON.stringify(told));
  await recRow.scrollIntoViewIfNeeded();
  await shot(page, "e4-advisor-cost-saved-red-1440", recRow);
  await recRow.locator("[data-below-cost-ask-owner]").click();
  check("E5: 'ask the owner' on a line below cost on the server: the owner was asked", !!(await until(async () => ((await recRow.locator("[data-below-cost-asked]").count()) ? 1 : null), 20, 300)));
  await browser.close();
  const notBelow = await api("/api/quote/save", { quotationId: qid, belowCostAsk: { id: tool } }, await cookieHeader("service_advisor"));
  check("E6: asking about a line whose SAVED price is not below cost asks nobody (asked: false)", notBelow.status === 200 && notBelow.json?.asked === false && notBelow.json?.notBelow === true, JSON.stringify(notBelow.json));
});

/* ---------------- F. Allow: the new version carries the NEW cost; the reason stamps only what he saw ---------------- */
await section("F allow", async () => {
  const { jobId, qid, partId, discount } = await seedApproved();
  const seeded = (await sql("select id, cost_aed::float8 as cost from public.part_items where job_id = $1 and id <> $2 and is_active and cost_aed is not null order by created_at limit 1", [jobId, partId]))[0];
  // A line already below cost on the approved version that nobody shows the owner in his box.
  await sql("update public.quotations set status = 'draft' where id = $1", [qid]);
  await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, unit_cost, markup_percent, created_by, updated_by) values ($1, 50, 'other', 'E2E UNSEEN CHARGE', 'manual', 1, 100, -20, $2, $2)", [qid, owner.id]);
  await sql("update public.quotations set status = 'approved' where id = $1", [qid]);
  const { browser: pb } = await pricePartAs(jobId, partId, discount);
  await until(async () => (await sql("select revision_requested_at from public.quotations where id = $1", [qid]))[0]?.revision_requested_at, 40, 500);
  await pb.close();
  const newCost = Math.round(seeded.cost * 2 * 100) / 100;
  await sql("update public.part_items set cost_aed = $2 where id = $1", [seeded.id, newCost]);
  const { browser, page } = await browserFor("owner", { viewport: { width: 1440, height: 900 } });
  await go(page, `${base}/jobs/${jobId}/quote/${qid}?revise=1`);
  const box = page.locator("[data-owner-box]");
  const changed = box.locator('[data-revision-row="changed"]');
  const money = (n) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  check("F1: the owner's box shows the re-priced part with its NEW cost", (await changed.count()) === 1 && (await changed.locator("[data-revision-cost]").textContent()) === `AED ${money(newCost)}`, (await changed.textContent().catch(() => ""))?.replace(/\s+/g, " "));
  await shot(page, "f1-owner-box-changed-cost-1440", box);
  await box.locator("[data-revision-note]").fill("Checked with Parts: both prices confirmed");
  await box.locator("[data-revision-allow]").click();
  await submitted(page);
  const v2 = await until(async () => (await sql("select id from public.quotations where job_id = $1 and kind = 'quotation' and version = 2", [jobId]))[0], 40, 500);
  const line = v2 ? await until(async () => (await sql("select unit_cost::float8 as cost from public.quotation_lines where quotation_id = $1 and part_item_id = $2 and is_active", [v2.id, seeded.id]))[0], 20, 500) : null;
  check("F2: version 2 carries the re-priced part at its NEW cost (never the approved version's old one)", line?.cost === newCost, `${JSON.stringify(line)} expected ${newCost}`);
  const unseen = v2 ? (await sql("select below_cost_reason, below_cost_at from public.quotation_lines where quotation_id = $1 and title = 'E2E UNSEEN CHARGE' and is_active", [v2.id]))[0] : null;
  check("F3: his reason did NOT stamp a line below cost he never saw in the box (it waits in Before sending)", !!unseen && !unseen.below_cost_at && !unseen.below_cost_reason, JSON.stringify(unseen));
  await browser.close();
});

/* ---------------- G. An advisor's request is never withdrawn by Parts ---------------- */
const removeAsDuplicate = async (page) => {
  const row = page.locator("[data-row-key]").filter({ hasText: /front rh brake pads/i }).first();
  await row.locator("button[aria-label='More for this part']").first().click();
  await page.locator("button", { hasText: /^Remove: not needed$/ }).first().click();
  const dlg = page.locator("[data-remove-dialog]");
  await until(async () => ((await dlg.count()) ? 1 : null), 20, 300);
  await dlg.getByRole("button", { name: "Duplicate" }).click().catch(async () => { await dlg.locator("input, textarea").first().fill("Duplicate"); });
  await dlg.getByRole("button", { name: "Remove", exact: true }).click();
};
await section("G advisor request", async () => {
  const { jobId, qid, partId, discount } = await seedApproved();
  const adv = (await sql("select id from public.staff where role_id = 'service_advisor' and is_active order by created_at limit 1"))[0];
  await sql("update public.quotations set revision_requested_at = now(), revision_requested_by = $2, revision_request_reason = 'E2E customer wants the rear brakes too', revision_request_kind = 'advisor', revision_request_parts = null where id = $1", [qid, adv.id]);
  const { browser, page, priced } = await pricePartAs(jobId, partId, discount);
  check("G1: Parts priced a part while the advisor's request waits", !!priced);
  await sleep(2000);
  const mid = (await sql("select revision_request_kind as kind, revision_request_parts as parts from public.quotations where id = $1", [qid]))[0];
  check("G1: the part does NOT join the advisor's request", mid?.kind === "advisor" && !mid?.parts, JSON.stringify(mid));
  await removeAsDuplicate(page);
  await until(async () => (await sql("select removed_at from public.part_items where id = $1", [partId]))[0]?.removed_at, 30, 500);
  await sleep(2500);
  const after = (await sql("select revision_declined_at, revision_request_reason as reason from public.quotations where id = $1", [qid]))[0];
  check("G2: taking that part off leaves the advisor's request waiting for the owner", !after?.revision_declined_at && /rear brakes too/.test(after?.reason ?? ""), JSON.stringify(after));
  check("G2: no 'withdrawn' in the history", (await sql("select 1 from public.quotation_events where quotation_id = $1 and event_type = 'revision_withdrawn'", [qid])).length === 0);
  await browser.close();
});

/* ---------------- H. An early charge waiting for the revision ---------------- */
await section("H charge", async () => {
  cleanupDb();
  const s = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const qid = s.quotationId;
  const charge = (await sql("insert into public.charge_lines (job_id, kind, description, cost_aed, charge_aed, free, created_by, updated_by) values ($1, 'other', 'E2E PARKING AT THE DEALER', 300, 200, false, $2, $2) returning id", [s.jobId, owner.id]))[0]?.id;
  await sql("update public.quotations set revision_requested_at = now(), revision_requested_by = $2, revision_request_reason = 'E2E added PARKING AT THE DEALER', revision_request_kind = 'parts', revision_request_parts = null where id = $1", [qid, owner.id]);
  const { browser, page } = await browserFor("owner", { viewport: { width: 1440, height: 900 } });
  await go(page, `${base}/jobs/${s.jobId}/quote/${qid}?revise=1`);
  const box = page.locator("[data-owner-box]");
  const crow = box.locator('[data-revision-row="charge"]');
  check("H1: the owner's box lists the waiting charge with its cost and price, red below cost (never 'the part was taken off')", !!charge && (await crow.count()) === 1 && (await crow.getAttribute("data-revision-row-red")) === "1" && (await box.locator("[data-revision-empty]").count()) === 0 && /AED 300\.00/.test((await crow.locator("[data-revision-cost]").textContent()) ?? "") && /AED 200\.00/.test((await crow.locator("[data-revision-sell]").textContent()) ?? ""), (await box.textContent().catch(() => ""))?.replace(/\s+/g, " ").slice(0, 300));
  await shot(page, "h1-owner-box-charge-1440", box);
  await box.locator("[data-revision-note]").fill("Parking is on us this time: agreed");
  await box.locator("[data-revision-allow]").click();
  await submitted(page);
  const v2 = await until(async () => (await sql("select id from public.quotations where job_id = $1 and kind = 'quotation' and version = 2", [s.jobId]))[0], 40, 500);
  const cl = v2 ? await until(async () => (await sql("select l.id, l.line_total::float8 as total, l.unit_cost::float8 as cost, l.below_cost_reason as reason from public.quotation_lines l join public.charge_lines c on c.quotation_line_id = l.id where c.id = $1 and l.quotation_id = $2", [charge, v2.id]))[0], 30, 500) : null;
  check("H2: Allow makes version 2 WITH the charge on it (sold at 200, cost 300)", cl?.total === 200 && cl?.cost === 300, JSON.stringify(cl));
  check("H2: his reason covers that charge, the one he saw below cost", /Parking is on us/.test(cl?.reason ?? ""), JSON.stringify(cl));
  await browser.close();
});

cleanupDb();
process.exit(summary() ? 1 : 0);
