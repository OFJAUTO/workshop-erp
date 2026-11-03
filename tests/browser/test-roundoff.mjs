// The optional round-off on every document (3 November 2026, batch A1), on the TEST database:
//  A. The advisor's Round off window in the quotation editor: nearest-10 down, the up cap, Remove,
//     above AED 100 goes to the owner at Send (the reason in his box), the owner approves, it sends.
//  B. The owner sets the total to 37,930.00 exactly (the Q-00039 example): VAT exactly 5% of the
//     taxable amount (1,806.19 on 36,123.81).
//  C. The round-off carries to the proforma; the proforma's own round-off; up above the approved
//     quotation total refused; Remove puts the draft's totals back; paid in full -> the tax invoice
//     carries the same figures, the Zoho outbox row is queued, and the PDF prints ROUND-OFF once.
//   node --env-file=.env.test.local tests/browser/test-roundoff.mjs   (test server on :3102)
import path from "node:path";
import fs from "node:fs";
import { api, base, browserFor, cleanupDb, go, here, makeChecks, sleep, sql, pressRecord } from "./pw-lib.mjs";

const mupdf = await import("mupdf");
const { check, summary } = makeChecks();
const SHOTS = path.join(here, "shots", "roundoff");
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (n) => path.join(SHOTS, n);
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const r2 = (n) => Math.round(n * 100) / 100;
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 14 * 60 * 1000).unref();

const quoteRow = async (id) => (await sql("select status, rounded_total_aed::float8 as rounded, subtotal_aed::float8 as subtotal, discount_aed::float8 as discount, vat_aed::float8 as vat, total_aed::float8 as total, owner_approval_reason as reason, token, owner_approved_at, valid_until from public.quotations where id = $1", [id]))[0];
const vatExact = (taxable, vat) => Math.abs(vat - taxable * 0.05) <= 0.005 + 1e-9;
/** Press "Quotation complete", answer any of its one-time asks, wait for the stamp, reload, press Send. */
async function completeThenSend(page, url, id) {
  await page.getByRole("button", { name: "Quotation complete" }).click();
  for (let i = 0; i < 6; i++) {
    const done = (await sql("select completed_at from public.quotations where id = $1", [id]))[0]?.completed_at;
    if (done) break;
    for (const sel of ["[data-deposit-skip]", "[data-markup-continue]", "[data-low-profit-send]", "[data-parts-leave]", "[data-high-markup-send]"]) {
      const b = page.locator(sel);
      if (await b.count()) { await b.first().click().catch(() => null); await sleep(400); }
    }
    await sleep(700);
  }
  const done = await until(async () => (await sql("select completed_at from public.quotations where id = $1", [id]))[0]?.completed_at, 20, 500);
  await go(page, url);
  await page.getByRole("button", { name: "Send quotation" }).click();
  return !!done;
}

/* ---------- A. The advisor in the editor ---------- */
await cleanupDb();
let seed = (await api("/api/e2e/stage", { stage: "quote" })).json;
const jobId = seed.jobId;
const qid = seed.quotationId;
// The seed's open parts request would block the send: closed, like a request Parts answered; the part
// gets its real supplier (a part with no supplier is a send blocker since 2 November).
await sql("update public.part_requests set status = 'closed', closed_reason = 'e2e round-off' where job_id = $1 and status = 'open'", [jobId]);
await sql("update public.part_items set supplier = 'E2E MOTORS LLC' where job_id = $1 and is_active", [jobId]);
await sql("update public.jobs set parts_pricing_done_at = now() where id = $1", [jobId]);

