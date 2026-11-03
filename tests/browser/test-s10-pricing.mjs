// Section 10 of 2 November 2026 (built 3 November): "Pricing done – send to advisor". Proved through the screens on
// the TEST server:
//   A. A job: the bar at the bottom says "n of m priced"; tapping it with a part not priced lists that part above the
//      button (Go to, Send what you have) and sends nothing; the advisor hears NOTHING per part while Parts price
//      (J-00016 got 94 "Parts priced" in one morning); every part priced = the car shows "Priced – send to the
//      advisor" on the parts desk and in Parts' Waiting on you; the tap sends ONE notification ("All parts priced on
//      J-…") and the car leaves both lists. Edit, a quantity changed, "Send updated prices" = ONE "Prices updated on
//      J-…" with the change folded in. A new part request after the send opens the pricing again.
//   B. An estimate: the same bar; "Send what you have" with one line open = ONE "Parts priced on E-…: 2 of 3"; the
//      line left open keeps the estimate on the desk's list ("1 part to price"); an old tab pressing the button again
//      sends nothing more ("Already sent"); "Send updated prices".
//   C. (review of 3 November 2026) "Price is right ✓" on the advisor's own price makes the line priced on the bar at
//      once ("1 of 1 priced") and the send says "All parts priced on E-…".
//   D. (review) A car past approval whose pricing was never sent: a new part request opens the pricing (the car is on
//      To price, the bar asks for the send) instead of holding the advisor's notices with nothing asking for a send.
//   ONLY=A,B,C,D runs those sections only.
// Run: npm run test:s10-pricing   (test server on :3102, or E2E_BASE=http://localhost:3101 for the dev test server)
// Screenshots: tests/browser/shots/s10-pricing/
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execSync } from "node:child_process";
import { api, base, browserFor, cleanupDb, cookieHeader, go, here, makeChecks, projectRoot, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const SHOTS = path.join(here, "shots", "s10-pricing");
fs.mkdirSync(SHOTS, { recursive: true });
setTimeout(() => { console.log("TIMEOUT: stopping"); finish().then(() => process.exit(2)); }, 20 * 60 * 1000).unref();
const shot = (page, name, loc) => (loc ? loc.screenshot({ path: path.join(SHOTS, `${name}.png`) }) : page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false })).catch((e) => console.log("shot", name, String(e).slice(0, 120)));
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const typeInto = async (loc, text) => { await loc.click({ clickCount: 3 }); await loc.press("Backspace"); if (text) await loc.pressSequentially(text); await loc.press("Tab"); };
const supplierOption = async (sel, name) => sel.locator("option").evaluateAll((os, n) => (os.find((o) => (o.textContent ?? "").toLowerCase().startsWith(n.toLowerCase())) ?? {}).value ?? "", name);
const section = async (name, fn) => { if (process.env.ONLY && !process.env.ONLY.split(",").includes(name[0])) return; console.log(`\n--- ${name}`); try { await fn(); } catch (e) { check(`${name}: ran to the end`, false, String(e?.stack ?? e).slice(0, 400)); } };
const flat = (t) => String(t ?? "").replace(/\s+/g, " ").trim();

const ID = (n) => `22222222-0000-4000-8000-00000000e6d${n}`;
const EST = ID("1");
const L1 = ID("2");
const L2 = ID("3");
const L3 = ID("4");
const L4 = ID("5");
const PR1 = "22222222-0000-4000-8000-00000000e309"; // the stage seed's rear brake discs request
const PA = "22222222-0000-4000-8000-00000000e306"; // the stage seed's front brake pads (priced, no supplier yet)
const SUP = "E2e Abu Dhabi S10";
const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0];
const stampReady = (await sql("select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'quotations' and column_name = 'parts_priced_at'"))[0]?.n === 1;
check("0: the TEST database keeps an estimate's send (migration 20261203170000_estimate_pricing_done)", stampReady);

