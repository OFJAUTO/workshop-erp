// Instant lines (20 October 2026, part 2 section 6): a new line appears the moment the button is
// tapped (editable, cursor in it) while the save runs behind; typing is never lost; a refused save
// shows "Not saved - Retry" on that line and the retry lands the same row (same id, no duplicate);
// removing a line is instant too.
//   node --env-file=.env.test.local tests/browser/test-instant.mjs
import { api, base, browserFor, cleanupDb, makeChecks, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shots = "C:/Users/user/Desktop/workshop ERP/tests/browser/shots";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, tries = 40, ms = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } return null; };

await cleanupDb();
const seed = (await api("/api/e2e/stage", { stage: "quote" })).json;
const { jobId, quotationId } = seed;

const ed = await browserFor("service_advisor", { viewport: { width: 1500, height: 1200 } });
const page = ed.page;

/* 1. The save is held up for 3 seconds on purpose: the line must appear long before it answers. */
let delaySaves = true;
await page.route("**/api/quote/save", async (route) => {
  if (delaySaves && route.request().postData()?.includes("addLine")) await sleep(3000);
  await route.fallback();
});
await page.goto(`${base}/jobs/${jobId}/quote/${quotationId}`, { waitUntil: "load" });
await page.waitForTimeout(1800);
const countLines = async () => await page.locator("[id^=item-line-]").count();
const ids = async () => await page.evaluate(() => Array.from(document.querySelectorAll("[id^=item-line-]")).map((e) => e.id.replace("item-line-", "")));
const ids0 = await ids();
const n0 = ids0.length;
await page.getByRole("button", { name: /^\+ Add line$/ }).click();
const t0 = Date.now();
await page.getByRole("button", { name: /^Labour$/ }).first().click();
await page.waitForFunction((n) => document.querySelectorAll("[id^=item-line-]").length > n, n0, { timeout: 5000 });
const dt = Date.now() - t0;
check("1: the new line appears at once, while the save is still held (3 s)", dt < 1500, `${dt} ms`);
// Type into it immediately: nothing waits, nothing is lost.
await page.keyboard.type("Repair test instant line", { delay: 25 });
await page.waitForTimeout(400);
const newId = (await ids()).find((x) => !ids0.includes(x));
check("2: typing lands in the new line straight away", ((await page.locator(`#name-${newId}`).inputValue().catch(() => "")) ?? "").toLowerCase().includes("repair test instant line"));
delaySaves = false;
// The held save lands: the SAME row id arrives in the database, no duplicate.
const row = await until(async () => { const r = (await sql("select id, title from public.quotation_lines where quotation_id = $1 and id = $2", [quotationId, newId]))[0]; return r && /instant line/i.test(String(r.title)) ? r : null; }, 30, 500);
check("3: the save lands on the same id (no duplicate row)", !!row, JSON.stringify(row));
const dup = await sql("select count(*)::int as n from public.quotation_lines where quotation_id = $1 and title ilike '%instant line%'", [quotationId]);
check("3: exactly one row carries the typed name", dup[0]?.n === 1, `rows ${dup[0]?.n}`);

/* 2. A refused save: "Not saved - Retry" on the line, the typing kept, Retry lands it. */
let refuse = true;
await page.unroute("**/api/quote/save");
await page.route("**/api/quote/save", async (route) => {
  if (refuse && route.request().postData()?.includes("addLine")) {
    await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "Test refusal" }) });
    return;
  }
  await route.fallback();
});
const n1 = await countLines();
await page.getByRole("button", { name: /^\+ Add line$/ }).click();
await page.getByRole("button", { name: /^Labour$/ }).first().click();
await page.waitForFunction((n) => document.querySelectorAll("[id^=item-line-]").length > n, n1, { timeout: 5000 });
await page.keyboard.type("Second instant line", { delay: 25 });
const chip = await until(async () => ((await page.locator("[data-line-not-saved]").count()) ? await page.locator("[data-line-not-saved]").textContent() : null), 20, 500);
check("4: the refused save shows Not saved with the reason on the line", !!chip && /Not saved/.test(chip) && /Test refusal/.test(chip), chip ?? "");
const failedId = await page.locator("[data-line-not-saved]").getAttribute("data-line-not-saved");
check("4: the typing is still there", ((await page.locator(`#name-${failedId}`).inputValue().catch(() => "")) ?? "").toLowerCase().includes("second instant line"));
await page.screenshot({ path: `${shots}/instant-not-saved.png` });
refuse = false;
await page.locator("[data-line-retry]").click();
const row2 = await until(async () => (await sql("select id from public.quotation_lines where quotation_id = $1 and id = $2", [quotationId, failedId]))[0] ?? null, 30, 500);
check("5: Retry lands the line on the same id", !!row2);
await until(async () => ((await page.locator("[data-line-not-saved]").count()) === 0 ? true : null), 20, 500);
check("5: the chip goes once saved", (await page.locator("[data-line-not-saved]").count()) === 0);

/* 3. Removing is instant too. */
const n2 = await countLines();
await page.locator(`#item-line-${failedId} [data-line-menu] button, #item-line-${failedId} button[aria-label="Line menu"]`).first().click().catch(async () => {
  await page.locator(`#item-line-${failedId} button`).last().click();
});
await page.waitForTimeout(500);
const removeBtn = page.getByRole("button", { name: /^Remove$/ }).first();
if (await removeBtn.count()) {
  const t1 = Date.now();
  await removeBtn.click();
  await page.waitForFunction((n) => document.querySelectorAll("[id^=item-line-]").length < n, n2, { timeout: 5000 });
  check("6: removing a line is instant", Date.now() - t1 < 1500, `${Date.now() - t1} ms`);
} else {
  check("6: removing a line is instant (menu found)", false, "no Remove in menu");
}
await ed.browser.close();
await cleanupDb();
process.exit(summary() ? 1 : 0);
