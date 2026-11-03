// Section 2 of 2 November 2026: placeholder costs (Q-00039's FRONT LH GRILL SURROUND MOULDING at AED 1.00 from "OFJ
// Additional", sold at 871.00 = "87,000%"), proved through the screens on the TEST server.
//   A. The Parts table: a cost under AED 5 asks "Is this the real price?" on the row's status line; the row is not
//      finished (never on the quotation) until "Yes, real price"; the answer is kept for that cost, a new cost asks again.
//   B. A stand-in supplier ("OFJ Additional") is "Not a supplier"; a typed line number or "OFJ" is refused in words.
//   C. 2.2 the LPO gate: Send LPO for approval refuses a part with no real price (naming it), and an LPO raised before
//      the rule (LPO-00038) cannot be approved; 2.4 "Prices to fix (n)" lists it on /parts and in Parts' Waiting on you.
//   D. 2.3 From our stock: the picker adds a stock item with its cost each; the row takes the stock cost (never typed);
//      the customer's approval writes the "out" movement and the part's cost is the stock average.
//   E. The quotation: a markup over 500% is amber on the line and asks once before sending (Send anyway: logged, the
//      owner told); a stand-in supplier stops the send.
//   F. Estimates: the advisor's "I have a price" and the parts desk ask the same question; a stand-in supplier is refused.
//   G. 2.5 part numbers: a stored line number reads NO NUMBER on the row and never prints on the parts check PDF.
//   H. History: a cheap part bought before at a similar price is not asked; a cost far under the last price paid is red.
// Review fixes of 3 November 2026:
//   I. An approved part not ordered yet answers its cost question on the locked row; the LPO then goes.
//   J. Correct the cost… for a part already received (from our stock) or ordered (a real supplier; the LPO re-addressed).
//   K. A stock cost typed in the picker is asked like any typed cost; a delivered one is not; the picker says when a typed
//      cost was not used, and an item with no cost takes the typed one; fewer on the shelf than needed is amber.
//   L. A replacement priced From our stock is received from the shelf at once (never To order, never blocking an LPO).
//   M. An Our-stock row priced before the rule (no stock item) stays priced and is listed in Prices to fix.
//   ONLY=A,C,... runs those sections only.
// Run: npm run test:s2-costs   (test server on :3102, or E2E_BASE=http://localhost:3101 for the dev test server)
import path from "node:path";
import fs from "node:fs";
import { api, base, browserFor, cleanupDb, confirmMoney, cookieHeader, go, here, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const SHOTS = path.join(here, "shots", "s2-costs");
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page, name, loc) => (loc ? loc.screenshot({ path: path.join(SHOTS, `${name}.png`) }) : page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false })).catch((e) => console.log("shot", name, String(e).slice(0, 120)));
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const typeInto = async (loc, text) => { await loc.click({ clickCount: 3 }); await loc.press("Backspace"); if (text) await loc.pressSequentially(text); await loc.press("Tab"); };
const supplierOption = async (sel, name) => sel.locator("option").evaluateAll((os, n) => (os.find((o) => (o.textContent ?? "").toLowerCase().startsWith(n.toLowerCase())) ?? {}).value ?? "", name);
const section = async (name, fn) => { if (process.env.ONLY && !process.env.ONLY.split(",").includes(name[0])) return; console.log(`\n--- ${name}`); try { await fn(); } catch (e) { check(`${name}: ran to the end`, false, String(e?.stack ?? e).slice(0, 400)); } };
const owner = (await sql("select id, display_name from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0];
const advisor = (await sql("select id, display_name from public.staff where role_id = 'service_advisor' and is_active order by created_at limit 1"))[0];
const ready = (await sql("select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'part_items' and column_name = 'cost_confirmed_aed'"))[0]?.n === 1;
check("0: the TEST database has the confirmation columns (migration 20261203100000)", ready);
const REAL = "E2e Abu Dhabi S2";
const ensureSupplier = async (name) => { await sql("insert into public.suppliers (name, default_discount_percent, discount_by_type, created_by) select $1, 0, '{}'::jsonb, $2 where not exists (select 1 from public.suppliers where name ilike $1)", [name, owner.id]); await sql("update public.suppliers set is_active = true where name ilike $1", [name]); };
const ofjExists = (await sql("select count(*)::int as n from public.suppliers where name ilike 'ofj additional' and is_active"))[0]?.n > 0;
if (!ofjExists) await ensureSupplier("OFJ Additional");
const seed = async (stage) => { cleanupDb(); await ensureSupplier(REAL); return (await api("/api/e2e/stage", { stage })).json; };
const partRow = (page, re) => page.locator("[data-row-key]").filter({ hasText: re }).first();
const priceRow = async (row, { pn, net, supplier, avail = "In stock" }) => {
  if (pn !== undefined) await typeInto(row.locator("input[aria-label='Part number']"), pn);
  await row.locator("select[aria-label='Type']").selectOption("genuine");
  if (supplier) { const sel = row.locator("select[aria-label='Supplier']"); await sel.selectOption(await supplierOption(sel, supplier)); await sleep(400); }
  await typeInto(row.locator("input[aria-label='Cost before VAT']"), net);
  await row.locator("select[aria-label='Availability']").selectOption({ label: avail });
};
const partOf = async (id) => (await sql("select cost_aed::float8 as cost, cost_confirmed_aed::float8 as confirmed, supplier, part_number, availability, stock_item_id, final_cost_aed::float8 as final, order_status from public.part_items where id = $1", [id]))[0];

/* ---------------- A. The Parts table: the cheap cost question ---------------- */
await section("A cheap cost", async () => {
  const s = await seed("quote");
  const { browser, page } = await browserFor("parts", { viewport: { width: 1600, height: 1000 } });
  await go(page, `${base}/parts/${s.jobId}`);
  const row = partRow(page, /rear brake discs/i);
  await until(async () => ((await row.count()) ? 1 : null), 30, 500);
  await priceRow(row, { pn: "E2E-PLUG-WASHER-1", net: "2.24", supplier: REAL });
  const part = await until(async () => (await sql("select id from public.part_items where job_id = $1 and part_request_id = $2 and is_active and cost_aed = 2.24 and availability = 'in_stock' and supplier is not null", [s.jobId, "22222222-0000-4000-8000-00000000e309"]))[0] ?? (await sql("select id from public.part_items where job_id = $1 and description ilike 'rear brake discs' and is_active and cost_aed = 2.24 and availability = 'in_stock'", [s.jobId]))[0], 40, 500);
  check("A1: the row saved AED 2.24 from a real supplier", !!part, JSON.stringify(part));
  const ask = row.locator("[data-cost-ask]");
  const shown = await until(async () => ((await ask.count()) ? 1 : null), 30, 400);
  check("A1: the status line asks 'AED 2.24 – is this the real price?' with Yes, real price", !!shown && /AED 2\.24 – is this the real price\?/.test((await ask.textContent()) ?? "") && (await ask.getAttribute("data-cost-ask-hold")) === "1" && (await row.locator("[data-cost-confirm]").count()) === 1, (await ask.textContent().catch(() => "")) ?? "");
  check("A1: the row is not finished (amber, not priced)", (await row.getAttribute("data-row-state")) === "not_finished");
  check("A1: and it is NOT on the quotation yet", (await sql("select count(*)::int as n from public.quotation_lines where part_item_id = $1 and is_active", [part?.id]))[0]?.n === 0);
  await row.scrollIntoViewIfNeeded();
  await shot(page, "a1-cost-question-1600", row);
  await page.setViewportSize({ width: 800, height: 1280 });
  await sleep(600);
  await row.scrollIntoViewIfNeeded();
  await shot(page, "a1-cost-question-800", row);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await sleep(400);
  await row.locator("[data-cost-confirm]").click();
  const confirmed = await until(async () => { const p = await partOf(part.id); return p?.confirmed === 2.24 ? p : null; }, 30, 500);
  check("A2: Yes, real price keeps the answer for AED 2.24", !!confirmed, JSON.stringify(await partOf(part.id)));
  const ev = await until(async () => (await sql("select note from public.job_events where job_id = $1 and event_type = 'part_cost_confirmed' order by created_at desc limit 1", [s.jobId]))[0], 20, 500);
  check("A2: logged: '<name> confirmed AED 2.24 is the real price of REAR BRAKE DISCS (E2E-PLUG-WASHER-1)'", /confirmed AED 2\.24 is the real price of REAR BRAKE DISCS \(E2E-PLUG-WASHER-1\) from E2e Abu Dhabi S2/i.test(ev?.note ?? ""), ev?.note ?? "");
  const priced = await until(async () => ((await row.getAttribute("data-row-state")) === "priced" ? 1 : null), 30, 400);
  check("A2: the row is priced and the question is gone", !!priced && (await row.locator("[data-cost-ask]").count()) === 0);
  const onQuote = await until(async () => ((await sql("select count(*)::int as n from public.quotation_lines where part_item_id = $1 and is_active", [part.id]))[0]?.n > 0 ? 1 : null), 30, 500);
  check("A2: now it joins the quotation", !!onQuote);
  await shot(page, "a2-confirmed-1600", row);
  await typeInto(row.locator("input[aria-label='Cost before VAT']"), "2.5");
  const again = await until(async () => ((await row.locator("[data-cost-ask]").count()) && /AED 2\.50 – is this the real price\?/.test((await row.locator("[data-cost-ask]").textContent()) ?? "") ? 1 : null), 30, 400);
  check("A3: a different cost (2.50) asks again", !!again);
  await browser.close();
});

/* ---------------- B. Stand-ins: "OFJ Additional", line numbers and "OFJ" as part numbers ---------------- */
await section("B stand-ins", async () => {
  const s = await seed("quote");
  const { browser, page } = await browserFor("parts", { viewport: { width: 1600, height: 1000 } });
  await go(page, `${base}/parts/${s.jobId}`);
  const row = partRow(page, /front brake pads/i);
  await until(async () => ((await row.count()) ? 1 : null), 30, 500);
  await priceRow(row, { pn: "E2E-GRILL-S2", net: "1", supplier: REAL, avail: "Next day" });
  await until(async () => { const p = await partOf("22222222-0000-4000-8000-00000000e306"); return p?.cost === 1 && p.part_number === "E2E-GRILL-S2" ? p : null; }, 40, 500);
  check("B1: 'OFJ Additional' is never offered as a supplier choice", !(await row.locator("select[aria-label='Supplier'] option").evaluateAll((os) => os.some((o) => o.value !== "__text" && /ofj additional/i.test(o.textContent ?? "")))));
  // A part priced before the rule with the stand-in supplier (J-00016's 31 lines).
  await sql("update public.part_items set supplier = 'OFJ Additional' where id = $1", ["22222222-0000-4000-8000-00000000e306"]);
  await go(page, `${base}/parts/${s.jobId}`);
  const saved = await until(async () => { const p = await partOf("22222222-0000-4000-8000-00000000e306"); return p?.supplier?.toLowerCase() === "ofj additional" && p.cost === 1 ? p : null; }, 40, 500);
  check("B1: a part with OFJ Additional at AED 1.00", !!saved, JSON.stringify(await partOf("22222222-0000-4000-8000-00000000e306")));
  await sleep(800);
  const tag = (await row.locator("[data-row-tag]").textContent()) ?? "";
  check("B1: the row says OFJ Additional is not a supplier, and is not finished", /"OFJ Additional" is not a supplier: pick the real supplier, or From our stock/.test(tag) && (await row.getAttribute("data-row-state")) === "not_finished", tag);
  check("B1: and asks about AED 1.00", /AED 1\.00 – is this the real price\?/.test((await row.locator("[data-cost-ask]").textContent().catch(() => "")) ?? ""));
  await row.scrollIntoViewIfNeeded();
  await shot(page, "b1-ofj-additional-1600", row);
  await typeInto(row.locator("input[aria-label='Part number']"), "12");
  const lineNo = await until(async () => (/looks like a line number/.test((await row.locator("[data-row-tag]").textContent()) ?? "") ? 1 : null), 30, 400);
  check("B2: a typed line number (12) is refused in words", !!lineNo, (await row.locator("[data-row-tag]").textContent()) ?? "");
  await typeInto(row.locator("input[aria-label='Part number']"), "OFJ1");
  const ofjNo = await until(async () => (/"OFJ1" is not a part number/.test((await row.locator("[data-row-tag]").textContent()) ?? "") ? 1 : null), 30, 400);
  check("B2: 'OFJ1' is refused in words (tap None when the supplier gives no number)", !!ofjNo, (await row.locator("[data-row-tag]").textContent()) ?? "");
  check("B2: the stored number stays the real one", (await partOf("22222222-0000-4000-8000-00000000e306"))?.part_number === "E2E-GRILL-S2");
  await shot(page, "b2-line-number-refused-1600", row);
  await browser.close();
});

/* ---------------- C. The LPO gate and "Prices to fix" ---------------- */
await section("C LPO gate", async () => {
  const s = await seed("approved");
  const PA = "22222222-0000-4000-8000-00000000e306";
  // The part was approved before the rule with a placeholder (the Q-00039 pattern): AED 1.00 from "OFJ Additional".
  await sql("update public.part_items set supplier = 'OFJ Additional', cost_aed = 1, list_price_aed = 1, part_number = 'E2E-GRILL-S2' where id = $1", [PA]);
  await sql("update public.part_requests set status = 'rejected', closed_reason = 'E2E not needed' where job_id = $1", [s.jobId]);
  const { browser, page } = await browserFor("parts", { viewport: { width: 1440, height: 900 } });
  await go(page, `${base}/parts/${s.jobId}`);
  await page.locator("[data-send-lpo]").click();
  if (await page.locator("[data-lpo-unfinished-send]").count()) await page.locator("[data-lpo-unfinished-send]").click();
  await page.waitForURL(/error=/, { timeout: 25000 }).catch(() => null);
  await sleep(1500);
  const err = decodeURIComponent((new URL(page.url()).searchParams.get("error") ?? "").replace(/\+/g, " "));
  check("C1: Send LPO for approval refuses it, naming the part and why", /1 part cannot go on an LPO yet: FRONT BRAKE PADS: "OFJ Additional" is not a supplier/.test(err), err);
  check("C1: no LPO was raised", (await sql("select count(*)::int as n from public.purchase_orders where job_id = $1", [s.jobId]))[0]?.n === 0);
  await shot(page, "c1-lpo-refused-1440");
  // 2.4: Prices to fix on /parts, and the line on Parts' Waiting on you.
  await go(page, `${base}/parts`);
  const card = page.locator("[data-prices-to-fix]");
  const listed = card.locator(`[data-price-to-fix="part:${PA}"]`);
  check("C2: 'Prices to fix' lists it with the job, the cost and the supplier", (await listed.count()) === 1 && /FRONT BRAKE PADS/.test((await listed.textContent()) ?? "") && /"OFJ Additional" is not a supplier/.test((await listed.textContent()) ?? "") && /cost AED 1\.00 · OFJ Additional/.test((await listed.textContent()) ?? ""), ((await listed.textContent().catch(() => "")) ?? "").replace(/\s+/g, " "));
  await card.scrollIntoViewIfNeeded();
  await shot(page, "c2-prices-to-fix-1440", card);
  await page.setViewportSize({ width: 800, height: 1280 });
  await sleep(600);
  await card.scrollIntoViewIfNeeded();
  await shot(page, "c2-prices-to-fix-800", card);
  await page.setViewportSize({ width: 1440, height: 900 });
  await go(page, `${base}/dashboard`);
  check("C2: Parts' Waiting on you has 'Prices to fix'", /Prices to fix: \d+ parts? with a placeholder price or supplier/.test((await page.locator("[data-waiting-panel]").textContent().catch(() => "")) ?? ""));
  await browser.close();
  // An LPO raised before the rule (LPO-00038): the approval refuses it, naming the line.
  const po = (await sql("insert into public.purchase_orders (job_id, kind, number, supplier_name, total_cost_aed, status, verify_token, created_by, updated_by) values ($1, 'main', 'LPO-E2E-S2', 'OFJ Additional', 1, 'pending_approval', md5(random()::text), $2, $2) returning id", [s.jobId, owner.id]))[0];
  const line = (await sql("insert into public.purchase_order_lines (po_id, part_item_id, position, description, part_number, quantity, unit_cost, created_by, updated_by) values ($1, $2, 1, 'front brake pads', '12', 1, 1, $3, $3) returning id", [po.id, PA, owner.id]))[0];
  await sql("update public.part_items set po_id = $1, po_line_id = $2 where id = $3", [po.id, line.id, PA]);
  const own = await browserFor("owner", { viewport: { width: 1440, height: 900 } });
  await go(own.page, `${base}/parts/orders/${po.id}`);
  check("C3: the LPO page never shows the line number 12 as a part number", !/\b12 · ordered|>12</.test(await own.page.content()) && !/· 12\b/.test((await own.page.locator("main").textContent()) ?? ""));
  // 3 November 2026 (review): the problem is where the approver is - on the line, beside Refuse, and inside the Approve
  // box, with Approve off - never only at the top of the page after a tap.
  const lineMark = own.page.locator(`[data-lpo-line-problem="${line.id}"]`);
  check("C3: the line itself says it has no real price ('OFJ Additional' is not a supplier)", (await lineMark.count()) === 1 && /Not a real price yet: "OFJ Additional" is not a supplier/.test((await lineMark.textContent()) ?? ""), (await lineMark.textContent().catch(() => "")) ?? "");
  const box = own.page.locator("[data-lpo-problems]");
  check("C3: the Approve box lists it and says what to do (refuse the line, Parts replace it)", (await box.count()) === 1 && /Approve is off: 1 line has no real price yet/.test((await box.textContent()) ?? "") && /FRONT BRAKE PADS: "OFJ Additional" is not a supplier/.test((await box.textContent()) ?? "") && /Refuse that line/.test((await box.textContent()) ?? ""), ((await box.textContent().catch(() => "")) ?? "").replace(/\s+/g, " "));
  check("C3: Approve is off until it is fixed", await own.page.locator("[data-confirm-open='lpo-approve']").first().isDisabled().catch(() => false));
  check("C3: it still waits, and no supplier LPO was made", (await sql("select status from public.purchase_orders where id = $1", [po.id]))[0]?.status === "pending_approval" && (await sql("select count(*)::int as n from public.purchase_orders where parent_id = $1", [po.id]))[0]?.n === 0);
  await box.scrollIntoViewIfNeeded();
  await shot(own.page, "c3-approval-box-1440");
  await own.page.setViewportSize({ width: 800, height: 1280 });
  await sleep(500);
  await box.scrollIntoViewIfNeeded();
  await shot(own.page, "c3-approval-box-800");
  await own.browser.close();
});

/* ---------------- D. From our stock ---------------- */
await section("D from our stock", async () => {
  const s = await seed("quote");
  const { browser, page } = await browserFor("parts", { viewport: { width: 1600, height: 1000 } });
  await go(page, `${base}/parts/${s.jobId}`);
  const row = partRow(page, /rear brake discs/i);
  await until(async () => ((await row.count()) ? 1 : null), 30, 500);
  await row.locator("select[aria-label='Type']").selectOption("genuine");
  await row.locator("select[aria-label='Supplier']").selectOption("__stock");
  const picker = page.locator("[data-stock-picker]");
  check("D1: 'From our stock…' opens the stock picker", !!(await until(async () => ((await picker.count()) ? 1 : null), 20, 300)));
  await shot(page, "d1-stock-picker-1600", picker);
  await picker.locator("[data-stock-add]").click();
  await typeInto(picker.locator("[data-stock-new-name]"), "E2E ENGINE OIL 0W20 S2");
  await typeInto(picker.locator("[data-stock-new-cost]"), "49");
  await typeInto(picker.locator("[data-stock-new-shelf]"), "10");
  await shot(page, "d1-stock-add-1600", picker);
  await picker.locator("[data-stock-new-save]").click();
  const item = await until(async () => { const r = (await sql("select id, quantity::float8 as qty, unit_cost::float8 as cost from public.stock_items where name ilike 'e2e engine oil 0w20 s2'"))[0]; return r && r.qty === 10 ? r : null; }, 30, 500) ?? (await sql("select id, quantity::float8 as qty, unit_cost::float8 as cost from public.stock_items where name ilike 'e2e engine oil 0w20 s2'"))[0];
  check("D2: the stock item is on the list with its cost each and what is on the shelf (10)", item?.cost === 49 && item?.qty === 10, JSON.stringify(item));
  const linked = await until(async () => (await sql("select id from public.part_items where job_id = $1 and stock_item_id = $2 and is_active", [s.jobId, item?.id]))[0], 40, 500);
  const p = linked ? await partOf(linked.id) : null;
  check("D2: the part takes the stock cost (49.00), Our stock, in stock, linked to the item", p?.cost === 49 && /our stock/i.test(p?.supplier ?? "") && p?.availability === "in_stock" && p?.stock_item_id === item?.id, JSON.stringify(p));
  const priced = await until(async () => ((await row.getAttribute("data-row-state")) === "priced" ? 1 : null), 30, 400);
  check("D2: the row is priced, the cost read-only, the stock item named on it", !!priced && (await row.locator("input[aria-label='Cost before VAT']").count()) === 0 && /From our stock: E2E ENGINE OIL 0W20 S2 · 10 pc on hand · AED 49\.00 average/.test((await row.locator("[data-stock-words]").textContent().catch(() => "")) ?? ""));
  await row.scrollIntoViewIfNeeded();
  await shot(page, "d2-stock-row-1600", row);
  await page.setViewportSize({ width: 800, height: 1280 });
  await sleep(600);
  await row.scrollIntoViewIfNeeded();
  await shot(page, "d2-stock-row-800", row);
  await browser.close();
  // The customer approves: the part leaves the shelf now, at the stock average.
  await until(async () => ((await sql("select count(*)::int as n from public.quotation_lines where part_item_id = $1 and is_active", [linked.id]))[0]?.n > 0 ? 1 : null), 30, 500);
  const q = (await sql("update public.quotations set status = 'sent', sent_at = now() where id = $1 returning token", [s.quotationId]))[0];
  await fetch(`${base}/api/quote/${q.token}`, { method: "POST", body: new URLSearchParams({ action: "approve", approver_name: "E2e Customer", agree: "on" }), redirect: "manual" });
  const out = await until(async () => (await sql("select quantity::float8 as qty, quantity_after::float8 as after from public.stock_movements where part_item_id = $1 and kind = 'out'", [linked.id]))[0], 40, 500);
  check("D3: approval writes the 'out' movement (2 off the shelf: 10 → 8)", out?.qty === -2 && out?.after === 8, JSON.stringify(out));
  const after = await partOf(linked.id);
  check("D3: the part is received from stock at the stock average (final cost 49.00)", after?.order_status === "received" && after?.final === 49, JSON.stringify(after));
  check("D3: it is never on an LPO", (await sql("select count(*)::int as n from public.purchase_order_lines where part_item_id = $1", [linked.id]))[0]?.n === 0);
});

/* ---------------- E. The quotation: markup over 500%, and a stand-in supplier stops the send ---------------- */
await section("E quotation", async () => {
  const s = await seed("quote");
  const PA = "22222222-0000-4000-8000-00000000e306";
  await sql("update public.part_requests set status = 'rejected', closed_reason = 'E2E not needed' where job_id = $1", [s.jobId]);
  await sql("update public.part_items set supplier = 'OFJ Additional', cost_aed = 1, part_number = 'E2E-GRILL-S2', availability = 'to_order', delivery_date = current_date + 1 where id = $1", [PA]);
  await sql("update public.quotation_lines set unit_cost = 1, markup_mode = 'aed', markup_aed = 870, markup_percent = null where part_item_id = $1 and quotation_id = $2", [PA, s.quotationId]);
  const { browser, page } = await browserFor("service_advisor", { viewport: { width: 1440, height: 900 } });
  await go(page, `${base}/jobs/${s.jobId}/quote/${s.quotationId}`);
  const high = page.locator("[data-markup-high]").first();
  check("E1: the line is amber: 'Markup 87,000% – is the cost real? (cost AED 1.00, OFJ Additional)'", /Markup 87,000% – is the cost real\? \(cost AED 1\.00, OFJ Additional\)/.test((await high.textContent().catch(() => "")) ?? ""), (await high.textContent().catch(() => "")) ?? "");
  check("E1: 'Before sending' stops it: OFJ Additional is not a supplier", /"OFJ Additional" is not a supplier – Parts to put the real supplier and price/.test((await page.locator("body").textContent()) ?? ""));
  await page.locator("[data-part-line]").first().scrollIntoViewIfNeeded();
  await shot(page, "e1-markup-high-1440", page.locator("[data-part-line]").first());
  await page.setViewportSize({ width: 800, height: 1280 });
  await sleep(600);
  await page.locator("[data-markup-high]").first().scrollIntoViewIfNeeded();
  await shot(page, "e1-markup-high-800");
  await page.setViewportSize({ width: 1440, height: 900 });
  // Parts put the real supplier and confirm the AED 1.00 (a real one-dirham part): only the markup question is left.
  await sql("update public.part_items set supplier = $2, cost_confirmed_aed = 1, cost_confirmed_at = now(), part_type = 'genuine' where id = $1", [PA, REAL]);
  await go(page, `${base}/jobs/${s.jobId}/quote/${s.quotationId}`);
  check("E2: with a real supplier and the price confirmed, nothing stops the send", !/is not a supplier – Parts|Parts to confirm the real price/.test((await page.locator("body").textContent()) ?? ""));
  await page.locator("button", { hasText: /^Quotation complete$/ }).click();
  const ask = page.locator("[data-high-markup-ask]");
  const asked = await until(async () => ((await ask.count()) ? 1 : null), 30, 400);
  check("E2: Quotation complete asks once: 'A part markup is over 500%: FRONT BRAKE PADS 87,000% – is the cost real?'", !!asked && /A part markup is over 500%: FRONT BRAKE PADS \(PAD-STAGE-1\) 87,000% – is the cost real\? \(cost AED 1\.00, E2e Abu Dhabi S2\)|A part markup is over 500%: .*87,000% – is the cost real\?/.test((await ask.textContent()) ?? ""), (await ask.textContent().catch(() => "")) ?? "");
  await shot(page, "e2-high-markup-ask-1440", ask.locator("div").first());
  check("E2: nothing completed before the answer", (await sql("select completed_at from public.quotations where id = $1", [s.quotationId]))[0]?.completed_at === null);
  await ask.locator("[data-high-markup-send]").click();
  const done = await until(async () => (await sql("select completed_at from public.quotations where id = $1", [s.quotationId]))[0]?.completed_at, 40, 500);
  check("E3: Send anyway completes it", !!done);
  const ev = (await sql("select note from public.quotation_events where quotation_id = $1 and event_type = 'high_markup_sent' order by created_at desc limit 1", [s.quotationId]))[0];
  check("E3: written on the quotation ('Send anyway')", /with a part markup over 500%: .*87,000% – is the cost real\?.*\(Send anyway\)/.test(ev?.note ?? ""), ev?.note ?? "");
  const bell = (await sql("select title, body from public.notifications where type = 'high_markup' and job_id = $1 order by created_at desc limit 1", [s.jobId]))[0];
  check("E3: the owner is told", /^Markup over 500% sent by /.test(bell?.title ?? "") && /Is the cost real\?/.test(bell?.body ?? ""), JSON.stringify(bell));
  await browser.close();
});

/* ---------------- F. Estimates: the advisor's own price and the parts desk ---------------- */
await section("F estimates", async () => {
  const s = await seed("quote");
  const job = (await sql("select customer_id, vehicle_id from public.jobs where id = $1", [s.jobId]))[0];
  const est = (await sql("insert into public.quotations (kind, number, version, customer_id, vehicle_id, status, token, created_by, updated_by) values ('estimate', 'E-E2E-S2', 1, $1, $2, 'draft', md5(random()::text), $3, $3) returning id", [job.customer_id, job.vehicle_id, advisor.id]))[0].id;
  const l1 = (await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, markup_percent, created_by, updated_by) values ($1, 1, 'part', 'E2E PLUG WASHER', 'manual', 1, 30, $2, $2) returning id", [est, advisor.id]))[0].id;
  const l2 = (await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, markup_percent, price_requested_at, price_requested_by, created_by, updated_by) values ($1, 2, 'part', 'E2E CABIN FILTER', 'manual', 1, 30, now(), $2, $2, $2) returning id", [est, advisor.id]))[0].id;
  const adv = await cookieHeader("service_advisor");
  const r1 = await api("/api/quote/save", { quotationId: est, advisorPrice: { id: l1, cost: 2.24, supplier: "ABU DHABI MOTORS L.L.C" } }, adv);
  check("F1: the advisor's 'I have a price' at AED 2.24 is asked (409, the same words)", r1.status === 409 && r1.json?.ask === "cost_check" && /AED 2\.24 – is this the real price\?/.test(r1.json?.error ?? ""), `${r1.status} ${JSON.stringify(r1.json)}`);
  check("F1: nothing saved before the answer", (await sql("select unit_cost from public.quotation_lines where id = $1", [l1]))[0]?.unit_cost === null);
  const r2 = await api("/api/quote/save", { quotationId: est, advisorPrice: { id: l1, cost: 2.24, supplier: "ABU DHABI MOTORS L.L.C", confirmCost: 2.24 } }, adv);
  const l1row = (await sql("select unit_cost::float8 as cost, cost_confirmed_aed::float8 as confirmed from public.quotation_lines where id = $1", [l1]))[0];
  check("F1: 'Yes, real price' saves it with the answer kept", r2.status === 200 && l1row?.cost === 2.24 && l1row?.confirmed === 2.24, `${r2.status} ${JSON.stringify(l1row)}`);
  const r3 = await api("/api/quote/save", { quotationId: est, advisorPrice: { id: l1, cost: 50, supplier: "OFJ Additional" } }, adv);
  check("F1: a stand-in supplier is refused in words", r3.status === 400 && /"OFJ Additional" is not a supplier/.test(r3.json?.error ?? ""), `${r3.status} ${r3.json?.error}`);
  // The parts desk prices the second part at AED 1.50 - on the shared Parts row (3 November 2026, section 9: the
  // estimate desk uses the same row as a job's parts, saving as it is typed).
  const { browser, page } = await browserFor("parts", { viewport: { width: 1440, height: 900 } });
  await go(page, `${base}/parts/estimate/${est}`);
  const card = page.locator(`[data-row-key="${l2}"]`);
  await until(async () => ((await card.count()) ? 1 : null), 30, 500);
  await typeInto(card.locator("input[aria-label='Part number']"), "12");
  const lineErr = await until(async () => (/looks like a line number/.test((await card.locator("[data-row-tag]").textContent()) ?? "") ? 1 : null), 30, 400);
  check("F2: the desk refuses a line number as the part number", !!lineErr, (await card.locator("[data-row-tag]").textContent()) ?? "");
  await typeInto(card.locator("input[aria-label='Part number']"), "E2E-CABIN-S2");
  await card.locator("select[aria-label='Type']").selectOption("genuine");
  const sup = card.locator("select[aria-label='Supplier']");
  await sup.selectOption(await supplierOption(sup, REAL));
  await sleep(400);
  await typeInto(card.locator("input[aria-label='Cost before VAT']"), "1.5");
  await card.locator("select[aria-label='Availability']").selectOption({ label: "In stock" });
  const deskAsk = card.locator("[data-cost-ask]");
  const deskShown = await until(async () => ((await deskAsk.count()) && /AED 1\.50 – is this the real price\?/.test((await deskAsk.textContent()) ?? "") ? 1 : null), 30, 400);
  check("F2: the desk is asked 'AED 1.50 – is this the real price?' on the row, and the row is not finished", !!deskShown && (await card.getAttribute("data-row-state")) === "not_finished", (await deskAsk.textContent().catch(() => "")) ?? "");
  await shot(page, "f2-desk-cost-ask-1440", card);
  await card.locator("[data-cost-confirm]").click();
  const l2row = await until(async () => { const r = (await sql("select unit_cost::float8 as cost, cost_confirmed_aed::float8 as confirmed, part_number, priced_at from public.quotation_lines where id = $1", [l2]))[0]; return r?.cost === 1.5 && r?.confirmed === 1.5 ? r : null; }, 30, 500);
  check("F2: Yes, real price saves AED 1.50 with the answer and the real part number (priced)", l2row?.confirmed === 1.5 && l2row?.part_number === "E2E-CABIN-S2" && !!l2row?.priced_at, JSON.stringify(l2row));
  // 3 November 2026 (review): the answer stands for this cost - saving the same price again (another availability) is not asked again.
  await go(page, `${base}/parts/estimate/${est}`);
  const card2 = page.locator(`[data-row-key="${l2}"]`);
  await until(async () => ((await card2.count()) ? 1 : null), 30, 500);
  await card2.locator("select[aria-label='Availability']").selectOption({ label: "Next day" });
  await page.keyboard.press("Tab");
  const resaved = await until(async () => { const r = (await sql("select availability, cost_confirmed_aed::float8 as confirmed from public.quotation_lines where id = $1", [l2]))[0]; return r?.availability === "to_order" ? r : null; }, 30, 500);
  check("F3: saving AED 1.50 again with another availability is not asked again (the stored answer stands)", !!resaved && resaved.confirmed === 1.5 && (await card2.locator("[data-cost-ask]").count()) === 0, JSON.stringify(resaved));
  // The advisor's own price: the same cost typed again is not asked again either.
  const r4 = await api("/api/quote/save", { quotationId: est, advisorPrice: { id: l1, cost: 2.24, supplier: "ABU DHABI MOTORS L.L.C" } }, adv);
  check("F3: the advisor's same AED 2.24 again is saved without the question", r4.status === 200, `${r4.status} ${JSON.stringify(r4.json)}`);
  await browser.close();
});

/* ---------------- G. Part numbers: a stored line number never prints ---------------- */
await section("G part numbers", async () => {
  const s = await seed("quote");
  const PA = "22222222-0000-4000-8000-00000000e306";
  await sql("update public.part_items set part_number = '987', supplier = $2 where id = $1", [PA, REAL]);
  const { browser, page } = await browserFor("parts", { viewport: { width: 1600, height: 1000 } });
  await go(page, `${base}/parts/${s.jobId}`);
  const row = partRow(page, /front brake pads/i);
  check("G1: the row shows NO NUMBER for a stored line number (what the database change writes)", (await row.locator("input[aria-label='Part number']").inputValue().catch(() => "")) === "NO NUMBER");
  await browser.close();
  const cookie = await cookieHeader("parts");
  const r = await fetch(`${base}/api/pdf/parts-check/${s.jobId}`, { headers: { cookie } });
  const mupdf = await import("mupdf");
  let text = "";
  if (r.status === 200) {
    const doc = mupdf.Document.openDocument(Buffer.from(await r.arrayBuffer()), "application/pdf");
    for (let i = 0; i < doc.countPages(); i++) text += doc.loadPage(i).toStructuredText().asText();
  }
  check("G2: the parts check PDF lists the part without the line number 987", r.status === 200 && /FRONT BRAKE PADS/i.test(text) && !/\b987\b/.test(text), `${r.status} ${text.slice(0, 160).replace(/\s+/g, " ")}`);
});

/* ---------------- H. History: bought before at a similar price is not asked; far under the last price is red ---------------- */
await section("H history", async () => {
  const s = await seed("quote");
  await sql("insert into public.stock_items (name, unit, quantity, minimum_level, unit_cost, part_number, item_type, created_by, updated_by) values ('E2E WASHER HISTORY S2', 'pc', 0, 0, 2.30, 'E2E-WASHER-77', 'part', $1, $1), ('E2E GRILL HISTORY S2', 'pc', 0, 0, 871, 'E2E-GRILL-HIST', 'part', $1, $1)", [owner.id]);
  // A stock cost teaches only when it came from a real purchase (3 November 2026): a part bought for a job and kept.
  await sql("insert into public.stock_movements (stock_item_id, kind, quantity, unit_cost, quantity_after, part_item_id, note, created_by, updated_by) select id, 'in', 1, unit_cost, 1, '22222222-0000-4000-8000-00000000e306', 'E2E delivered', $1, $1 from public.stock_items where name in ('E2E WASHER HISTORY S2', 'E2E GRILL HISTORY S2')", [owner.id]);
  // The purchase list is kept a minute per server: wait for it to read the two new purchases.
  await sleep(62000);
  const mem = await fetch(`${base}/api/parts/price-memory?pn=E2E-WASHER-77`, { headers: { cookie: await cookieHeader("parts") } }).then((x) => x.json()).catch(() => null);
  check("H0: the price memory knows what it was bought at (our stock list, AED 2.30)", mem?.paid?.cost === 2.3 && /our stock list/.test(mem?.paid?.where ?? ""), JSON.stringify(mem));
  const { browser, page } = await browserFor("parts", { viewport: { width: 1600, height: 1000 } });
  await go(page, `${base}/parts/${s.jobId}`);
  const row = partRow(page, /rear brake discs/i);
  await until(async () => ((await row.count()) ? 1 : null), 30, 500);
  await priceRow(row, { pn: "E2E-WASHER-77", net: "2.24", supplier: REAL });
  const saved = await until(async () => (await sql("select id from public.part_items where job_id = $1 and part_number = 'E2E-WASHER-77' and cost_aed = 2.24 and availability = 'in_stock'", [s.jobId]))[0], 40, 500);
  const pricedRow = await until(async () => ((await row.getAttribute("data-row-state")) === "priced" ? 1 : null), 30, 400);
  check("H1: bought before at AED 2.30 (within 20%): AED 2.24 is not asked, the row is priced", !!saved && !!pricedRow && (await row.locator("[data-cost-ask]").count()) === 0);
  const pads = partRow(page, /front brake pads/i);
  await priceRow(pads, { pn: "E2E-GRILL-HIST", net: "1", supplier: REAL, avail: "Next day" });
  const red = pads.locator("[data-cost-ask='far_below']");
  const isRed = await until(async () => ((await red.count()) ? 1 : null), 30, 400);
  check("H2: AED 1.00 against AED 871.00 bought before is red: 'Last bought at AED 871.00 (our stock list…): AED 1.00 is less than half'", !!isRed && /Last bought at AED 871\.00 \(our stock list[^)]*\): AED 1\.00 is less than half\. Is AED 1\.00 the real price\?/.test((await red.textContent()) ?? ""), (await red.textContent().catch(() => "")) ?? "");
  await pads.scrollIntoViewIfNeeded();
  await shot(page, "h2-far-below-1600", pads);
  await browser.close();
});

/* ------------- Review fixes of 3 November 2026 ------------- */
const PA = "22222222-0000-4000-8000-00000000e306";
const sendLpo = async (page) => {
  await page.locator("[data-send-lpo]").click();
  await sleep(600);
  if (await page.locator("[data-lpo-unfinished-send]").count()) await page.locator("[data-lpo-unfinished-send]").click();
  await page.waitForURL(/error=|message=/, { timeout: 25000 }).catch(() => null);
  await sleep(1200);
  return decodeURIComponent((new URL(page.url()).searchParams.get("error") ?? "").replace(/\+/g, " "));
};

/* I. An approved part not ordered yet: its cost question is answered on the locked row, and the LPO then goes. */
await section("I approved part answered", async () => {
  const s = await seed("approved");
  await sql("update public.part_requests set status = 'rejected', closed_reason = 'E2E not needed' where job_id = $1", [s.jobId]);
  await sql("update public.part_items set supplier = $2, cost_aed = 2.24, list_price_aed = null, discount_percent = null, part_number = 'E2E-WASHER-APPROVED', cost_confirmed_aed = null where id = $1", [PA, REAL]);
  check("I0: the part is approved and to order, on no LPO", (await partOf(PA))?.order_status === "to_order");
  const { browser, page } = await browserFor("parts", { viewport: { width: 1440, height: 900 } });
  await go(page, `${base}/parts/${s.jobId}`);
  const err = await sendLpo(page);
  check("I1: Send LPO refuses it with the question, and says to tap Yes, real price - never Remove: not needed", /1 part cannot go on an LPO yet: FRONT BRAKE PADS: AED 2\.24 – is this the real price\?/.test(err) && /Yes, real price/.test(err) && !/Remove: not needed/.test(err), err);
  await go(page, `${base}/parts/${s.jobId}`);
  const row = partRow(page, /front brake pads/i);
  const yes = row.locator("[data-cost-confirm-approved]");
  check("I2: the locked row offers Yes, real price ('Approved by the customer, not ordered yet'), never 'Ordered: correct it…'", (await yes.count()) === 1 && /Approved by the customer, not ordered yet/.test((await row.locator("[data-cost-ask]").textContent()) ?? "") && !/Ordered: correct it/.test((await row.textContent()) ?? ""));
  await row.scrollIntoViewIfNeeded();
  await shot(page, "i2-approved-yes-1440", row);
  await yes.click();
  const conf = await until(async () => ((await partOf(PA))?.confirmed === 2.24 ? 1 : null), 30, 500);
  check("I3: the answer alone is kept (cost 2.24 unchanged, still to order)", !!conf && (await partOf(PA))?.cost === 2.24 && (await partOf(PA))?.order_status === "to_order");
  const ev = (await sql("select note from public.job_events where job_id = $1 and event_type = 'part_cost_confirmed' order by created_at desc limit 1", [s.jobId]))[0];
  check("I3: logged '(already approved by the customer)'", /confirmed AED 2\.24 is the real price of FRONT BRAKE PADS .*already approved by the customer/.test(ev?.note ?? ""), ev?.note ?? "");
  await go(page, `${base}/parts/${s.jobId}`);
  const err2 = await sendLpo(page);
  const lpo = (await sql("select count(*)::int as n from public.purchase_orders where job_id = $1 and kind = 'main'", [s.jobId]))[0]?.n;
  check("I4: now Send LPO for approval raises the LPO", !err2 && lpo === 1, err2);
  await browser.close();
});

/* J. "Correct the cost…" for a part already received or ordered from "OFJ Additional" (J-00017, J-00609, J-00969). */
await section("J correct the cost", async () => {
  let s = await seed("approved");
  await sql("update public.part_requests set status = 'rejected', closed_reason = 'E2E not needed' where job_id = $1", [s.jobId]);
  await sql("update public.part_items set supplier = 'OFJ Additional', cost_aed = 1, part_number = 'E2E-DRAIN-S2', availability = 'in_stock', order_status = 'received', received_qty = 1, confirmed_quantity = 1 where id = $1", [PA]);
  const item = (await sql("insert into public.stock_items (name, unit, quantity, minimum_level, unit_cost, item_type, created_by, updated_by) values ('E2E DRAIN PLUG S2', 'pc', 5, 0, 12, 'part', $1, $1) returning id", [owner.id]))[0];
  const { browser, page } = await browserFor("parts", { viewport: { width: 1440, height: 900 } });
  await go(page, `${base}/parts/${s.jobId}`);
  const row = partRow(page, /front brake pads/i);
  const fix = row.locator("[data-settled-fix]");
  check("J1: a received part at AED 1.00 from OFJ Additional is red on its row, with Correct the cost…", (await fix.count()) === 1 && /AED 1\.00 is not a real price/.test((await fix.textContent()) ?? "") && (await row.locator("[data-correct-cost]").count()) === 1, (await fix.textContent().catch(() => "")) ?? "");
  check("J1: it is past pricing, so never 'not finished'", (await row.getAttribute("data-row-state")) === "priced");
  const jobCard = await fetch(`${base}/jobs/${s.jobId}`, { headers: { cookie: await cookieHeader("service_advisor") } }).then((r) => r.text());
  check("J1: and the job card never counts it as 'waiting for a price'", jobCard.length > 1000 && !/\d+ waiting for a price/.test(jobCard));
  await go(page, `${base}/parts`);
  const listed = page.locator(`[data-price-to-fix="part:${PA}"]`);
  check("J1: Prices to fix lists it as received, 'Correct the cost'", (await listed.getAttribute("data-price-to-fix-settled")) === "1" && /Correct the cost/.test((await listed.textContent()) ?? ""));
  await go(page, `${base}/parts/${s.jobId}`);
  await partRow(page, /front brake pads/i).locator("[data-correct-cost]").click();
  const dlg = page.locator("[data-correct-dialog]");
  await dlg.waitFor({ timeout: 10000 });
  await shot(page, "j1-correct-dialog-1440", dlg);
  await dlg.locator("[data-correct-stock]").click();
  const picker = page.locator("[data-stock-picker]");
  await picker.waitFor({ timeout: 10000 });
  await picker.locator("[data-stock-search]").fill("E2E DRAIN");
  await picker.locator(`[data-stock-item="${item.id}"]`).click();
  const msg = dlg.locator("[data-correct-message]");
  const said = await until(async () => ((await msg.count()) ? (await msg.textContent()) : null), 30, 400);
  check("J2: the answer shows in the window: 'Cost corrected: AED 12.00 each from Our stock (E2E DRAIN PLUG S2)'", /Cost corrected: AED 12\.00 each from Our stock \(E2E DRAIN PLUG S2\)/.test(said ?? ""), said ?? "");
  await shot(page, "j2-corrected-1440", dlg);
  const after = await partOf(PA);
  check("J2: the part is linked to the stock item at its cost (final 12.00, Our stock)", after?.final === 12 && after?.stock_item_id === item.id && /our stock/i.test(after?.supplier ?? ""), JSON.stringify(after));
  const shelf = (await sql("select quantity::float8 as q from public.stock_items where id = $1", [item.id]))[0]?.q;
  const out = (await sql("select quantity::float8 as q from public.stock_movements where part_item_id = $1 and kind = 'out'", [PA]));
  check("J2: the shelf went down once (5 → 4)", shelf === 4 && out.length === 1 && out[0].q === -1, `${shelf} ${JSON.stringify(out)}`);
  const ev = (await sql("select note from public.job_events where job_id = $1 and event_type = 'part_cost_corrected' order by created_at desc limit 1", [s.jobId]))[0];
  check("J2: written on the job, before → after", /FRONT BRAKE PADS: cost corrected from AED 1\.00 \(OFJ Additional\) to AED 12\.00 each from Our stock/.test(ev?.note ?? ""), ev?.note ?? "");
  await dlg.locator("[data-correct-close]").click();
  await go(page, `${base}/parts/${s.jobId}`);
  check("J2: the row is no longer red", (await partRow(page, /front brake pads/i).locator("[data-settled-fix]").count()) === 0);
  await go(page, `${base}/parts`);
  check("J2: and it left Prices to fix", (await page.locator(`[data-price-to-fix="part:${PA}"]`).count()) === 0);
  await browser.close();

  // Ordered on an LPO addressed to OFJ Additional (J-00969): the real supplier and cost; the LPO is re-addressed.
  s = await seed("approved");
  await sql("update public.part_requests set status = 'rejected', closed_reason = 'E2E not needed' where job_id = $1", [s.jobId]);
  const po = (await sql("insert into public.purchase_orders (job_id, kind, number, supplier_name, total_cost_aed, status, verify_token, created_by, updated_by) values ($1, 'supplier', 'LPO-E2E-S2J', 'OFJ Additional', 1, 'approved', md5(random()::text), $2, $2) returning id", [s.jobId, owner.id]))[0];
  const pl = (await sql("insert into public.purchase_order_lines (po_id, part_item_id, position, description, part_number, quantity, unit_cost, created_by, updated_by) values ($1, $2, 1, 'front brake pads', 'E2E-GRILL-J', 1, 1, $3, $3) returning id", [po.id, PA, owner.id]))[0];
  await sql("update public.part_items set supplier = 'OFJ Additional', cost_aed = 1, part_number = 'E2E-GRILL-J', availability = 'to_order', order_status = 'ordered', po_id = $2, po_line_id = $3 where id = $1", [PA, po.id, pl.id]);
  const b2 = await browserFor("parts", { viewport: { width: 1440, height: 900 } });
  await go(b2.page, `${base}/parts/${s.jobId}`);
  await partRow(b2.page, /front brake pads/i).locator("[data-correct-cost]").click();
  const d2 = b2.page.locator("[data-correct-dialog]");
  await d2.waitFor({ timeout: 10000 });
  check("J3: an ordered part never offers 'from our stock' (it was bought from a supplier)", (await d2.locator("[data-correct-stock]").count()) === 0);
  const realValue = await d2.locator("[data-correct-supplier-select] option").evaluateAll((os, n) => (os.find((o) => (o.textContent ?? "").trim().toLowerCase() === n.toLowerCase()) ?? {}).value ?? "", REAL);
  await d2.locator("[data-correct-supplier-select]").selectOption(realValue);
  await typeInto(d2.locator("[data-correct-cost-input]"), "2");
  await d2.locator("[data-correct-save]").click();
  const ask = await until(async () => ((await d2.locator("[data-correct-ask]").count()) ? (await d2.locator("[data-correct-ask]").textContent()) : null), 30, 400);
  check("J3: a cheap corrected cost is asked once too ('AED 2.00 – is this the real price?')", /AED 2\.00 – is this the real price\?/.test(ask ?? ""), ask ?? "");
  await typeInto(d2.locator("[data-correct-cost-input]"), "450");
  await d2.locator("[data-correct-save]").click();
  const said2 = await until(async () => ((await d2.locator("[data-correct-message]").count()) ? (await d2.locator("[data-correct-message]").textContent()) : null), 30, 400);
  check("J3: saved, and the LPO is now addressed to the real supplier", /Cost corrected: AED 450\.00 each from E2e Abu Dhabi S2; LPO-E2E-S2J is now addressed to E2e Abu Dhabi S2 \(it was "OFJ Additional"\)/i.test(said2 ?? ""), said2 ?? ((await d2.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").slice(0, 300));
  const p2 = await partOf(PA);
  const po2 = (await sql("select supplier_name, supplier_id from public.purchase_orders where id = $1", [po.id]))[0];
  check("J3: the part's supplier and final cost are the real ones; the LPO's supplier row too", /e2e abu dhabi s2/i.test(p2?.supplier ?? "") && p2?.final === 450 && /e2e abu dhabi s2/i.test(po2?.supplier_name ?? "") && !!po2?.supplier_id, `${JSON.stringify(p2)} ${JSON.stringify(po2)}`);
  await shot(b2.page, "j3-supplier-corrected-1440", d2);
  await b2.browser.close();
});

/* K. A stock cost typed in the picker is asked like any typed cost; a cost from deliveries is not; the picker's notes. */
await section("K typed stock cost", async () => {
  const s = await seed("quote");
  await sql("insert into public.stock_items (name, unit, quantity, minimum_level, unit_cost, item_type, created_by, updated_by) values ('E2E NO COST S2', 'pc', 0, 0, 0, 'part', $1, $1)", [owner.id]);
  const delivered = (await sql("insert into public.stock_items (name, unit, quantity, minimum_level, unit_cost, item_type, created_by, updated_by) values ('E2E DELIVERED SHIM S2', 'pc', 6, 0, 3, 'part', $1, $1) returning id", [owner.id]))[0];
  await sql("insert into public.stock_movements (stock_item_id, kind, quantity, unit_cost, quantity_after, part_item_id, note, created_by, updated_by) values ($1, 'in', 6, 3, 6, $2, 'E2E delivered', $3, $3)", [delivered.id, PA, owner.id]);
  const { browser, page } = await browserFor("parts", { viewport: { width: 1600, height: 1000 } });
  await go(page, `${base}/parts/${s.jobId}`);
  const discs = partRow(page, /rear brake discs/i);
  await until(async () => ((await discs.count()) ? 1 : null), 30, 500);
  await discs.locator("select[aria-label='Type']").selectOption("genuine");
  await discs.locator("select[aria-label='Supplier']").selectOption("__stock");
  const picker = page.locator("[data-stock-picker]");
  await picker.waitFor({ timeout: 10000 });
  await picker.locator("[data-stock-add]").click();
  await typeInto(picker.locator("[data-stock-new-name]"), "E2E SHIM S2");
  await typeInto(picker.locator("[data-stock-new-cost]"), "3");
  await picker.locator("[data-stock-new-save]").click();
  const ask = discs.locator("[data-cost-ask]");
  const asked = await until(async () => ((await ask.count()) && /AED 3\.00 – is this the real price\?/.test((await ask.textContent()) ?? "") ? 1 : null), 40, 400);
  check("K1: a stock cost typed in the picker (AED 3.00) is asked like any typed cost; the row is not finished", !!asked && (await ask.getAttribute("data-cost-ask-hold")) === "1" && (await discs.getAttribute("data-row-state")) === "not_finished", (await ask.textContent().catch(() => "")) ?? "");
  check("K1: nothing on the shelf (0) for the 2 the part needs: amber on the row", (await discs.locator("[data-stock-short='1']").count()) === 1 && /not enough on the shelf by the count/.test((await discs.locator("[data-stock-words]").textContent()) ?? ""));
  await discs.scrollIntoViewIfNeeded();
  await shot(page, "k1-typed-stock-cost-1600", discs);
  await discs.locator("[data-cost-confirm]").click();
  const okRow = await until(async () => ((await discs.getAttribute("data-row-state")) === "priced" ? 1 : null), 30, 400);
  check("K1: Yes, real price: priced", !!okRow);
  // The same name again with another cost: the item keeps its cost, said in the picker first.
  const pads = partRow(page, /front brake pads/i);
  await pads.locator("select[aria-label='Supplier']").selectOption("__stock");
  await picker.waitFor({ timeout: 10000 });
  await picker.locator("[data-stock-add]").click();
  await typeInto(picker.locator("[data-stock-new-name]"), "E2E SHIM S2");
  await typeInto(picker.locator("[data-stock-new-cost]"), "5");
  await picker.locator("[data-stock-new-save]").click();
  const note = picker.locator("[data-stock-note]");
  check("K2: 'E2E SHIM S2 is already on the stock list at AED 3.00 each: that cost is used.' with Use it", !!(await until(async () => ((await note.count()) ? 1 : null), 20, 300)) && /already on the stock list at AED 3\.00 each: that cost is used/.test((await note.textContent()) ?? ""));
  await shot(page, "k2-stock-note-1600", picker);
  await note.locator("[data-stock-note-use]").click();
  await until(async () => ((await sql("select stock_item_id from public.part_items where id = $1", [PA]))[0]?.stock_item_id ? 1 : null), 30, 400);
  // An item on the list with no cost: the typed cost becomes its cost (it used to be dropped and the pick refused).
  await pads.locator("[data-stock-change]").click();
  await picker.waitFor({ timeout: 10000 });
  await picker.locator("[data-stock-add]").click();
  await typeInto(picker.locator("[data-stock-new-name]"), "E2E NO COST S2");
  await typeInto(picker.locator("[data-stock-new-cost]"), "7");
  await picker.locator("[data-stock-new-save]").click();
  const noCost = await until(async () => { const r = (await sql("select unit_cost::float8 as c from public.stock_items where name = 'E2E NO COST S2'"))[0]; return r?.c === 7 ? r : null; }, 30, 400);
  check("K3: a matching item with no cost takes the cost just typed (7.00), and the row takes it", !!noCost && !!(await until(async () => ((await partOf(PA))?.cost === 7 ? 1 : null), 30, 400)), JSON.stringify(await partOf(PA)));
  // A stock item whose cost came from a real delivery is never asked, even at AED 3.00.
  await pads.locator("[data-stock-change]").click();
  await picker.waitFor({ timeout: 10000 });
  await picker.locator("[data-stock-search]").fill("E2E DELIVERED");
  await picker.locator(`[data-stock-item="${delivered.id}"]`).click();
  const delOk = await until(async () => ((await partOf(PA))?.stock_item_id === delivered.id && (await pads.getAttribute("data-row-state")) === "priced" ? 1 : null), 30, 400);
  check("K4: AED 3.00 from a delivered stock item: priced, no question", !!delOk && (await pads.locator("[data-cost-ask]").count()) === 0);
  await browser.close();
});

/* L. A replacement priced From our stock is taken off the shelf at once - never left To order (it blocked every LPO). */
await section("L stock replacement", async () => {
  const s = await seed("approved");
  await sql("update public.part_requests set status = 'rejected', closed_reason = 'E2E not needed' where job_id = $1", [s.jobId]);
  await sql("update public.part_items set supplier = $2, cost_aed = 200, part_number = 'E2E-PADS-L', not_needed_at = now(), not_needed_reason = 'E2E wrong pads' where id = $1", [PA, REAL]);
  const shelfItem = (await sql("insert into public.stock_items (name, unit, quantity, minimum_level, unit_cost, item_type, created_by, updated_by) values ('E2E PADS SHELF S2', 'pc', 3, 0, 150, 'part', $1, $1) returning id", [owner.id]))[0];
  const { browser, page } = await browserFor("parts", { viewport: { width: 1600, height: 1000 } });
  await go(page, `${base}/parts/${s.jobId}`);
  await partRow(page, /front brake pads/i).locator("[data-replace-part]").click();
  const repl = page.locator("[data-row-key]").filter({ has: page.locator("[data-replaces-chip]") }).first();
  await until(async () => ((await repl.count()) ? 1 : null), 30, 500);
  await repl.locator("select[aria-label='Supplier']").selectOption("__stock");
  const picker = page.locator("[data-stock-picker]");
  await picker.waitFor({ timeout: 10000 });
  await picker.locator("[data-stock-search]").fill("E2E PADS SHELF");
  await picker.locator(`[data-stock-item="${shelfItem.id}"]`).click();
  const made = await until(async () => (await sql("select id, order_status, final_cost_aed::float8 as final, received_qty::float8 as rq from public.part_items where replaced_part_id = $1 and is_active", [PA]))[0], 30, 500);
  const done = await until(async () => { const r = (await sql("select order_status, final_cost_aed::float8 as final from public.part_items where id = $1", [made?.id]))[0]; return r?.order_status === "received" ? r : null; }, 40, 500);
  check("L1: the replacement from our stock is received at once at the stock cost (never To order)", done?.order_status === "received" && done?.final === 150, JSON.stringify(done ?? made));
  check("L1: the shelf went down (3 → 2)", (await sql("select quantity::float8 as q from public.stock_items where id = $1", [shelfItem.id]))[0]?.q === 2);
  check("L1: the original is back to none (the replacement took over its approval)", (await partOf(PA))?.order_status === "none");
  await go(page, `${base}/parts/${s.jobId}`);
  check("L1: nothing is left to order, so no LPO is blocked by it", (await page.locator("[data-send-lpo]").count()) === 0);
  await browser.close();
});

/* M. "Our stock" priced before the rule (no stock item): never unpriced for it, listed in Prices to fix. */
await section("M old shelf rows", async () => {
  const s = await seed("quote");
  await sql("update public.part_requests set status = 'rejected', closed_reason = 'E2E not needed' where job_id = $1", [s.jobId]);
  await sql("update public.part_items set supplier = 'Our Stock', cost_aed = 150, availability = 'in_stock', delivery_date = null, stock_item_id = null where id = $1", [PA]);
  await sql("update public.jobs set parts_pricing_done_at = now(), parts_pricing_reopened_at = null where id = $1", [s.jobId]);
  const { browser, page } = await browserFor("parts", { viewport: { width: 1440, height: 900 } });
  await go(page, `${base}/parts/${s.jobId}`);
  const row = partRow(page, /front brake pads/i);
  check("M1: an old 'Our stock' row with no stock item stays priced", (await row.getAttribute("data-row-state")) === "priced");
  check("M1: with the hint to pick the stock item (Pricing done: tap Edit first)", (await row.locator("[data-stock-pick-hint]").count()) === 1);
  await go(page, `${base}/parts`);
  const listed = page.locator(`[data-price-to-fix="part:${PA}"]`);
  check("M1: Prices to fix lists it ('from our stock, but no stock item')", (await listed.count()) === 1 && /from our stock, but no stock item/.test((await listed.textContent()) ?? ""));
  await browser.close();
  // The job card never counts it as waiting for a price (it was priced before the rule).
  const card = await fetch(`${base}/jobs/${s.jobId}`, { headers: { cookie: await cookieHeader("service_advisor") } }).then((r) => r.text());
  check("M2: the job card does not count it as 'waiting for a price'", card.length > 1000 && !/\d+ waiting for a price/.test(card));
});

cleanupDb();
process.exit(summary() ? 1 : 0);
