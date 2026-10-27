// Zoho Books phase 3/4, LOCAL proof: the per-supplier VAT switch (and the flag on bills already posted when it
// moves), the customer-refund card and hook, the returned-part hook, the go-live panel (checklist red = switch
// locked; Mathew's tick from an accounts login), the pure rules (start-date gate, the seven-calendar-day gate, the
// start date never in the future, the book that owns a day, when yesterday's check is due, real months), "Done by
// hand" on a red row, the reconciliation and monthly-close pages, the REAL write guard — and the go-live SWITCH
// itself, simulated inside a database transaction that is rolled back (OFJ TEST -> a fake organization -> OFJ TEST;
// never REAL, nothing kept).
//   node --env-file=.env.local tests/browser/test-zoho3.mjs   (dev server, no ZOHO_* values)
import pg from "pg";
import { api, base, browserFor, cleanupDb, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 15 * 60 * 1000).unref();
cleanupDb();

const until = async (fn, tries = 40, ms = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } return null; };
const plainText = (html) => html.replace(/<!--.*?-->/g, "").replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
async function section(name, fn) {
  console.log(`\n== ${name}`);
  try { await fn(); } catch (e) { check(`${name}: no crash`, false, String(e?.message ?? e).slice(0, 300)); }
}
/** Local test rows must never be posted by the LIVE five-minute cron (it shares this database): park them as red. */
const park = (kind, recordId) => sql("update public.zoho_outbox set status = 'failed', last_error = 'E2e: local test row (never posted)' where kind = $1 and record_id = $2 and status = 'pending'", [kind, recordId]);

