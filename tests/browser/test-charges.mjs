// EARLY CHARGES + PENDING CHARGES (1 November 2026, B2; J-00971 FERRARI 550, RASHED AL SHAMSI TRANSPORT 270/300 a trip).
// A: recovery (two ways) and fuel added on the job card BEFORE the check-in approval, the supplier's bill attached;
//    the customer's vehicle check-in lists them as CHARGES ALREADY INCURRED with the VAT the agreed way (EN + AR) and
//    the agreement words; approving agrees them; the job card shows the cost and the profit so far.
// B: a charge added AFTER the approval goes into the quotation. C: "customer declined all work" invoices the agreed
//    charges with the inspection fee. D: the quotation's "+ Inspection fee" button follows the job's fee choice.
// E: a pending charge for a customer whose car never came in (no job card, not on the dashboard) with its PROFORMA;
//    a part payment then the rest through the Record payment window → the TAX INVOICE by itself; another entry linked
//    to a car that already left, issued by hand; the list with totals and filters; the "Pending charge – collect it"
//    note on the gate-in; the Excel export.
// Run: node --env-file=.env.test.local tests/browser/test-charges.mjs   (test server on 3102)
import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { api, base, browserForId, cleanupDb, go, here, makeChecks, sleep, sql, pressYes } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const dir = path.join(here, "shots", "charges");
mkdirSync(dir, { recursive: true });
const shot = (name) => path.join(dir, name);
const text = async (loc) => ((await loc.first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
const until = async (fn, tries = 60, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const png = path.join(dir, "bill.png");
writeFileSync(png, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAEklEQVR4nGNoaGjAgxhGpbFIAwDdcwIBtxZC4AAAAABJRU5ErkJggg==", "base64"));

const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0];
const advisor = (await sql("select id from public.staff where role_id = 'service_advisor' and is_active order by created_at limit 1"))[0];
const acc = (await sql("select id from public.staff where role_id = 'accounts' and is_active order by created_at limit 1"))[0];
const browsers = [];
const open = async (id, w = 1440, h = 1000) => { const b = await browserForId(id, { viewport: { width: w, height: h } }); browsers.push(b); return b; };
const addChargeRow = async (page, i, row) => {
  const r = page.locator(`[data-charge-row="${i}"]`);
  await r.locator(`[data-charge-kind="${row.kind}"]`).click();
  if (row.kind === "recovery") {
    await r.locator("[data-charge-provider]").fill(row.provider);
    await r.locator("[data-charge-recovery-type]").selectOption(row.type);
    await r.locator("[data-charge-trips]").fill(String(row.trips));
  }
  if (row.kind === "fuel") await r.locator("[data-charge-litres]").fill(String(row.litres));
  if (row.kind === "other") await r.locator("[data-charge-description]").fill(row.description);
  await r.locator("[data-charge-cost]").fill(String(row.cost));
  await r.locator("[data-charge-charge]").fill(String(row.charge));
};

cleanupDb();
try {
  /* ---------- A. Before the check-in approval ---------- */
  const seed = (await api("/api/e2e/stage", { stage: "assign" })).json;
  const jobId = seed.jobId;
  await sql("update public.jobs set first_approval_at = null, status = 'pending_approval', stage = 'approval' where id = $1", [jobId]);
  const job = (await sql("select job_number, customer_id, vehicle_id, first_approval_at from public.jobs where id = $1", [jobId]))[0];
  check("A: the test car waits for its check-in approval", !job.first_approval_at);
  const adv = await open(advisor.id);
  await go(adv.page, `${base}/jobs/${jobId}`);
  await adv.page.locator("[data-charge-open]").click();
  await addChargeRow(adv.page, 0, { kind: "recovery", provider: "E2E RASHED AL SHAMSI TRANSPORT", type: "full_down", trips: 2, cost: 540, charge: 600 });
  await adv.page.locator("[data-charge-add-row]").click();
  await addChargeRow(adv.page, 1, { kind: "fuel", litres: 40, cost: 120, charge: 130 });
  await adv.page.screenshot({ path: shot("a1-add-charges.png") });
  await adv.page.locator("[data-charge-save]").click();
  const lines = await until(async () => { const r = await sql("select id, kind, description, cost_aed::float as cost, charge_aed::float as charge from public.charge_lines where job_id = $1 and is_active order by created_at", [jobId]); return r.length === 2 ? r : null; });
  check(`A: both charges saved (${(lines ?? []).map((l) => l.description).join(" | ")})`, lines?.[0]?.description === "RECOVERY – FULL DOWN, TWO WAYS" && lines?.[1]?.description === "FUEL – 40 L");
  await go(adv.page, `${base}/jobs/${jobId}#charges`);
  const rec = adv.page.locator(`[data-charge-line="${lines[0].id}"]`);
  await rec.locator('input[type="file"]').first().setInputFiles(png);
  const bill = await until(async () => (await sql("select id from public.job_files where job_id = $1 and ref_id = $2", [jobId, lines[0].id]))[0], 60, 500);
  check("A: the supplier's bill is attached to the recovery", !!bill);
  const profitText = await text(adv.page.locator("[data-charges-profit]"));
  check(`A: the cost counts in the job's profit at once ("${profitText}")`, profitText.includes("AED 70.00"));
  await adv.page.locator("[data-charges-card]").scrollIntoViewIfNeeded();
  await adv.page.screenshot({ path: shot("a2-charges-card.png") });
  // The customer's vehicle check-in.
  const token = randomBytes(16).toString("base64url");
  await sql("insert into public.approval_requests (job_id, token, status, sent_to_phone, sent_to_name, terms_text, created_by, opened_at) values ($1, $2, 'sent', '+971500000001', 'E2e Customer', 'Terms', $3, now())", [jobId, token, advisor.id]);
  const cust = await open(owner.id, 390, 844);
  await go(cust.page, `${base}/approve/${token}`);
  const incurred = await cust.page.locator("[data-charge-incurred]").allTextContents();
  check(`A: the check-in lists the charges with VAT ("${incurred[0]?.slice(0, 90)}")`, incurred.some((t) => t.includes("RECOVERY – FULL DOWN, TWO WAYS: AED 630.00 including VAT (AED 600 + VAT)")) && incurred.some((t) => t.includes("FUEL – 40 L: AED 136.50 including VAT (AED 130 + VAT)")));
  check("A: … also in Arabic", incurred.some((t) => t.includes("شاملة ضريبة القيمة المضافة")));
  check(`A: the approval adds the words about the charges`, (await text(cust.page.locator("[data-charges-agree]"))).includes("agree to pay the charges listed above, even if no further work is approved"));
  await cust.page.locator("[data-charges-incurred]").scrollIntoViewIfNeeded();
  await cust.page.screenshot({ path: shot("a3-check-in-charges.png"), fullPage: true });
  await cust.page.locator("[data-approver-name]").fill("E2E CUSTOMER");
  await cust.page.locator("input[name='agree']").check();
  await cust.page.locator("#approval-form button[type='submit']").click();
  const agreed = await until(async () => { const r = await sql("select count(*)::int as n from public.charge_lines where job_id = $1 and agreed_at is not null", [jobId]); return r[0]?.n === 2 ? r : null; });
  check("A: approving the check-in agrees both charges", !!agreed);
  const snap = (await sql("select jsonb_array_length(charges_snapshot) as n from public.approval_requests where token = $1", [token]))[0];
  check("A: the approval keeps them in its snapshot", snap?.n === 2);

  /* ---------- B. After the approval: into the quotation ---------- */
  const q = (await api("/api/e2e/stage", { stage: "quote" })).json;
  await go(adv.page, `${base}/jobs/${jobId}`);
  await adv.page.locator("[data-charge-open]").click();
  await addChargeRow(adv.page, 0, { kind: "other", description: "Parking at the dealer", cost: 50, charge: 60 });
  await adv.page.locator("[data-charge-save]").click();
  // The quotation is totalled after the line goes in: wait for the line to carry its total.
  const parked = await until(async () => { const r = (await sql("select cl.quotation_line_id, ql.title, ql.unit_price::float as price, ql.line_total::float as total, ql.markup_percent::float as markup from public.charge_lines cl join public.quotation_lines ql on ql.id = cl.quotation_line_id where cl.job_id = $1 and cl.description ilike 'parking%'", [jobId]))[0]; return r && r.total > 0 ? r : null; });
  check(`B: a charge after the approval goes into the quotation ("${parked?.title}", AED ${parked?.price})`, !!parked?.quotation_line_id && parked?.title === "PARKING AT THE DEALER" && parked?.price === 60);
  // 2 November 2026: THE price rule prices an Other line with a cost as cost + markup, so the charge goes in as the markup
  // that lands on it (cost 50 + 20% = 60), never at the cost alone.
  check("B: it sells at the charge, not at its cost (line total AED " + parked?.total + ", markup " + parked?.markup + "%)", parked?.total === 60 && Math.abs((parked?.markup ?? 0) - 20) < 1e-6);

  /* ---------- D. The fee button follows this job's fee choice ---------- */
  const own = await open(owner.id);
  await sql("update public.jobs set inspection_fee_choice = 'none', inspection_fee_aed = null where id = $1", [jobId]);
  await go(own.page, `${base}/jobs/${jobId}/quote/${q.quotationId}`);
  check("D: no \"+ Inspection fee\" on a free-inspection job", (await own.page.getByText(/\+ Inspection fee/).count()) === 0);
  await sql("update public.jobs set inspection_fee_choice = 'fee', inspection_fee_aed = 1000 where id = $1", [jobId]);
  await go(own.page, `${base}/jobs/${jobId}/quote/${q.quotationId}`);
  check("D: a fee job shows its own amount (+ Inspection fee (AED 1,000.00))", (await own.page.getByText("+ Inspection fee (AED 1,000.00)").count()) === 1);

  /* ---------- C. The customer declined all work ---------- */
  await go(own.page, `${base}/jobs/${jobId}`);
  await own.page.locator("[data-declined-all]").first().click();
  await own.page.locator("[data-declined-charge]").click();
  await own.page.locator("[data-declined-result]").waitFor({ timeout: 30000 }).catch(() => {});
  const inv = await until(async () => (await sql("select i.id, i.number, i.total_aed::float as total from public.invoices i where i.job_id = $1 and i.kind = 'tax_invoice' order by i.created_at desc limit 1", [jobId]))[0]);
  const invLines = inv ? await sql("select description, amount_aed::float as amount, cost_aed::float as cost from public.invoice_lines where invoice_id = $1 order by position", [inv.id]) : [];
  check(`C: the declined-work invoice carries the fee and every agreed charge (${invLines.map((l) => `${l.description} ${l.amount}`).join(" | ")})`, invLines.some((l) => /INSPECTION CHARGES/.test(l.description) && l.amount === 1000) && invLines.some((l) => l.description === "RECOVERY – FULL DOWN, TWO WAYS" && l.amount === 600 && l.cost === 540) && invLines.some((l) => l.description === "FUEL – 40 L" && l.amount === 130));
  const locked = (await sql("select count(*)::int as n from public.charge_lines where job_id = $1 and invoice_id = $2", [jobId, inv?.id]))[0];
  check("C: the invoiced charges are locked to the invoice (once only)", locked?.n === 2);
  await own.page.screenshot({ path: shot("c1-declined-invoice.png") });

  /* ---------- E. Pending charges ---------- */
  const jobsBefore = (await sql("select count(*)::int as n from public.jobs"))[0].n;
  const accB = await open(acc.id);
  const page = accB.page;
  await go(page, `${base}/pending-charges?new=1`);
  await page.locator("[data-pc-new-name]").fill("E2E PENDING CUSTOMER");
  await page.locator("[data-pc-new-phone]").fill("+971500000977");
  await addChargeRow(page, 0, { kind: "recovery", provider: "E2E RASHED AL SHAMSI TRANSPORT", type: "full_down", trips: 2, cost: 540, charge: 600 });
  await page.screenshot({ path: shot("e1-new-pending-charge.png"), fullPage: true });
  await page.locator("[data-pc-quick-customer] button[type='submit']").click();
  const pcCust = await until(async () => (await sql("select id, full_name from public.customers where phone like '%500000977' order by created_at desc limit 1"))[0]);
  const entry = await until(async () => { const e = (await sql("select id, proforma_id from public.charge_entries where customer_id = $1", [pcCust?.id ?? "00000000-0000-0000-0000-000000000000"]))[0]; if (!e?.proforma_id) return null; const i = (await sql("select number, total_aed::float as total, job_id from public.invoices where id = $1", [e.proforma_id]))[0]; return i ? { ...e, ...i } : null; });
  check(`E: the pending charge has its own PROFORMA (${entry?.number}, AED ${entry?.total}), on no job`, !!entry?.proforma_id && entry?.total === 630 && entry?.job_id === null);
  const jobsAfter = (await sql("select count(*)::int as n from public.jobs"))[0].n;
  check("E: no job card was made", jobsAfter === jobsBefore);
  await page.waitForURL(/open=/, { timeout: 20000 }).catch(() => {});
  await sleep(600);
  check("E: the proforma link is ready to send", (await page.locator("[data-pc-send]").count()) === 1);
  await page.screenshot({ path: shot("e2-pending-charge-opened.png"), fullPage: true });
  const dash = await (await fetch(`${base}/dashboard`, { headers: { cookie: (await accB.context.cookies()).map((c) => `${c.name}=${c.value}`).join("; ") } })).text();
  // The owner's rule of 31 October: a pending charge is not on the dashboard (no customer, no car, no row). Since 3 November
  // the Awaiting payment tile counts it, so one plain line says "Plus n pending charges · AED x" with a link to the page.
  check("E: it is not on the dashboard (no customer, no row)", !dash.includes("E2E PENDING CUSTOMER") && !dash.includes(`charge:${entry?.id}`) && !dash.includes('data-money-kind="charge"'));
  const plain = dash.replace(/<!-- -->/g, ""); // React splits text around {values} with empty comments
  check("E: the dashboard only says how much of Awaiting payment is pending charges, linking to the page", /data-pending-charges-line[^>]*>[^<]*Plus \d+ pending charges?/.test(plain) && /data-pending-charges-line[\s\S]{0,600}href="\/pending-charges"/.test(plain));
  // A part payment, then the rest, through the Record payment window.
  const pay = async (amount) => {
    await go(page, `${base}/pending-charges?open=${entry.id}`);
    await page.locator("[data-record-payment-open]").first().click();
    const d = page.locator("[data-record-payment-dialog]");
    await until(async () => (await d.locator("[data-pay-targets]").count()) > 0, 40, 300);
    await d.locator(`[data-pay-target="inv:${entry.proforma_id}"]`).click();
    await d.locator("[data-method='cash']").click();
    if (await d.locator("[data-amount-partial]").count()) await d.locator("[data-amount-partial]").click();
    await d.locator("[data-amount-input]").fill("");
    await d.locator("[data-amount-input]").pressSequentially(String(amount));
    // A person takes a moment: the form guard swallows a second tap within five seconds of the last one.
    await sleep(5500);
    await d.locator("[data-record-payment]").click();
    await d.locator("[data-confirm-yes]").click({ timeout: 4000 }).catch(() => {});
    const ok = await until(async () => (await d.locator("[data-record-payment-done]").count()) > 0, 50, 500);
    if (!ok) console.log("   window says:", (await text(d)).slice(-500));
    await d.locator("[data-record-payment-finish]").click().catch(() => {});
  };
  await pay(300);
  // The second payment in the same tab, after a reload: a new form key, never "already used" (fixed 1 November 2026).
  const part = (await sql("select status, tax_invoice_id from public.charge_entries where id = $1", [entry.id]))[0];
  check("E: AED 300 of 630 paid: still pending, no tax invoice yet", part?.status === "pending" && !part?.tax_invoice_id);
  await go(page, `${base}/pending-charges?open=${entry.id}`);
  check(`E: the list shows what is paid ("${(await text(page.locator("[data-pc-money]"))).slice(0, 80)}")`, (await text(page.locator("[data-pc-money]"))).includes("paid AED 300.00"));
  await pay(330);
  const paid = await until(async () => (await sql("select e.status, i.number, i.kind from public.charge_entries e join public.invoices i on i.id = e.tax_invoice_id where e.id = $1", [entry.id]))[0]);
  check(`E: paid in full, the TAX INVOICE is issued by itself (${paid?.number})`, paid?.status === "paid" && paid?.kind === "tax_invoice");
  const moved = (await sql("select count(*)::int as n from public.payments p join public.charge_entries e on e.tax_invoice_id = p.invoice_id where e.id = $1", [entry.id]))[0];
  check("E: both payments sit on the tax invoice (balance 0)", moved?.n === 2);
  // A second entry linked to the seeded car (the car that came and left), issued by hand.
  await go(page, `${base}/pending-charges?new=1&customer=${job.customer_id}`);
  await page.locator("[data-pc-job]").selectOption(jobId);
  await addChargeRow(page, 0, { kind: "other", description: "Towing extra", cost: 100, charge: 150 });
  await page.locator("[data-pc-save]").click();
  const e2 = await until(async () => (await sql("select id, proforma_id, job_id, vehicle_id from public.charge_entries where job_id = $1 and status = 'pending' and proforma_id is not null", [jobId]))[0]);
  check("E: an entry linked to the car that already left (its job and car)", !!e2 && e2.vehicle_id === job.vehicle_id);
  const e2inv = (await sql("select job_id from public.invoices where id = $1", [e2?.proforma_id]))[0];
  check("E: its proforma is its own bill, never on the job's", e2inv && e2inv.job_id === null);
  await page.waitForURL(/open=/, { timeout: 20000 }).catch(() => {});
  await page.locator("form:has([data-pc-issue]) input[name='reason']").fill("Customer asked for the tax invoice now");
  await page.locator("[data-pc-issue]").click(); await pressYes(page);
  const manual = await until(async () => (await sql("select tax_invoice_id, status from public.charge_entries where id = $1 and tax_invoice_id is not null", [e2.id]))[0]);
  check("E: \"Issue tax invoice\" by hand (logged with the reason), still pending until paid", !!manual && manual.status === "pending");
  // The list, totals and filters.
  await go(page, `${base}/pending-charges?status=all`);
  check(`E: totals at the top ("${(await text(page.locator("[data-pc-totals]"))).slice(0, 60)}")`, /Pending: \d+ · AED/.test(await text(page.locator("[data-pc-totals]"))));
  check("E: the All filter shows the paid one too", (await page.locator(`[data-pc-row="${entry.id}"][data-pc-state="paid"]`).count()) === 1);
  await go(page, `${base}/pending-charges?status=paid`);
  check("E: the Paid filter", (await page.locator("[data-pc-row][data-pc-state='pending']").count()) === 0 && (await page.locator(`[data-pc-row="${entry.id}"]`).count()) === 1);
  await page.screenshot({ path: shot("e3-list.png"), fullPage: true });
  const cookie = (await accB.context.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
  const res = await fetch(`${base}/api/export/pending-charges?status=all`, { headers: { cookie } });
  const buf = Buffer.from(await res.arrayBuffer());
  check(`E: Export to Excel (${buf.length} bytes)`, res.status === 200 && buf.slice(0, 2).toString() === "PK");
  // The follow-up note on the gate-in of the customer's car.
  await go(adv.page, `${base}/jobs/${jobId}/quote/${q.quotationId}`);
  const note = await text(adv.page.locator("[data-pending-charge-note]"));
  check(`E: the quotation (as the gate-in and the customer panel) says "Pending charge … – collect it" ("${note}")`, /^Pending charge: AED [\d,.]+ \(other .+\) – collect it/i.test(note));
  await adv.page.locator("[data-pending-charge-note]").scrollIntoViewIfNeeded().catch(() => {});
  await adv.page.screenshot({ path: shot("e4-gate-in-note.png") });
} finally {
  for (const b of browsers) await b.browser.close().catch(() => {});
  if (!process.env.KEEP) cleanupDb();
}
summary();
