// Confirm + undo for money actions (1 November 2026, B3), through the screens on the TEST database:
//  A. the question before a customer payment, before "Paid to supplier" and before an LPO approval: exact words,
//     Cancel changes nothing, the named button does it;
//  B. Undo inside the window: the receipt voided as "Undone", its Zoho row (held back during the window) dropped,
//     so nothing reaches Zoho; the same for "Paid to supplier";
//  C. after the window: no Undo any more, the owner reverses with a reason (logged) and the Zoho row goes back to
//     the worker to take the payment back in Zoho (the posting itself needs a Zoho connection: not on the test server);
//  D. Settings > Money saves the undo minutes.
//   npm run test:undo   (test server on :3102, E2E_BASE for another port)
import fs from "node:fs";
import path from "node:path";
import { api, base, browserFor, cleanupDb, go, here, makeChecks, sleep, sql, pressYes } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const SHOTS = path.join(here, "shots", "undo");
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (name) => path.join(SHOTS, name);
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const text = async (loc) => ((await loc.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 15 * 60 * 1000).unref();

await cleanupDb();
const seed = (await api("/api/e2e/stage", { stage: "ready" })).json;
const jobId = seed.jobId;
const proforma = await until(async () => (await sql("select id, number from public.invoices where job_id = $1 and kind = 'proforma' and status = 'issued' and is_active order by created_at desc limit 1", [jobId]))[0] ?? null, 30, 500);
check("seed: the car is ready with its proforma", !!proforma?.id, JSON.stringify(proforma));

const acc = await browserFor("accounts", { viewport: { width: 1366, height: 1000 } });
const own = await browserFor("owner", { viewport: { width: 1366, height: 1000 } });
const dialog = (page) => page.locator("[data-record-payment-dialog]");

async function openWindow(page) {
  await go(page, `${base}/jobs/${jobId}`);
  await page.locator("[data-record-payment-open]").first().click();
  await dialog(page).waitFor({ timeout: 15000 });
  await until(async () => (await dialog(page).locator("[data-pay-targets], [data-record-payment-error]").count()) > 0, 40, 300);
  const d = dialog(page);
  const inv = d.locator(`[data-pay-target^="inv:"]`);
  if (await inv.count()) await inv.first().click();
}
async function fillCash(page, amount) {
  const d = dialog(page);
  await d.locator('[data-method="cash"]').click();
  if (await d.locator("[data-amount-partial]").count()) await d.locator("[data-amount-partial]").click();
  await d.locator("[data-amount-input]").fill("");
  await d.locator("[data-amount-input]").pressSequentially(String(amount));
}
const payments = async () => sql("select id, number, status, void_reason, amount_aed::float as amount, created_at from public.payments where job_id = $1 order by created_at", [jobId]);

/* ---------- A1 + B1: a customer payment: the question, Cancel, Yes, then Undo ---------- */
{
  const page = acc.page;
  await openWindow(page);
  await fillCash(page, 100);
  await dialog(page).locator("[data-record-payment]").click();
  const q = page.locator("[data-confirm-full]");
  await q.waitFor({ timeout: 10000 });
  const words = await text(q.locator("[data-confirm-text]"));
  check(`A1: the question says what happens ("${words}")`, new RegExp(`^Record payment of AED 100\\.00 · against ${proforma.number} · Cash$`).test(words), words);
  check("A1: a named button, never just OK", /Yes, record payment/.test(await text(q.locator("[data-confirm-yes]"))) && (await q.locator("[data-confirm-back]").count()) === 1);
  await page.screenshot({ path: shot("a1-payment-question.png") });
  await q.locator("[data-confirm-back]").click();
  await sleep(1200);
  check("A1: Go back records nothing", (await payments()).length === 0);
  await dialog(page).locator("[data-record-payment]").click();
  await page.locator("[data-confirm-yes]").click();
  const done = await until(async () => (await dialog(page).locator("[data-record-payment-done]").count()) ? await dialog(page).locator("[data-record-payment-done]").getAttribute("data-record-payment-done") : null, 50, 500);
  check(`A1: Yes records it (${done})`, !!done);
  const bar = dialog(page).locator("[data-undo-bar]");
  const barText = await text(bar);
  check(`B1: the bar "${barText}"`, /^Payment recorded ?Undo \((10:00|9:[0-5]\d)\)$/.test(barText), barText);
  await page.screenshot({ path: shot("b1-undo-bar.png") });
  const pay = (await payments())[0];
  const held = (await sql("select status, zoho_id from public.zoho_outbox where kind = 'payment' and record_id = $1", [pay.id]))[0];
  check("B1: its Zoho row waits (held back for the undo window)", held?.status === "pending" && !held.zoho_id, JSON.stringify(held));
  await sleep(2000);
  const later = await text(dialog(page).locator("[data-undo-money]"));
  check(`B1: it counts down (${later})`, later !== barText.replace(/^Payment recorded /, ""), later);
  await dialog(page).locator("[data-undo-money]").click();
  await until(async () => (await dialog(page).locator("[data-payment-undone]").count()) > 0, 30, 500);
  check("B1: Undo answers in the window", /undone/i.test(await text(dialog(page).locator("[data-payment-undone]"))));
  const after = (await payments())[0];
  check("B1: the receipt is voided as undone, kept on the record", after.status === "voided" && /^Undone within 10 minutes by /.test(after.void_reason ?? ""), JSON.stringify(after));
  const gone = await sql("select count(*)::int as n from public.zoho_outbox where kind = 'payment' and record_id = $1", [pay.id]);
  check("B1: its Zoho row is dropped: nothing goes to Zoho", gone[0].n === 0);
  const ev = await sql("select note from public.job_events where job_id = $1 and event_type = 'payment_void' order by created_at desc limit 1", [jobId]);
  check("B1: the job's history says who undid it", /undone by .* within 10 minutes/.test(ev[0]?.note ?? ""), ev[0]?.note);
  await page.screenshot({ path: shot("b1-undone.png") });
  await dialog(page).locator("[data-record-payment-finish]").click().catch(() => {});
}

/* ---------- C1: after the window: no Undo, the owner reverses with a reason ---------- */
{
  const page = acc.page;
  // A one-minute window for this step (a receipt's time cannot be moved back: the stamp is protected).
  await sql("insert into public.settings (key, label, value) values ('money_undo_minutes', 'Money actions: undo within (minutes)', to_jsonb(1)) on conflict (key) do update set value = excluded.value");
  await openWindow(page);
  await fillCash(page, 150);
  await dialog(page).locator("[data-record-payment]").click();
  await page.locator("[data-confirm-yes]").click();
  await until(async () => (await dialog(page).locator("[data-record-payment-done]").count()) > 0, 50, 500);
  const pay = (await payments()).find((p) => p.status === "recorded");
  check("C1: a second payment recorded", !!pay, JSON.stringify(pay));
  await go(page, `${base}/jobs/${jobId}/invoice`);
  check("C1: inside the window the money page shows Undo on its row", (await page.locator(`[data-payment-row="${pay.number}"] [data-undo-bar]`).count()) === 1);
  // The minute passes, and the payment is as if it had reached Zoho.
  await sleep(Math.max(0, Date.parse(pay.created_at) + 62000 - Date.now()));
  await sql("update public.payments set zoho_payment_id = 'E2E-ZP-UNDO' where id = $1", [pay.id]);
  await sql("update public.zoho_outbox set status = 'synced', zoho_id = 'E2E-ZP-UNDO' where kind = 'payment' and record_id = $1", [pay.id]);
  await go(page, `${base}/jobs/${jobId}/invoice`);
  check("C1: after the window Undo is gone", (await page.locator(`[data-payment-row="${pay.number}"] [data-undo-bar]`).count()) === 0);
  await sql("insert into public.settings (key, label, value) values ('money_undo_minutes', 'Money actions: undo within (minutes)', to_jsonb(10)) on conflict (key) do update set value = excluded.value");
  const op = own.page;
  await go(op, `${base}/invoices/${proforma.id}`);
  const row = op.locator("li", { hasText: pay.number }).filter({ has: op.locator("details") }).first();
  await row.locator("summary", { hasText: "Void this receipt" }).click();
  await row.locator('[name="reason"]').fill("Recorded on the wrong car");
  await row.getByRole("button", { name: "Void" }).click();
  await op.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 30000 }).catch(() => null);
  const after = (await sql("select status, void_reason from public.payments where id = $1", [pay.id]))[0];
  check("C1: the owner reversed it with the reason", after?.status === "voided" && after.void_reason === "Recorded on the wrong car", JSON.stringify(after));
  const back = (await sql("select status, last_error from public.zoho_outbox where kind = 'payment' and record_id = $1", [pay.id]))[0];
  check("C1: its Zoho row goes back to the worker to take the payment back in Zoho (not a red by-hand row)", back?.status === "pending" && !back.last_error, JSON.stringify(back));
  await op.screenshot({ path: shot("c1-reversed.png"), fullPage: true });
}