let jobId = null;
let customerId = null;
let vehicleId = null;
let cnId = null;
const DAY = 86400000;
const today = new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 10);
const dayPlus = (n) => new Date(Date.parse(`${today}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const nextFirst = (() => { const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 10); })();

/* ---------------- 1. guards and the pure rules ---------------- */
await section("1 guards and the pure rules", async () => {
  const g = await api("/api/e2e/zoho", { action: "write_to_real" });
  check("1: a write at the REAL book is refused", g.json?.refused === true, JSON.stringify(g.json).slice(0, 160));
  const d = await api("/api/e2e/zoho", { action: "date_gate", cases: [
    { docDate: "2026-10-31", live: true, startDate: "2026-11-01" },
    { docDate: "2026-11-01", live: true, startDate: "2026-11-01" },
    { docDate: "2026-11-02", live: true, startDate: "2026-11-01" },
    { docDate: "2026-10-31", live: false, startDate: "2026-11-01" },
    { docDate: "2026-10-31", live: true, startDate: "" },
  ] });
  check("1: the start-date gate refuses only pre-start documents, only once live", JSON.stringify(d.json?.results) === JSON.stringify([true, false, false, false, false]), JSON.stringify(d.json));
  const c = await api("/api/e2e/zoho", { action: "golive_checklist" });
  check("1: the go-live checklist evaluates seven gates (with Zoho's invoice prefix) and is NOT all green", Array.isArray(c.json?.items) && c.json.items.length === 7 && c.json.items.some((i) => i.key === "invoice_prefix") && c.json.allGreen === false, JSON.stringify(c.json?.items?.map((i) => `${i.key}:${i.ok ? 1 : 0}`)));

  // Gate 5: the SEVEN CALENDAR DAYS before today, each green and checked after its day ended.
  const after = (day) => new Date(Date.parse(`${day}T00:00:00+04:00`) + DAY + 3600000).toISOString();
  const rowsFor = (offsets) => offsets.map((n) => ({ day: dayPlus(-n), status: "green", checked_at: after(dayPlus(-n)) }));
  const seven = rowsFor([7, 6, 5, 4, 3, 2, 1]);
  const old = rowsFor([27, 26, 25, 24, 23, 22, 21]);
  const oneRed = seven.map((r, i) => (i === 3 ? { ...r, status: "red" } : r));
  const early = seven.map((r, i) => (i === 6 ? { ...r, checked_at: `${r.day}T08:00:00.000Z` } : r));
  // reconDue on 26 Oct (that day ends 2026-10-26T20:00Z).
  const end = Date.parse("2026-10-26T20:00:00Z");
  const H = 3600000;
  const p = await api("/api/e2e/zoho", {
    action: "pure_rules",
    reconGate: [{ rows: seven, today }, { rows: old, today }, { rows: oneRed, today }, { rows: early, today }],
    startGate: [{ start: `${today.slice(0, 7)}-01`, today }, { start: nextFirst, today }, { start: "", today }, { start: today.slice(8) === "15" ? `${today.slice(0, 7)}-14` : `${today.slice(0, 7)}-15`, today }],
    reconOrg: [
      { day: "2026-10-31", live: false, start: "2026-11-01", testOrg: "944122733" },
      { day: "2026-10-31", live: true, start: "2026-11-01", testOrg: "944122733" },
      { day: "2026-11-01", live: true, start: "2026-11-01", testOrg: "944122733" },
    ],
    reconDue: [
      { row: null, day: "2026-10-26", nowMs: end + 2 * H, saturated: true },
      { row: null, day: "2026-10-26", nowMs: end + 10 * 60000, saturated: false },
      { row: null, day: "2026-10-26", nowMs: end + H, saturated: false },
      { row: { status: "green", checked_at: "2026-10-26T10:00:00Z" }, day: "2026-10-26", nowMs: end + H, saturated: false },
      { row: { status: "green", checked_at: new Date(end + 40 * 60000).toISOString() }, day: "2026-10-26", nowMs: end + 3 * H, saturated: false },
      { row: { status: "red", checked_at: new Date(end + 40 * 60000).toISOString() }, day: "2026-10-26", nowMs: end + 3 * H, saturated: false },
      { row: { status: "red", checked_at: new Date(end + 170 * 60000).toISOString() }, day: "2026-10-26", nowMs: end + 3 * H, saturated: false },
    ],
    months: ["2026-10", "2026-13", "2026-00", "2026-1"],
  });
  const j = p.json ?? {};
  check("1: gate 5 needs the last seven CALENDAR days (old rows, a red day or a mid-day check all block)", JSON.stringify((j.reconGate ?? []).map((x) => x.ok)) === JSON.stringify([true, false, false, false]), JSON.stringify(j.reconGate));
  check("1: gate 6 wants the 1st of a month, today or earlier (a future 1st, a blank and a mid-month day all block)", JSON.stringify((j.startGate ?? []).map((x) => x.ok)) === JSON.stringify([true, false, false, false]), JSON.stringify(j.startGate));
  check("1: each day is reconciled against the book that owns it", JSON.stringify(j.reconOrg) === JSON.stringify(["944122733", "944122733", "942979945"]), JSON.stringify(j.reconOrg));
  check("1: yesterday's check waits for a busy queue and 00:30, re-checks a mid-day row, and a red day hourly", JSON.stringify(j.reconDue) === JSON.stringify([false, false, true, true, false, true, false]), JSON.stringify(j.reconDue));
  check("1: only real months pass", JSON.stringify(j.months) === JSON.stringify([true, false, false, false]), JSON.stringify(j.months));
});

/* ---------------- 2. the supplier VAT switch, and the flag on bills already posted ---------------- */
await section("2 supplier VAT switch", async () => {
  const [sup] = await sql("insert into public.suppliers (name, phone) values ('E2e Novat Supplier', '+971500000097') returning id");
  // A bill of theirs is already in Zoho (posted WITH VAT while they were registered).
  const [po] = await sql(
    "insert into public.purchase_orders (number, kind, supplier_id, supplier_name, status, total_cost_aed, supplier_invoice_status, supplier_invoice_number, supplier_invoice_date) values ('LPO-E2E9-Z3-VAT', 'supplier', $1, 'E2e Novat Supplier', 'received', 100, 'received', 'E2E-Z3-VAT-1', $2) returning id",
    [sup.id, today],
  );
  await sql("update public.purchase_orders set zoho_bill_id = 'E2E-FAKE-BILL', zoho_bill_taxed = true where id = $1", [po.id]);
  await sql("insert into public.zoho_outbox (kind, record_id, status, zoho_id, synced_at) values ('bill', $1, 'synced', 'E2E-FAKE-BILL', now())", [po.id]);
  // A second bill of theirs posted WITHOUT VAT already matches the new standing: it must be left alone.
  const [po2] = await sql(
    "insert into public.purchase_orders (number, kind, supplier_id, supplier_name, status, total_cost_aed, supplier_invoice_status, supplier_invoice_number, supplier_invoice_date) values ('LPO-E2E9-Z3-VAT2', 'supplier', $1, 'E2e Novat Supplier', 'received', 50, 'received', 'E2E-Z3-VAT-2', $2) returning id",
    [sup.id, today],
  );
  await sql("update public.purchase_orders set zoho_bill_id = 'E2E-FAKE-BILL-2', zoho_bill_taxed = false where id = $1", [po2.id]);
  await sql("insert into public.zoho_outbox (kind, record_id, status, zoho_id, synced_at) values ('bill', $1, 'synced', 'E2E-FAKE-BILL-2', now())", [po2.id]);
  const { browser, page } = await browserFor("owner", { viewport: { width: 1440, height: 1400 } });
  try {
    await go(page, `${base}/parts/suppliers`);
    check("2: the add form carries the VAT switch, ticked by default", (await page.locator("[data-vat-switch] input").first().isChecked()) === true);
    // Open the e2e supplier's edit fold and untick the switch.
    await page.locator("details", { hasText: "E2e Novat Supplier" }).first().locator("summary").click();
    const fold = page.locator("details", { hasText: "E2e Novat Supplier" }).first();
    await fold.locator("[data-vat-switch] input").setChecked(false);
    await fold.locator('button[type="submit"]').first().click();
    await page.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 30000 }).catch(() => null);
    const row = await until(async () => { const r = (await sql("select vat_registered from public.suppliers where name ilike 'e2e novat supplier'"))[0]; return r && r.vat_registered === false ? r : null; });
    check("2: the switch saves (not VAT registered)", row?.vat_registered === false, JSON.stringify(row));
    const flagged = await until(async () => { const r = (await sql("select status, last_error from public.zoho_outbox where kind = 'bill' and record_id = $1", [po.id]))[0]; return r?.status === "failed" ? r : null; });
    check("2: the bill posted WITH VAT turns red: it keeps its VAT, the accountant decides", flagged?.status === "failed" && /now marked NOT VAT registered\. The bill E2E-Z3-VAT-1 .* was posted with VAT and keeps it/.test(flagged?.last_error ?? "") && /Done by hand/.test(flagged?.last_error ?? ""), JSON.stringify(flagged));
    const untouched = (await sql("select status from public.zoho_outbox where kind = 'bill' and record_id = $1", [po2.id]))[0];
    check("2: the bill posted WITHOUT VAT already matches and stays green", untouched?.status === "synced", JSON.stringify(untouched));
  } finally {
    await browser.close();
  }
});

/* ---------------- 3. the customer-refund card and hook ---------------- */
await section("3 customer refund", async () => {
  const seed = await api("/api/e2e/stage", { stage: "ready" });
  jobId = seed.json.jobId;
  const [job] = await sql("select customer_id, vehicle_id from public.jobs where id = $1", [jobId]);
  customerId = job.customer_id;
  vehicleId = job.vehicle_id;
  const [cn] = await sql(
    "insert into public.invoices (number, kind, job_id, customer_id, vehicle_id, token, subtotal_aed, discount_aed, taxable_aed, vat_aed, total_aed, notes) values ('CN-E2EZ3', 'credit_note', $1, $2, $3, 'e2e-z3-cn', 200, 0, 200, 10, 210, 'Goodwill') returning id",
    [jobId, customerId, vehicleId],
  );
  cnId = cn.id;
  await sql("insert into public.invoice_lines (invoice_id, position, section, description, quantity, unit_price, amount_aed, vat_aed, total_aed, cost_aed) values ($1, 0, 'services', 'Goodwill credit', 1, 200, 200, 10, 210, 0)", [cn.id]);
  const { browser, page } = await browserFor("accounts", { viewport: { width: 1440, height: 1200 } });
  try {
    await go(page, `${base}/invoices/${cn.id}`);
    check("3: the refund card renders for accounts", (await page.locator("[data-cn-refund]").count()) === 1);
    await page.locator('[data-cn-refund] input[name="amount"]').fill("210");
    await page.locator('[data-cn-refund] label', { hasText: "Bank transfer" }).click();
    await page.locator('[data-cn-refund] input[name="reference"]').fill("TT-99");
    await page.locator("[data-cn-refund-save]").click();
    await page.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 30000 }).catch(() => null);
    const row = await until(async () => (await sql("select refund_paid_at, refund_method, refund_amount_aed::float as amount from public.invoices where id = $1", [cn.id]))[0]?.refund_paid_at ? (await sql("select refund_paid_at, refund_method, refund_amount_aed::float as amount from public.invoices where id = $1", [cn.id]))[0] : null);
    check("3: the refund is recorded (210, transfer)", !!row && row.refund_method === "transfer" && row.amount === 210, JSON.stringify(row));
    const ob = await until(async () => (await sql("select status from public.zoho_outbox where kind = 'cnrefund' and record_id = $1", [cn.id]))[0]);
    check("3: it joined the Zoho queue", ob?.status === "pending", JSON.stringify(ob));
    await park("cnrefund", cn.id);
    await go(page, `${base}/invoices/${cn.id}`);
    check("3: the card shows the recorded refund", (await page.locator("[data-cn-refund-done]").count()) === 1);
    // A second submit (a stale tab) must not claim its own figure: the action answers that it was already recorded.
    const events = Number((await sql("select count(*)::int as n from public.job_events where job_id = $1 and note like 'CN-E2EZ3:%refunded%'", [jobId]))[0]?.n ?? 0);
    check("3: exactly one refund line in the job history", events === 1, String(events));
  } finally {
    await browser.close();
  }
});

/* ---------------- 4. the returned-part hook (Returns and leftovers) ---------------- */
await section("4 returned part hook", async () => {
  const [part] = await sql(
    "insert into public.part_items (job_id, description, quantity, confirmed_quantity, cost_aed, supplier, availability, not_needed_at, not_needed_reason) values ($1, 'E2e alternator', 1, 1, 450, 'E2e Novat Supplier', 'in_stock', now(), 'E2e test') returning id",
    [jobId],
  );
  const { browser, page } = await browserFor("owner", { viewport: { width: 1440, height: 1400 } });
  try {
    await go(page, `${base}/parts/no-home`);
    check("4: the part sits on Returns and leftovers", (await page.getByText("E2e alternator").count()) >= 1);
    // The 'returned' ending with the supplier's credit note number.
    await page.getByRole("button", { name: /Returned to supplier/i }).first().click().catch(() => null);
    await sleep(300);
    await page.locator('input[name="note"]').first().fill("SCN-123");
    await page.getByRole("button", { name: /^Save|^Confirm|Returned/i }).last().click();
    await page.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 30000 }).catch(() => null);
    const row = await until(async () => { const r = (await sql("select disposition from public.part_items where id = $1", [part.id]))[0]; return r?.disposition === "returned" ? r : null; });
    check("4: the part is marked returned with the credit note number", row?.disposition === "returned", JSON.stringify(row));
    const ob = await until(async () => (await sql("select status from public.zoho_outbox where kind = 'vendorcredit' and record_id = $1", [part.id]))[0]);
    check("4: the vendor credit joined the Zoho queue", ob?.status === "pending", JSON.stringify(ob));
    await park("vendorcredit", part.id);
  } finally {
    await browser.close();
  }
});

/* ---------------- 5. the go-live panel: locked while red; Mathew's tick ---------------- */
await section("5 go-live panel", async () => {
  const { browser, page } = await browserFor("owner", { viewport: { width: 1440, height: 1800 } });
  try {
    await go(page, `${base}/settings/zoho`);
    check("5: the panel renders with the seven gates (before go-live)", (await page.locator("[data-golive-checklist] [data-golive-item]").count()) === 7 && (await page.locator('[data-golive-panel][data-golive-state="test"]').count()) === 1);
    // A live Zoho test in the last 7 days shows a warning (the stamp is put back exactly as it was).
    const stampBefore = (await sql("select value from public.settings where key = 'zoho_last_live_test_at'"))[0]?.value ?? "";
    await sql("update public.settings set value = to_jsonb(now()::text) where key = 'zoho_last_live_test_at'");
    await go(page, `${base}/settings/zoho`);
    check("5: a live test in the last 7 days shows the warning with the first safe day", /do not go live before \d{4}-\d{2}-\d{2}/.test((await page.locator("[data-golive-live-test-warning]").textContent().catch(() => "")) ?? ""));
    await sql("update public.settings set value = to_jsonb($1::text) where key = 'zoho_last_live_test_at'", [String(stampBefore)]);
    check("5: at least one gate is red and the switch is LOCKED", (await page.locator('[data-golive-ok="0"]').count()) >= 1 && (await page.locator("[data-golive-flip-btn]").isDisabled()) === true);
    check("5: the owner has no review tick (it belongs to accounts)", (await page.locator("[data-golive-tick]").count()) === 0);
    await page.screenshot({ path: "tests/browser/shots/zoho3-golive-locked.png", fullPage: true });
  } finally {
    await browser.close();
  }
  // Mathew's REAL tick (27 October 2026, 09:16) is his decision: a test never clears or overwrites it.
  const reviewedBefore = (await sql("select value from public.settings where key = 'zoho_golive_reviewed'"))[0]?.value ?? {};
  const realTick = !!reviewedBefore?.at;
  const { browser: ab, page: ap } = await browserFor("accounts", { viewport: { width: 1440, height: 1200 } });
  try {
    await go(ap, `${base}/zoho`);
    if (realTick) {
      check("5: accounts see the real review as done (left untouched)", (await ap.locator("[data-golive-reviewed]").count()) === 1 && (await ap.locator("[data-golive-tick]").count()) === 0, JSON.stringify(reviewedBefore));
    } else {
      check("5: accounts see the review card with the tick", (await ap.locator("[data-golive-tick]").count()) === 1);
      await ap.locator("[data-golive-tick]").click();
      await ap.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 30000 }).catch(() => null);
      const ticked = await until(async () => { const r = (await sql("select value from public.settings where key = 'zoho_golive_reviewed'"))[0]?.value; return r?.at ? r : null; });
      check("5: the tick stores who and when", !!ticked?.at && !!ticked?.name, JSON.stringify(ticked));
    }
    const c = await api("/api/e2e/zoho", { action: "golive_checklist" });
    check("5: the reviewed gate is green, the rest still block", c.json?.items?.find((i) => i.key === "reviewed")?.ok === true && c.json?.allGreen === false, JSON.stringify(c.json?.items?.map((i) => `${i.key}:${i.ok ? 1 : 0}`)));
  } finally {
    await ab.close();
    // Only the test's OWN tick is taken back; a real one stays exactly as it was.
    if (!realTick) await sql("update public.settings set value = '{}'::jsonb where key = 'zoho_golive_reviewed'");
  }
});

/* ---------------- 6. reconciliation and monthly close pages ---------------- */
await section("6 reconciliation and close pages", async () => {
  const { browser, page } = await browserFor("accounts", { viewport: { width: 1440, height: 1400 } });
  try {
    await go(page, `${base}/zoho/reconciliation`);
    const body = plainText(await page.content());
    check("6: the reconciliation page renders with the backfill button", (await page.locator("[data-recon-backfill]").count()) === 1 && /yesterday per the ERP next to yesterday per Zoho/i.test(body), body.slice(0, 160));
    await go(page, `${base}/zoho/close`);
    check("6: the monthly close renders its lines", (await page.locator("[data-close-line]").count()) >= 7);
    check("6: the Excel export link is there", (await page.locator("[data-close-export]").count()) === 1);
    const cookie = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
    const month = today.slice(0, 7);
    const xlsx = await fetch(`${base}/api/export/zoho-close?month=${month}`, { headers: { cookie } });
    check("6: the export answers with a spreadsheet", xlsx.status === 200 && /spreadsheetml/.test(xlsx.headers.get("content-type") ?? ""), `${xlsx.status} ${xlsx.headers.get("content-type")}`);
    await page.screenshot({ path: "tests/browser/shots/zoho3-close.png", fullPage: true });
    // An impossible month (a typo in the address) never crashes either.
    const bad = await fetch(`${base}/api/export/zoho-close?month=2026-13`, { headers: { cookie } });
    check("6: the export refuses 2026-13 in plain words (400, not a crash)", bad.status === 400, String(bad.status));
    await go(page, `${base}/zoho/close?month=2026-13`);
    check("6: the close page shows the current month for 2026-13 instead of crashing", (await page.locator("[data-close-line]").count()) >= 7);
  } finally {
    await browser.close();
  }
});

/* ---------------- 7. Done by hand on a red row ---------------- */
await section("7 done by hand", async () => {
  const { browser, page } = await browserFor("accounts", { viewport: { width: 1440, height: 1400 } });
  try {
    await go(page, `${base}/zoho?show=failed`);
    const row = page.locator('li[data-zoho-row="failed"]', { hasText: "CN-E2EZ3" }).first();
    check("7: the parked refund row shows red with the Done-by-hand fold", (await row.count()) === 1 && (await row.locator("[data-zoho-by-hand]").count()) === 1);
    await row.locator("[data-zoho-by-hand] summary").click();
    await row.locator("[data-zoho-by-hand-note]").fill("Entered by hand as refund RF-E2E");
    await row.locator("[data-zoho-by-hand-save]").click();
    await page.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 30000 }).catch(() => null);
    const done = await until(async () => { const r = (await sql("select status, zoho_result from public.zoho_outbox where kind = 'cnrefund' and record_id = $1", [cnId]))[0]; return r?.status === "synced" ? r : null; });
    check("7: the row closes as done by hand with who, the note and the old reason", done?.zoho_result?.manual === true && /RF-E2E/.test(done?.zoho_result?.note ?? "") && /E2e: local test row/.test(done?.zoho_result?.reason ?? "") && !!done?.zoho_result?.name, JSON.stringify(done));
    await go(page, `${base}/zoho?show=synced`);
    check("7: the sync page says it was done by hand", /Done by hand by/.test(plainText(await page.content())));
  } finally {
    await browser.close();
  }
});

/* ---------------- 7b. a late addition to a row closed by hand turns it red (never re-posts) ---------------- */
await section("7b late addition to a hand-closed row", async () => {
  // The refund row was closed by hand in section 7: a file added now must not make the handler post a second document.
  await api("/api/e2e/zoho", { action: "reopen", kind: "cnrefund", recordId: cnId });
  const r = (await sql("select status, last_error from public.zoho_outbox where kind = 'cnrefund' and record_id = $1", [cnId]))[0];
  check("7b: the hand-closed row turns red asking for the addition by hand", r?.status === "failed" && /added after this was done by hand/.test(r?.last_error ?? ""), JSON.stringify(r));
});

/* ---------------- 7e. paying a supplier: the method, the reference and the proof ---------------- */
await section("7e supplier payment method and proof", async () => {
  const [sup] = await sql("insert into public.suppliers (name, phone) values ('E2e Pay Supplier', '+971500000094') returning id");
  const [po] = await sql(
    "insert into public.purchase_orders (number, kind, job_id, supplier_id, supplier_name, status, total_cost_aed, supplier_invoice_status, supplier_invoice_number, supplier_invoice_date) values ('LPO-E2E9-Z3-PAY', 'supplier', $1, $2, 'E2e Pay Supplier', 'received', 120, 'received', 'E2E-PAY-1', $3) returning id",
    [jobId, sup.id, today],
  );
  await sql("insert into public.job_files (job_id, kind, ref_id, storage_path, content_type) values ($1, 'supplier_invoice', $2, $3, 'application/pdf')", [jobId, po.id, `${jobId}/e2e-z3-pay-scan.pdf`]);
  const { browser, page } = await browserFor("accounts", { viewport: { width: 1440, height: 1400 } });
  try {
    await go(page, `${base}/parts/orders/${po.id}`);
    check("7e: the pay form asks how it was paid (bank transfer by default) and shows the account each method pays from", (await page.locator("[data-pay-method] input[value=transfer]").isChecked()) && /Paid from in Zoho — Bank transfer: /.test((await page.locator("[data-pay-method]").textContent()) ?? ""));
    await page.locator("[data-pay-method] label", { hasText: "Cash" }).click();
    await page.locator('[data-pay-form] input[name="reference"]').fill("Receipt 77");
    await page.locator("[data-pay-proof]").setInputFiles({ name: "receipt.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF\n") });
    await page.locator("[data-mark-supplier-paid]").click();
    await page.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 30000 }).catch(() => null);
    const row = await until(async () => { const r = (await sql("select supplier_paid_method, supplier_paid_reference, supplier_paid_proof_path from public.purchase_orders where id = $1", [po.id]))[0]; return r?.supplier_paid_method === "cash" ? r : null; });
    check("7e: paid by cash, with the reference and the proof stored", row?.supplier_paid_method === "cash" && row?.supplier_paid_reference === "Receipt 77" && /^supplier-payments\//.test(row?.supplier_paid_proof_path ?? ""), JSON.stringify(row));
    await park("billpayment", po.id);
    await park("bill", po.id);
    check("7e: the LPO shows Cash and the proof link", /Cash/.test((await page.locator("[data-paid-line]").textContent()) ?? "") && (await page.locator("[data-paid-proof]").count()) === 1);
    if (row?.supplier_paid_proof_path) await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/job-files/${row.supplier_paid_proof_path}`, { method: "DELETE", headers: { authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, apikey: process.env.SUPABASE_SERVICE_ROLE_KEY } }).catch(() => null);
  } finally {
    await browser.close();
  }
});

