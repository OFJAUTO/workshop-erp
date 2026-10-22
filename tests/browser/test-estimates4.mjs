// Overnight 22-23 October 2026, section 4: estimates - Delete a draft, Cancel a sent one with a reason (kept under
// Cancelled / expired, the customer's link says withdrawn), expire, Re-send / extend with one tap, the duplicate
// question when starting a second estimate for the same car, Copy estimate without the commission, and an accepted
// estimate offers Copy only.
// Run: node --env-file=.env.local tests/browser/test-estimates4.mjs   (dev server; E2E_BASE for another port)
import path from "node:path";
import { api, base, browserFor, cleanupDb, go, here, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shot = (name) => path.join(here, "shots", name);
const text = async (loc) => ((await loc.first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };

cleanupDb();
const seed = await api("/api/e2e/stage", { stage: "quote" });
const job = (await sql("select customer_id, vehicle_id from public.jobs where id = $1", [seed.json.jobId]))[0];
const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active limit 1"))[0].id;
const custName = (await sql("select coalesce(company_name, full_name) as n from public.customers where id = $1", [job.customer_id]))[0].n;
const mk = async (status, extra = "") => {
  const tok = `e2eest${Math.random().toString(36).slice(2, 12)}`;
  const r = (await sql(`insert into public.quotations (kind, customer_id, vehicle_id, status, token, validity_days, sent_at, valid_until, created_by, updated_by${extra ? ", commission_to, commission_kind, commission_value, commission_aed, commission_status, commission_set_by, commission_set_at" : ""}) values ('estimate', $1, $2, $3, $4, 7, ${status === "draft" ? "null" : "now() - interval '1 day'"}, ${status === "expired_soon" ? "now() - interval '1 hour'" : "now() + interval '6 days'"}, $5, $5${extra ? ", 'E2e Agent', 'aed', 500, 500, 'approved', $5, now()" : ""}) returning id, number, token`, [job.customer_id, job.vehicle_id, status === "expired_soon" ? "sent" : status, tok, owner]))[0];
  await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, hours, labour_rate, line_total, created_by, updated_by) values ($1, 1, 'labour', 'E2e brake service', 'manual', 1, 2, 350, 700, $2, $2), ($1, 2, 'labour', 'E2e wheel alignment', 'manual', 1, 1, 350, 350, $2, $2)", [r.id, owner]);
  return r;
};
const draft = await mk("draft");
const sent = await mk("sent");
const old = await mk("expired_soon", "commission");

const { browser, page } = await browserFor("owner", { viewport: { width: 1366, height: 1000 } });
await go(page, `${base}/estimates`);
const rowOf = (n) => page.locator(`[data-estimate-row="${n}"]`);

/* 1. Delete a draft */
await rowOf(draft.number).locator("[data-estimate-dots]").click();
check("1: a draft's menu offers Delete (and Copy), not Cancel", (await page.locator('[data-estimate-action="delete"]').count()) === 1 && (await page.locator('[data-estimate-action="cancel"]').count()) === 0);
await page.locator('[data-estimate-action="delete"]').click();
check("1: Delete asks first in a centre window", /Delete .* never sent/.test(await text(page.locator('[data-estimate-dialog="delete"]'))));
await page.screenshot({ path: shot("est4-1-delete-confirm.png") });
await page.locator("[data-estimate-confirm]").click();
check("1: the draft is gone from the list (inactive, logged)", !!(await until(async () => ((await sql("select is_active from public.quotations where id = $1", [draft.id]))[0]?.is_active === false ? 1 : null))) && (await until(async () => ((await rowOf(draft.number).count()) === 0 ? 1 : null), 20, 500)) === 1);

/* 2. Cancel a sent one with a reason */
await rowOf(sent.number).locator("[data-estimate-dots]").click();
check("2: a sent estimate offers Cancel, never Delete", (await page.locator('[data-estimate-action="cancel"]').count()) === 1 && (await page.locator('[data-estimate-action="delete"]').count()) === 0);
await page.locator('[data-estimate-action="cancel"]').click();
await page.locator('[data-estimate-dialog="cancel"] input[name="cancel_reason"]').fill(`Replaced by ${old.number}`);
await page.screenshot({ path: shot("est4-2-cancel-reason.png") });
await page.locator("[data-estimate-confirm]").click();
const c = await until(async () => { const r = (await sql("select status, cancel_reason, is_active from public.quotations where id = $1", [sent.id]))[0]; return r?.status === "cancelled" ? r : null; });
check("2: cancelled with the reason, kept (never deleted)", !!c && c.is_active && c.cancel_reason === `Replaced by ${old.number}`, JSON.stringify(c));
await go(page, `${base}/estimates`);
check("2: it moved to the folded 'Cancelled / expired' section", (await page.locator(`[data-estimates-closed] [data-estimate-row="${sent.number}"]`).count()) === 1 && (await page.locator("[data-estimates-closed]").getAttribute("open")) === null);
const { browser: cb, page: cp } = await browserFor("owner", { viewport: { width: 420, height: 800 } });
await go(cp, `${base}/quote/${sent.token}`);
check("2: the customer's link says it was withdrawn", /withdrawn/i.test(await text(cp.locator("main"))));
await cb.close();

/* 3. Expiry and Re-send / extend */
const { browser: xb, page: xp } = await browserFor("owner", { viewport: { width: 420, height: 800 } });
await go(xp, `${base}/quote/${old.token}`);
await xb.close();
check("3: past 'valid until' without a reply, it is Expired", (await sql("select status from public.quotations where id = $1", [old.id]))[0]?.status === "expired");
await go(page, `${base}/estimates`);
await page.locator("[data-estimates-closed] summary").click();
check("3: the expired one is under Cancelled / expired too", (await page.locator(`[data-estimates-closed] [data-estimate-row="${old.number}"]`).count()) === 1);
await page.screenshot({ path: shot("est4-3-closed-section.png") });
await rowOf(old.number).locator("[data-estimate-dots]").click();
await page.locator('[data-estimate-action="extend"]').click();
const dlg = page.locator('[role="dialog"]').filter({ hasText: "Re-send" });
await dlg.waitFor({ timeout: 20000 });
check("3: Re-send / extend opens the prepared WhatsApp with the estimate link", /\/q\/|\/quote\//.test(await text(dlg)) && /Re-send/.test(await text(dlg)));
await page.screenshot({ path: shot("est4-4-resend.png") });
const ext = (await sql("select status, valid_until > now() + interval '5 days' as fresh, extended_at is not null as ext from public.quotations where id = $1", [old.id]))[0];
// The customer had opened it before, so it is back to Opened (waiting for the customer) with a fresh validity.
check("3: back to waiting for the customer with a fresh validity (7 days)", ["sent", "opened"].includes(ext.status) && ext.fresh && ext.ext, JSON.stringify(ext));
await page.keyboard.press("Escape");

/* 4. The duplicate question */
await go(page, `${base}/estimates/new?customer=${job.customer_id}&vehicle=${job.vehicle_id}`);
await page.locator('[data-start-form="estimate"] button[type="submit"]').first().click();
const dup = page.locator("[data-estimate-duplicate]");
await dup.waitFor({ timeout: 20000 });
check(`4: '${custName} already has ${old.number} – open it instead?'`, (await text(dup)).includes(`${custName} already has ${old.number} – open it instead?`), await text(dup));
await page.screenshot({ path: shot("est4-5-duplicate.png") });
check("4: 'Open' goes to the existing estimate", ((await page.locator("[data-estimate-open-existing]").getAttribute("href")) ?? "").endsWith(old.id));
const before = (await sql("select count(*)::int as n from public.quotations where kind = 'estimate' and customer_id = $1 and is_active", [job.customer_id]))[0].n;
await page.locator("[data-estimate-new-anyway]").click();
await page.waitForURL(/\/estimates\/[0-9a-f-]{36}/, { timeout: 30000 });
check("4: 'Create a new one anyway' makes a second one on purpose", (await sql("select count(*)::int as n from public.quotations where kind = 'estimate' and customer_id = $1 and is_active", [job.customer_id]))[0].n === before + 1);

/* 5. Copy estimate - the commission is not copied */
await go(page, `${base}/estimates/${old.id}`);
await page.locator("[data-estimate-dots]").first().click();
await page.locator('[data-estimate-action="copy"]').click();
await page.waitForURL((u) => /\/estimates\/[0-9a-f-]{36}\?message=/.test(u.toString()) && !u.toString().includes(old.id), { timeout: 30000 });
const newId = page.url().match(/estimates\/([0-9a-f-]{36})/)[1];
const copy = (await sql("select number, status, commission_to, commission_aed, copied_from_id, (select count(*)::int from public.quotation_lines where quotation_id = q.id and is_active) as lines from public.quotations q where id = $1", [newId]))[0];
check("5: the copy is a new draft estimate with both lines, linked to its source", copy.status === "draft" && copy.lines === 2 && copy.copied_from_id === old.id && copy.number !== old.number, JSON.stringify(copy));
check("5: the commission was NOT copied", copy.commission_to === null && Number(copy.commission_aed ?? 0) === 0, JSON.stringify(copy));
await page.screenshot({ path: shot("est4-6-copy.png") });

/* 6. An accepted estimate: Copy only */
await sql("update public.quotations set status = 'approved', responded_at = now(), approver_name = 'E2e Customer' where id = $1", [newId]);
await go(page, `${base}/estimates`);
await rowOf(copy.number).locator("[data-estimate-dots]").click();
check("6: an accepted estimate offers Copy only (no Delete, no Cancel)", (await page.locator('[data-estimate-action="copy"]').count()) === 1 && (await page.locator('[data-estimate-action="delete"], [data-estimate-action="cancel"], [data-estimate-action="extend"]').count()) === 0);
await browser.close();

cleanupDb();
check("cleanup: no test estimates left", (await sql("select count(*)::int as n from public.quotations where customer_id = $1", [job.customer_id]))[0].n === 0);
process.exit(summary() ? 1 : 0);
