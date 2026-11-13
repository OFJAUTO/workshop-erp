// 13 November 2026, Section 15: approvals stand-in - the owner sends his approvals to a person between two dates, by
// type with a cost limit; the stand-in decides through the same Approvals page "on behalf of the owner"; never their
// own request; above the limit it waits for the owner; the team is told; one tap ends it. TEST only.
//   node --env-file=.env.test.local tests/browser/test-s13-15-standin.mjs
import fs from "node:fs";
import { api, base, browserFor, browserForId, cleanupDb, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-13-standin";
fs.mkdirSync(OUT, { recursive: true });
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const day = (n) => new Date(Date.now() + 4 * 3600000 + n * 86400000).toISOString().slice(0, 10);
let before = null;

try {
  cleanupDb();
  before = (await sql("select value from public.settings where key = 'approval_standin'"))[0]?.value ?? null;
  const [standin, other] = await sql("select id, display_name from public.staff where role_id = 'service_advisor' and is_active order by display_name limit 2");
  const seed = await api("/api/e2e/stage", { stage: "quote" });
  const qid = (await sql("select id from public.quotations where job_id = $1 order by created_at limit 1", [seed.json.jobId]))[0].id;
  const wait = async (total, by) => sql("update public.quotations set status = 'pending_owner', owner_approval_reason = 'E2E: total above the approval amount', total_aed = $2, completed_by = $3, owner_approved_by = null, owner_approved_at = null where id = $1", [qid, total, by]);

  // 1. The owner sends his quotation approvals to an advisor, up to AED 5,000, for three days.
  const o = await browserFor("owner", { viewport: { width: 1440, height: 900 } });
  await go(o.page, `${base}/settings/approvals#stand-in`);
  await o.page.locator("[data-standin-person]").selectOption(standin.id);
  await o.page.locator("[data-standin-from]").fill(day(0));
  await o.page.locator("[data-standin-until]").fill(day(3));
  await o.page.locator('[data-standin-type="quote"] input[type=checkbox]').check();
  await o.page.locator('[data-standin-limit="quote"]').fill("5000");
  const since = new Date().toISOString();
  await o.page.locator("[data-standin-save]").click();
  await o.page.locator("[data-standin-saved]").waitFor({ timeout: 20000 }).catch(() => null);
  check("1: saved: 'Your approvals go to <name> …'", new RegExp(`go to ${standin.display_name}`).test((await o.page.locator("[data-standin-saved]").textContent().catch(() => "")) ?? ""));
  await o.page.locator("#stand-in").screenshot({ path: `${OUT}/s15-settings-1440.png` });
  const notice = await until(async () => (await sql("select count(*)::int n from public.notifications where type = 'approval_standin' and created_at >= $1 and title like 'Approvals go to %'", [since]))[0].n >= 1);
  check("1: the team gets the notice 'Approvals go to <name> until <date>'", !!notice);

  // 2. A quotation of AED 3,000 asked by another advisor: the stand-in sees and approves it.
  await wait(3000, other.id);
  const s = await browserForId(standin.id, { viewport: { width: 800, height: 1280 }, touch: true });
  await go(s.page, `${base}/approvals`);
  check("2: the stand-in has Approvals in the menu", (await s.page.locator('a[href="/approvals"]').count()) >= 1);
  const box = s.page.locator(`[data-approval-box="quote:${qid}"]`);
  check("2: the request is on the stand-in's Approvals page", (await box.count()) === 1);
  await s.page.screenshot({ path: `${OUT}/s15-standin-approvals-800.png` });
  await box.locator("[data-approval-approve]").click();
  const done = await until(async () => { const q = (await sql("select status, owner_approved_by from public.quotations where id = $1", [qid]))[0]; return q.status === "draft" && q.owner_approved_by === standin.id ? q : null; });
  check("2: approved through the same door (back to the advisor, approved by the stand-in)", !!done);
  const log = (await until(async () => { const rows = (await sql("select value from public.settings where key = 'approval_standin_log'"))[0]?.value?.rows ?? []; return rows.length ? rows : null; }, 30)) ?? [];
  check("2: logged as '<name> on behalf of the owner'", log.some((r) => r.by === `${standin.display_name} on behalf of the owner` && r.decision === "approved"));

  // 3. Above the limit, and the stand-in's own request: both wait for the owner.
  await wait(9000, other.id);
  await go(s.page, `${base}/approvals`);
  check("3: above the AED 5,000 limit: not on the stand-in's page", (await s.page.locator(`[data-approval-box="quote:${qid}"]`).count()) === 0);
  await wait(3000, standin.id);
  await go(s.page, `${base}/approvals`);
  check("3: their own request: not on their page (nobody approves their own)", (await s.page.locator(`[data-approval-box="quote:${qid}"]`).count()) === 0);
  await go(o.page, `${base}/approvals`);
  check("3: the owner still sees it, with the banner and the stand-in's decisions", (await o.page.locator(`[data-approval-box="quote:${qid}"]`).count()) === 1 && (await o.page.locator("[data-standin-banner]").count()) === 1 && (await o.page.locator("[data-standin-row]").count()) >= 1);
  await o.page.screenshot({ path: `${OUT}/s15-owner-approvals-1440.png` });

  // 4. One tap ends it: the stand-in's Approvals go away.
  await go(o.page, `${base}/settings/approvals#stand-in`);
  await o.page.locator("[data-standin-end]").click();
  await o.page.locator("[data-standin-saved]").waitFor({ timeout: 20000 }).catch(() => null);
  await go(s.page, `${base}/home`);
  check("4: 'End now' ends it at once (no Approvals for the stand-in)", (await s.page.locator('a[href="/approvals"]').count()) === 0);
  const r = await s.page.request.get(`${base}/approvals`);
  check("4: the page answers Not found to the former stand-in", r.status() === 404);
  await sql("update public.quotations set status = 'draft', owner_approval_reason = null where id = $1", [qid]);
  await s.browser.close();
  await o.browser.close();
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  await sql("update public.settings set value = coalesce($1::jsonb, '{}'::jsonb) where key = 'approval_standin'", [before === null ? null : JSON.stringify(before)]).catch(() => null);
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