/* ---------------- 7c. a by-hand-only row (opening balances) is never re-run ---------------- */
await section("7c by-hand-only rows", async () => {
  await sql("insert into public.zoho_outbox (kind, record_id, job_id, status, last_error, zoho_result) values ('creditnote', $1, $2, 'failed', 'E2e: sits in the opening balances', '{\"hand_only\": true}'::jsonb) on conflict (kind, record_id) do update set status = 'failed', last_error = excluded.last_error, zoho_result = excluded.zoho_result", [cnId, jobId]);
  await api("/api/e2e/zoho", { action: "reopen", kind: "creditnote", recordId: cnId });
  const r = (await sql("select status, zoho_result from public.zoho_outbox where kind = 'creditnote' and record_id = $1", [cnId]))[0];
  check("7c: a late addition leaves a by-hand-only row red and untouched", r?.status === "failed" && r?.zoho_result?.hand_only === true, JSON.stringify(r));
  const { browser, page } = await browserFor("accounts", { viewport: { width: 1440, height: 1400 } });
  try {
    await go(page, `${base}/zoho?show=failed`);
    const row = page.locator('li[data-zoho-row="failed"]', { hasText: "E2e: sits in the opening balances" }).first();
    await row.locator("[data-zoho-retry]").click();
    await page.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 30000 }).catch(() => null);
    const after = (await sql("select status from public.zoho_outbox where kind = 'creditnote' and record_id = $1", [cnId]))[0];
    check("7c: Retry refuses it in plain words (it could post twice)", /corrected\+by\+hand|corrected%20by%20hand/.test(page.url()) && after?.status === "failed", `${page.url().slice(-120)} ${JSON.stringify(after)}`);
  } finally {
    await browser.close();
  }
});

