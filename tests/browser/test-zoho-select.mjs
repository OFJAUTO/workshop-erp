// Zoho manual sync: choose items + confirm + why "still waiting" (3 Nov batch A2, Mathew), on the TEST database:
//  A. Tick boxes on the Waiting rows, Select all / by type / by date, "Sync 2 selected" sends ONLY those two
//     (the third stays waiting); the confirm window asks "Do you want to sync and record these 2 items to
//     Zoho (OFJ TEST)?" and names the book.
//  B. "Sync this" on one row sends that row alone, through the same confirm window.
//  C. A supplier payment ticked without its bill: the window says it needs the bill first - a pending bill is
//     offered with "Add it to this sync"; a FAILED bill (missing TRN) shows the reason and the Fix the
//     supplier link, and the /zoho list says WHY the payment still waits, with the same link.
//   node --env-file=.env.test.local tests/browser/test-zoho-select.mjs   (test server on :3102)
import path from "node:path";
import fs from "node:fs";
import { api, base, browserFor, cleanupDb, go, here, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const SHOTS = path.join(here, "shots", "zoho-select");
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (n) => path.join(SHOTS, n);
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 12 * 60 * 1000).unref();

await cleanupDb();
// The seed gives a job; the sync rows are three stand-in "contact" rows on three e2e customers, so the
// stub posts them with their names, plus the supplier pair for the dependency proof.
const seed = (await api("/api/e2e/stage", { stage: "quote" })).json;
const custs = await sql(`insert into public.customers (customer_number, customer_type, full_name, phone, created_by, updated_by)
  values ('E2E-Z1', 'individual', 'E2E ZOHO ONE', '+971500000091', null, null), ('E2E-Z2', 'individual', 'E2E ZOHO TWO', '+971500000092', null, null), ('E2E-Z3', 'individual', 'E2E ZOHO THREE', '+971500000093', null, null) returning id`);
const [c1, c2, c3] = custs.map((c) => c.id);
if (!c1 || !c2 || !c3) throw new Error("customer seed failed");
const stub = JSON.stringify({ e2e_stub: "post" });
await sql("insert into public.zoho_outbox (kind, record_id, status, zoho_result, enqueued_at) values ('contact', $1, 'pending', $4::jsonb, now() - interval '3 days'), ('contact', $2, 'pending', $4::jsonb, now() - interval '2 days'), ('contact', $3, 'pending', $4::jsonb, now() - interval '1 hour')", [c1, c2, c3, stub]);
// The dependency pair: GOLDEN ZONE's bill FAILED (missing TRN) and its supplier payment waits; a second
// supplier's bill is PENDING with its payment, for "Add it to this sync".
const [supG] = await sql("insert into public.suppliers (name, vat_registered, trn) values ('E2e Golden Zone', true, null) returning id");
const [supP] = await sql("insert into public.suppliers (name, vat_registered, trn) values ('E2e Pending Parts', true, '100000000000777') returning id");
const [poG] = await sql("insert into public.purchase_orders (number, kind, job_id, supplier_id, supplier_name, status, total_cost_aed, supplier_paid_at, supplier_paid_method) values ('LPO-E2EZG-1', 'supplier', $1, $2, 'E2e Golden Zone', 'received', 900, now(), 'transfer') returning id", [seed.jobId, supG.id]);
const [poP] = await sql("insert into public.purchase_orders (number, kind, job_id, supplier_id, supplier_name, status, total_cost_aed, supplier_paid_at, supplier_paid_method) values ('LPO-E2EZP-1', 'supplier', $1, $2, 'E2e Pending Parts', 'received', 500, now(), 'transfer') returning id", [seed.jobId, supP.id]);
await sql("insert into public.zoho_outbox (kind, record_id, job_id, status, last_error, attempts) values ('bill', $1, $2, 'failed', 'E2e Golden Zone needs its 15-digit TRN before its bill can go to Zoho', 1)", [poG.id, seed.jobId]);
await sql("insert into public.zoho_outbox (kind, record_id, job_id, status, zoho_result) values ('billpayment', $1, $2, 'pending', $3::jsonb)", [poG.id, seed.jobId, stub]);
await sql("insert into public.zoho_outbox (kind, record_id, job_id, status, zoho_result) values ('bill', $1, $2, 'pending', $3::jsonb), ('billpayment', $1, $2, 'pending', $3::jsonb)", [poP.id, seed.jobId, stub]);