async function finish() {
  const file = path.join(os.tmpdir(), `s10-pricing-${process.pid}.sql`);
  fs.writeFileSync(file, `delete from public.notifications where href like '%${EST}%';\n`);
  try { execSync(`node --env-file=.env.test.local scripts/db-sql.mjs "${file}"`, { cwd: projectRoot, encoding: "utf8" }); } catch (e) { console.log("notifications not removed:", String(e.message).slice(0, 160)); }
  fs.rmSync(file, { force: true });
  cleanupDb();
}
const ensureSupplier = async () => { await sql("insert into public.suppliers (name, default_discount_percent, discount_by_type, created_by) select $1, 0, '{}'::jsonb, $2 where not exists (select 1 from public.suppliers where name ilike $1)", [SUP, owner.id]); await sql("update public.suppliers set is_active = true where name ilike $1", [SUP]); };
const pickSupplier = async (row) => { const sel = row.locator("select[aria-label='Supplier']"); await sel.selectOption(await supplierOption(sel, SUP)); await sleep(400); };
const priceRow = async (row, { pn, net, avail = "In stock" }) => {
  if (pn !== undefined) await typeInto(row.locator("input[aria-label='Part number']"), pn);
  await row.locator("select[aria-label='Type']").selectOption("genuine");
  await pickSupplier(row);
  await typeInto(row.locator("input[aria-label='Cost before VAT']"), net);
  await row.locator("select[aria-label='Availability']").selectOption({ label: avail });
  await row.locator("input[aria-label='Part number']").press("Tab");
};
const progressOf = async (page) => (await page.locator("[data-pricing-progress]").getAttribute("data-pricing-progress").catch(() => "")) ?? "";
const advisorNotes = async (staffId, where, param) => (await sql(`select count(*)::int as n from public.notifications where staff_id = $1 and ${where}`, [staffId, param]))[0]?.n ?? 0;
const waitingRow = async (page, jobId) => { await go(page, `${base}/dashboard`); return flat(await page.locator(`[data-waiting-job="${jobId}"]`).allTextContents().then((t) => t.join(" | ")).catch(() => "")); };

