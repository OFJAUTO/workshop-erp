// Section 9 of 2 November 2026 (built 3 November): quantity + unit on every parts form. E-00058 (Rolls-Royce Cullinan
// 2021): the parts desk's estimate form showed "ENGINE OIL – ROLLS ROYCE GENUINE ×1" with no way to change it.
// Proved through the screens on the TEST server:
//   A. The job's Parts table: the oil request starts in litres; Parts change 1 → 8 L and price it per litre; the row,
//      the history and the quotation line say "Advisor asked 1 L, Parts changed to 8 L"; the advisor is NOT told per part.
//   B. The estimate desk is the SAME row: the advisor sends the oil to the desk (it goes in litres by its name), the
//      desk changes 1 → 8 L, prices it; the estimate's history says "Advisor asked 1 L, Parts changed to 8 L".
//   C. The advisor changes a JOB part's quantity in the quotation editor (it used to be dropped): saved on the part,
//      written down, Parts told; refused in words once ordered. His change on an estimate part is written down too.
//   D. Documents: the estimate PDF and the job quotation PDF print "ENGINE OIL – … · 7 L" / "· 8 L" with "8 L" in QTY.
//   E. 9.3: on a second car of the same model the desk is offered "Last time on <MODEL>: 7 L (E-…)"; Use fills it in.
//   F. A litre part received prints ONE sticker saying the litres, never one per litre.
//   G. Layout: both screens at 800×1280 and 1440×900; the Parts table never scrolls sideways at 1366.
//   ONLY=A,B,... runs those sections only.
// Run: npm run test:s9-qty   (test server on :3102, or E2E_BASE=http://localhost:3101 for the dev test server)
// Screenshots: tests/browser/shots/s9-qty/
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execSync } from "node:child_process";
import { api, base, browserFor, browserForId, cleanupDb, cookieHeader, go, here, makeChecks, projectRoot, sleep, sql } from "./pw-lib.mjs";

const mupdf = await import("mupdf");
const { check, summary } = makeChecks();
const SHOTS = path.join(here, "shots", "s9-qty");
fs.mkdirSync(SHOTS, { recursive: true });
setTimeout(() => { console.log("TIMEOUT: stopping"); finish().then(() => process.exit(2)); }, 20 * 60 * 1000).unref();
const shot = (page, name, loc) => (loc ? loc.screenshot({ path: path.join(SHOTS, `${name}.png`) }) : page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true })).catch((e) => console.log("shot", name, String(e).slice(0, 120)));
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const typeInto = async (loc, text) => { await loc.click({ clickCount: 3 }); await loc.press("Backspace"); if (text) await loc.pressSequentially(text); await loc.press("Tab"); };
const supplierOption = async (sel, name) => sel.locator("option").evaluateAll((os, n) => (os.find((o) => (o.textContent ?? "").toLowerCase().startsWith(n.toLowerCase())) ?? {}).value ?? "", name);
const section = async (name, fn) => { if (process.env.ONLY && !process.env.ONLY.split(",").includes(name[0])) return; console.log(`\n--- ${name}`); try { await fn(); } catch (e) { check(`${name}: ran to the end`, false, String(e?.stack ?? e).slice(0, 400)); } };
const flat = (t) => String(t ?? "").replace(/\s+/g, " ").trim();
function pdfLines(buf) {
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  const out = [];
  for (let i = 0; i < doc.countPages(); i++) {
    const json = JSON.parse(doc.loadPage(i).toStructuredText("preserve-whitespace").asJSON());
    for (const b of json.blocks ?? []) for (const l of b.lines ?? []) out.push(flat(l.text));
  }
  return out.filter(Boolean);
}