const own = await browserFor("owner", { viewport: { width: 1440, height: 1000 } });
const p = own.page;
await go(p, `${base}/zoho?show=pending`);

/* ---------- The list: why a waiting row waits, with the fix link ---------- */
const gRow = p.locator("li").filter({ hasText: "Supplier payment" }).filter({ hasText: /Golden Zone|LPO-E2EZG-1/i }).first();
check("C: the GOLDEN ZONE supplier payment says WHY it waits", /needs its 15-digit TRN|waits for the .*bill.*failed/i.test((await gRow.locator("[data-zoho-why]").textContent().catch(() => "")) ?? ""), (await gRow.locator("[data-zoho-why]").textContent().catch(() => "")) ?? "(no words)");
check("C: with the Fix the supplier link", (await gRow.locator('[data-zoho-fix-link][href*="/parts/suppliers"]').count()) >= 1);
await gRow.screenshot({ path: shot("c-why-waiting-row.png") }).catch(() => null);

/* ---------- A. Tick two of the three contacts, sync them ---------- */
check("A: every waiting row has a tick box", (await p.locator("[data-zoho-tick]").count()) >= 6);
check("A: the bar has Select all, by type and by date", (await p.locator("[data-zoho-select-all]").count()) === 1 && (await p.locator("[data-zoho-select-type]").count()) === 1 && (await p.locator("[data-zoho-select-date]").count()) === 1);
// Select by type (Customer) ticks the three contact rows.
await p.locator("[data-zoho-select-type]").selectOption("contact");
check("A: Select by type ticked the three customers", (await p.locator('[data-zoho-tick][data-kind="contact"]:checked').count()) === 3 && /Sync 3 selected/.test((await p.locator("[data-zoho-sync-selected]").textContent()) ?? ""));
// Untick the third so exactly two go (a real click, so the bar's count follows).
await p.locator("li").filter({ hasText: "E2E ZOHO THREE" }).first().locator("[data-zoho-tick]").click();
await until(async () => /Sync 2 selected/.test((await p.locator("[data-zoho-sync-selected]").textContent()) ?? ""), 10, 300);
check("A: unticking one reads Sync 2 selected", /Sync 2 selected/.test((await p.locator("[data-zoho-sync-selected]").textContent()) ?? ""));
await p.locator("[data-zoho-sync-selected]").click();
await p.waitForSelector("[data-zoho-preview]", { timeout: 20000 });
check("A: the preview covers the 2 picked rows", (await p.locator("[data-zoho-preview-selected]").count()) === 1 && /2 rows you picked/.test((await p.locator("[data-zoho-preview-selected]").textContent()) ?? ""));
const question = (await p.locator("[data-zoho-confirm-question]").textContent()) ?? "";
check("A: the confirm question names the book", question === "Do you want to sync and record these 2 items to Zoho (OFJ TEST)?", question);
await p.screenshot({ path: shot("a-confirm-2-selected.png") });
await p.locator("[data-zoho-sync-confirm]").click();
await p.waitForSelector('[data-zoho-sync-window="results"]', { timeout: 60000 });
check("A: 2 posted", /2 posted/.test((await p.locator("[data-zoho-sync-summary]").textContent()) ?? ""), (await p.locator("[data-zoho-sync-summary]").textContent()) ?? "");
const left = await sql("select record_id, status from public.zoho_outbox where kind = 'contact' and record_id in ($1, $2, $3) order by enqueued_at", [c1, c2, c3]);
check("A: exactly the two ticked posted, the third still waits", left.filter((r) => r.status === "synced").length === 2 && left.find((r) => r.record_id === c3)?.status === "pending", JSON.stringify(left));
await p.locator("[data-zoho-sync-done]").click();