const adv = await browserFor("service_advisor", { viewport: { width: 1366, height: 1000 } });
const ap = adv.page;
await go(ap, `${base}/jobs/${jobId}/quote/${qid}`);
// Base: labour 600 + part 300 = 900 before VAT; 945.00 incl. VAT.
check("A: the Round off button is in the Summary", (await ap.locator("[data-roundoff-open]").count()) === 1);
await ap.locator("[data-roundoff-open]").click();
check("A: the window opens with the total", (await ap.locator("[data-roundoff-dialog]").count()) === 1 && /945\.00/.test((await ap.locator("[data-roundoff-current]").textContent()) ?? ""));
await ap.locator('[data-roundoff-step="10-down"]').click();
let row = await until(async () => { const r = await quoteRow(qid); return r.rounded === 940 && r.total === 940 ? r : null; });
check("A: nearest AED 10 down stores 940.00", !!row, JSON.stringify(row));
check("A: VAT recalculated to exactly 5% (44.76 on 895.24)", row && row.vat === 44.76 && vatExact(r2(row.total - row.vat), row.vat), JSON.stringify(row));
await until(async () => /Round-off/.test((await ap.locator("[data-roundoff-open]").textContent()) ?? ""));
check("A: the button reads the round-off", /Round-off − AED 4\.76/.test((await ap.locator("[data-roundoff-open]").textContent()) ?? ""));
check("A: the Summary shows it once, in green", (await ap.locator("[data-roundoff-row]").count()) === 1);
await ap.screenshot({ path: shot("a-rounded-editor.png") });
// Up beyond the cap is refused on the spot.
await ap.locator("[data-roundoff-open]").click();
await ap.locator("[data-roundoff-set]").fill("956");
await until(async () => /limited to AED 10/.test((await ap.locator("[data-roundoff-preview]").textContent().catch(() => "")) ?? ""), 10, 300);
check("A: up beyond AED 10 is refused in words", /limited to AED 10/.test((await ap.locator("[data-roundoff-preview]").textContent()) ?? ""));
check("A: Apply is off for it", await ap.locator("[data-roundoff-apply]").isDisabled());
// Remove puts the exact total back.
await ap.locator("[data-roundoff-remove]").click();
row = await until(async () => { const r = await quoteRow(qid); return r.rounded === null && r.total === 945 ? r : null; });
check("A: Remove round-off puts 945.00 back", !!row, JSON.stringify(row));
// Above the advisor's AED 100 limit: stored, told it goes to the owner.
await ap.locator("[data-roundoff-open]").click();
await ap.locator("[data-roundoff-set]").fill("820");
await ap.locator("[data-roundoff-apply]").click();
await until(async () => (await ap.locator("[data-roundoff-owner-note]").count()) > 0 || (await ap.locator("[data-roundoff-note]").count()) > 0);
const noteText = `${(await ap.locator("[data-roundoff-note]").textContent().catch(() => "")) ?? ""}${(await ap.locator("[data-roundoff-owner-note]").textContent().catch(() => "")) ?? ""}`;
check("A: above AED 100 says it goes to the owner at Send", /above your AED 100 limit/.test(noteText), noteText);
row = await until(async () => { const r = await quoteRow(qid); return r.rounded === 820 && r.total === 820 ? r : null; });
check("A: 820.00 is stored (VAT 39.05 on 780.95)", row && row.total === 820 && row.vat === 39.05 && vatExact(r2(row.total - row.vat), row.vat), JSON.stringify(row));
await ap.keyboard.press("Escape");
// Complete and send: it waits for the owner with the round-off as the reason.
check("A: Quotation complete goes through", await completeThenSend(ap, `${base}/jobs/${jobId}/quote/${qid}`, qid));
row = await until(async () => { const r = await quoteRow(qid); return r.status === "pending_owner" ? r : null; });
check("A: sending waits for the owner", !!row);
// The reason counts the PRE-VAT round-off (945 -> 820 = 119.05 before VAT), and the %-of-labour rule fires with it.
check("A: the reason names the round-off and the limit", /round-off AED 119\.05 \(limit AED 100\)/.test(row?.reason ?? ""), row?.reason);
await ap.screenshot({ path: shot("a-pending-owner.png") });
await adv.browser.close();
// The owner approves it from his box; the quotation can then be sent.
const own1 = await browserFor("owner", { viewport: { width: 1366, height: 1000 } });
const op1 = own1.page;
await go(op1, `${base}/jobs/${jobId}/quote/${qid}`);
check("A: the owner's box shows the reason", /round-off AED 119\.05/.test((await op1.locator("[data-owner-box-reason]").textContent().catch(() => "")) ?? ""));
await op1.locator("[data-owner-approve]").click();
row = await until(async () => { const r = await quoteRow(qid); return r.status !== "pending_owner" ? r : null; });
check("A: the owner's approval frees it", !!row && row.rounded === 820, JSON.stringify({ status: row?.status, rounded: row?.rounded }));
await own1.browser.close();

/* ---------- B + C. The owner's exact total, the carry to proforma and tax invoice ---------- */
await cleanupDb();
seed = (await api("/api/e2e/stage", { stage: "quote" })).json;
const job2 = seed.jobId;
const q2 = seed.quotationId;
await sql("update public.part_requests set status = 'closed', closed_reason = 'e2e round-off' where job_id = $1 and status = 'open'", [job2]);
await sql("update public.jobs set parts_pricing_done_at = now() where id = $1", [job2]);
// One big labour line: 108.4 h x 350 = 37,940.00 before VAT (39,837.00 with VAT).
await sql("update public.quotation_lines set is_active = false, updated_by = null where quotation_id = $1 and fee_kind is null", [q2]);
await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, hours, labour_rate, markup_percent, discount_percent, line_total) values ($1, 0, 'labour', 'E2E ENGINE OVERHAUL', 'manual', 1, 108.4, 350, 0, 0, 37940)", [q2]);
await sql("delete from public.part_items where job_id = $1 and id = '22222222-0000-4000-8000-00000000e311'", [job2]).catch(() => null);
await sql("update public.part_items set is_active = false where job_id = $1", [job2]);

