// 13 November 2026, Section 5: the parts desk's "+ Add a part" on an estimate (E-00092). Signed in as the parts desk: the
// same picker as a job's parts page, "For job:" chips, the part tagged "Added by Parts". Signed in as the advisor: Accept
// onto the estimate, Decline leaves it off; the desk sees "Accepted by <advisor>" / "Declined". An estimate already sent
// is never changed: the advisor is asked to revise it. TEST only.
//   node --env-file=.env.test.local tests/browser/test-s5-deskparts.mjs
import fs from "node:fs";
import path from "node:path";
import { base, browserFor, browserForId, cleanupDb, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-13-desk-add-part";
fs.mkdirSync(OUT, { recursive: true });
const until = async (fn, tries = 60, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const made = [];

async function addOne(page, name, forTitle) {
  await page.locator("[data-desk-add-part]").click();
  const picker = page.locator("[data-part-picker]").last();
  await picker.waitFor({ timeout: 15000 });
  await picker.locator("[data-custom-part-button]").click();
  await picker.locator("input[aria-label='Custom part name']").fill(name);
  await picker.getByRole("button", { name: "Add", exact: true }).click();
  await picker.locator("[data-picker-done]").click();
  const win = page.locator("[data-desk-for-window]");
  await win.waitFor({ timeout: 10000 });
  if (forTitle) await win.locator("[data-desk-for-job]").filter({ hasText: forTitle }).first().click();
  return win;
}

try {
  cleanupDb();
  const advisor = (await sql("select id, display_name from public.staff where role_id = 'service_advisor' and is_active order by display_name limit 1"))[0];
  const mm = (await sql("select m.id as make_id, v.id as model_id from public.vehicle_makes m join public.vehicle_models v on v.make_id = m.id where m.is_active and v.is_active order by m.name, v.name limit 1"))[0];
  const cust = (await sql("insert into public.customers (customer_type, full_name, phone) values ('individual', 'E2e Desk Add', '+971500000093') returning id"))[0].id;
  const car = (await sql("insert into public.vehicles (customer_id, has_plate, plate_country, plate_emirate, plate_code, plate_number, make_id, model_id, model_year) values ($1, true, 'UAE', 'Dubai', 'D', '93511', $2, $3, 2024) returning id", [cust, mm.make_id, mm.model_id]))[0].id;
  const est = (await sql("insert into public.quotations (kind, customer_id, vehicle_id, status, validity_days, created_by, updated_by) values ('estimate', $1, $2, 'draft', 7, $3, $3) returning id, number", [cust, car, advisor.id]))[0];
  made.push(est.id);
  const job = (await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, hours, labour_rate, line_total, created_by, updated_by) values ($1, 1, 'labour', 'E2E FRONT BRAKE SERVICE', 'manual', 1, 2, 350, 700, $2, $2) returning id", [est.id, advisor.id]))[0];

  // A. The parts desk: + Add a part (the same picker), For job:, tagged "Added by Parts".
  const desk = await browserFor("parts", { viewport: { width: 1440, height: 1000 } });
  await go(desk.page, `${base}/parts/estimate/${est.id}`);
  check("A1: the desk page offers \"+ Add a part\" on an estimate with nothing sent to the desk yet", (await desk.page.locator("[data-desk-add-part]").count()) === 1);
  let win = await addOne(desk.page, "E2E FRONT BRAKE PADS", "E2E FRONT BRAKE SERVICE");
  check("A2: the For job window lists the estimate's job", (await win.locator("[data-desk-for-job]").count()) >= 2);
  await win.screenshot({ path: path.join(OUT, "a-for-job-window-1440.png") });
  await win.locator("[data-desk-add-save]").click();
  await win.locator("[data-desk-add-done]").waitFor({ timeout: 30000 });
  const l1 = await until(async () => (await sql("select id, left_off, parts_add_status, parent_line_id, parts_added_by from public.quotation_lines where quotation_id = $1 and title ilike 'E2E FRONT BRAKE PADS'", [est.id]))[0]);
  check("A3: the line is on the estimate, left off, waiting, linked to its job", !!l1 && l1.left_off === true && l1.parts_add_status === "pending" && l1.parent_line_id === job.id, JSON.stringify(l1));
  await desk.page.locator("[data-desk-add-close]").click();
  await go(desk.page, `${base}/parts/estimate/${est.id}`);
  const body1 = (await desk.page.textContent("body")) ?? "";
  check("A4: the desk row says Added by Parts · for job · waiting for the advisor", /Added by Parts · for job: E2E FRONT BRAKE SERVICE · waiting for the advisor/i.test(body1));
  await desk.page.screenshot({ path: path.join(OUT, "a-desk-row-1440.png"), fullPage: true });
  // A second part, for no particular job (to be declined).
  win = await addOne(desk.page, "E2E WIPER BLADES", null);
  await win.locator('[data-desk-for-job="none"]').click();
  await win.locator("[data-desk-add-save]").click();
  await win.locator("[data-desk-add-done]").waitFor({ timeout: 30000 });
  const l2 = await until(async () => (await sql("select id from public.quotation_lines where quotation_id = $1 and title ilike 'E2E WIPER BLADES'", [est.id]))[0]);
  const bell = await until(async () => (await sql("select title from public.notifications where staff_id = $1 and href like $2 and title like 'Parts added a part%'", [advisor.id, `%${est.id}%`]))[0]);
  check("A5: the advisor is told (one bell per add)", !!bell, bell?.title);

  // B. The advisor (signed in as the advisor): Accept one, Decline the other.
  const adv = await browserForId(advisor.id, { viewport: { width: 800, height: 1280 }, touch: true });
  await go(adv.page, `${base}/estimates/${est.id}`);
  const card = adv.page.locator("[data-desk-parts-card]");
  check("B1: the estimate shows the Added by Parts card with Accept and Decline", (await card.count()) === 1 && (await card.locator("[data-desk-accept]").count()) === 2);
  await card.screenshot({ path: path.join(OUT, "b-advisor-card-800.png") });
  await card.locator(`[data-desk-part="${l1.id}"] [data-desk-accept]`).click();
  await card.locator(`[data-desk-part="${l1.id}"] [data-desk-decided]`).waitFor({ timeout: 30000 });
  await card.locator(`[data-desk-part="${l2.id}"] [data-desk-decline]`).click();
  await card.locator(`[data-desk-part="${l2.id}"] [data-desk-decided]`).waitFor({ timeout: 30000 });
  const after = await sql("select title, left_off, parts_add_status from public.quotation_lines where id = any($1::uuid[]) order by title", [[l1.id, l2.id]]);
  check("B2: accepted = on the estimate; declined = left off", after.find((r) => /PADS/i.test(r.title))?.left_off === false && after.find((r) => /PADS/i.test(r.title))?.parts_add_status === "accepted" && after.find((r) => /WIPER/i.test(r.title))?.left_off === true && after.find((r) => /WIPER/i.test(r.title))?.parts_add_status === "declined", JSON.stringify(after));
  await go(adv.page, `${base}/estimates/${est.id}`);
  await adv.page.locator("[data-desk-parts-card]").screenshot({ path: path.join(OUT, "b-advisor-decided-800.png") });

  // C. The desk sees the outcome.
  await go(desk.page, `${base}/parts/estimate/${est.id}`);
  const list = (await desk.page.locator("[data-desk-added-list]").textContent()) ?? "";
  const re = new RegExp(`Accepted by ${advisor.display_name}`, "i");
  check("C1: the desk sees \"Accepted by <advisor>\" and \"Declined\"", re.test(list) && /Declined by/i.test(list), list.slice(0, 200));
  const deskBell = await until(async () => (await sql("select count(*)::int as n from public.notifications n join public.staff s on s.id = n.staff_id where s.role_id = 'parts' and n.href like $1 and (n.title like 'Accepted:%' or n.title like 'Declined:%')", [`%${est.id}%`]))[0].n >= 2);
  check("C2: the desk is told of both answers", !!deskBell);
  await desk.page.screenshot({ path: path.join(OUT, "c-desk-outcome-1440.png"), fullPage: true });
  const tab = await browserFor("parts", { viewport: { width: 800, height: 1280 }, touch: true });
  await go(tab.page, `${base}/parts/estimate/${est.id}`);
  await tab.page.screenshot({ path: path.join(OUT, "c-desk-outcome-800.png"), fullPage: true });
  await tab.browser.close();

  // D. Sent: the estimate is never changed from the desk; the advisor is asked to revise it.
  await sql("update public.quotations set status = 'sent', sent_at = now() where id = $1", [est.id]);
  await go(desk.page, `${base}/parts/estimate/${est.id}`);
  win = await addOne(desk.page, "E2E CABIN FILTER", null);
  await win.locator('[data-desk-for-job="none"]').click();
  await win.locator("[data-desk-add-save]").click();
  await win.locator("[data-desk-add-done]").waitFor({ timeout: 30000 });
  const doneWords = (await win.locator("[data-desk-add-done]").textContent()) ?? "";
  const none = (await sql("select count(*)::int as n from public.quotation_lines where quotation_id = $1 and title ilike 'E2E CABIN FILTER'", [est.id]))[0].n;
  check("D1: sent = no line added, the window says it needs a revision", none === 0 && /needs a revision/i.test(doneWords), doneWords);
  const reviseBell = await until(async () => (await sql("select title from public.notifications where staff_id = $1 and href like $2 and title like 'Revise %'", [advisor.id, `%${est.id}%`]))[0]);
  check("D2: the advisor is asked to revise", !!reviseBell, reviseBell?.title);

  await adv.browser.close();
  await desk.browser.close();
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  if (made.length) await sql("delete from public.notifications where " + made.map((_, i) => `href like $${i + 1}`).join(" or "), made.map((id) => `%${id}%`)).catch(() => null);
  cleanupDb();
  await sql("select setval('public.estimate_number_seq', greatest(1, coalesce((select max(substring(number from 3)::int) from public.quotations where number ~ '^E-[0-9]+$'), 1)))").catch(() => null);
}
process.exit(summary() ? 1 : 0);