/* ---------- B. "Sync this" on the third row ---------- */
await go(p, `${base}/zoho?show=pending`);
const row3 = p.locator("li").filter({ hasText: "E2E ZOHO THREE" }).first();
check("B: the waiting row has Sync this", (await row3.locator("[data-zoho-sync-this]").count()) === 1);
await row3.locator("[data-zoho-sync-this]").click();
await p.waitForSelector("[data-zoho-preview]", { timeout: 20000 });
check("B: the window previews that 1 item", /this 1 item to Zoho \(OFJ TEST\)/.test((await p.locator("[data-zoho-confirm-question]").textContent()) ?? ""), (await p.locator("[data-zoho-confirm-question]").textContent()) ?? "");
await p.screenshot({ path: shot("b-sync-this.png") });
await p.locator("[data-zoho-sync-confirm]").click();
await p.waitForSelector('[data-zoho-sync-window="results"]', { timeout: 60000 });
check("B: it posted alone", (await sql("select status from public.zoho_outbox where kind = 'contact' and record_id = $1", [c3]))[0]?.status === "synced");
await p.locator("[data-zoho-sync-done]").click();

/* ---------- C. Dependencies in the window ---------- */
await go(p, `${base}/zoho?show=pending`);
// Tick ONLY the two supplier payments (golden zone's bill is red; pending parts' bill is in the queue).
await p.locator("[data-zoho-select-type]").selectOption("billpayment");
await until(async () => /Sync 2 selected/.test((await p.locator("[data-zoho-sync-selected]").textContent()) ?? ""), 10, 300);
await p.locator("[data-zoho-sync-selected]").click();
await p.waitForSelector("[data-zoho-preview]", { timeout: 20000 });
const needs = (await p.locator("[data-zoho-preview-needs]").textContent().catch(() => "")) ?? "";
check("C: the window says the GOLDEN ZONE payment waits for its FAILED bill, with the reason", /Golden Zone/i.test(needs) && /failed/.test(needs) && /TRN/.test(needs), needs.slice(0, 220));
check("C: with the Fix the supplier link", (await p.locator('[data-zoho-preview-needs] [data-zoho-need-link][href*="/parts/suppliers"]').count()) >= 1);
check("C: the PENDING PARTS payment offers Add it to this sync", (await p.locator("[data-zoho-need-add]").count()) === 1);
await p.screenshot({ path: shot("c-needs.png") });
await p.locator("[data-zoho-need-add]").first().click();
await p.waitForSelector("[data-zoho-preview]", { timeout: 20000 });
await until(async () => /3 rows you picked/.test((await p.locator("[data-zoho-preview-selected]").textContent().catch(() => "")) ?? ""), 20, 500);
check("C: Add it brings the bill in (3 picked, bill before its payment)", /3 rows you picked/.test((await p.locator("[data-zoho-preview-selected]").textContent()) ?? ""));
// The added bill rightly notes its supplier will be queued by itself; what matters is that nothing is
// left to ADD and the red GOLDEN ZONE line still explains itself.
check("C: nothing is left to add; the red bill's line stays", (await p.locator("[data-zoho-need-add]").count()) === 0 && /Golden Zone/i.test((await p.locator("[data-zoho-preview-needs]").textContent().catch(() => "")) ?? ""));
await p.screenshot({ path: shot("c-added.png") });
await p.locator("[data-zoho-sync-cancel]").click();

await own.browser.close();
// The outbox rows this test made leave with it (cleanup knows the suppliers/POs; the contact rows are ours).
await sql("delete from public.zoho_outbox where record_id in ($1, $2, $3) or record_id in ($4, $5)", [c1, c2, c3, poG.id, poP.id]);
// The customers themselves leave with the cleanup (their +9715000000… phones are the e2e pattern).
await cleanupDb();
summary();