const ID = (n) => `22222222-0000-4000-8000-00000000e6c${n}`;
const REQ_OIL = ID("1");
const EST_A = ID("2");
const L_OIL = ID("3");
const L_FILTER = ID("4");
const VEH_M1 = ID("5");
const VEH_M2 = ID("6");
const EST_M1 = ID("7");
const L_M1 = ID("8");
const EST_M2 = ID("9");
const L_M2 = ID("a");
const SUP = "E2e Abu Dhabi S9";
const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0];
const partsPerson = (await sql("select id, display_name from public.staff where role_id = 'parts' and is_active order by created_at limit 1"))[0];
const ready = (await sql("select count(*)::int as n from information_schema.columns where table_schema = 'public' and ((table_name = 'part_items' and column_name = 'unit') or (table_name = 'quotation_lines' and column_name in ('unit', 'asked_quantity')))"))[0]?.n === 3;
check("0: the TEST database has the unit columns (migration 20261203160000_part_units)", ready);
const made = { estimates: [EST_A, EST_M1, EST_M2], jobs: [] };
async function finish() {
  // The notifications about these estimates carry no job: they go by their link (as test-estparts does).
  const file = path.join(os.tmpdir(), `s9-qty-${process.pid}.sql`);
  fs.writeFileSync(file, `delete from public.notifications where ${made.estimates.map((id) => `href like '%${id}%'`).join(" or ")};
`);
  try { execSync(`node --env-file=.env.test.local scripts/db-sql.mjs "${file}"`, { cwd: projectRoot, encoding: "utf8" }); } catch (e) { console.log("notifications not removed:", String(e.message).slice(0, 160)); }
  fs.rmSync(file, { force: true });
  cleanupDb();
}
const ensureSupplier = async () => { await sql("insert into public.suppliers (name, default_discount_percent, discount_by_type, created_by) select $1, 0, '{}'::jsonb, $2 where not exists (select 1 from public.suppliers where name ilike $1)", [SUP, owner.id]); await sql("update public.suppliers set is_active = true where name ilike $1", [SUP]); };
const seed = async () => { cleanupDb(); await ensureSupplier(); return (await api("/api/e2e/stage", { stage: "quote" })).json; };
const priceRow = async (row, { pn, net, avail = "In stock" }) => {
  if (pn !== undefined) await typeInto(row.locator("input[aria-label='Part number']"), pn);
  await row.locator("select[aria-label='Type']").selectOption("genuine");
  const sel = row.locator("select[aria-label='Supplier']");
  await sel.selectOption(await supplierOption(sel, SUP));
  await sleep(400);
  await typeInto(row.locator("input[aria-label='Cost before VAT']"), net);
  await row.locator("select[aria-label='Availability']").selectOption({ label: avail });
  await row.locator("input[aria-label='Part number']").press("Tab");
};
const advisorOf = async (jobId) => (await sql("select j.gated_in_by as id, s.display_name from public.jobs j join public.staff s on s.id = j.gated_in_by where j.id = $1", [jobId]))[0];
const advisorSaid = async (staffId, jobId) => (await sql("select count(*)::int as n from public.notifications where staff_id = $1 and job_id = $2 and type = 'parts_priced'", [staffId, jobId]))[0]?.n ?? 0;
let seeded = null;

