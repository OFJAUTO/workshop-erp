// 13 November 2026, Section 1 (J-01002): work starts as soon as the customer approves. The workshop manager releases at
// once (Parts alongside); each job line says READY TO START or WAITING FOR PART; "Start anyway"; the steps tag "Work
// active · Parts: n of m here"; a decline the customer later reversed never shows; APPROVED IN PART; no LPO when all
// declined; the inspection type from a clear request; the 30-minute LPO nudge to accounts. TEST only.
//   node --env-file=.env.test.local tests/browser/test-s1-work.mjs
import fs from "node:fs";
import path from "node:path";
import { MANAGER_MECH, api, base, browserFor, browserForId, cleanupDb, go, makeChecks, pickPerson, sendLpo, sleep, sql, submitted } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-13-work-on-approval";
fs.mkdirSync(OUT, { recursive: true });
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const text = async (page, sel) => (((await page.locator(sel).first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim());
const today = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);

try {
  cleanupDb();
  const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const JOB = seed.jobId, QID = seed.quotationId;
  const PA = (await sql("select part_item_id from public.quotation_lines where quotation_id = $1 and line_type = 'part'", [QID]))[0].part_item_id;
  const tech = (await sql("select assigned_to from public.jobs where id = $1", [JOB]))[0].assigned_to;
  check("0: the customer approved; the part is still to order (no LPO yet)", (await sql("select status from public.jobs where id = $1", [JOB]))[0].status === "waiting_parts" && (await sql("select order_status from public.part_items where id = $1", [PA]))[0].order_status === "to_order");

  // 1. The workshop manager can release at once: Parts run alongside.
  const m = await browserForId(MANAGER_MECH, { viewport: { width: 1440, height: 1100 } });
  await go(m.page, `${base}/jobs/${JOB}`);
  check("1a: the release is offered the moment the customer approved (Parts not done yet)", (await m.page.locator('[data-release="mechanical"], [data-release-form="mechanical"]').count()) >= 1);
  check("1b: it says the work starts now and the parts follow", /Work starts now; the parts follow/.test(await text(m.page, "[data-start-with-available]")));
  await m.page.locator('[data-release-form="mechanical"]').screenshot({ path: path.join(OUT, "1-release-at-approval-1440.png") });
  await pickPerson(m.page.locator('[data-release-form="mechanical"]'), tech);
  const start = m.page.locator("input[name=start_date]");
  if ((await start.count()) && !(await start.inputValue())) await start.fill(today);
  const promised = m.page.locator('[data-release-form="mechanical"] [data-promised-date]');
  if (await promised.count()) await promised.fill(new Date(Date.now() + 4 * 3600000 + 3 * 86400000).toISOString().slice(0, 10));
  const reason = m.page.locator('[data-release-form="mechanical"] textarea[name="promise_reason"], [data-release-form="mechanical"] input[name="promise_reason"]');
  if (await reason.count()) await reason.first().fill("Test: the promised date set at release");
  await m.page.getByRole("button", { name: "Release to workshop" }).click();
  await submitted(m.page);
  check("1c: released: the car is in work while its part is still to order", (await until(async () => (await sql("select status from public.jobs where id = $1 and status = 'in_work'", [JOB]))[0])) !== null, decodeURIComponent(m.page.url()).slice(-220));

  // 2. The technician's lines: WAITING FOR PART.
  const t = await browserForId(tech, { viewport: { width: 800, height: 1280 }, touch: true });
  await go(t.page, `${base}/my-jobs/${JOB}`);
  const tag = await text(t.page, "[data-todo-ready]");
  check("2: the technician sees WAITING FOR PART: <part>, <expected>", /^WAITING FOR PART: FRONT BRAKE PADS, (\d{4}-\d{2}-\d{2}|not ordered yet)/.test(tag), tag);
  await t.page.locator("[data-jobs-to-do]").screenshot({ path: path.join(OUT, "2-technician-waiting-800.png") });

  // 3. The manager: "Start anyway"; the steps tag.
  await go(m.page, `${base}/jobs/${JOB}/work`);
  await m.page.locator("[data-todo-start-anyway]").first().click();
  await until(async () => (await sql("select 1 as x from public.job_events where job_id = $1 and event_type = 'start_anyway'", [JOB]))[0]);
  await go(m.page, `${base}/jobs/${JOB}/work`);
  check("3a: Start anyway: the line reads START ANYWAY (dismantle and prepare)", (await m.page.locator('[data-todo-ready="anyway"]').count()) === 1);
  check("3b: Work complete still waits for the part (fitted or back order)", /not handed to the technician/.test(await text(m.page, "[data-work-blockers]")));
  await m.page.locator("[data-jobs-to-do]").screenshot({ path: path.join(OUT, "3-start-anyway-1440.png") });
  await go(m.page, `${base}/jobs/${JOB}`);
  check("3c: the steps say Work active with Parts: 0 of 1 here", /Work active · Parts: 0 of 1 here/.test(await text(m.page, "[data-parts-here]")));

  // 4. The part arrives: READY TO START.
  await sql("update public.part_items set order_status = 'received', received_qty = 1 where id = $1", [PA]);
  await go(t.page, `${base}/my-jobs/${JOB}`);
  check("4: the part is here: READY TO START", (await t.page.locator('[data-todo-ready="ready"]').count()) === 1);
  await t.page.locator("[data-jobs-to-do]").screenshot({ path: path.join(OUT, "4-technician-ready-800.png") });
  await t.browser.close();

  // 5. Headline: a decline the customer later reversed never shows; APPROVED IN PART.
  await sql("update public.jobs set declined_out_at = now() - interval '1 day' where id = $1", [JOB]);
  await sql("update public.quotations set responded_at = now() where id = $1", [QID]);
  const adv = await browserFor("service_advisor", { viewport: { width: 1440, height: 1100 } });
  await go(adv.page, `${base}/jobs/${JOB}`);
  check("5a: declined earlier but approved after: the headline never says Declined", !/Declined, car going out/.test(await text(adv.page, "[data-job-status]")), await text(adv.page, "[data-job-status]"));
  await sql("update public.quotation_lines set customer_approved = false where quotation_id = $1 and line_type = 'labour'", [QID]);
  await go(adv.page, `${base}/jobs/${JOB}`);
  check("5b: some items approved: APPROVED IN PART: 1 OF 2 ITEMS", /APPROVED IN PART: 1 OF 2 ITEMS/.test(await text(adv.page, "[data-approved-part]")));
  await adv.page.screenshot({ path: path.join(OUT, "5-approved-in-part-1440.png") });
  await adv.page.setViewportSize({ width: 800, height: 1280 });
  await adv.page.screenshot({ path: path.join(OUT, "5-approved-in-part-800.png") });
  await sql("update public.quotation_lines set customer_approved = null where quotation_id = $1 and line_type = 'labour'", [QID]);

  // 6. The inspection type: from a clear request, else hidden.
  await sql("update public.jobs set inspection_scope = null where id = $1", [JOB]);
  await sql("update public.job_requests set text = 'FULL INSPECTION' where job_id = $1", [JOB]);
  await go(adv.page, `${base}/jobs/${JOB}`);
  const scopeWords = await text(adv.page, "[data-scope-label]");
  check("6a: a finished inspection with no type: taken from the request (Full inspection)", /full/i.test(scopeWords) && !/not set/i.test(scopeWords), scopeWords);
  await sql("update public.job_requests set text = 'AC not cold' where job_id = $1", [JOB]);
  await go(adv.page, `${base}/jobs/${JOB}`);
  check("6b: no clear request: the \"not set\" box is hidden", (await adv.page.locator("[data-scope-box]").count()) === 0);
  await adv.browser.close();

  // 7. Everything declined: no LPO.
  const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active limit 1"))[0].id;
  await sql("insert into public.suppliers (name, vat_registered, trn) select 'E2E S1 Supplier', true, '100000000000003' where not exists (select 1 from public.suppliers where name ilike 'e2e s1 supplier')");
  // The approved part back to "to order" with a real supplier and price, so it can go on an LPO.
  await sql("update public.part_items set order_status = 'to_order', received_qty = 0, part_number = 'A1234567890', supplier = 'E2E S1 Supplier', availability = 'to_order', delivery_date = current_date + 2, cost_confirmed_aed = cost_aed, cost_confirmed_at = now(), priced_by = $2, priced_at = now() where id = $1", [PA, owner]);
  await sql("update public.part_requests set status = 'closed' where job_id = $1 and status = 'open'", [JOB]);
  const P2 = PA;

  await sql("update public.quotations set responded_at = now() - interval '2 days' where id = $1", [QID]);
  const refused = (await api("/api/e2e/stage", { stage: "lpo-create", id: JOB })).json;
  check("7: the customer declined everything (no approval after): no LPO can be raised", /declined all work/i.test(refused.error ?? ""), JSON.stringify(refused));
  await sql("update public.quotations set responded_at = now() where id = $1", [QID]);
  const sent = (await api("/api/e2e/stage", { stage: "lpo-create", id: JOB })).json;
  check("7b: approved after the decline: the LPO goes", !!sent.poId && !sent.error, JSON.stringify(sent));

  // 8. The LPO waits: accounts are nudged after 30 minutes, then every 30 minutes; the owner gets no bell.
  const po = (await sql("select id, number from public.purchase_orders where job_id = $1 and status = 'pending_approval' and is_active", [JOB]))[0];
  const now = Date.now();
  const mine = async () => (await sql("select count(*)::int as n from public.notifications n join public.staff s on s.id = n.staff_id where n.type = 'po_approval' and s.role_id = 'accounts' and n.title like $1", [`LPO waiting for approval%${po?.number}`]))[0].n;
  const nudge = async (mins) => { await api("/api/e2e/stage", { stage: "lpo-nudge", now: now + mins * 60000 }); return mine(); };
  const n10 = await nudge(10);
  const n40 = await nudge(40);
  // The bell was written at the real time: move it to the simulated "+40 min" so the next 30 minutes count from there.
  await sql("update public.notifications set created_at = to_timestamp($1 / 1000.0) where type = 'po_approval' and title like $2", [now + 40 * 60000, `LPO waiting for approval%${po?.number}`]);
  const n55 = await nudge(55);
  const n75 = await nudge(75);
  check("8a: nothing before 30 minutes; at 40 min a nudge; at 55 none; at 75 the next", n10 === 0 && n40 >= 1 && n55 === n40 && n75 > n55, JSON.stringify({ n10, n40, n55, n75 }));
  const bells = await sql("select s.role_id, n.title from public.notifications n join public.staff s on s.id = n.staff_id where n.type = 'po_approval' and n.title like $1", [`LPO waiting for approval%${po?.number}`]);
  check("8b: the nudges go to accounts, never the owner", bells.length >= 2 && bells.every((b) => b.role_id === "accounts"), JSON.stringify(bells.map((b) => b.role_id)));
  await m.browser.close();
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