/* ---------------- 7d. "Done by hand" on an invoice turns its already-posted payments red ---------------- */
await section("7d done by hand on an invoice", async () => {
  const [inv] = await sql(
    "insert into public.invoices (number, kind, job_id, customer_id, vehicle_id, token, subtotal_aed, discount_aed, taxable_aed, vat_aed, total_aed) values ('INV-E2EZ3-H', 'tax_invoice', $1, $2, $3, 'e2e-z3-inv-h', 400, 0, 400, 20, 420) returning id",
    [jobId, customerId, vehicleId],
  );
  const [pay] = await sql(
    "insert into public.payments (number, job_id, invoice_id, customer_id, method, amount_aed, bank_charge_aed, is_deposit, status, received_at) values ('RCT-E2EZ3-H', $1, $2, $3, 'cash', 420, 0, false, 'recorded', now()) returning id",
    [jobId, inv.id, customerId],
  );
  await sql("insert into public.zoho_outbox (kind, record_id, job_id, status, last_error) values ('invoice', $1, $2, 'failed', 'E2e: invoice refused in Zoho')", [inv.id, jobId]);
  await sql("insert into public.zoho_outbox (kind, record_id, job_id, status, zoho_id, synced_at, zoho_result) values ('payment', $1, $2, 'synced', 'E2E-FAKE-PAY', now(), '{\"amount\": 420}'::jsonb)", [pay.id, jobId]);
  const { browser, page } = await browserFor("accounts", { viewport: { width: 1440, height: 1400 } });
  try {
    await go(page, `${base}/zoho?show=failed`);
    const row = page.locator('li[data-zoho-row="failed"]', { hasText: "INV-E2EZ3-H" }).first();
    await row.locator("[data-zoho-by-hand] summary").click();
    await row.locator("[data-zoho-by-hand-note]").fill("Entered by hand as INV-9001");
    await row.locator("[data-zoho-by-hand-save]").click();
    await page.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 30000 }).catch(() => null);
    const p = await until(async () => { const r = (await sql("select status, last_error, zoho_id from public.zoho_outbox where kind = 'payment' and record_id = $1", [pay.id]))[0]; return r?.status === "failed" ? r : null; });
    check("7d: the payment already in Zoho turns red, keeping its Zoho id, asking to apply it by hand", p?.status === "failed" && p?.zoho_id === "E2E-FAKE-PAY" && /INV-E2EZ3-H was settled by hand in Zoho, so .* already posted there unapplied, was never applied/.test(p?.last_error ?? ""), JSON.stringify(p));
    check("7d: the message says so next to the button", /payment.*already\+in\+Zoho|payment.*already%20in%20Zoho/.test(page.url()), page.url().slice(-160));
  } finally {
    await browser.close();
  }
});

