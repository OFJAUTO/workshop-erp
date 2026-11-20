// 20 November 2026, Section 2: LOOSE-ITEMS JOBS (NO CAR) AND THE JOB CARD BUTTON - the J-01034 case on TEST.
//  A. A booked car from an approved parts-only estimate opens on the JOB CARD (no longer the bodyshop page): the jobs,
//     the parts and their status, the booking, the promised handover, red "ARRIVAL WAS DUE …".
//  B. The advisor taps START THE JOB – LOOSE ITEMS: the same job opens as LOOSE ITEMS – NO CAR, mechanical, the
//     estimate carried, the quotation started from it.
//  C. The job card shows the four steps; "Nothing to receive" completes the first.
//  D. The car page has the JOB CARD button.
//  E. The gate role: "Loose items, no car" offers the customer's approved estimate (no amounts) to start from.
//  F. The bodyshop page of a parts-only booking: no PPF pre-work panel; never "Quotation not started" for an approved estimate.
// TEST only.  node --env-file=.env.test.local tests/browser/test-s20-2-loose-jobs.mjs
import fs from "node:fs";
import path from "node:path";
import { api, base, browserFor, cleanupDb, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-20-loose-jobs";
fs.mkdirSync(OUT, { recursive: true });
const until = async (fn, tries = 60, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const text = async (loc) => (((await loc.first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim());
const shots = async (page, el, name) => {
  for (const [w, h] of [[1440, 1000], [800, 1280]]) {
    await page.setViewportSize({ width: w, height: h });
    await sleep(300);
    await (el ?? page).screenshot({ path: path.join(OUT, `${name}-${w}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
};

async function estimate(cust, veh, number, staffId) {
  const id = (await sql("insert into public.quotations (kind, number, customer_id, vehicle_id, status, validity_days, vat_percent, created_by) values ('estimate', $1, $2, $3, 'draft', 30, 5, $4) returning id", [number, cust, veh, staffId]))[0].id;
  let pos = 1;
  for (const t of ["LINK REAR", "LOWER ARM BUSHING", "OIL FILTER"]) await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, quantity, unit_price, unit_cost, created_by) values ($1, $2, 'part', $3, 1, 200, 120, $4)", [id, pos++, t, staffId]);
  await sql("update public.quotations set status = 'approved', responded_at = now() where id = $1", [id]);
  return id;
}

try {
  cleanupDb();
  const seed = (await api("/api/e2e/stage", { stage: "quote" })).json;
  const SEEDJOB = seed.jobId;
  const j = (await sql("select customer_id, vehicle_id from public.jobs where id = $1", [SEEDJOB]))[0];
  const adv = (await sql("select id from public.staff where role_id = 'service_advisor' and is_active order by created_at limit 1"))[0].id;
  // The seed's own job leaves (closed), so the car is free for a booking.
  await sql("update public.jobs set is_open = false, status = 'closed' where id = $1", [SEEDJOB]);
  const E1 = await estimate(j.customer_id, j.vehicle_id, "E-E2E-LS1", adv);
  const held = (await sql("insert into public.jobs (vehicle_id, customer_id, status, stage, is_open, department, estimate_id, booked_arrival_at, promised_at, gated_in_by, created_by) values ($1, $2, 'booked', 'quote', false, 'mechanical', $3, now() - interval '1 day', now() + interval '1 day', $4, $4) returning id, job_number", [j.vehicle_id, j.customer_id, E1, adv]))[0];
  await sql("insert into public.part_items (job_id, description, quantity, cost_aed, order_status, delivery_date, is_active, priced_at) values ($1, 'LINK REAR', 1, 120, 'ordered', (now() + interval '5 day')::date, true, now())", [held.id]);

  // A. The advisor opens the booked car's job card.
  const a = await browserFor("service_advisor", { viewport: { width: 1440, height: 1000 } });
  await go(a.page, `${base}/jobs/${held.id}`);
  const card = a.page.locator("[data-booked-card]");
  await card.waitFor({ timeout: 30000 });
  check("A1: the booked car opens on the JOB CARD, not the bodyshop page", a.page.url().includes(`/jobs/${held.id}`));
  check("A2: red ARRIVAL WAS DUE …", /^ARRIVAL WAS DUE /.test(await text(card.locator("[data-arrival-due]"))));
  check("A3: the jobs and the parts with their status", /LINK REAR/.test(await text(card.locator("[data-booked-lines]"))) && /Ordered · expected/.test(await text(card.locator("[data-booked-parts]"))));
  check("A4: the warning: the promised handover cannot be met (a part expected after it)", /cannot be met/.test(await text(card.locator("[data-handover-risk]"))));
  await shots(a.page, card, "a-booked-job-card");

  // D. The car page's JOB CARD button.
  await go(a.page, `${base}/vehicles/${j.vehicle_id}`);
  check("D1: the car page has JOB CARD (booked)", (await a.page.locator(`[data-job-card-button="${held.id}"]`).count()) >= 1 && /JOB CARD/.test(await text(a.page.locator(`[data-job-card-button="${held.id}"]`))));

  // F. The bodyshop page of this parts-only booking.
  await go(a.page, `${base}/bodyshop/${held.id}`);
  const bodyText = await text(a.page.locator("body"));
  check("F1: no PPF pre-work panel on a parts-only job", !/Pre-work check \(before PPF\)/.test(bodyText));
  check("F2: never \"Quotation not started\" for an approved estimate", !/Quotation not started/.test(bodyText) && /approved by the customer/.test(await text(a.page.locator("[data-booked-quote-words]"))));

  // B. START THE JOB – LOOSE ITEMS.
  await go(a.page, `${base}/jobs/${held.id}?v=2`);
  await a.page.locator(`[data-start-loose="${E1}"] [data-start-loose-button]`).click();
  const opened = await until(async () => { const x = (await sql("select job_kind, status, is_open, department from public.jobs where id = $1", [held.id]))[0]; return x?.job_kind === "loose" && x?.is_open ? x : null; });
  check("B1: the same job opens as loose items, mechanical", opened?.status !== "booked" && opened?.department === "mechanical", JSON.stringify(opened ?? {}));
  const carried = await until(async () => (await sql("select carried_job_id from public.quotations where id = $1", [E1]))[0]?.carried_job_id === held.id);
  check("B2: the estimate is carried (nothing typed twice)", !!carried);
  const q = await until(async () => (await sql("select count(*)::int as n from public.quotations where job_id = $1 and kind = 'quotation'", [held.id]))[0].n > 0, 60);
  check("B3: the quotation starts from the estimate", !!q);

  // C. The job card: tag and the four steps; Nothing to receive.
  await go(a.page, `${base}/jobs/${held.id}?v=3`);
  check("C1: LOOSE ITEMS – NO CAR on the job card", /LOOSE ITEMS – NO CAR/.test(await text(a.page.locator("[data-loose-tag]"))));
  const flow = a.page.locator("[data-loose-flow]");
  await flow.waitFor({ timeout: 30000 });
  check("C2: four steps, Items received first", (await flow.locator("[data-loose-step]").count()) === 4 && (await flow.locator('[data-loose-step="received"]').getAttribute("data-state")) === "current");
  await shots(a.page, flow, "c-loose-flow");
  await flow.locator("[data-loose-nothing]").click();
  await until(async () => (await sql("select count(*)::int as n from public.job_events where job_id = $1 and event_type = 'items_none'", [held.id]))[0].n > 0);
  await go(a.page, `${base}/jobs/${held.id}?v=4`);
  check("C3: Nothing to receive completes the first step", (await a.page.locator('[data-loose-step="received"]').getAttribute("data-state")) === "done");
  await a.browser.close();

  // E. The gate: Loose items, no car, with the customer's approved estimate.
  const E2 = await estimate(j.customer_id, j.vehicle_id, "E-E2E-LS2", adv);
  const g = await browserFor("gate_in", { viewport: { width: 1440, height: 1000 } });
  await go(g.page, `${base}/gate-in/loose?customer=${j.customer_id}`);
  const row = g.page.locator('[data-loose-estimate="E-E2E-LS2"]');
  await row.waitFor({ timeout: 30000 });
  check("E1: the approved estimate is offered, with no amount for the gate", (await row.locator("[data-start-loose-button]").count()) === 1 && !/AED/.test(await text(row)));
  await shots(g.page, g.page.locator("[data-loose-estimates]"), "e-gate-loose-from-estimate");
  void E2;
  await g.browser.close();
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
