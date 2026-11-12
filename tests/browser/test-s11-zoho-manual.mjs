// Section 11 of 2 November 2026 (built 3 November): Zoho Books on MANUAL — the proof, on the TEST server and the TEST
// database only. The test server has NO Zoho at all (no ZOHO_* values): the rows this test queues carry a stand-in
// marker (zoho_result.e2e_stub), honoured only on the TEST server (isTestEnvironment), so the screens run end to end
// without one Zoho call. It proves:
//   11.1  the five-minute run's own function sends nothing on manual (no row claimed or touched) and says what waits;
//   11.2  "Sync to Zoho" (accounts) opens the preview — how many tax invoices, payments, bills, supplier payments and
//         their totals, the book (OFJ TEST), the payment still inside the undo window held back — and "Yes, send"
//         sends ONLY the rows that were shown (a row queued after the preview opened stays untouched);
//   11.3  the results list in the same window: posted, failed with the reason, still waiting with the reason; Retry on a
//         failed row sends that row only (nothing else moves); the run is stored and re-opens at /zoho?run=<id> (once the
//         migration is applied); Retry on the page's own list sends that row only too;
//   11.4  the daily reminder: not before opening time, once on a working day ("N items waiting to sync to Zoho", to the
//         owner and accounts, linking to /zoho?sync=1), never twice the same day; the link opens the window by itself;
//         accounts' Waiting on you carries the line;
//   11.5  the owner-only switch: accounts see no switch and the server refuses them; the owner switches to automatic
//         (asked once, logged in the change log, accounts told) and back to manual.
//   Review of 3 November 2026: a receipt voided before the press is "nothing goes" and one voided after it reached
//   Zoho is "taken back out of Zoho" — neither counts in Payments or Money in, and the results list them apart from
//   Posted; the button's number counts only what a press would send (a row waiting for something else is left out);
//   the Failed list shows a red row older than 400 newer rows; Retry is hidden on a row done by hand before; a tap on
//   the bell while already on Zoho Books opens the window (twice in a row).
//   npm run test:s11-zoho-manual      (test server: E2E_BASE, default the production test server on :3102)
// Screenshots: tests/browser/shots/s11-zoho-manual/
import fs from "node:fs";
import path from "node:path";
import { api, base, browserFor, cleanupDb, go, here, makeChecks, sleep } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const SHOTS = path.join(here, "shots", "s11-zoho-manual");
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (name) => path.join(SHOTS, name);
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 25 * 60 * 1000).unref();