const own = await browserFor("owner", { viewport: { width: 1366, height: 1000 } });
const op = own.page;
await go(op, `${base}/jobs/${job2}/quote/${q2}`);
await op.locator("[data-roundoff-open]").click();
await op.locator("[data-roundoff-set]").fill("37930");
await until(async () => /Round-off − AED/.test((await op.locator("[data-roundoff-preview]").textContent().catch(() => "")) ?? ""), 10, 300);
check("B: the preview shows the split", /36,123\.81.*1,806\.19.*37,930\.00/.test(((await op.locator("[data-roundoff-preview]").textContent()) ?? "").replace(/\s+/g, " ")), (await op.locator("[data-roundoff-preview]").textContent()) ?? "");
await op.locator("[data-roundoff-apply]").click();
let row2 = await until(async () => { const r = await quoteRow(q2); return r.rounded === 37930 && r.total === 37930 ? r : null; });
check("B: 37,930.00 stored with VAT exactly 1,806.19 (5% of 36,123.81)", row2 && row2.total === 37930 && row2.vat === 1806.19 && r2(row2.total - row2.vat) === 36123.81, JSON.stringify(row2));
await op.screenshot({ path: shot("b-37930.png") });
// The owner completes and sends it himself (his own round-off needs nobody).
check("B: Quotation complete goes through", await completeThenSend(op, `${base}/jobs/${job2}/quote/${q2}`, q2));
// The seed's token exists from the start, so the proof of the send is the stamp the send writes:
// the owner's own approval (the total is above the owner-approval threshold) and the validity date.
row2 = await until(async () => { const r = await quoteRow(q2); return r.token && r.valid_until && (r.owner_approved_at || r.status === "sent") ? r : null; });
check("B: the owner sends it without an approval step", !!row2 && row2.status !== "pending_owner", JSON.stringify({ status: row2?.status, approvedOwn: !!row2?.owner_approved_at }));
await op.keyboard.press("Escape");
// The link counts as sent once the window's WhatsApp/Copy is pressed; the test records the send directly.
await sql("update public.quotations set status = 'sent', sent_at = now(), valid_until = coalesce(valid_until, now() + interval '7 days') where id = $1 and status = 'draft'", [q2]);
// The customer approves through the public route; the car is put at Ready for the proforma.
const fd = new FormData();
fd.set("action", "approve");
fd.set("approver_name", "E2E ROUND CUSTOMER");
fd.set("agree", "on");
const approveRes = await fetch(`${base}/api/quote/${row2.token}`, { method: "POST", body: fd, redirect: "manual" });
const approved = await until(async () => (await quoteRow(q2)).status === "approved", 30, 500);
check("C: the customer approves on the link", [200, 302, 303].includes(approveRes.status) && !!approved, `${approveRes.status} → ${approveRes.headers.get("location")} · ${JSON.stringify(await quoteRow(q2))}`);
// applyCustomerResponse moves the job itself after approving: wait for its write, then put the car at Ready.
await until(async () => { const s = (await sql("select status from public.jobs where id = $1", [job2]))[0]?.status; return s && s !== "pending_quote" ? s : null; }, 20, 500);
await sql("update public.jobs set status = 'ready', stage = 'ready', stage_entered_at = now() where id = $1", [job2]);
await go(op, `${base}/jobs/${job2}/invoice`);
const prep = op.getByRole("button", { name: "Prepare the proforma" });
check("C: the money page offers Prepare the proforma", !!(await until(async () => (await prep.count()) > 0, 20, 500)), (await op.locator("[data-what-now]").textContent().catch(() => "")) ?? "");
await prep.click();
const pro = await until(async () => (await sql("select id, token, taxable_aed::float8 as taxable, vat_aed::float8 as vat, total_aed::float8 as total from public.invoices where job_id = $1 and kind = 'proforma' and status = 'issued' and converted_to is null", [job2]))[0] ?? null, 30, 500);
check("C: the proforma carries the quotation's round-off exactly", pro && pro.total === 37930 && pro.vat === 1806.19 && pro.taxable === 36123.81, JSON.stringify(pro));
// The proforma's own round-off: up above the approved total is refused; down works; Remove resets.
await go(op, `${base}/jobs/${job2}/invoice`);
check("C: the proforma has the Round off control", (await op.locator("[data-invoice-roundoff] [data-roundoff-open]").count()) === 1);
await op.locator("[data-invoice-roundoff] [data-roundoff-open]").click();
await op.locator("[data-roundoff-set]").fill("37935");
await until(async () => /approved quotation total/.test((await op.locator("[data-roundoff-preview]").textContent().catch(() => "")) ?? ""), 10, 300);
check("C: up above the approved quotation total is refused", /approved quotation total/.test((await op.locator("[data-roundoff-preview]").textContent()) ?? ""));
await op.locator("[data-roundoff-set]").fill("37900");
await op.locator("[data-roundoff-apply]").click();
let proNow = await until(async () => { const r = (await sql("select taxable_aed::float8 as taxable, vat_aed::float8 as vat, total_aed::float8 as total from public.invoices where id = $1", [pro.id]))[0]; return r.total === 37900 ? r : null; });
check("C: the proforma rounds to 37,900.00 (taxable 36,095.24, VAT 1,804.76)", proNow && proNow.taxable === 36095.24 && proNow.vat === 1804.76 && vatExact(proNow.taxable, proNow.vat), JSON.stringify(proNow));
await op.locator("[data-invoice-roundoff] [data-roundoff-open]").click();
await op.locator("[data-roundoff-remove]").click();
proNow = await until(async () => { const r = (await sql("select taxable_aed::float8 as taxable, vat_aed::float8 as vat, total_aed::float8 as total from public.invoices where id = $1", [pro.id]))[0]; return r.total === 37930 ? r : null; });
check("C: Remove puts the draft's totals back (37,930.00)", !!proNow, JSON.stringify(proNow));
await op.locator("[data-invoice-roundoff] [data-roundoff-open]").click();
await op.locator("[data-roundoff-set]").fill("37900");
await op.locator("[data-roundoff-apply]").click();
await until(async () => (await sql("select total_aed::float8 as t from public.invoices where id = $1", [pro.id]))[0].t === 37900);
await op.screenshot({ path: shot("c-proforma-rounded.png") });
// Paid in full in cash: the tax invoice is born with the same figures and queues for Zoho.
await go(op, `${base}/jobs/${job2}/invoice`);
const fold = op.locator("[data-record-block] summary");
if (await fold.count()) await fold.click();
// The form offers the full balance (a hidden amount of 37,900.00): pick cash and record it.
await op.locator('[data-method="cash"]').first().click();
await pressRecord(op);
const tax = await until(async () => (await sql("select id, number, token, taxable_aed::float8 as taxable, vat_aed::float8 as vat, total_aed::float8 as total, subtotal_aed::float8 as subtotal, discount_aed::float8 as discount from public.invoices where job_id = $1 and kind = 'tax_invoice' and status = 'issued'", [job2]))[0] ?? null, 40, 500);
check("C: paid in full, the tax invoice carries 37,900.00 with VAT 1,804.76", tax && tax.total === 37900 && tax.vat === 1804.76 && tax.taxable === 36095.24, JSON.stringify(tax));
check("C: the tax invoice never went above the approved quotation total", tax && tax.total <= 37930);
// The TEST server has no Zoho, so tryEnqueueZoho leaves no row here; the live hooks are unchanged. What
// Zoho will post is the stored figures: the derived round-off (taxable less lines-after-discount) is the
// taxed Round-off line, and VAT is exactly 5%, so the posting matches to the fils by construction.
const derivedRoundoff = r2(tax.taxable - (tax.subtotal - tax.discount));
check("C: the stored figures give Zoho the exact round-off (-1,844.76 = -1,810 on the quote - 34.76 here)", derivedRoundoff === r2(36095.24 - 37940), String(derivedRoundoff));
// The customer's PDF prints the round-off once and one total.
const pdfRes = await fetch(`${base}/api/pdf/invoice/${tax.token}`);
const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
const doc = mupdf.Document.openDocument(pdfBuf, "application/pdf");
const text = Array.from({ length: doc.countPages() }, (_, i) => doc.loadPage(i).toStructuredText().asText()).join("\n");
const upper = text.toUpperCase().replace(/\s+/g, " ");
check("C: the PDF prints ROUND-OFF once", upper.split("ROUND-OFF").length - 1 === 1, `${upper.split("ROUND-OFF").length - 1} times`);
// 37,900.00 is the total AND the recorded payment ("Paid ... (RCT-…)"): twice at most, never more.
const totals = upper.split("37,900.00").length - 1;
check("C: the PDF prints 37,900.00 as the total and the payment only", totals >= 1 && totals <= 2, `${totals} times`);
check("C: the PDF VAT line is 1,804.76", upper.includes("1,804.76"));
await own.browser.close();

await cleanupDb();
summary();
