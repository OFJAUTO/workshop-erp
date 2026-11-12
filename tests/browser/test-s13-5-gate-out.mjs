// 13 November 2026, Section 5: gate-out - the owner's release, sign-offs only from teams that worked, the bodyshop
// manager signing for an absent leader, unpaid release owner-only with its confirmation, "Out with balance due".
// TEST only.   node --env-file=.env.test.local tests/browser/test-s13-5-gate-out.mjs
import fs from "node:fs";
import { api, base, browserFor, browserForId, cleanupDb, makeChecks, pageReady, sleep } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-13-gate-out";
fs.mkdirSync(OUT, { recursive: true });
async function q(text, params = []) {
  const r = await api("/api/e2e/sql", { sql: text, params });
  if (r.status !== 200) throw new Error(`SQL failed: ${JSON.stringify(r.json ?? r.text).slice(0, 300)}\n${text.slice(0, 200)}`);
  return r.json.rows ?? [];
}
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const txt = async (loc) => ((await loc.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();

try {
  cleanupDb();
  const st = await api("/api/e2e/stage", { stage: "bodyshop", at: "ready" });
  if (st.status !== 200) throw new Error(`stage: ${st.status} ${JSON.stringify(st.json).slice(0, 200)}`);
  const jobId = st.json.jobId;
  const people = st.json.people ?? {};
  // A team whose stage was only planned (never started) is not asked to sign.
  await q("update public.bodyshop_stages set status = 'pending', done_at = null, done_by = null where job_id = $1 and section = 'detailing' and is_active", [jobId]);

  // 1. The bodyshop manager signs for an absent PPF leader (his own PIN, logged on behalf).
  const managerId = people.manager ?? people.managerId ?? (await q("select id from public.staff where display_name ilike 'E2e%manager%' limit 1"))[0]?.id;
  if (managerId) {
    const m = await browserForId(managerId, { viewport: { width: 1366, height: 900 } });
    await m.page.goto(`${base}/bodyshop/${jobId}#signoff`, { waitUntil: "domcontentloaded" });
    await pageReady(m.page);
    const panel = m.page.locator("[data-signoff-panel]");
    const keys = await panel.locator("[data-signoff-row]").evaluateAll((els) => els.map((e) => e.getAttribute("data-signoff-row")));
    check("detailing is not asked (its stage never started)", !keys.includes("detailing"), keys.join(","));
    const ppfRow = panel.locator("[data-signoff-row='ppf']");
    if (await ppfRow.count()) {
      await ppfRow.locator("[data-signoff-open]").click();
      await ppfRow.locator("[data-signoff-pin]").fill("1234");
      await ppfRow.locator("[data-signoff-confirm]").click();
      const signed = await until(async () => (await q("select on_behalf, staff_id from public.bodyshop_signoffs where job_id = $1 and role_key = 'ppf' and is_active", [jobId]))[0]);
      check("the bodyshop manager signed for the PPF leader, recorded on behalf", signed?.on_behalf === true && signed.staff_id === managerId, JSON.stringify(signed));
    } else check("the PPF sign-off row is there", false, keys.join(","));
    await m.browser.close();
  } else check("the seed has a bodyshop manager", false, JSON.stringify(people).slice(0, 200));

  // 2. Accounts cannot release a car with money owing (only the owner can).
  const a = await browserFor("accounts", { viewport: { width: 1366, height: 900 } });
  await a.page.goto(`${base}/jobs/${jobId}/gate-out`, { waitUntil: "domcontentloaded" });
  await pageReady(a.page);
  const aText = await txt(a.page.locator("main"));
  check("accounts: blocked until it is paid or the owner releases it", /blocked until it is paid, or the owner releases it/.test(aText) || /Release sign-off still needed/.test(aText), aText.slice(0, 200));
  await a.browser.close();

  // 3. The owner: the sign-off message once, "Release as owner" with a reason, the unpaid confirmation.
  const o = await browserFor("owner", { viewport: { width: 1366, height: 900 } });
  await o.page.goto(`${base}/jobs/${jobId}/gate-out`, { waitUntil: "domcontentloaded" });
  await pageReady(o.page);
  const body = await txt(o.page.locator("main"));
  check("the sign-off message shows once", (body.match(/Release sign-off still needed/g) ?? []).length === 1, String((body.match(/Release sign-off still needed/g) ?? []).length));
  check("Release as owner is offered", (await o.page.locator("[data-owner-release]").count()) === 1);
  // Fill the gate-out.
  await o.page.locator("input[name='keys_ok']").check().catch(() => null);
  await o.page.locator("input[name='keychain_ok']").check().catch(() => null);
  await o.page.locator("input[name='collector_name']").fill("E2e Collector").catch(() => null);
  await o.page.locator("input[name='handover_confirmed']").check().catch(() => null);
  await o.page.locator("input[name='dash_cam_reconnected']").check().catch(() => null);
  const mileage = o.page.locator("[data-mileage-out]");
  if (await mileage.count()) {
    await mileage.fill("1300");
    await o.page.locator("[data-final-mileage] input[type=file]").first().setInputFiles({ name: "cluster.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQCJ9dvEAAAAAElFTkSuQmCC", "base64") });
    await until(async () => (await q("select id from public.job_files where job_id = $1 and kind = 'odometer_out' and removed_at is null", [jobId]))[0], 40, 500);
  }
  await o.page.locator("[data-owner-release-tick]").check();
  await o.page.locator("[data-owner-release-reason]").fill("Customer collecting, leaders away");
  const unpaid = o.page.locator("[data-unpaid-confirm] input");
  check("the unpaid release has its own confirmation (owner)", (await unpaid.count()) === 1);
  if (await unpaid.count()) await unpaid.check();
  await o.page.locator("[name=release_reason]").fill("Customer pays on Sunday (test)").catch(() => null);
  await o.page.screenshot({ path: `${OUT}/s5-release-as-owner-1366.png`, fullPage: true });
  await o.page.locator("form button[type='submit']").last().click();
  const closed = await until(async () => (await q("select is_open from public.jobs where id = $1", [jobId]))[0]?.is_open === false, 40);
  const err = (await o.page.locator("div[role=alert].bg-red-soft").allTextContents()).join(" | ");
  check("released by the owner (the car left)", !!closed, err.slice(-300));
  const ev = (await q("select note from public.job_events where job_id = $1 and event_type = 'owner_release' order by created_at desc limit 1", [jobId]))[0];
  check("the missing sign-offs are recorded SKIPPED BY OWNER, never signed", /SKIPPED BY OWNER/.test(ev?.note ?? "") && /Customer collecting/.test(ev?.note ?? ""), ev?.note);
  const signedRows = (await q("select role_key from public.bodyshop_signoffs where job_id = $1 and is_active", [jobId])).map((r) => r.role_key);
  check("no sign-off was written as signed by the release", !signedRows.includes("manager"), signedRows.join(","));

  // 4. "Out with balance due" on the owner's dashboard until paid.
  await q("update public.gate_outs set balance_due_aed = greatest(balance_due_aed, 1) where job_id = $1", [jobId]);
  await o.page.goto(`${base}/dashboard`, { waitUntil: "domcontentloaded" });
  await pageReady(o.page);
  const owing = o.page.locator(`[data-out-owing='${jobId}']`);
  check("the car is on 'Out with balance due'", (await owing.count()) === 1, await txt(o.page.locator("[data-out-with-balance]")));
  await o.page.locator("[data-out-with-balance]").screenshot({ path: `${OUT}/s5-out-with-balance-1366.png` }).catch(() => null);
  await o.page.setViewportSize({ width: 800, height: 1280 });
  await o.page.goto(`${base}/dashboard`, { waitUntil: "domcontentloaded" });
  await pageReady(o.page);
  await o.page.screenshot({ path: `${OUT}/s5-dashboard-800.png` });
  await o.browser.close();
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
