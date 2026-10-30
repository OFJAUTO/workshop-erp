// Discount clarity (21 October 2026, part 1 section 1.6): the advisor applies a labour discount
// himself with no "Only the owner" banner; a green status reads "AED 500 = 5.6% of labour · within
// your limit (10%)"; above the limit it turns amber and (after sending) says Waiting for owner
// approval. The server-side send gate is test:discount's job and stays green.
//   node --env-file=.env.test.local tests/browser/test-discount2.mjs
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
await page.goto(`${base}/jobs/${jobId}/quote/${quotationId}`, { waitUntil: "load" });
await page.waitForTimeout(1800);

// The advisor gives AED 30 off the labour (600): 5% - no banner, a green status, saved on the server.
await page.locator("[data-labour-discount]").click();
await page.waitForTimeout(400);
await page.getByRole("button", { name: /^AED$/ }).click();
const amountBox = page.getByLabel("Discount amount");
await amountBox.click({ clickCount: 3 });
await amountBox.pressSequentially("30", { delay: 25 });
await page.waitForTimeout(1200);
await page.getByRole("button", { name: /^Apply$/ }).click();
const saved = await until(async () => { const r = (await sql("select discount_kind as k, discount_value::numeric as v from public.quotations where id = $1", [quotationId]))[0]; return r?.k ? r : null; }, 30, 500);
check("the advisor's discount saves (no owner banner)", saved?.k === "aed" && Number(saved?.v) === 30, JSON.stringify(saved));
await page.waitForTimeout(600);
const body1 = ((await page.textContent("body")) ?? "").replace(/\s+/g, " ");
check("no 'Only the owner gives a discount' anywhere", !/Only the owner gives a discount/.test(body1));
const status1 = ((await page.locator("[data-discount-status]").textContent().catch(() => "")) ?? "").replace(/\s+/g, " ");
check("the green status names the share and the limit", /AED 30\.00 = 5\.0% of labour · within your limit \(10%\)/.test(status1), status1);
await page.screenshot({ path: `${shots}/discount-status-green.png` });

// Above the limit: amber, with the owner wording.
await page.locator("[data-labour-discount]").click();
await page.waitForTimeout(400);
await page.getByRole("button", { name: /^AED$/ }).click();
const box2 = page.getByLabel("Discount amount");
await box2.click({ clickCount: 3 });
await box2.pressSequentially("108", { delay: 25 });
await page.waitForTimeout(1200);
await page.getByRole("button", { name: /^Apply$/ }).click();
const over = await until(async () => { const t = ((await page.locator("[data-discount-status]").textContent().catch(() => "")) ?? "").replace(/\s+/g, " "); return /limit 10%/.test(t) && /18/.test(t) ? t : null; }, 30, 500);
check("above the limit the status turns amber with the owner wording", !!over && /18(\.0)?% · limit 10% · the owner approves before it can be sent/.test(over), over ?? "");
check("the amber flag is set", (await page.locator("[data-discount-status][data-discount-over]").count()) === 1);
await page.screenshot({ path: `${shots}/discount-status-amber.png` });
await ed.browser.close();

await cleanupDb();
process.exit(summary() ? 1 : 0);