try {
  /* ---------------- A. A job: one bar, the open lines listed, ONE notification, off the list ---------------- */
  await section("A job", async () => {
    cleanupDb();
    await ensureSupplier();
    const seed = (await api("/api/e2e/stage", { stage: "quote" })).json;
    const { jobId, quotationId } = seed;
    const adv = (await sql("select gated_in_by as id from public.jobs where id = $1", [jobId]))[0];
    const jobNumber = (await sql("select job_number from public.jobs where id = $1", [jobId]))[0]?.job_number;
    const saidBefore = await advisorNotes(adv.id, "type = 'parts_priced' and job_id = $2", jobId);
    const { browser, page } = await browserFor("parts", { viewport: { width: 1440, height: 900 } });
    await go(page, `${base}/parts/${jobId}`);
    await until(async () => ((await page.locator("[data-pricing-bar]").count()) ? 1 : null), 30, 500);
    check("A1: the bar is there with the progress '0 of 2 priced' and ONE big button 'Pricing done – send to advisor'", (await progressOf(page)) === "0/2" && /0 of 2 priced/.test(flat(await page.locator("[data-pricing-progress]").textContent())) && /Pricing done – send to advisor/.test(flat(await page.locator("[data-pricing-done]").textContent())), `${await progressOf(page)} · ${flat(await page.locator("[data-pricing-bar]").textContent())}`);
    const pads = page.locator(`[data-row-key="${PA}"]`);
    await pickSupplier(pads);
    await pads.locator("input[aria-label='Part number']").press("Tab");
    check("A2: one part priced: '1 of 2 priced'", !!(await until(async () => ((await progressOf(page)) === "1/2" ? 1 : null), 30, 400)), await progressOf(page));
    await shot(page, "a-bar-1-of-2-1440");
    // The tap with a part not priced: listed instead of sent.
    await page.locator("[data-pricing-done]").click();
    await sleep(400);
    const list = page.locator("[data-pricing-open-list]");
    const listText = flat(await list.textContent().catch(() => ""));
    check("A3: the unpriced part is listed above the button with what it misses (nothing sent)", (await list.count()) === 1 && /1 part not priced yet/.test(listText) && /REAR BRAKE DISCS/i.test(listText) && /no part number/.test(listText) && (await page.locator(`[data-pricing-open-line="req:${PR1}"]`).count()) === 1 && !(await sql("select parts_pricing_done_at from public.jobs where id = $1", [jobId]))[0]?.parts_pricing_done_at, listText);
    await shot(page, "a-open-list-1440");
    await page.setViewportSize({ width: 800, height: 1280 });
    await sleep(600);
    await shot(page, "a-open-list-800");
    await page.setViewportSize({ width: 1440, height: 900 });
    await sleep(400);
    await page.locator(`[data-pricing-go="req:${PR1}"]`).click();
    await sleep(700);
    const inDiscs = await page.evaluate((key) => !!document.activeElement?.closest(`[data-row-key="${key}"]`), `req:${PR1}`);
    check("A4: Go to takes the cursor into the unpriced row (outlined red)", inDiscs && (await page.locator(`[data-row-key="req:${PR1}"].border-red-bar`).count()) === 1);
    // Review of 3 November 2026: the list folds to one line and the row sits above the bar, never behind it.
    const inSight = await page.evaluate((key) => { const row = document.querySelector(`[data-row-key="${key}"]`)?.getBoundingClientRect(); const bar = document.querySelector("[data-pricing-bar]")?.getBoundingClientRect(); return !!row && !!bar && row.top >= 0 && row.bottom <= bar.top + 1; }, `req:${PR1}`);
    check("A4b: after Go to the list folds to one line and the row is in sight above the bar", inSight && (await page.locator("[data-pricing-open-list]").count()) === 0 && (await page.locator("[data-pricing-jump-strip]").count()) === 1);
    await page.keyboard.press("Escape");
    const discs = page.locator(`[data-row-key="req:${PR1}"]`);
    await priceRow(discs, { pn: "E2E-DISC-S10", net: "400", avail: "Next day" });
    check("A5: every part priced: '2 of 2 priced'", !!(await until(async () => ((await progressOf(page)) === "2/2" ? 1 : null), 40, 500)), await progressOf(page));
    check("A6: the advisor heard NOTHING per part while Parts priced", (await advisorNotes(adv.id, "type = 'parts_priced' and job_id = $2", jobId)) === saidBefore);
    // Priced but not sent: on the parts desk's list and in Parts' Waiting on you, with "Send to advisor".
    await until(async () => ((await sql("select count(*)::int as n from public.part_items where job_id = $1 and is_active and order_status = 'none' and priced_at is null", [jobId]))[0]?.n === 0 && (await sql("select count(*)::int as n from public.part_requests where job_id = $1 and is_active and status = 'open'", [jobId]))[0]?.n === 0 ? 1 : null), 40, 500);
    const { browser: b2, page: p2 } = await browserFor("parts", { viewport: { width: 1440, height: 900 } });
    await go(p2, `${base}/parts`);
    check("A7: the parts desk lists the car under 'Priced – send to the advisor'", (await p2.locator(`[data-to-send-car="${jobId}"]`).count()) === 1 && (await p2.locator(`[data-to-price-car="${jobId}"]`).count()) === 0);
    await shot(p2, "a-parts-desk-to-send-1440", p2.locator("[data-to-send-section]"));
    const w1 = await waitingRow(p2, jobId);
    check("A8: Parts' Waiting on you says 'all parts priced – send to the advisor'", /all parts priced – send to the advisor/.test(w1), w1);
    // The send: ONE notification, the answer in the bar.
    await page.locator("[data-pricing-done]").click();
    const done = await until(async () => (await sql("select parts_pricing_done_at from public.jobs where id = $1", [jobId]))[0]?.parts_pricing_done_at ? 1 : null, 40, 500);
    check("A9: sent: the job records it", !!done);
    const n1 = await until(async () => { const r = await sql("select title, body from public.notifications where staff_id = $1 and type = 'parts_priced' and job_id = $2 order by id desc", [adv.id, jobId]); return r.length > saidBefore ? r : null; }, 30, 500);
    check(`A10: the advisor gets ONE notification: 'All parts priced on ${jobNumber}'`, !!n1 && n1.length === saidBefore + 1 && n1[0].title === `All parts priced on ${jobNumber}` && /2 of 2 parts priced by /.test(n1[0].body ?? ""), JSON.stringify(n1?.[0]));
    const sentWords = await until(async () => ((await page.locator("[data-pricing-sent]").count()) ? flat(await page.locator("[data-pricing-sent]").textContent()) : null), 30, 500);
    check("A11: the answer shows in the bar: 'All parts priced on J-… – sent to …', green, locked, with Edit", /All parts priced on J-\d+ – sent to /.test(sentWords ?? "") && (await page.locator("[data-pricing-locked]").count()) === 1 && (await page.locator("[data-pricing-edit]").count()) === 1, sentWords ?? "");
    await shot(page, "a-sent-1440");
    await go(p2, `${base}/parts`);
    check("A12: the car left the parts desk's to-do list", (await p2.locator(`[data-to-send-car="${jobId}"]`).count()) === 0 && (await p2.locator(`[data-to-price-car="${jobId}"]`).count()) === 0);
    const w2 = await waitingRow(p2, jobId);
    check("A13: and Parts' Waiting on you", !/send to the advisor/.test(w2), w2);
    // Edit, a quantity changed: told only with "Send updated prices", the change folded in.
    await sleep(5200); // the form's one-tap lock
    await page.locator("[data-pricing-edit]").click();
    await until(async () => ((await page.locator("[data-pricing-editing]").count()) ? 1 : null), 30, 500);
    await typeInto(discs.locator("[data-part-qty]"), "4");
    await until(async () => { const r = (await sql("select confirmed_quantity::float8 as q from public.part_items where part_request_id = $1 and is_active", [PR1]))[0]; return r?.q === 4 ? 1 : null; }, 40, 500);
    check("A14: a quantity changed while editing does not tell the advisor on its own", (await advisorNotes(adv.id, "type = 'parts_priced' and job_id = $2", jobId)) === saidBefore + 1);
    check("A15: the bar now offers 'Send updated prices'", /Send updated prices/.test(flat(await page.locator("[data-pricing-done]").textContent())));
    await sleep(1500);
    await page.locator("[data-pricing-done]").click();
    const n2 = await until(async () => { const r = await sql("select title, body from public.notifications where staff_id = $1 and type = 'parts_priced' and job_id = $2 order by id desc", [adv.id, jobId]); return r.length > saidBefore + 1 ? r : null; }, 40, 500);
    check(`A16: ONE 'Prices updated on ${jobNumber}' with the change folded in ('Technician asked 2, Parts changed to 4')`, !!n2 && n2.length === saidBefore + 2 && n2[0].title === `Prices updated on ${jobNumber}` && /Changes: .*asked 2, Parts changed to 4/i.test(n2[0].body ?? ""), JSON.stringify(n2?.[0]));
    // A new part request after the send opens the pricing again: back on the list.
    const r = await api("/api/quote/save", { quotationId, opId: crypto.randomUUID(), requestPart: { description: "E2e wear sensor S10", quantity: 1 } }, await cookieHeader(adv.id));
    const reopened = await until(async () => (await sql("select parts_pricing_reopened_at from public.jobs where id = $1", [jobId]))[0]?.parts_pricing_reopened_at ? 1 : null, 30, 500);
    check("A17: a part asked after the send reopens the pricing (Send updated prices) and puts the car back on the list", r.status === 200 && !!reopened);
    await go(p2, `${base}/parts`);
    check("A18: the car is on the parts desk's 'To price' again", (await p2.locator(`[data-to-price-car="${jobId}"]`).count()) === 1);
    await b2.close();
    await browser.close();
  });

  /* ---------------- B. An estimate: the same bar, Send what you have, back on the list ---------------- */
  await section("B estimate", async () => {
    cleanupDb();
    await ensureSupplier();
    const seed = (await api("/api/e2e/stage", { stage: "quote" })).json;
    const job = (await sql("select customer_id, vehicle_id, gated_in_by from public.jobs where id = $1", [seed.jobId]))[0];
    await sql("insert into public.quotations (id, kind, number, version, customer_id, vehicle_id, status, token, created_by, updated_by) values ($1, 'estimate', 'E-E2E-S10', 1, $2, $3, 'draft', md5(random()::text), $4, $4) on conflict (id) do nothing", [EST, job.customer_id, job.vehicle_id, job.gated_in_by]);
    await sql("insert into public.quotation_lines (id, quotation_id, position, line_type, title, source_type, quantity, markup_percent, created_by, updated_by) values ($1, $4, 1, 'part', 'ENGINE OIL - ROLLS ROYCE GENUINE', 'manual', 7, 30, $5, $5), ($2, $4, 2, 'part', 'SET OIL-FILTER ELEMENT', 'manual', 1, 30, $5, $5), ($3, $4, 3, 'part', 'DRAIN PLUG', 'manual', 1, 30, $5, $5) on conflict (id) do nothing", [L1, L2, L3, EST, job.gated_in_by]);
    const advCookie = await cookieHeader(job.gated_in_by);
    const sent = await api("/api/quote/save", { quotationId: EST, sendToDesk: { ids: [L1, L2, L3] } }, advCookie);
    check("B0: the advisor sends three parts to the desk", sent.status === 200 && sent.json?.sent === 3, JSON.stringify(sent.json));
    const { browser, page } = await browserFor("parts", { viewport: { width: 1440, height: 900 } });
    await go(page, `${base}/parts`);
    check("B1: the estimate is on the parts desk's list", (await page.locator(`[data-estimate-to-price="E-E2E-S10"]`).count()) === 1);
    await go(page, `${base}/parts/estimate/${EST}`);
    await until(async () => ((await page.locator("[data-pricing-bar]").count()) ? 1 : null), 30, 500);
    check("B2: the same bar on the estimate: '0 of 3 priced'", (await progressOf(page)) === "0/3", await progressOf(page));
    await priceRow(page.locator(`[data-row-key="${L1}"]`), { pn: "E2E-OIL-S10", net: "165" });
    await priceRow(page.locator(`[data-row-key="${L2}"]`), { pn: "E2E-FILTER-S10", net: "53" });
    check("B3: two priced: '2 of 3 priced'", !!(await until(async () => ((await progressOf(page)) === "2/3" ? 1 : null), 40, 500)), await progressOf(page));
    check("B4: the advisor heard nothing per line", (await advisorNotes(job.gated_in_by, "type = 'estimate_parts_priced' and href like $2", `%${EST}%`)) === 0);
    await page.locator("[data-pricing-done]").click();
    await sleep(400);
    const listText = flat(await page.locator("[data-pricing-open-list]").textContent().catch(() => ""));
    check("B5: the drain plug is listed instead of sending", /1 part not priced yet/.test(listText) && /DRAIN PLUG/.test(listText), listText);
    await shot(page, "b-estimate-open-list-1440");
    // An old tab of the same estimate, opened before the send (it still shows the button).
    const oldTab = await page.context().newPage();
    await go(oldTab, `${base}/parts/estimate/${EST}`);
    await until(async () => ((await oldTab.locator("[data-pricing-bar]").count()) ? 1 : null), 30, 500);
    await page.locator("[data-pricing-send-anyway]").click();
    const n1 = await until(async () => { const r = await sql("select title, body from public.notifications where staff_id = $1 and type = 'estimate_parts_priced' and href like $2 order by id desc", [job.gated_in_by, `%${EST}%`]); return r.length ? r : null; }, 40, 500);
    check("B6: ONE notification 'Parts priced on E-E2E-S10: 2 of 3', naming the plug", !!n1 && n1.length === 1 && n1[0].title === "Parts priced on E-E2E-S10: 2 of 3" && /Not priced yet: DRAIN PLUG/.test(n1[0].body ?? ""), JSON.stringify(n1));
    const stamp = (await sql("select parts_priced_at from public.quotations where id = $1", [EST]))[0];
    check("B7: the estimate keeps the send", !!stamp?.parts_priced_at);
    await until(async () => ((await page.locator("[data-pricing-locked]").count()) ? 1 : null), 30, 500);
    await shot(page, "b-estimate-sent-1440");
    check("B7b: the answer shows in the bar next to the button", /Parts priced on E-E2E-S10: 2 of 3 – sent to /.test(flat(await page.locator("[data-pricing-sent]").textContent().catch(() => ""))));
    // The old tab presses the button again: nothing more goes to the advisor, and it says so next to the button.
    await oldTab.locator("[data-pricing-done]").click();
    await sleep(400);
    if (await oldTab.locator("[data-pricing-send-anyway]").count()) await oldTab.locator("[data-pricing-send-anyway]").click();
    const again = await until(async () => ((await oldTab.locator("[data-pricing-sent]").count()) ? flat(await oldTab.locator("[data-pricing-sent]").textContent()) : null), 30, 500);
    const stillOne = await sql("select count(*)::int as n from public.notifications where staff_id = $1 and type = 'estimate_parts_priced' and href like $2", [job.gated_in_by, `%${EST}%`]);
    check("B7c: a second send with nothing changed sends nothing more ('Already sent … Nothing changed since.')", /Already sent to the advisor/.test(again ?? "") && stillOne[0]?.n === 1, `${again} · ${JSON.stringify(stillOne)}`);
    await oldTab.close();
    await go(page, `${base}/parts`);
    // Review of 3 November 2026: the bar promised "the rest stay on your To price list" - they do.
    check("B8: the drain plug left open keeps the estimate on the parts desk's list ('1 part to price')", (await page.locator(`[data-estimate-to-price="E-E2E-S10"]`).count()) === 1 && /1 part to price/.test(flat(await page.locator(`[data-estimate-to-price="E-E2E-S10"]`).textContent().catch(() => ""))));
    // The advisor sends another part: back on the list.
    await sql("insert into public.quotation_lines (id, quotation_id, position, line_type, title, source_type, quantity, markup_percent, created_by, updated_by) values ($1, $2, 4, 'part', 'PLUG WASHER', 'manual', 1, 30, $3, $3) on conflict (id) do nothing", [L4, EST, job.gated_in_by]);
    await sleep(1100);
    await api("/api/quote/save", { quotationId: EST, sendToDesk: { ids: [L4] } }, advCookie);
    await go(page, `${base}/parts`);
    check("B9: a part sent after it joins the list ('2 parts to price')", (await page.locator(`[data-estimate-to-price="E-E2E-S10"]`).count()) === 1 && /2 parts to price/.test(flat(await page.locator(`[data-estimate-to-price="E-E2E-S10"]`).textContent().catch(() => ""))));
    await go(page, `${base}/parts/estimate/${EST}`);
    await until(async () => ((await page.locator("[data-pricing-bar]").count()) ? 1 : null), 30, 500);
    await priceRow(page.locator(`[data-row-key="${L3}"]`), { pn: "E2E-PLUG-S10", net: "26.88" });
    await priceRow(page.locator(`[data-row-key="${L4}"]`), { pn: "E2E-WASHER-S10", net: "6" });
    check("B10: all four priced and the bar offers 'Send updated prices'", !!(await until(async () => ((await progressOf(page)) === "4/4" ? 1 : null), 40, 500)) && /Send updated prices/.test(flat(await page.locator("[data-pricing-done]").textContent())), `${await progressOf(page)} · ${flat(await page.locator("[data-pricing-done]").textContent().catch(() => ""))}`);
    await page.locator("[data-pricing-done]").click();
    const n2 = await until(async () => { const r = await sql("select title from public.notifications where staff_id = $1 and type = 'estimate_parts_priced' and href like $2 order by id desc", [job.gated_in_by, `%${EST}%`]); return r.length > 1 ? r : null; }, 40, 500);
    check("B11: ONE more: 'Prices updated on E-E2E-S10'", !!n2 && n2.length === 2 && n2[0].title === "Prices updated on E-E2E-S10", JSON.stringify(n2));
    await go(page, `${base}/parts`);
    check("B12: and the estimate is off the list again", (await page.locator(`[data-estimate-to-price="E-E2E-S10"]`).count()) === 0);
    await browser.close();
  });
  /* ---------------- C. "Price is right ✓" makes the advisor's own price a priced line (review of 3 November 2026) ---------------- */
  await section("C price is right", async () => {
    cleanupDb();
    await ensureSupplier();
    const seed = (await api("/api/e2e/stage", { stage: "quote" })).json;
    const job = (await sql("select customer_id, vehicle_id, gated_in_by from public.jobs where id = $1", [seed.jobId]))[0];
    await sql("insert into public.quotations (id, kind, number, version, customer_id, vehicle_id, status, token, created_by, updated_by) values ($1, 'estimate', 'E-E2E-S10', 1, $2, $3, 'draft', md5(random()::text), $4, $4) on conflict (id) do nothing", [EST, job.customer_id, job.vehicle_id, job.gated_in_by]);
    await sql("insert into public.quotation_lines (id, quotation_id, position, line_type, title, source_type, quantity, markup_percent, created_by, updated_by) values ($1, $2, 1, 'part', 'OIL FILTER', 'manual', 1, 30, $3, $3) on conflict (id) do nothing", [L1, EST, job.gated_in_by]);
    const advCookie = await cookieHeader(job.gated_in_by);
    const priced = await api("/api/quote/save", { quotationId: EST, advisorPrice: { id: L1, cost: 80, supplier: SUP } }, advCookie);
    check("C0: the advisor types his own price (cost and supplier)", priced.status === 200, JSON.stringify(priced.json));
    const { browser, page } = await browserFor("parts", { viewport: { width: 1440, height: 900 } });
    await go(page, `${base}/parts/estimate/${EST}`);
    await until(async () => ((await page.locator("[data-pricing-bar]").count()) ? 1 : null), 30, 500);
    check("C1: before the check the line is open: '0 of 1 priced'", (await progressOf(page)) === "0/1", await progressOf(page));
    await page.locator("[data-desk-price-right]").click();
    check("C2: after 'Price is right ✓' the bar says '1 of 1 priced' at once (no part number, type or availability asked)", !!(await until(async () => ((await progressOf(page)) === "1/1" ? 1 : null), 30, 400)), await progressOf(page));
    await sleep(1500);
    const lastId = (await sql("select coalesce(max(id), 0)::bigint::text as id from public.notifications"))[0]?.id ?? "0";
    await page.locator("[data-pricing-done]").click();
    const n = await until(async () => { const r = await sql("select title from public.notifications where staff_id = $1 and type = 'estimate_parts_priced' and href like $2 and id > $3::bigint order by id desc", [job.gated_in_by, `%${EST}%`, lastId]); return r.length ? r : null; }, 40, 500);
    check("C3: the send says 'All parts priced on E-E2E-S10' (never 'Not priced yet' for a checked price)", !!n && n[0].title === "All parts priced on E-E2E-S10", JSON.stringify(n));
    await browser.close();
  });

  /* ---------------- D. A car past approval, never sent: a new part opens the pricing (review of 3 November 2026) ---------------- */
  await section("D past approval", async () => {
    cleanupDb();
    const seed = (await api("/api/e2e/stage", { stage: "quote" })).json;
    const { jobId, quotationId } = seed;
    const adv = (await sql("select gated_in_by as id from public.jobs where id = $1", [jobId]))[0];
    // The car is in work and Parts never pressed the button (every car approved before section 10 is like this).
    await sql("update public.part_requests set status = 'rejected', removed_at = now(), removed_reason = 'E2e' where job_id = $1 and status = 'open'", [jobId]);
    await sql("update public.jobs set status = 'in_work', stage = 'work', parts_pricing_done_at = null, parts_pricing_reopened_at = null where id = $1", [jobId]);
    const r = await api("/api/quote/save", { quotationId, opId: crypto.randomUUID(), requestPart: { description: "E2e wiper blade S10", quantity: 1 } }, await cookieHeader(adv.id));
    const reopened = await until(async () => (await sql("select parts_pricing_reopened_at from public.jobs where id = $1", [jobId]))[0]?.parts_pricing_reopened_at ? 1 : null, 30, 500);
    check("D1: a part asked on an in-work car never sent opens the pricing", r.status === 200 && !!reopened);
    const { browser, page } = await browserFor("parts", { viewport: { width: 1440, height: 900 } });
    await go(page, `${base}/parts`);
    check("D2: the car is on the parts desk's 'To price'", (await page.locator(`[data-to-price-car="${jobId}"]`).count()) === 1);
    await go(page, `${base}/parts/${jobId}`);
    await until(async () => ((await page.locator("[data-pricing-bar]").count()) ? 1 : null), 30, 500);
    check("D3: its bar asks for 'Pricing done – send to advisor' (never sent before, so not 'Send updated prices')", /Pricing done – send to advisor/.test(flat(await page.locator("[data-pricing-done]").textContent().catch(() => ""))), flat(await page.locator("[data-pricing-bar]").textContent().catch(() => "")));
    await browser.close();
  });
} catch (e) {
  check("walked without a crash", false, (e?.message ?? String(e)).slice(0, 300));
} finally {
  await finish();
}
process.exit(summary() ? 1 : 0);