/** SQL that stops the test on an error (the shared helper hides them). */
async function q(text, params = []) {
  const r = await api("/api/e2e/sql", { sql: text, params });
  if (r.status !== 200) throw new Error(`SQL failed: ${JSON.stringify(r.json ?? r.text).slice(0, 300)}\n${text.slice(0, 200)}`);
  return r.json.rows ?? [];
}
const ID = (n) => `22222222-0000-4000-8000-00000000eb${n}`;
const tok = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
const text = async (loc) => ((await loc.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
async function section(name, fn) {
  console.log(`\n== ${name}`);
  try { await fn(); } catch (e) { check(`${name}: no crash`, false, String(e?.message ?? e).slice(0, 300)); }
}

const STARTED = (await q("select now()::text as t"))[0].t;
const DUBAI_TODAY = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
const atDubai = (hh, mm = 0) => Date.parse(`${DUBAI_TODAY}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+04:00`);

// The mode as it stood before the test (restored exactly at the end; tests never leave the switch moved).
const modeBefore = (await q("select value #>> '{}' as v from public.settings where key = 'zoho_sync_mode'"))[0]?.v ?? null;
const setMode = (mode) => q("insert into public.settings (key, label, value) values ('zoho_sync_mode', 'Zoho Books: how documents are sent (manual or automatic)', to_jsonb($1::text)) on conflict (key) do update set value = excluded.value", [mode]);
const outbox = (id) => q("select status, attempts, last_error, claimed_at, zoho_id from public.zoho_outbox where id = $1", [id]).then((r) => r[0] ?? null);

const OB = { inv1: ID("11"), inv2: ID("12"), pay1: ID("13"), dep: ID("14"), held: ID("15"), bill: ID("16"), billpay: ID("17"), late: ID("18"), voidBefore: ID("19"), voidAfter: ID("1a"), oldRed: ID("1b"), manualRed: ID("1d") };
// THE rule of what a press sends (sendsOnPress in zoho-sync-rules.ts), in SQL.
const PRESSABLE_SQL = "(last_error is null or last_error ilike '%call%allowance%is%used%up%' or last_error ilike 'Zoho%could%not%be%reached%for%the%chart%of%accounts%')";

try {
  cleanupDb();
  await setMode("manual");
  /* ---------------- Seeds (TEST database only) ---------------- */
  const OWNER = (await q("select id::text as id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0].id;
  const ADVISOR = (await q("select id::text as id from public.staff where role_id = 'service_advisor' and is_active order by display_name limit 1"))[0].id;
  const make = (await q("select make_id::text as m from public.vehicles where make_id is not null limit 1"))[0].m;
  await q("insert into public.customers (id, customer_type, full_name, phone, created_by, updated_by) values ($1, 'individual', 'E2E S11 ZOHO CUSTOMER', '+971500000961', $2, $2)", [ID("01"), OWNER]);
  await q("insert into public.vehicles (id, customer_id, plate_country, plate_emirate, plate_code, plate_number, has_plate, make_id, model_year, created_by, updated_by) values ($1, $2, 'UAE', 'Dubai', 'S', '11961', true, $3, 2022, $4, $4)", [ID("02"), ID("01"), make, OWNER]);
  await q("insert into public.jobs (id, vehicle_id, customer_id, stage, status, priority, department, gated_in_by, first_approval_at, stage_entered_at, is_open, created_by, updated_by) values ($1, $2, $3, 'ready', 'ready', 'normal', 'mechanical', $4, now(), now(), true, $5, $5)", [ID("03"), ID("02"), ID("01"), ADVISOR, OWNER]);
  const invoice = (n, number, total) => q("insert into public.invoices (id, number, kind, job_id, customer_id, vehicle_id, status, issued_at, token, labour_mode, subtotal_aed, discount_aed, taxable_aed, vat_aed, total_aed, sent_at, issued_by, created_by, updated_by) values ($1, $2, 'tax_invoice', $3, $4, $5, 'issued', now(), $6, 'itemised', $7, 0, $7, $8, $9, now(), $10, $10, $10)", [ID(n), number, ID("03"), ID("01"), ID("02"), tok(), total / 1.05, total - total / 1.05, total, OWNER]);
  await invoice("04", "E2E-INV-S11-1", 1050);
  await invoice("05", "E2E-INV-S11-2", 2100);
  const payment = (n, invoiceId, amount, method) => q("insert into public.payments (id, job_id, invoice_id, customer_id, method, amount_aed, is_deposit, status, received_by, created_by, updated_by, received_at, verified_at, verified_by) values ($1, $2, $3, $4, $5, $6, $7, 'recorded', $8, $8, $8, now(), now(), $8) returning number", [ID(n), ID("03"), invoiceId, ID("01"), method, amount, !invoiceId, OWNER]);
  await payment("06", ID("04"), 1050, "cash");
  await payment("07", null, 500, "transfer");
  await payment("08", ID("05"), 300, "cash");
  await payment("0a", ID("05"), 200, "cash");
  // Two receipts voided: one before anything was sent (nothing goes), one after it reached Zoho (Yes takes it back out).
  await payment("0b", ID("05"), 777, "cash");
  await payment("0c", ID("05"), 888, "cash");
  await q("update public.payments set status = 'voided', void_reason = 'E2E S11: voided before the sync', voided_at = now() where id = $1", [ID("0b")]);
  await q("update public.payments set status = 'voided', void_reason = 'E2E S11: voided after it reached Zoho', voided_at = now(), zoho_payment_id = 'E2E-Z-0c' where id = $1", [ID("0c")]);
  // The LPO is marked paid, so its supplier payment is a first post (an LPO not paid any more would be "nothing goes").
  await q("insert into public.purchase_orders (id, number, kind, job_id, supplier_name, status, total_cost_aed, supplier_invoice_status, supplier_invoice_number, supplier_invoice_date, supplier_invoice_amount, supplier_paid_at) values ($1, 'LPO-E2E-S11-1', 'supplier', $2, 'E2e S11 Supplier', 'received', 800, 'received', 'E2E-S11-SUPINV', current_date, 800, now())", [ID("09"), ID("03")]);
  // The queue, each row with its stand-in (posted / fails once / waits): only the TEST server honours the marker.
  const queue = (id, kind, recordId, minutesAgo, stub, words = null) =>
    q("insert into public.zoho_outbox (id, kind, record_id, job_id, status, attempts, enqueued_at, updated_at, zoho_result) values ($1, $2, $3, $4, 'pending', 0, now() - make_interval(mins => $5), now() - make_interval(mins => $5), $6::jsonb)", [id, kind, recordId, ID("03"), minutesAgo, JSON.stringify(words ? { e2e_stub: stub, e2e_words: words } : { e2e_stub: stub })]);
  await queue(OB.inv1, "invoice", ID("04"), 40, "post");
  await queue(OB.inv2, "invoice", ID("05"), 39, "fail_once", "Zoho said: test refusal (e2e) - the mapping was missing");
  await queue(OB.pay1, "payment", ID("06"), 30, "post");
  await queue(OB.dep, "deposit", ID("07"), 30, "wait", "Test: waits for its invoice to reach Zoho first.");
  await queue(OB.held, "payment", ID("08"), 1, "post"); // recorded a minute ago: still inside the undo window
  await queue(OB.bill, "bill", ID("09"), 25, "post");
  await queue(OB.billpay, "billpayment", ID("09"), 20, "post");
  await queue(OB.voidBefore, "payment", ID("0b"), 28, "skip");
  await queue(OB.voidAfter, "payment", ID("0c"), 27, "reverse", "RCT-E2E-0c");
  await q("update public.zoho_outbox set zoho_id = 'E2E-Z-0c' where id = $1", [OB.voidAfter]);

  /* ---------------- 11.1 the five-minute run sends nothing on manual ---------------- */
  await section("11.1 the cron on manual", async () => {
    const r = await api("/api/e2e/zoho", { action: "manual_cron" });
    check("11.1: the run answers on manual and says what waits", r.status === 200 && /^Manual: \d+ items? waiting for Sync to Zoho/.test(r.json?.words ?? ""), JSON.stringify(r.json).slice(0, 200));
    check("11.1: it posted nothing", r.json?.pushed === 0 && r.json?.failed === 0);
    const rows = await q("select count(*)::int as n from public.zoho_outbox where id = any($1::uuid[]) and (attempts > 0 or claimed_at is not null or status <> 'pending')", [Object.values(OB).filter((x) => x !== OB.late)]);
    check("11.1: none of the queued rows was claimed or touched", rows[0].n === 0, JSON.stringify(rows));
  });

  /* ---------------- 11.2 / 11.3 Sync to Zoho as accounts ---------------- */
  let runId = null;
  await section("11.2 preview, confirm, results", async () => {
    // What the preview must count (free, not held, not being sent), read before the window opens.
    const undo = Number((await q("select coalesce((select value #>> '{}' from public.settings where key = 'money_undo_minutes'), '10') as v"))[0].v) || 10;
    // Only FIRST posts count in the groups (review of 3 November 2026): not a row already in Zoho, not a voided receipt,
    // not an LPO no longer paid, not a document that never goes (zoho-docs.ts / rowEffect is the rule; this is the same in SQL).
    const firstPosts = await q(
      `select o.kind, count(*)::int as n, coalesce(sum(p.amount_aed), 0)::numeric(14,2)::text as payments
         from public.zoho_outbox o
         left join public.payments p on p.id = o.record_id and o.kind in ('payment', 'deposit')
         left join public.invoices i on i.id = o.record_id and o.kind = 'invoice'
         left join public.purchase_orders po on po.id = o.record_id and o.kind in ('bill', 'billpayment')
        where o.status = 'pending' and (o.claimed_at is null or o.claimed_at < now() - interval '10 minutes')
          and not (o.kind in ('payment', 'deposit', 'billpayment') and o.enqueued_at > now() - make_interval(mins => $1))
          and o.zoho_id is null
          and (o.kind not in ('payment', 'deposit') or p.id is null or (p.status not in ('voided', 'reversed') and p.zoho_payment_id is null))
          and (o.kind <> 'invoice' or i.id is null or (i.kind = 'tax_invoice' and i.deposit_for_quotation_id is null and i.status <> 'cancelled' and i.zoho_invoice_id is null))
          and (o.kind <> 'bill' or po.id is null or (po.kind <> 'main' and po.supplier_name !~* '^our stock$' and po.zoho_bill_id is null))
          and (o.kind <> 'billpayment' or po.id is null or (po.supplier_name !~* '^our stock$' and po.supplier_paid_at is not null and po.zoho_billpayment_id is null))
        group by o.kind`,
      [undo],
    );
    const counts = Object.fromEntries(firstPosts.map((r) => [r.kind, r.n]));
    const paymentsTotal = firstPosts.filter((r) => r.kind === "payment" || r.kind === "deposit").reduce((a, r) => a + Number(r.payments), 0);
    const { browser, page } = await browserFor("accounts", { viewport: { width: 1366, height: 1000 } });
    try {
      await go(page, `${base}/zoho`);
      check("11.2: the page says manual for accounts, and that only the owner changes it", (await page.locator('[data-zoho-controls][data-zoho-mode="manual"]').count()) === 1 && /Manual:.*Only the owner changes this/.test(await text(page.locator("[data-zoho-mode-line]"))), await text(page.locator("[data-zoho-mode-line]")));
      check("11.2: the button carries the waiting count", /^Sync to Zoho · \d+$/.test(await text(page.locator("[data-zoho-sync-open]"))), await text(page.locator("[data-zoho-sync-open]")));
      check("11.5: accounts see no switch", (await page.locator("[data-zoho-mode-card]").count()) === 0);
      check("11.2: the menu entry carries the count", /\d/.test(await text(page.locator('nav a[href="/zoho"]').first())), await text(page.locator('nav a[href="/zoho"]').first()));
      await page.locator("[data-zoho-sync-open]").click();
      await page.locator("[data-zoho-preview]").waitFor({ timeout: 60000 });
      // A document queued AFTER the preview opened: "what you saw is what goes" — it must stay waiting, untouched.
      await q("insert into public.zoho_outbox (id, kind, record_id, job_id, status, attempts, enqueued_at, updated_at, zoho_result) values ($1, 'payment', $2, $3, 'pending', 0, now() - interval '30 minutes', now(), '{\"e2e_stub\": \"post\"}'::jsonb)", [OB.late, ID("0a"), ID("03")]);
      const preview = page.locator("[data-zoho-preview]");
      check("11.2: the preview names the book: OFJ TEST", (await preview.locator('[data-zoho-preview-dest="test"]').count()) === 1 && /Sending to OFJ TEST/.test(await text(preview.locator("[data-zoho-preview-dest]"))));
      const grp = async (key) => {
        const el = preview.locator(`[data-zoho-preview-group="${key}"]`);
        if (!(await el.count())) return { count: 0, total: null };
        return { count: Number(await el.getAttribute("data-count")), total: await el.getAttribute("data-total") };
      };
      const inv = await grp("invoices");
      const pays = await grp("payments");
      const bills = await grp("bills");
      const bps = await grp("billpayments");
      check("11.2: tax invoices counted as in the database", inv.count === (counts.invoice ?? 0), `${inv.count} vs ${counts.invoice}`);
      check("11.2: payments and deposits counted together, the held one left out", pays.count === (counts.payment ?? 0) + (counts.deposit ?? 0) + (counts.paygroup ?? 0), `${pays.count} vs ${(counts.payment ?? 0) + (counts.deposit ?? 0) + (counts.paygroup ?? 0)}`); // combined payments joined this group on 9 Nov
      check("review: the payments' total is first posts only (the two voided receipts, AED 777 and 888, are not in it)", Math.abs(Number(pays.total) - paymentsTotal) < 0.005, `${pays.total} vs ${paymentsTotal.toFixed(2)}`);
      const moneyIn = await text(preview.locator("[data-zoho-preview-money-in]"));
      check("review: Money in is the payments' first posts, never a voided receipt", moneyIn.includes(Number(pays.total).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })), moneyIn);
      check("review: the receipt voided after it reached Zoho is on its own \"Taken back out of Zoho\" line", (await preview.locator(`[data-zoho-preview-removals] [data-zoho-preview-removal="${OB.voidAfter}"]`).count()) === 1 && /Taken back out of Zoho/.test(await text(preview.locator("[data-zoho-preview-removals]"))), await text(preview.locator("[data-zoho-preview-removals]")));
      check("review: the receipt voided before the press is on its own \"Nothing goes\" line", (await preview.locator(`[data-zoho-preview-nothing] [data-zoho-preview-nothing-row="${OB.voidBefore}"]`).count()) === 1);
      check("review: both are still in the list, marked with their effect", (await preview.locator(`[data-zoho-preview-row="${OB.voidAfter}"][data-zoho-preview-effect="removal"]`).count()) === 1 && (await preview.locator(`[data-zoho-preview-row="${OB.voidBefore}"][data-zoho-preview-effect="nothing"]`).count()) === 1);
      check("11.2: supplier bills and supplier payments counted", bills.count === (counts.bill ?? 0) && bps.count === (counts.billpayment ?? 0), `${bills.count}/${bps.count}`);
      if ((counts.invoice ?? 0) === 2) check("11.2: the tax invoices' total is the ERP's (1,050 + 2,100)", inv.total === "3150.00", inv.total);
      if ((counts.bill ?? 0) === 1) check("11.2: the bill's total is THE bill figure (800 + VAT)", bills.total === "840.00", bills.total);
      for (const [label, id] of [["inv1", OB.inv1], ["inv2", OB.inv2], ["pay1", OB.pay1], ["dep", OB.dep], ["bill", OB.bill], ["billpay", OB.billpay]]) {
        check(`11.2: ${label} is in the list of what will be sent`, (await preview.locator(`[data-zoho-preview-row="${id}"]`).count()) === 1);
      }
      check("11.2: the payment still inside the undo window is NOT in it, and is named as held", (await preview.locator(`[data-zoho-preview-row="${OB.held}"]`).count()) === 0 && (await preview.locator("[data-zoho-preview-held]").count()) === 1, await text(preview.locator("[data-zoho-preview-held]")));
      check("11.2: the names carry the documents and amounts", /E2E-INV-S11-1 · AED 1,050\.00/.test(await text(preview.locator(`[data-zoho-preview-row="${OB.inv1}"]`))));
      const confirm = preview.locator("[data-zoho-sync-confirm]");
      // 3 November 2026 (A2): the button reads "Yes, sync and record N items to OFJ TEST" (Mathew's wording).
      check("11.2: the confirm button names the action and the book", /^Yes, sync and record \d+ items? to OFJ TEST$/.test(await text(confirm)) && !(await confirm.isDisabled()), await text(confirm));
      await page.screenshot({ path: shot("preview-1366.png"), fullPage: false });
      await page.setViewportSize({ width: 390, height: 844 });
      await sleep(400);
      await page.screenshot({ path: shot("preview-390.png"), fullPage: false });
      const box = await page.locator("[data-zoho-sync-window] > div").boundingBox();
      check("11.2: the window fits a phone (no sideways overflow)", !!box && box.x >= 0 && box.x + box.width <= 391, JSON.stringify(box));
      await page.setViewportSize({ width: 1366, height: 1000 });
      await sleep(300);

      // Yes, send.
      await confirm.click();
      await page.locator("[data-zoho-sync-results]").waitFor({ timeout: 180000 });
      await page.screenshot({ path: shot("results-1366.png"), fullPage: false });
      const results = page.locator("[data-zoho-sync-results]");
      const item = (outcome, id) => results.locator(`[data-zoho-sync-item="${outcome}"][data-outbox-id="${id}"]`);
      check("11.3: the invoice, the payment, the bill and its payment are listed as posted", (await item("posted", OB.inv1).count()) === 1 && (await item("posted", OB.pay1).count()) === 1 && (await item("posted", OB.bill).count()) === 1 && (await item("posted", OB.billpay).count()) === 1);
      check("11.3: the failed one is listed red with Zoho's reason and a Retry", (await item("failed", OB.inv2).count()) === 1 && /test refusal \(e2e\)/.test(await text(item("failed", OB.inv2))) && (await item("failed", OB.inv2).locator("[data-zoho-sync-retry]").count()) === 1);
      check("11.3: the waiting one is listed with its reason", (await item("waiting", OB.dep).count()) === 1 && /waits for its invoice/.test(await text(item("waiting", OB.dep))));
      check("11.3: the summary line counts them", /\d+ posted · .*\d+ removed from Zoho · \d+ closed, nothing sent · \d+ failed · \d+ still waiting/.test(await text(results.locator("[data-zoho-sync-summary]"))), await text(results.locator("[data-zoho-sync-summary]")));
      check("review: the receipt voided before the press is listed as \"Nothing sent\", not as posted", (await item("skipped", OB.voidBefore).count()) === 1 && (await item("posted", OB.voidBefore).count()) === 0);
      check("review: the receipt voided after it reached Zoho is listed as \"Removed from Zoho\"", (await item("removed", OB.voidAfter).count()) === 1 && /Removed from Zoho: RCT-E2E-0c/.test(await text(item("removed", OB.voidAfter))), await text(item("removed", OB.voidAfter)));
      const i1 = await outbox(OB.inv1);
      check("11.3: the database agrees: posted rows are synced with the stand-in's Zoho id", i1?.status === "synced" && /^E2E-/.test(i1?.zoho_id ?? ""), JSON.stringify(i1));
      const i2 = await outbox(OB.inv2);
      check("11.3: the failed row is failed with the reason", i2?.status === "failed" && /test refusal/.test(i2?.last_error ?? ""), JSON.stringify(i2));
      const dep = await outbox(OB.dep);
      check("11.3: the waiting row stays pending with the reason written on it", dep?.status === "pending" && /waits for its invoice/.test(dep?.last_error ?? ""), JSON.stringify(dep));
      const held = await outbox(OB.held);
      check("11.2: the held payment was not touched", held?.status === "pending" && held?.attempts === 0, JSON.stringify(held));
      const late = await outbox(OB.late);
      check("11.2: the row queued after the preview was NOT sent (only what was shown goes)", late?.status === "pending" && late?.attempts === 0, JSON.stringify(late));

      // Retry in the window: that row only.
      await item("failed", OB.inv2).locator("[data-zoho-sync-retry]").click();
      const retried = await until(async () => (await item("posted", OB.inv2).count()) === 1, 60, 500);
      check("11.3: Retry in the window posts the failed row (it moves to Posted)", !!retried);
      check("11.3: the database agrees", (await outbox(OB.inv2))?.status === "synced");
      const lateAfter = await outbox(OB.late);
      const heldAfter = await outbox(OB.held);
      check("11.3: Retry sent that row only: nothing else moved", lateAfter?.attempts === 0 && heldAfter?.attempts === 0 && (await outbox(OB.dep))?.attempts === 1, `${JSON.stringify(lateAfter)} ${JSON.stringify(heldAfter)}`);
      await page.screenshot({ path: shot("results-after-retry-1366.png"), fullPage: false });

      // The stored run (once the migration made zoho_sync_runs).
      const hasRuns = (await q("select to_regclass('public.zoho_sync_runs') is not null as ok"))[0].ok;
      if (hasRuns) {
        const run = (await q("select id::text as id, status, posted, failed, waiting, outbox_ids::text[] as ids from public.zoho_sync_runs where started_at >= $1::timestamptz order by started_at desc limit 1", [STARTED]))[0];
        runId = run?.id ?? null;
        check("11.3: the run is stored as done, with exactly the confirmed rows", run?.status === "done" && run.ids.includes(OB.inv1) && !run.ids.includes(OB.late) && !run.ids.includes(OB.held), JSON.stringify(run).slice(0, 300));
        await page.locator("[data-zoho-sync-done]").click();
        await go(page, `${base}/zoho`);
        check("11.3: Last syncs lists the run", (await page.locator(`[data-zoho-run="${runId}"]`).count()) === 1);
        await go(page, `${base}/zoho?run=${runId}`);
        check("11.3: the run re-opens with its rows, the retried one now posted", (await page.locator(`[data-zoho-run-view="${runId}"]`).count()) === 1 && (await page.locator(`[data-zoho-run-view] [data-zoho-run-item="failed"][data-zoho-run-now="posted"]`).count()) >= 1);
        await page.screenshot({ path: shot("run-view-1366.png"), fullPage: true });
      } else {
        console.log("NOTE  zoho_sync_runs does not exist yet (migration 20261203180000 not applied on TEST): the stored history is not checked");
        await page.locator("[data-zoho-sync-done]").click();
      }

      // The button's number: only what a press would send (the deposit that waits for its invoice is left out).
      await go(page, `${base}/zoho`);
      const pressable = (await q(`select count(*)::int as n from public.zoho_outbox where status = 'pending' and ${PRESSABLE_SQL}`))[0].n;
      const label = await text(page.locator("[data-zoho-sync-open]"));
      check("review: the button's number counts only what a press would send", pressable ? label === `Sync to Zoho · ${pressable}` : label === "Sync to Zoho", `${label} vs ${pressable}`);

      // Retry on the page's own list: that row only, the answer next to it in the message.
      await q("update public.zoho_outbox set status = 'failed', last_error = 'E2e S11: refused once more', zoho_result = '{\"e2e_stub\": \"fail\", \"e2e_words\": \"Zoho said: still refused (e2e)\"}'::jsonb where id = $1", [OB.dep]);
      await go(page, `${base}/zoho?show=failed`);
      await page.locator(`#z-${OB.dep} [data-zoho-retry]`).click();
      await page.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 60000 }).catch(() => null);
      check("11.3: Retry on the list answers with the new reason", /still\+refused|still%20refused/.test(page.url()), page.url().slice(-160));
      check("11.3: the list's Retry also sent that row only", (await outbox(OB.late))?.attempts === 0 && (await outbox(OB.held))?.attempts === 0);
    } finally {
      await browser.close();
    }
  });

  /* ---------------- review: the Failed list is complete; Retry hidden where it could post twice ---------------- */
  await section("review: Failed list past 400 rows", async () => {
    await q("insert into public.zoho_outbox (id, kind, record_id, job_id, status, attempts, last_error, enqueued_at, updated_at, zoho_result) values ($1, 'commission', $2, $3, 'failed', 1, 'E2E S11: red since long ago', now() - interval '60 days', now() - interval '60 days', '{\"e2e_stub\": \"fail\"}'::jsonb)", [OB.oldRed, ID("1c"), ID("03")]);
    await q("insert into public.zoho_outbox (id, kind, record_id, job_id, status, attempts, last_error, enqueued_at, updated_at, zoho_result) values ($1, 'recovery', $2, $3, 'failed', 1, 'A file or figure was added after this was done by hand: add it in Zoho by hand too, then press \"Done by hand\".', now() - interval '2 days', now(), jsonb_build_object('manual', true, 'name', 'E2E S11', 'at', now(), 'note', 'entered by hand'))", [OB.manualRed, ID("1e"), ID("03")]);
    // 401 newer posted rows (fillers, removed at the end): the old red row is far outside the newest 400.
    await q("insert into public.zoho_outbox (kind, record_id, status, attempts, enqueued_at, updated_at, synced_at, zoho_result) select 'contact', gen_random_uuid(), 'synced', 1, now() - make_interval(secs => g), now(), now(), '{\"e2e_s11_filler\": true}'::jsonb from generate_series(1, 401) g");
    const red = (await q("select count(*)::int as n from public.zoho_outbox where status = 'failed'"))[0].n;
    const { browser, page } = await browserFor("accounts", { viewport: { width: 1366, height: 1000 } });
    try {
      await go(page, `${base}/zoho?show=failed`);
      check("review: the old red row is on the Failed list though 401 newer rows came after it", (await page.locator(`#z-${OB.oldRed}[data-zoho-row="failed"]`).count()) === 1);
      check("review: the Failed chip counts every red row in the database", (await text(page.locator('[data-filter="failed"]'))) === `Failed · ${red}`, `${await text(page.locator('[data-filter="failed"]'))} vs ${red}`);
      check("review: a row done by hand before shows no Retry, only the words", (await page.locator(`#z-${OB.manualRed} [data-zoho-retry]`).count()) === 0 && /done by hand in Zoho before/.test(await text(page.locator(`#z-${OB.manualRed} [data-zoho-retry-refused]`))));
      await go(page, `${base}/zoho`);
      check("review: \"All\" carries every red row too (the results window's links land on it)", (await page.locator(`#z-${OB.oldRed}`).count()) === 1 && (await page.locator("[data-zoho-rows-capped]").count()) === 1);
      await page.screenshot({ path: shot("failed-list-1366.png"), fullPage: false });
    } finally {
      await browser.close();
      await q("delete from public.zoho_outbox where zoho_result ->> 'e2e_s11_filler' = 'true'");
    }
  });

  /* ---------------- 11.5 the owner-only switch ---------------- */
  await section("11.5 owner-only switch", async () => {
    const refused = await api("/api/e2e/zoho", { action: "manual_mode_as", role: "accounts", mode: "automatic" });
    check("11.5: the server refuses accounts", /Only the owner/.test(refused.json?.error ?? ""), JSON.stringify(refused.json));
    check("11.5: and the switch did not move", (await q("select value #>> '{}' as v from public.settings where key = 'zoho_sync_mode'"))[0]?.v === "manual");
    const { browser, page } = await browserFor("owner", { viewport: { width: 1366, height: 1000 } });
    try {
      await go(page, `${base}/zoho`);
      const card = page.locator('[data-zoho-mode-card="manual"]');
      check("11.5: the owner sees the switch, on manual", (await card.count()) === 1);
      await page.screenshot({ path: shot("owner-switch-1366.png"), fullPage: true });
      await card.locator('[data-zoho-mode-switch="automatic"]').click();
      await page.locator('[data-confirm-yes-money="zoho-mode"]').waitFor({ timeout: 10000 });
      check("11.5: going automatic asks once, in plain words", /without a preview/.test(await text(page.locator('[data-confirm-money="zoho-mode"]'))));
      await page.locator('[data-confirm-yes-money="zoho-mode"]').click();
      await page.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 30000 }).catch(() => null);
      check("11.5: saved: automatic", (await q("select value #>> '{}' as v from public.settings where key = 'zoho_sync_mode'"))[0]?.v === "automatic" && /Automatic\+from\+now|Automatic%20from%20now/.test(page.url()), page.url().slice(-120));
      const owner = (await q("select id::text as id from public.staff where role_id = 'owner' and is_active order by display_name limit 1"))[0].id;
      const audit = (await q("select new_data, changed_by::text as by from public.audit_log where table_name = 'settings' and record_id = 'zoho_sync_mode' and changed_at >= $1::timestamptz order by id desc limit 1", [STARTED]))[0];
      check("11.5: the change log has who and what", audit?.new_data?.mode === "automatic" && audit?.by === owner, JSON.stringify(audit));
      const told = (await q("select count(*)::int as n from public.notifications n join public.staff s on s.id = n.staff_id where n.type = 'zoho_sync_mode' and s.role_id = 'accounts' and n.created_at >= $1::timestamptz", [STARTED]))[0].n;
      check("11.5: accounts were told", told >= 1, String(told));
      const tick = await api("/api/e2e/zoho", { action: "manual_cron" });
      check("11.5: on automatic the five-minute run sends again (here: no Zoho on the test server, so it says so)", !/^Manual:/.test(tick.json?.words ?? "") && /not set up on this server/.test(tick.json?.words ?? ""), tick.json?.words);
      await go(page, `${base}/zoho`);
      await page.locator('[data-zoho-mode-card="automatic"] [data-zoho-mode-switch="manual"]').click();
      await page.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 30000 }).catch(() => null);
      check("11.5: and back to manual", (await q("select value #>> '{}' as v from public.settings where key = 'zoho_sync_mode'"))[0]?.v === "manual" && (await page.locator('[data-zoho-mode-card="manual"]').count()) === 1);
      // Settings > Zoho Books carries the same card — loaded only when no real Zoho connection could be touched from here.
      const realConnection = ((await q("select count(*)::int as n from public.zoho_tokens where is_active"))[0]?.n ?? 0) > 0 || !!process.env.ZOHO_CLIENT_ID;
      if (!realConnection) {
        await go(page, `${base}/settings/zoho`);
        check("11.5: Settings > Zoho Books has the same switch", (await page.locator('[data-zoho-mode-card="manual"]').count()) === 1);
      } else console.log("NOTE  a Zoho connection exists on this database: /settings/zoho is not loaded from a test (it could touch the real token row)");
    } finally {
      await browser.close();
    }
  });

  /* ---------------- 11.4 the daily reminder ---------------- */
  await section("11.4 daily reminder", async () => {
    await q("delete from public.notifications where type = 'zoho_waiting' and created_at >= $1::timestamptz", [new Date(`${DUBAI_TODAY}T00:00:00+04:00`).toISOString()]);
    const early = await api("/api/e2e/zoho", { action: "manual_reminder", nowMs: atDubai(6, 30) });
    const workingDays = early.json?.workingDays ?? [];
    const openHour = Number(early.json?.openHour) || 8;
    const dayId = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date(`${DUBAI_TODAY}T12:00:00+04:00`).getUTCDay()];
    const working = !workingDays.length || workingDays.includes(dayId);
    check("11.4: nothing before opening time (or on a day off)", early.json?.sent === 0 && (working ? /Before opening/.test(early.json?.reason) : /Not a working day/.test(early.json?.reason)), JSON.stringify(early.json));
    const due = await api("/api/e2e/zoho", { action: "manual_reminder", nowMs: atDubai(openHour, 5) });
    if (working) {
      check("11.4: from opening time, one bell: \"N items waiting to sync to Zoho\"", due.json?.sent === 1 && /^\d+ items? waiting to sync to Zoho$/.test(due.json?.title ?? ""), JSON.stringify(due.json));
      const bells = await q("select s.role_id, n.title, n.href, n.body from public.notifications n join public.staff s on s.id = n.staff_id where n.type = 'zoho_waiting' and n.created_at >= $1::timestamptz", [STARTED]);
      check("11.4: the owner and accounts got it, linking to the Sync to Zoho window", bells.some((b) => b.role_id === "owner") && bells.some((b) => b.role_id === "accounts") && bells.every((b) => b.href === "/zoho?sync=1" && /press Sync to Zoho/.test(b.body ?? "")), JSON.stringify(bells.slice(0, 2)));
      const again = await api("/api/e2e/zoho", { action: "manual_reminder", nowMs: atDubai(openHour + 1, 5) });
      check("11.4: never twice the same day", again.json?.sent === 0 && /Already told today/.test(again.json?.reason ?? ""), JSON.stringify(again.json));
    } else {
      check("11.4: today is not a working day: no bell at all", due.json?.sent === 0 && /Not a working day/.test(due.json?.reason ?? ""), JSON.stringify(due.json));
    }
    const { browser, page } = await browserFor("accounts", { viewport: { width: 1366, height: 1000 } });
    try {
      await go(page, `${base}/zoho?sync=1`);
      const opened = await until(async () => (await page.locator("[data-zoho-preview], [data-zoho-sync-error]").count()) > 0, 60, 500);
      check("11.4: the bell's link opens the Sync to Zoho window by itself", !!opened && !/sync=1/.test(page.url()), page.url());
      await page.keyboard.press("Escape");
      if (working) {
        // Already on Zoho Books: the bell pushes the same address again and the page stays mounted — the window must still open.
        for (const round of [1, 2]) {
          await page.locator('button[aria-label^="Notifications"]:visible').first().click();
          await page.locator("[data-bell-panel]").waitFor({ timeout: 15000 });
          await page.locator("[data-bell-panel] li button", { hasText: "waiting to sync to Zoho" }).first().click();
          const again = await until(async () => (await page.locator("[data-zoho-preview], [data-zoho-sync-error]").count()) > 0, 60, 500);
          check(`review: tapping the bell while on Zoho Books opens the window (${round === 1 ? "first" : "second"} time)`, !!again && !/sync=1/.test(page.url()), page.url());
          await page.keyboard.press("Escape");
          await until(async () => (await page.locator("[data-zoho-sync-window]").count()) === 0, 20, 250);
        }
      }
      await go(page, `${base}/dashboard`);
      check("11.4: accounts' Waiting on you carries the waiting line", (await page.locator('[data-waiting-job="zoho:waiting"]').count()) === 1, await text(page.locator('[data-waiting-job="zoho:waiting"]')));
      await page.screenshot({ path: shot("accounts-waiting-1366.png"), fullPage: false });
    } finally {
      await browser.close();
    }
  });
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  // Put everything back: the switch as it was, this run's bells and stored runs, the seeded rows.
  try {
    if (modeBefore) await setMode(modeBefore);
    await q("delete from public.notifications where type in ('zoho_waiting', 'zoho_sync_mode') and created_at >= $1::timestamptz", [STARTED]);
    await q("delete from public.zoho_outbox where zoho_result ->> 'e2e_s11_filler' = 'true'");
    if ((await q("select to_regclass('public.zoho_sync_runs') is not null as ok"))[0].ok) await q("delete from public.zoho_sync_runs where started_at >= $1::timestamptz", [STARTED]);
  } catch (e) {
    console.log("restore failed:", String(e?.message ?? e).slice(0, 200));
  }
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