/* ---------- A2 + B2 + C2: Paid to supplier ---------- */
{
  const part = (await sql("select id from public.part_items where job_id = $1 and is_active limit 1", [jobId]))[0] ?? null;
  const [po] = await sql(
    "insert into public.purchase_orders (number, kind, job_id, supplier_name, status, total_cost_aed, supplier_invoice_status, supplier_invoice_number, supplier_invoice_date, received_at) values ('LPO-E2EUNDO-1', 'supplier', $1, 'E2e Undo Supplier', 'received', 400, 'received', 'E2E-UNDO-77', current_date, now()) returning id",
    [jobId],
  );
  await sql("insert into public.purchase_order_lines (po_id, part_item_id, description, quantity, unit_cost, received_qty) values ($1, $2, 'Air filter', 2, 200, 2)", [po.id, part?.id ?? null]);
  await sql("insert into public.job_files (job_id, kind, ref_id, storage_path, content_type) values ($1, 'supplier_invoice', $2, $3, 'application/pdf')", [jobId, po.id, `${jobId}/e2e-undo-scan.pdf`]);
  const page = acc.page;
  await go(page, `${base}/parts/orders/${po.id}`);
  check("A2: the proof sits apart from the money button", (await page.locator("[data-pay-form] [data-pay-proof-area]").count()) === 1 && (await page.locator("[data-pay-proof-area] [data-confirm-open]").count()) === 0);
  await page.locator('[data-pay-form] input[name="reference"]').fill("TRF 5511");
  await page.locator('[data-confirm-open="supplier-paid"]').click();
  const q = page.locator('[data-confirm-money="supplier-paid"]');
  await q.waitFor({ timeout: 10000 });
  const words = await text(q.locator("[data-confirm-text]"));
  check(`A2: "Paid to supplier" asks first ("${words}")`, /^Record payment to E2e Undo Supplier · invoice E2E-UNDO-77 · .*AED 4\d\d\.\d\d.* · Bank transfer · ref TRF 5511 · no proof attached$/i.test(words), words);
  await page.screenshot({ path: shot("a2-supplier-question.png") });
  await q.locator("[data-confirm-cancel]").click();
  await sleep(1000);
  check("A2: Cancel changes nothing", (await sql("select supplier_paid_at from public.purchase_orders where id = $1", [po.id]))[0]?.supplier_paid_at === null);
  await page.locator('[data-confirm-open="supplier-paid"]').click();
  await pressYes(page);
  await page.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 30000 }).catch(() => null);
  check("A2: Yes marks it paid", !!(await sql("select supplier_paid_at from public.purchase_orders where id = $1", [po.id]))[0]?.supplier_paid_at);
  const bp = (await sql("select status from public.zoho_outbox where kind = 'billpayment' and record_id = $1", [po.id]))[0];
  check("B2: the supplier payment's Zoho row waits", bp?.status === "pending", JSON.stringify(bp));
  const bar = await text(page.locator("[data-supplier-pay] [data-undo-bar]"));
  check(`B2: the bar "${bar}"`, /^Payment to the supplier recorded ?Undo \((10:00|9:[0-5]\d)\)$/.test(bar), bar);
  await page.locator("[data-supplier-pay] [data-undo-money]").click();
  await page.waitForURL((u) => /message=|error=/.test(u.toString()) && u.toString() !== page.url(), { timeout: 30000 }).catch(() => null);
  await until(async () => !(await sql("select supplier_paid_at from public.purchase_orders where id = $1", [po.id]))[0]?.supplier_paid_at, 30, 500);
  const undone = (await sql("select supplier_paid_at, supplier_paid_reference from public.purchase_orders where id = $1", [po.id]))[0];
  check("B2: Undo takes the paid stamp off", undone?.supplier_paid_at === null && undone.supplier_paid_reference === null, JSON.stringify(undone));
  check("B2: and drops its Zoho row: nothing goes to Zoho", (await sql("select count(*)::int as n from public.zoho_outbox where kind = 'billpayment' and record_id = $1", [po.id]))[0].n === 0);
  // Paid again; eleven minutes on, as if posted: the owner/accounts reverse with a reason.
  await go(page, `${base}/parts/orders/${po.id}`);
  await page.locator('[data-confirm-open="supplier-paid"]').click();
  await pressYes(page);
  await page.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 30000 }).catch(() => null);
  await until(async () => !!(await sql("select supplier_paid_at from public.purchase_orders where id = $1", [po.id]))[0]?.supplier_paid_at, 30, 500);
  await sql("update public.purchase_orders set supplier_paid_at = now() - interval '11 minutes', zoho_billpayment_id = 'E2E-BP-UNDO' where id = $1", [po.id]);
  await sql("update public.zoho_outbox set status = 'synced', zoho_id = 'E2E-BP-UNDO' where kind = 'billpayment' and record_id = $1", [po.id]);
  await go(page, `${base}/parts/orders/${po.id}`);
  check("C2: after the window no Undo, the reverse fold instead", (await page.locator("[data-supplier-pay] [data-undo-bar]").count()) === 0 && (await page.locator("[data-reverse-paid]").count()) === 1);
  await page.locator("[data-reverse-paid] summary").click();
  await page.locator('[data-reverse-paid] input[name="reason"]').fill("Paid from the wrong account");
  await page.locator('[data-confirm-open="supplier-reverse"]').click();
  const rq = await text(page.locator('[data-confirm-money="supplier-reverse"] [data-confirm-text]'));
  check(`C2: the reversal asks first ("${rq}")`, /reason: Paid from the wrong account$/.test(rq), rq);
  await pressYes(page);
  await page.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 30000 }).catch(() => null);
  const rev = (await sql("select supplier_paid_at from public.purchase_orders where id = $1", [po.id]))[0];
  check("C2: reversed: the LPO is unpaid again", rev?.supplier_paid_at === null);
  const back = (await sql("select status, last_error from public.zoho_outbox where kind = 'billpayment' and record_id = $1", [po.id]))[0];
  check("C2: its Zoho row goes back to the worker to take the vendor payment back in Zoho", back?.status === "pending" && !back.last_error, JSON.stringify(back));
  const ev = await sql("select note from public.job_events where job_id = $1 and note like '%reversed by%' order by created_at desc limit 1", [jobId]);
  check("C2: logged with the reason", /Paid from the wrong account/.test(ev[0]?.note ?? ""), ev[0]?.note);
  await page.screenshot({ path: shot("c2-supplier-reversed.png"), fullPage: true });
}