/* ---------------- 8. the go-live switch, simulated in a rolled-back transaction ---------------- */
await section("8 switch simulation (rolled back)", async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const ref = url.replace(/^https:\/\//, "").replace(/\.supabase\.co\/?$/, "");
  const db = new pg.Client({ host: `db.${ref}.supabase.co`, port: 5432, user: "postgres", password: process.env.SUPABASE_DB_PASSWORD, database: "postgres", ssl: { rejectUnauthorized: false } });
  await db.connect();
  const q = async (text, params = []) => (await db.query(text, params)).rows;
  const SIM = "SIM-NOT-AN-ORG";
  const ID_COLS = [
    ["customers", "zoho_contact_id"], ["suppliers", "zoho_vendor_id"], ["invoices", "zoho_invoice_id"], ["invoices", "zoho_creditnote_id"], ["invoices", "zoho_refund_id"],
    ["payments", "zoho_payment_id"], ["purchase_orders", "zoho_bill_id"], ["purchase_orders", "zoho_billpayment_id"], ["part_items", "zoho_vendorcredit_id"],
    ["commission_payments", "zoho_expense_id"], ["recovery_payouts", "zoho_expense_id"],
  ];
  const ids = async () => { let n = 0; for (const [t, c] of ID_COLS) n += Number((await q(`select count(*)::int as n from public.${t} where ${c} is not null`))[0].n); return n; };
  const snap = async (testOrg) => ({
    outbox: Number((await q("select count(*)::int as n from public.zoho_outbox"))[0].n),
    archived: Number((await q("select count(*)::int as n from public.zoho_outbox_archive where org = $1", [testOrg]))[0].n),
    ids: await ids(),
    live: (await q("select value from public.settings where key = 'zoho_live_enabled'"))[0]?.value,
  });
  try {
    await q("set statement_timeout = '90s'");
    const testOrg = (await q("select value #>> '{}' as v from public.settings where key = 'zoho_org_test'"))[0]?.v;
    check("8: OFJ TEST is the picked organization (never the REAL id)", !!testOrg && testOrg !== "942979945", String(testOrg));
    // The live five-minute cron shares this database: wait until nothing is being posted.
    await until(async () => Number((await q("select count(*)::int as n from public.zoho_outbox where claimed_at > now() - interval '10 minutes'"))[0].n) === 0, 60, 1000);
    const before = await snap(testOrg);
    await q("begin");
    try {
      // A row in flight stops the switch.
      await q("savepoint claimed");
      const one = (await q("select id from public.zoho_outbox limit 1"))[0];
      if (one) {
        await q("update public.zoho_outbox set claimed_at = now() where id = $1", [one.id]);
        let refused = "";
        try { await q("select public.zoho_switch_org($1, $2, false, null, null)", [testOrg, SIM]); } catch (e) { refused = e.message; }
        check("8: the switch refuses while a document is being posted", /posting a document right now/.test(refused), refused || "went through");
      }
      await q("rollback to savepoint claimed");

      // The switch runs once in the life of the books: after go-live it refuses for good (checked under its lock).
      await q("savepoint once");
      await q("update public.settings set value = to_jsonb('2026-11-01T00:00:00Z'::text) where key = 'zoho_went_live_at'");
      let once = "";
      try { await q("select public.zoho_switch_org($1, $2, false, null, null)", [testOrg, SIM]); } catch (e) { once = e.message; }
      check("8: once the books went live, the switch refuses to run again", /already went live/.test(once), once || "went through");
      await q("rollback to savepoint once");

      // Bills dated from the start date are replayed as NEW bills: their OFJ TEST VAT snapshot goes; older ones keep it.
      await q("savepoint taxed");
      const [sup] = await q("insert into public.suppliers (name, phone) values ('E2e Sim Supplier', '+971500000095') returning id");
      const [newBill] = await q("insert into public.purchase_orders (number, kind, supplier_id, supplier_name, status, total_cost_aed, supplier_invoice_status, supplier_invoice_number, supplier_invoice_date, zoho_bill_taxed) values ('LPO-E2E9-SIM-1', 'supplier', $1, 'E2e Sim Supplier', 'received', 10, 'received', 'SIM-1', '2026-11-03', true) returning id", [sup.id]);
      const [oldBill] = await q("insert into public.purchase_orders (number, kind, supplier_id, supplier_name, status, total_cost_aed, supplier_invoice_status, supplier_invoice_number, supplier_invoice_date, zoho_bill_taxed) values ('LPO-E2E9-SIM-2', 'supplier', $1, 'E2e Sim Supplier', 'received', 10, 'received', 'SIM-2', '2026-10-20', true) returning id", [sup.id]);
      await q("select public.zoho_switch_org($1, $2, false, null, '2026-11-01'::date)", [testOrg, SIM]);
      const snaps = await q("select number, zoho_bill_taxed from public.purchase_orders where id in ($1, $2) order by number", [newBill.id, oldBill.id]);
      check("8: the switch clears the VAT snapshot of bills from the start date only (they post again as new bills)", snaps[0]?.zoho_bill_taxed === null && snaps[1]?.zoho_bill_taxed === true, JSON.stringify(snaps));
      await q("rollback to savepoint taxed");

      const r1 = (await q("select public.zoho_switch_org($1, $2, false, null, null) as r", [testOrg, SIM]))[0].r;
      const mid = await snap(testOrg);
      check("8: away from OFJ TEST: its whole queue is archived, the queue is empty, every stored Zoho id cleared", mid.outbox === 0 && mid.archived === before.archived + before.outbox && mid.ids === 0 && r1.archived === before.outbox, JSON.stringify({ before, mid, r1 }));
      check("8: the simulation never turned the books live", mid.live === false, JSON.stringify(mid.live));

      const r2 = (await q("select public.zoho_switch_org($1, $2, false, null, null) as r", [SIM, testOrg]))[0].r;
      const back = await snap(testOrg);
      const mism = Number((await q(`select (
          (select count(*) from public.customers t join public.zoho_outbox o on o.kind = 'contact' and o.record_id = t.id and o.status = 'synced' and o.zoho_id is not null where t.zoho_contact_id is distinct from o.zoho_id)
        + (select count(*) from public.suppliers t join public.zoho_outbox o on o.kind = 'vendor' and o.record_id = t.id and o.status = 'synced' and o.zoho_id is not null where t.zoho_vendor_id is distinct from o.zoho_id)
        + (select count(*) from public.invoices t join public.zoho_outbox o on o.kind = 'invoice' and o.record_id = t.id and o.status = 'synced' and o.zoho_id is not null where t.zoho_invoice_id is distinct from o.zoho_id)
        + (select count(*) from public.payments t join public.zoho_outbox o on o.kind in ('payment', 'deposit') and o.record_id = t.id and o.status = 'synced' and o.zoho_id is not null where t.zoho_payment_id is distinct from o.zoho_id)
        + (select count(*) from public.purchase_orders t join public.zoho_outbox o on o.kind = 'bill' and o.record_id = t.id and o.status = 'synced' and o.zoho_id is not null where t.zoho_bill_id is distinct from o.zoho_id)
        )::int as n`))[0].n);
      check("8: back on OFJ TEST: its queue returns whole and every id comes back from its posted rows", back.outbox === before.outbox && back.archived === before.archived && r2.restored === before.outbox && mism === 0 && back.ids > 0, JSON.stringify({ back, r2, mism }));
    } finally {
      await q("rollback");
    }
    const afterAll = await snap(testOrg);
    check("8: rolled back: the real queue and every id are exactly as before", afterAll.outbox === before.outbox && afterAll.ids === before.ids && afterAll.archived === before.archived && afterAll.live === false, JSON.stringify({ before, afterAll }));
  } finally {
    await db.end();
  }
});

await sql("delete from public.zoho_outbox where job_id = $1 or record_id in (select id from public.invoices where job_id = $1) or record_id in (select id from public.part_items where job_id = $1)", [jobId]).catch(() => null);
cleanupDb();
process.exit(summary() ? 1 : 0);
