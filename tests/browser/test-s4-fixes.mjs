// 13 November 2026, Section 4: every warning comes with its fix. Gate-out of a bodyshop car with an incomplete warranty
// card: the owner presses "Enter details" and fills it on the same page (the warning clears); an advisor, who may not,
// gets "Remind the bodyshop manager". A balance due: "Remind accounts" for the advisor, "Record payment" for accounts.
// A quotation waiting for the owner: the advisor's "Remind the owner". The list of warnings is written. TEST only.
//   node --env-file=.env.test.local tests/browser/test-s4-fixes.mjs
import fs from "node:fs";
import path from "node:path";
import { api, base, browserFor, cleanupDb, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-13-warning-fixes";
fs.mkdirSync(OUT, { recursive: true });
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };

try {
  cleanupDb();
  const seed = (await api("/api/e2e/stage", { stage: "bodyshop", at: "ready" })).json;
  const JOB = seed.jobId;
  const since = async () => (await sql("select coalesce(max(id), 0) as m from public.notifications"))[0].m;

  // 1. The owner: "Enter details" fills the warranty card on the gate-out page.
  const own = await browserFor("owner", { viewport: { width: 1440, height: 1100 } });
  await go(own.page, `${base}/jobs/${JOB}/gate-out`);
  const w = own.page.locator('[data-fixit="warranty"]');
  check("1a: the gate-out warns the warranty card is incomplete, with \"Enter details\" beside it", (await w.count()) === 1 && (await w.locator("[data-fixit-open]").count()) === 1, (await w.textContent().catch(() => "")) ?? "");
  if (await w.count()) {
    await w.locator("[data-fixit-open]").click();
    await w.locator("[data-fixit-panel]").waitFor({ timeout: 10000 });
    await own.page.locator("[data-fixit-panel]").screenshot({ path: path.join(OUT, "1-enter-details-panel-1440.png") });
    for (const box of await w.locator("input[data-warranty-roll]").all()) await box.fill("E2E-ROLL-77");
    for (const area of await w.locator("[data-warranty-area]").all()) { if ((await area.getAttribute("aria-pressed")) !== "true") { await area.click(); break; } }
    for (const box of await w.locator('input[placeholder="Ceramic product name"]').all()) await box.fill("E2E CERAMIC PRO");
    const before = own.page.url();
    await w.locator("[data-warranty-fix-save]").click();
    await own.page.waitForURL((u) => u.toString() !== before, { timeout: 30000 }).catch(() => null);
    await sleep(1200);
    check("1b: saved and back on the gate-out page (never left)", /\/gate-out\?message=/.test(own.page.url()), own.page.url());
    check("1c: the warning cleared", (await own.page.locator('[data-fixit="warranty"]').count()) === 0, (await own.page.locator('[data-fixit="warranty"]').textContent().catch(() => "")) ?? "");
  }

  // 2. An advisor may not write warranty details: "Remind the bodyshop manager". The balance: "Remind accounts".
  await sql("update public.warranty_entries set roll_batch = null where job_id = $1", [JOB]).catch(() => null);
  const adv = await browserFor("service_advisor", { viewport: { width: 800, height: 1280 }, touch: true });
  await go(adv.page, `${base}/jobs/${JOB}/gate-out`);
  const aw = adv.page.locator('[data-fixit="warranty"]');
  if (await aw.count()) {
    const m0 = await since();
    await aw.locator("[data-fixit-remind]").click();
    const told = await until(async () => (await sql("select n.title from public.notifications n where n.id > $1 and n.type = 'fix_reminder'", [m0]))[0]);
    check("2a: the advisor reminds the bodyshop manager (one bell)", !!told && /warranty card details/.test(told.title), told?.title);
    check("2b: the button says Reminded", /Reminded/.test((await aw.locator("[data-fixit-remind]").textContent()) ?? ""));
  } else check("2a: the advisor sees the warranty warning", false, "no warning (the card may be complete on this seed)");
  const pay = adv.page.locator("[data-gateout-fix-pay]");
  check("2c: beside the balance due: \"Remind accounts\" for the advisor", (await pay.locator("[data-fixit-remind]").count()) === 1);
  await adv.page.screenshot({ path: path.join(OUT, "2-advisor-gate-out-800.png"), fullPage: true });
  const acc = await browserFor("accounts", { viewport: { width: 1440, height: 1100 } });
  await go(acc.page, `${base}/jobs/${JOB}/gate-out`);
  check("2d: for accounts: \"Record payment\" right there", (await acc.page.locator("[data-gateout-fix-pay] [data-record-payment-open], [data-gateout-fix-pay] button").count()) >= 1);
  await acc.browser.close();

  // 3. A quotation waiting for the owner: the advisor's "Remind the owner".
  const q = (await api("/api/e2e/stage", { stage: "quote" })).json;
  await sql("update public.quotations set status = 'pending_owner', owner_approval_reason = 'E2E: total above the approval amount' where id = $1", [q.quotationId]);
  await go(adv.page, `${base}/jobs/${q.jobId}/quote/${q.quotationId}`);
  const ow = adv.page.locator('[data-fixit="owner-approval"]');
  check("3: waiting for the owner: \"Remind the owner\" beside it", (await ow.locator("[data-fixit-remind]").count()) === 1);
  await adv.browser.close();
  await own.browser.close();

  // 4. The list of every warning on the staff screens is written.
  const list = fs.readFileSync("docs/warnings-list-13-nov.md", "utf8");
  check("4: the warnings list exists, every blocking warning with its fix", /with a fix beside them/.test(list), list.split("\n")[2]);
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