/* ---------- A3: an LPO approval asks first ---------- */
{
  const [po] = await sql("insert into public.purchase_orders (number, kind, job_id, supplier_name, status, total_cost_aed) values ('LPO-E2EUNDO-2', 'supplier', $1, 'E2e Undo Supplier', 'pending_approval', 250) returning id", [jobId]);
  await sql("insert into public.purchase_order_lines (po_id, description, quantity, unit_cost) values ($1, 'Brake pads', 1, 250)", [po.id]);
  const op = own.page;
  await go(op, `${base}/parts/orders/${po.id}`);
  await op.locator('[data-confirm-open="lpo-approve"]').click();
  const q = op.locator('[data-confirm-money="lpo-approve"]');
  await q.waitFor({ timeout: 10000 });
  const words = await text(q.locator("[data-confirm-text]"));
  check(`A3: the approval asks first ("${words}")`, /^Approve · LPO-E2EUNDO-2/.test(words) && /AED 250\.00/.test(words), words);
  check("A3: with Cancel and 'Yes, approve the LPO'", (await q.locator("[data-confirm-cancel]").count()) === 1 && /Yes, approve the LPO/.test(await text(q.locator("[data-confirm-yes-money]"))));
  await op.screenshot({ path: shot("a3-lpo-question.png") });
  await q.locator("[data-confirm-cancel]").click();
  await sleep(1000);
  check("A3: Cancel leaves it waiting", (await sql("select status from public.purchase_orders where id = $1", [po.id]))[0]?.status === "pending_approval");
}

/* ---------- D: Settings > Money ---------- */
{
  const op = own.page;
  await go(op, `${base}/settings#money-limits`);
  await op.locator("[data-undo-minutes]").fill("10");
  await op.locator("[data-money-limits-save]").click();
  await op.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 30000 }).catch(() => null);
  const v = (await sql("select value from public.settings where key = 'money_undo_minutes'"))[0];
  check("D: Settings > Money saves the undo minutes", Number(v?.value) === 10, JSON.stringify(v));
}

await acc.browser.close();
await own.browser.close();
await cleanupDb();
summary();