try {
  /* ---------------- A. The job's Parts table: the oil in litres, 1 → 8 L ---------------- */
  await section("A job parts table", async () => {
    seeded = await seed();
    const { jobId } = seeded;
    const adv = await advisorOf(jobId);
    await sql("insert into public.part_requests (id, job_id, inspection_id, source_type, source_key, label, requested_text, status, quantity, created_by, updated_by) values ($1, $2, $3, 'manual', 'e2e-s9-oil', 'ENGINE OIL - ROLLS ROYCE GENUINE', 'Quantity 1 · asked by the advisor', 'open', 1, $4, $4)", [REQ_OIL, jobId, null, adv.id]);
    const saidBefore = await advisorSaid(adv.id, jobId);
    const { browser, page } = await browserFor("parts", { viewport: { width: 1440, height: 900 } });
    await go(page, `${base}/parts/${jobId}`);
    const row = page.locator(`[data-row-key="req:${REQ_OIL}"]`);
    await until(async () => ((await row.count()) ? 1 : null), 30, 500);
    check("A1: the oil row starts in litres (its name), the rear discs in pieces", (await row.locator("[data-part-unit]").getAttribute("data-part-unit")) === "l" && (await page.locator(`[data-row-key="req:22222222-0000-4000-8000-00000000e309"] [data-part-unit]`).getAttribute("data-part-unit").catch(() => "pc")) === "pc");
    await typeInto(row.locator("[data-part-qty]"), "8");
    await priceRow(row, { pn: "E2E-OIL-0W30", net: "165" });
    const part = await until(async () => (await sql("select id, quantity::float8 as asked, confirmed_quantity::float8 as qty, unit, cost_aed::float8 as cost, priced_at from public.part_items where part_request_id = $1 and is_active", [REQ_OIL]))[0] ?? null, 40, 500);
    const pricedPart = await until(async () => { const p = (await sql("select id, quantity::float8 as asked, confirmed_quantity::float8 as qty, unit, cost_aed::float8 as cost, priced_at from public.part_items where part_request_id = $1 and is_active", [REQ_OIL]))[0]; return p?.priced_at && p.qty === 8 ? p : null; }, 40, 500);
    check("A2: the part keeps the advisor's ask (1) and Parts' 8 in litres, at AED 165 per litre", !!pricedPart && pricedPart.asked === 1 && pricedPart.qty === 8 && pricedPart.unit === "l" && pricedPart.cost === 165, JSON.stringify(pricedPart ?? part));
    const ev = await until(async () => (await sql("select note from public.job_events where job_id = $1 and event_type = 'parts_quantity' order by created_at desc limit 1", [jobId]))[0], 30, 500);
    check("A3: the history says 'ENGINE OIL – ROLLS ROYCE GENUINE: Advisor asked 1 L, Parts changed to 8 L'", /ENGINE OIL - ROLLS ROYCE GENUINE: Advisor asked 1 L, Parts changed to 8 L/i.test(ev?.note ?? ""), ev?.note ?? "");
    await until(async () => (/Advisor asked 1 L, Parts changed to 8 L/.test((await row.locator("[data-status-line]").textContent()) ?? "") ? 1 : null), 20, 500);
    const status = flat(await row.locator("[data-status-line]").textContent());
    check("A4: the row says it too, with the cost per litre: 'AED 165.00 per litre × 8 L'", /Advisor asked 1 L, Parts changed to 8 L/.test(status) && /AED 165\.00 per litre × 8 L/.test(status), status);
    check("A5: the line total is 8 × 165 = 1,320.00", /1,320\.00/.test((await row.locator("[data-line-total]").textContent()) ?? ""));
    const line = await until(async () => (await sql("select quantity::float8 as qty, unit, title from public.quotation_lines where part_item_id = $1 and is_active", [pricedPart?.id]))[0], 30, 500);
    check("A6: the quotation line follows its part: 8, litres", line?.qty === 8 && line?.unit === "l", JSON.stringify(line));
    check("A7: the advisor is NOT told per part while Parts are pricing (it comes with Pricing done – send to advisor)", (await advisorSaid(adv.id, jobId)) === saidBefore, `${await advisorSaid(adv.id, jobId)} vs ${saidBefore}`);
    await row.scrollIntoViewIfNeeded();
    await shot(page, "a-job-row-8-litres-1440", row);
    await page.setViewportSize({ width: 800, height: 1280 });
    await sleep(700);
    await row.scrollIntoViewIfNeeded();
    await shot(page, "a-job-row-8-litres-800", row);
    // G (layout): the Parts table never scrolls sideways at 1366.
    await page.setViewportSize({ width: 1366, height: 900 });
    await sleep(700);
    const sideways = await page.evaluate(() => Array.from(document.querySelectorAll(".overflow-x-auto")).filter((el) => el.querySelector("[data-row-key]")).map((el) => el.scrollWidth - el.clientWidth));
    check("G1: at 1366 the Parts table (with the unit) never scrolls sideways", sideways.length > 0 && sideways.every((d) => d <= 1), JSON.stringify(sideways));
    await browser.close();
  });

  /* ---------------- B. The estimate desk: the SAME row, the quantity editable ---------------- */
  await section("B estimate desk", async () => {
    if (!seeded) seeded = await seed();
    const job = (await sql("select customer_id, vehicle_id, gated_in_by from public.jobs where id = $1", [seeded.jobId]))[0];
    await sql("insert into public.quotations (id, kind, number, version, customer_id, vehicle_id, status, token, created_by, updated_by) values ($1, 'estimate', 'E-E2E-S9A', 1, $2, $3, 'draft', md5(random()::text), $4, $4) on conflict (id) do nothing", [EST_A, job.customer_id, job.vehicle_id, job.gated_in_by]);
    await sql("insert into public.quotation_lines (id, quotation_id, position, line_type, title, source_type, quantity, markup_percent, created_by, updated_by) values ($1, $3, 1, 'part', 'ENGINE OIL - ROLLS ROYCE GENUINE', 'manual', 1, 30, $4, $4), ($2, $3, 2, 'part', 'SET OIL-FILTER ELEMENT', 'manual', 1, 30, $4, $4) on conflict (id) do nothing", [L_OIL, L_FILTER, EST_A, job.gated_in_by]);
    const advCookie = await cookieHeader(job.gated_in_by);
    const sent = await api("/api/quote/save", { quotationId: EST_A, sendToDesk: { ids: [L_OIL, L_FILTER] } }, advCookie);
    const units = await sql("select id, unit from public.quotation_lines where id in ($1, $2)", [L_OIL, L_FILTER]);
    check("B1: sent to the desk, the oil goes in litres by its name, the filter in pieces", sent.status === 200 && units.find((u) => u.id === L_OIL)?.unit === "l" && units.find((u) => u.id === L_FILTER)?.unit === "pc", `${sent.status} ${JSON.stringify(units)}`);
    const { browser, page } = await browserFor("parts", { viewport: { width: 1440, height: 900 } });
    await go(page, `${base}/parts/estimate/${EST_A}`);
    const oil = page.locator(`[data-row-key="${L_OIL}"]`);
    await until(async () => ((await oil.count()) ? 1 : null), 30, 500);
    check("B2: the estimate desk shows the SAME parts row (quantity box and unit, list, discount, net, supplier, availability)", (await oil.locator("[data-part-qty]").count()) === 1 && (await oil.locator("[data-part-unit]").getAttribute("data-part-unit")) === "l" && (await oil.locator("input[aria-label='List price']").count()) === 1 && (await oil.locator("select[aria-label='Supplier']").count()) === 1);
    await shot(page, "b-estimate-desk-before-1440");
    await typeInto(oil.locator("[data-part-qty]"), "8");
    await priceRow(oil, { pn: "E2E-OIL-0W30", net: "165" });
    const filter = page.locator(`[data-row-key="${L_FILTER}"]`);
    await priceRow(filter, { pn: "E2E-FILTER-1", net: "53" });
    const line = await until(async () => { const r = (await sql("select quantity::float8 as qty, unit, asked_quantity::float8 as asked, unit_cost::float8 as cost, priced_at, quantity_changed_by from public.quotation_lines where id = $1", [L_OIL]))[0]; return r?.qty === 8 && r?.priced_at ? r : null; }, 40, 500);
    check("B3: the estimate line is 8 L at AED 165 per litre, the advisor's 1 kept, priced", !!line && line.unit === "l" && line.asked === 1 && line.cost === 165 && line.quantity_changed_by === partsPerson?.id, JSON.stringify(line));
    const ev = await until(async () => (await sql("select note from public.quotation_events where quotation_id = $1 and event_type = 'part_quantity' order by created_at desc limit 1", [EST_A]))[0], 30, 500);
    check("B4: the estimate's history says 'Advisor asked 1 L, Parts changed to 8 L'", /ENGINE OIL - ROLLS ROYCE GENUINE: Advisor asked 1 L, Parts changed to 8 L/i.test(ev?.note ?? ""), ev?.note ?? "");
    const status = flat(await oil.locator("[data-status-line]").textContent());
    check("B5: the row says it, and shows the cost per litre", /Advisor asked 1 L, Parts changed to 8 L/.test(status) && /per litre × 8 L/.test(status), status);
    await shot(page, "b-estimate-desk-priced-1440");
    await page.setViewportSize({ width: 800, height: 1280 });
    await sleep(700);
    await shot(page, "b-estimate-desk-priced-800");
    await browser.close();
  });

  /* ---------------- C. The advisor's quantity: a job part (no longer dropped) and an estimate part ---------------- */
  await section("C advisor quantity", async () => {
    if (!seeded) seeded = await seed();
    const { jobId, quotationId } = seeded;
    const adv = await advisorOf(jobId);
    const PA = "22222222-0000-4000-8000-00000000e306";
    const { browser, page } = await browserForId(adv.id, { viewport: { width: 1440, height: 900 } });
    await go(page, `${base}/jobs/${jobId}/quote/${quotationId}`);
    const box = page.locator("[data-job-part-qty]").first();
    check("C1: the job part's quantity is a box for the advisor (it was plain text)", (await box.count()) === 1);
    await typeInto(box, "2");
    const p = await until(async () => { const r = (await sql("select confirmed_quantity::float8 as qty from public.part_items where id = $1", [PA]))[0]; return r?.qty === 2 ? r : null; }, 40, 500);
    check("C2: the part takes the advisor's 2 (it used to be dropped silently)", !!p);
    const l = await until(async () => { const r = (await sql("select quantity::float8 as qty from public.quotation_lines where part_item_id = $1 and quotation_id = $2 and is_active", [PA, quotationId]))[0]; return r?.qty === 2 ? r : null; }, 30, 500);
    check("C3: the quotation line follows it", !!l);
    const ev = await until(async () => (await sql("select note from public.job_events where job_id = $1 and event_type = 'parts_quantity' and note ilike 'FRONT BRAKE PADS:%' order by created_at desc limit 1", [jobId]))[0], 30, 500);
    check("C4: written down in the one wording: 'FRONT BRAKE PADS: … asked 1, Advisor changed to 2'", /FRONT BRAKE PADS: \w+ asked 1, Advisor changed to 2/i.test(ev?.note ?? ""), ev?.note ?? "");
    const told = await until(async () => (await sql("select title from public.notifications where job_id = $1 and type = 'parts_request' and title like 'Quantity changed%' order by id desc limit 1", [jobId]))[0], 20, 500);
    check("C5: Parts are told", !!told, told?.title ?? "");
    await shot(page, "c-editor-job-part-qty-1440", page.locator(`[data-part-qty-cell]`).first());
    await browser.close();
    // Review of 3 November 2026: the Parts row names who changed it (the advisor), never "Parts changed to 2".
    {
      const { browser: pb, page: pp } = await browserFor("parts", { viewport: { width: 1440, height: 900 } });
      await go(pp, `${base}/parts/${jobId}`);
      await until(async () => ((await pp.locator(`[data-row-key="${PA}"]`).count()) ? 1 : null), 30, 500);
      const status = String((await pp.locator(`[data-row-key="${PA}"]`).textContent().catch(() => "")) ?? "").replace(/\s+/g, " ");
      check("C4b: the Parts row says the advisor changed it ('… asked 1, Advisor changed to 2')", /asked 1, Advisor changed to 2/.test(status) && !/Parts changed to 2/.test(status), status.slice(0, 300));
      await pb.close();
    }
    // Ordered: refused in words.
    await sql("update public.part_items set order_status = 'ordered' where id = $1", [PA]);
    const lineId = (await sql("select id from public.quotation_lines where part_item_id = $1 and quotation_id = $2 and is_active", [PA, quotationId]))[0]?.id;
    const r = await api("/api/quote/save", { quotationId, patchLine: { id: lineId, quantity: 3 } }, await cookieHeader(adv.id));
    check("C6: once ordered the quantity is refused in words (ask Parts)", r.status === 400 && /already ordered: ask Parts/.test(r.json?.error ?? ""), `${r.status} ${r.json?.error}`);
    await sql("update public.part_items set order_status = 'none' where id = $1", [PA]);
    // The advisor's change on an estimate part the desk priced.
    if (!(await sql("select id from public.quotation_lines where id = $1", [L_OIL]))[0]) return;
    const r2 = await api("/api/quote/save", { quotationId: EST_A, patchLine: { id: L_OIL, quantity: 7 } }, await cookieHeader(adv.id));
    const ev2 = await until(async () => (await sql("select note from public.quotation_events where quotation_id = $1 and event_type = 'part_quantity' and note ilike '%Advisor changed to 7 L%' order by created_at desc limit 1", [EST_A]))[0], 20, 500);
    check("C7: the advisor's 8 → 7 L on the estimate is written down: 'Parts asked 8 L, Advisor changed to 7 L'", r2.status === 200 && /Parts asked 8 L, Advisor changed to 7 L/.test(ev2?.note ?? ""), `${r2.status} ${ev2?.note}`);
    const r3 = await api("/api/quote/save", { quotationId: EST_A, patchLine: { id: L_FILTER, quantity: 1.5 } }, await cookieHeader(adv.id));
    check("C8: pieces are counted whole (1.5 refused in words)", r3.status === 400 && /whole/.test(r3.json?.error ?? ""), `${r3.status} ${r3.json?.error}`);
    // Review of 3 November 2026: switching 6.5 L to pieces is refused too (it used to save 6.5 pieces, printed "6.50").
    await api("/api/quote/save", { quotationId: EST_A, patchLine: { id: L_OIL, quantity: 6.5 } }, await cookieHeader(adv.id));
    const r4 = await api("/api/quote/save", { quotationId: EST_A, patchLine: { id: L_OIL, unit: "pc" } }, await cookieHeader(adv.id));
    const oilNow = (await sql("select quantity::float8 as q, unit from public.quotation_lines where id = $1", [L_OIL]))[0];
    check("C9: 6.5 L switched to pieces is refused in words and the line stays 6.5 L", r4.status === 400 && /whole/.test(r4.json?.error ?? "") && oilNow?.unit === "l" && oilNow?.q === 6.5, `${r4.status} ${r4.json?.error} · ${JSON.stringify(oilNow)}`);
    await api("/api/quote/save", { quotationId: EST_A, patchLine: { id: L_OIL, quantity: 7 } }, await cookieHeader(adv.id));
  });

  /* ---------------- D. Documents: "· 7 L" after the name and "7 L" in the QTY column ---------------- */
  await section("D documents", async () => {
    const est = (await sql("select token from public.quotations where id = $1", [EST_A]))[0];
    if (est?.token) {
      const res = await fetch(`${base}/api/pdf/quote/${est.token}`);
      const lines = res.ok ? pdfLines(Buffer.from(await res.arrayBuffer())) : [];
      // A long name may wrap onto a second line in the PDF: the words are read as one text.
      const all = lines.join(" ");
      const oilLine = (all.match(/ENGINE OIL - ROLLS ROYCE GENUINE.{0,60}?· 7 L/) ?? [""])[0];
      check("D1: the estimate PDF prints 'ENGINE OIL - ROLLS ROYCE GENUINE … · 7 L'", !!oilLine, oilLine || lines.slice(0, 40).join(" | "));
      check("D2: and '7 L' in the QTY column (the price beside it is per litre)", lines.includes("7 L"), lines.filter((t) => /\bL\b/.test(t)).join(" | "));
      check("D3: the filter (pieces) prints no unit", lines.some((t) => /^SET OIL-FILTER ELEMENT/.test(t) && !/· \d+ (L|SETS?)$/.test(t)));
    } else check("D1: the estimate from B exists", false);
    if (seeded) {
      const q = (await sql("select token from public.quotations where id = $1", [seeded.quotationId]))[0];
      const res = await fetch(`${base}/api/pdf/quote/${q?.token}`);
      const lines = res.ok ? pdfLines(Buffer.from(await res.arrayBuffer())) : [];
      check("D4: the job's quotation PDF prints the oil '· 8 L' with '8 L' in QTY", /ENGINE OIL - ROLLS ROYCE GENUINE.{0,60}?· 8 L/.test(lines.join(" ")) && lines.includes("8 L"), lines.slice(0, 40).join(" | "));
    }
  });

  /* ---------------- E. 9.3: the quantity used last time on the same model ---------------- */
  await section("E last quantity", async () => {
    if (!seeded) seeded = await seed();
    const job = (await sql("select customer_id, gated_in_by from public.jobs where id = $1", [seeded.jobId]))[0];
    const mm = (await sql("select m.id as make_id, v.id as model_id, m.name as make, v.name as model from public.vehicle_makes m join public.vehicle_models v on v.make_id = m.id where m.is_active and v.is_active order by m.name, v.name limit 1"))[0];
    for (const id of [VEH_M1, VEH_M2]) await sql("insert into public.vehicles (id, customer_id, has_plate, plate_country, make_id, model_id, model_year, created_by, updated_by) values ($1, $2, false, 'UAE', $3, $4, 2021, $5, $5) on conflict (id) do nothing", [id, job.customer_id, mm.make_id, mm.model_id, owner.id]);
    await sql("insert into public.quotations (id, kind, number, version, customer_id, vehicle_id, status, token, created_by, updated_by) values ($1, 'estimate', 'E-E2E-S9M1', 1, $2, $3, 'draft', md5(random()::text), $4, $4), ($5, 'estimate', 'E-E2E-S9M2', 1, $2, $6, 'draft', md5(random()::text), $4, $4) on conflict (id) do nothing", [EST_M1, job.customer_id, VEH_M1, job.gated_in_by, EST_M2, VEH_M2]);
    await sql("insert into public.quotation_lines (id, quotation_id, position, line_type, title, source_type, quantity, unit, unit_cost, supplier_text, part_type, part_number, availability, markup_percent, price_requested_at, priced_at, created_by, updated_by) values ($1, $2, 1, 'part', 'OW-30 FE GENUINE OIL LL-01-2L', 'manual', 7, 'l', 165, $4, 'genuine', 'E2E-OIL-M1', 'in_stock', 30, now() - interval '1 day', now() - interval '1 day', $3, $3) on conflict (id) do nothing", [L_M1, EST_M1, job.gated_in_by, SUP]);
    await sql("insert into public.quotation_lines (id, quotation_id, position, line_type, title, source_type, quantity, unit, markup_percent, price_requested_at, price_requested_by, created_by, updated_by) values ($1, $2, 1, 'part', 'ENGINE OIL - ROLLS ROYCE GENUINE', 'manual', 1, 'l', 30, now(), $3, $3, $3) on conflict (id) do nothing", [L_M2, EST_M2, job.gated_in_by]);
    const { browser, page } = await browserFor("parts", { viewport: { width: 1440, height: 900 } });
    await go(page, `${base}/parts/estimate/${EST_M2}`);
    const row = page.locator(`[data-row-key="${L_M2}"]`);
    await until(async () => ((await row.count()) ? 1 : null), 30, 500);
    const chip = row.locator("[data-qty-memory]");
    const words = flat(await chip.textContent().catch(() => ""));
    check(`E1: the desk is offered 'Last time on ${mm.make} ${mm.model} 2021: 7 L (E-E2E-S9M1) · Use'`.toUpperCase(), new RegExp(`Last time on .*${mm.model.toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*: 7 L \\(E-E2E-S9M1\\) · Use`).test(words), words);
    check("E2: never filled in by itself (still 1 until Use)", (await row.locator("[data-part-qty]").inputValue()) === "1");
    await shot(page, "e-last-quantity-chip-1440", row);
    await chip.click();
    const after = await until(async () => { const r = (await sql("select quantity::float8 as qty, unit from public.quotation_lines where id = $1", [L_M2]))[0]; return r?.qty === 7 ? r : null; }, 40, 500);
    check("E3: Use fills in 7 L (saved like any change, written down)", !!after && after.unit === "l");
    await browser.close();
  });

  /* ---------------- F. One sticker for a litre part ---------------- */
  await section("F sticker", async () => {
    const p = (await sql("select id, job_id from public.part_items where part_request_id = $1 and is_active", [REQ_OIL]))[0];
    if (!p) { check("F1: the oil part from A exists", false); return; }
    await sql("update public.part_items set order_status = 'received', received_qty = 8 where id = $1", [p.id]);
    const { browser, page } = await browserFor("parts", { viewport: { width: 1440, height: 900 } });
    await go(page, `${base}/parts/labels/${p.job_id}?parts=${p.id}`);
    const body = flat(await page.locator("body").textContent());
    check("F1: 8 L of oil prints ONE sticker saying the litres (never 8 stickers)", /\b1 sticker\b/.test(body) && /8 L/.test(body), body.slice(0, 200));
    await shot(page, "f-one-sticker-8-litres");
    await sql("update public.part_items set order_status = 'none', received_qty = 0 where id = $1", [p.id]);
    await browser.close();
  });
} catch (e) {
  check("walked without a crash", false, (e?.message ?? String(e)).slice(0, 300));
} finally {
  await finish();
}
process.exit(summary() ? 1 : 0);
