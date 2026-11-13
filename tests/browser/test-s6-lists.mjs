// 13 November 2026, Section 6: the Estimates and Quotations lists. Signed in as an advisor: Mine first (All shows the
// others'), tabs PREPARING / SENT / APPROVED with counts and Closed behind a link, the row tags, the age tag turning red,
// search, the owner-approved-not-sent list, "Not going ahead" with a reason, the 2-day ready-to-send reminder and the
// owner's count. The Quotations page uses the same list. TEST only.
//   node --env-file=.env.test.local tests/browser/test-s6-lists.mjs
import fs from "node:fs";
import path from "node:path";
import { api, base, browserForId, cleanupDb, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-13-estimate-lists";
fs.mkdirSync(OUT, { recursive: true });
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const made = [];
const DAY = 86_400_000;
const ago = (d) => new Date(Date.now() - d * DAY).toISOString();

try {
  cleanupDb();
  const advisors = await sql("select id, display_name from public.staff where role_id = 'service_advisor' and is_active order by display_name limit 2");
  const [me, other] = advisors;
  const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active limit 1"))[0].id;
  const mm = (await sql("select m.id as make_id, v.id as model_id from public.vehicle_makes m join public.vehicle_models v on v.make_id = m.id where m.is_active and v.is_active order by m.name, v.name limit 1"))[0];
  const cust = (await sql("insert into public.customers (customer_type, full_name, phone) values ('individual', 'E2e List Customer', '+971500000094') returning id"))[0].id;
  const car = async (n) => (await sql("insert into public.vehicles (customer_id, has_plate, plate_country, plate_emirate, plate_code, plate_number, make_id, model_id, model_year) values ($1, true, 'UAE', 'Dubai', 'K', $2, $3, $4, 2023) returning id", [cust, n, mm.make_id, mm.model_id]))[0].id;
  const est = async (carId, by, status, extra = {}) => {
    const cols = ["kind", "customer_id", "vehicle_id", "status", "validity_days", "created_by", "updated_by", ...Object.keys(extra)];
    const vals = ["estimate", cust, carId, status, 7, by, by, ...Object.values(extra)];
    const q = (await sql(`insert into public.quotations (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id, number`, vals))[0];
    made.push(q.id);
    return q;
  };
  const line = async (qid, by, title, extra = "") => { await sql("update public.quotations set total_aed = 735 where id = $1", [qid]); return line0(qid, by, title, extra); };
  const line0 = (qid, by, title, extra = "") => sql(`insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, hours, labour_rate, line_total, created_by, updated_by${extra ? ", price_requested_at" : ""}) values ($1, 1, '${extra ? "part" : "labour"}', $2, 'manual', 1, ${extra ? "null" : "2"}, ${extra ? "null" : "350"}, ${extra ? "0" : "700"}, $3, $3${extra ? ", now()" : ""})`, [qid, title, by]);
  // Mine: a ready draft; a sent one 3 days ago. Theirs: a draft with a part on the desk. An owner-approved one unsent 3 days.
  const mineReady = await est(await car("71001"), me.id, "draft");
  await line(mineReady.id, me.id, "E2E OIL SERVICE");
  const mineSent = await est(await car("71002"), me.id, "draft");
  await line(mineSent.id, me.id, "E2E BRAKE JOB");
  await sql("update public.quotations set status = 'sent', sent_at = $2 where id = $1", [mineSent.id, ago(3)]);
  const theirs = await est(await car("71003"), other.id, "draft");
  await line(theirs.id, other.id, "E2E HEADLIGHT", "part");
  const approvedUnsent = await est(await car("71004"), me.id, "draft");
  await line(approvedUnsent.id, me.id, "E2E SUSPENSION");
  await sql("update public.quotations set owner_approved_at = $2, owner_approved_by = $3 where id = $1", [approvedUnsent.id, ago(3), owner]);

  // 1. The advisor opens on Mine, Preparing.
  const adv = await browserForId(me.id, { viewport: { width: 1440, height: 1000 } });
  await go(adv.page, `${base}/estimates`);
  const row = (n) => adv.page.locator(`[data-quote-list-row="${n}"]`);
  check("1a: opens on Mine and the Preparing tab", (await adv.page.locator('[data-list-who="mine"]').count()) === 1 && (await adv.page.locator('[data-quote-tab="preparing"][data-quote-tab-on="1"]').count()) === 1);
  check("1b: my ready draft shows with \"Ready to send\"; the other advisor's does not", (await row(mineReady.number).count()) === 1 && (await row(mineReady.number).locator('[data-row-tag="ready"]').count()) === 1 && (await row(theirs.number).count()) === 0);
  check("1c: tabs carry counts; Closed sits behind a link", (await adv.page.locator("[data-quote-tab] [data-quote-tab-count]").count()) === 3 && (await adv.page.locator("[data-closed-link]").count()) === 1);
  check("1d: the owner-approved estimate not sent for 3 days is listed (read-only)", (await adv.page.locator(`[data-owner-approved-unsent] [data-owner-approved-row="${approvedUnsent.number}"]`).count()) === 1);
  await adv.page.screenshot({ path: path.join(OUT, "1-advisor-mine-preparing-1440.png"), fullPage: true });

  // 2. All shows the other advisor's, with "With parts desk".
  await adv.page.locator('[data-list-who-choice="all"]').click();
  await adv.page.waitForURL(/who=all/, { timeout: 15000 });
  check("2: All shows the other advisor's estimate tagged With parts desk", (await row(theirs.number).locator('[data-row-tag="desk"]').count()) === 1);

  // 3. Sent: my estimate sent 3 days ago, the age tag red.
  await go(adv.page, `${base}/estimates?tab=sent`);
  const sentAge = row(mineSent.number).locator("[data-row-age]");
  check("3: Sent tab: sent 3 days ago, the age tag is red", (await sentAge.getAttribute("data-age-red")) === "1" && /3 days/.test((await sentAge.textContent()) ?? ""), (await sentAge.textContent().catch(() => "")) ?? "");

  // 4. Search by plate without spaces.
  await go(adv.page, `${base}/estimates?who=all`);
  await adv.page.locator("[data-list-search]").fill("k71003");
  await adv.page.locator("[data-list-search]").press("Enter");
  await adv.page.waitForURL(/q=k71003/i, { timeout: 15000 });
  check("4: search by plate finds the one estimate", (await adv.page.locator("[data-quote-list-row]").count()) === 1 && (await row(theirs.number).count()) === 1);

  // 5. Not going ahead, with a reason: moves to Closed.
  await go(adv.page, `${base}/estimates`);
  await row(mineReady.number).locator("[data-estimate-dots]").click();
  await adv.page.locator('[data-estimate-action="cancel"]').click();
  const dlg = adv.page.locator('[data-estimate-dialog="cancel"]');
  await dlg.getByRole("button", { name: "Price too high" }).click();
  await dlg.locator("[data-estimate-confirm]").click();
  const closed = await until(async () => (await sql("select status, cancel_reason from public.quotations where id = $1", [mineReady.id]))[0]?.status === "cancelled");
  const why = (await sql("select cancel_reason from public.quotations where id = $1", [mineReady.id]))[0]?.cancel_reason;
  check("5a: Not going ahead keeps it with the reason", !!closed && /Price too high/.test(why ?? ""), why);
  await go(adv.page, `${base}/estimates?tab=closed`);
  check("5b: it is under Closed with the reason", (await row(mineReady.number).locator("[data-cancel-reason]").count()) === 1);

  // 6. The 2-day ready-to-send reminder, and the owner's evening count.
  const fresh = await est(await car("71005"), me.id, "draft");
  await line(fresh.id, me.id, "E2E WHEEL ALIGNMENT");
  const later = Date.now() + 3 * DAY;
  const evening = (() => { const d = new Date(later); d.setUTCHours(18, 0, 0, 0); return d.getTime(); })();
  await api("/api/e2e/stage", { stage: "ready-reminders", now: evening });
  const bell = await until(async () => (await sql("select title from public.notifications where staff_id = $1 and type = 'ready_to_send' and href like $2", [me.id, `%${fresh.id}%`]))[0]);
  check("6a: ready to send for 2+ days reminds the advisor", !!bell && /Ready to send for 3 days/.test(bell.title), bell?.title);
  const ownerBell = await until(async () => (await sql("select title from public.notifications where staff_id = $1 and type = 'ready_to_send_count' order by id desc limit 1", [owner]))[0]);
  check("6b: the owner gets the evening count", !!ownerBell && /ready to send for 2\+ days/.test(ownerBell.title), ownerBell?.title);
  // The reminder is stamped at the real time; move it to the simulated evening so "within 2 days" is measured there.
  await sql("update public.quotation_events set created_at = $2 where quotation_id = $1 and event_type = 'ready_to_send_reminder'", [fresh.id, new Date(evening).toISOString()]);
  await api("/api/e2e/stage", { stage: "ready-reminders", now: evening + 3600_000 });
  const twice = (await sql("select count(*)::int as n from public.notifications where staff_id = $1 and type = 'ready_to_send' and href like $2", [me.id, `%${fresh.id}%`]))[0].n;
  check("6c: not reminded twice within 2 days", twice === 1, String(twice));

  // 7. Tablet size, and the Quotations page uses the same list.
  const tab = await browserForId(me.id, { viewport: { width: 800, height: 1280 }, touch: true });
  await go(tab.page, `${base}/estimates?who=all`);
  await tab.page.screenshot({ path: path.join(OUT, "7-advisor-all-800.png"), fullPage: true });
  await go(tab.page, `${base}/quotes`);
  check("7: the Quotations page has the same tabs, search and Mine/All", (await tab.page.locator("[data-quote-tabs] [data-quote-tab]").count()) === 3 && (await tab.page.locator("[data-list-search]").count()) === 1 && (await tab.page.locator("[data-list-who]").count()) === 1);
  await tab.page.screenshot({ path: path.join(OUT, "7-quotations-800.png"), fullPage: true });
  await go(adv.page, `${base}/quotes`);
  await adv.page.screenshot({ path: path.join(OUT, "7-quotations-1440.png"), fullPage: true });
  await tab.browser.close();
  await adv.browser.close();
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  if (made.length) await sql("delete from public.notifications where " + made.map((_, i) => `href like $${i + 1}`).join(" or "), made.map((id) => `%${id}%`)).catch(() => null);
  await sql("delete from public.notifications where type = 'ready_to_send_count' and created_at > now() - interval '1 hour'").catch(() => null);
  cleanupDb();
  await sql("select setval('public.estimate_number_seq', greatest(1, coalesce((select max(substring(number from 3)::int) from public.quotations where number ~ '^E-[0-9]+$'), 1)))").catch(() => null);
}
process.exit(summary() ? 1 : 0);
