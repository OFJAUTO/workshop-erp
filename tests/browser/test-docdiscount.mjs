// Discount on every customer document (21 October 2026, section 2): the line's own discount prints in
// bold green under the line and in the totals ("Labour and services (before discount)" → green
// "Discount −AED X"), on the quotation PDF AND the proforma; trailing dashes leave the names; the
// Complimentary word follows onto the invoice. One shared template renders them all.
//   node --env-file=.env.local tests/browser/test-docdiscount.mjs
import { writeFileSync } from "node:fs";
import { api, base, browserFor, cleanupDb, cookieHeader, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shots = "C:/Users/user/Desktop/workshop ERP/tests/browser/shots";
const until = async (fn, tries = 30, ms = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } return null; };
const pdfText = async (buf) => {
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  let text = "";
  for (let i = 0; i < doc.countPages(); i++) text += JSON.parse(doc.loadPage(i).toStructuredText().asJSON()).blocks.map((b) => b.lines.map((ln) => ln.text).join(" ")).join(" ") + " ";
  return text;
};

await cleanupDb();
const seed = (await api("/api/e2e/stage", { stage: "quote" })).json;
const jobId = seed.jobId;
const quotationId = (await sql("select id from public.quotations where job_id = $1 order by created_at desc limit 1", [jobId]))[0]?.id;
await sql("update public.part_items set cost_aed = coalesce(cost_aed, 150), availability = 'in_stock', supplier = coalesce(supplier, 'Our Stock') where job_id = $1 and is_active", [jobId]);
await sql("update public.part_requests set status = 'unavailable', closed_reason = 'E2e: not in this test' where job_id = $1 and is_active and id not in (select part_request_id from public.part_items where job_id = $1 and part_request_id is not null)", [jobId]);
const owner = await cookieHeader("owner");
// One priced line with a trailing dash and a 22% line discount, one complimentary, one free recovery.
const l1 = (await api("/api/quote/save", { quotationId, addLine: { title: "E2E PPF - EXTERIOR -", line_type: "package", unit_price: 22000 } }, owner)).json;
const d = (await api("/api/quote/save", { quotationId, patchLine: { id: l1.id, discount_percent: 22 } }, owner)).json;
check("owner sets a 22% line discount", !d?.error, JSON.stringify(d).slice(0, 120));
await api("/api/quote/save", { quotationId, addLine: { title: "E2E PPF INTERIOR", line_type: "package", unit_price: 0, unit_cost: 80, price_display: "complimentary" } }, owner);
const rec = (await api("/api/quote/save", { quotationId, addLine: { line_type: "recovery", title: "Recovery", recovery_type: "normal", recovery_trips: 2, unit_cost: 150, unit_price: 0 } }, owner)).json;
await api("/api/quote/save", { quotationId, patchLine: { id: rec.id, recovery_paid_by: "us", recovery_mention_free: true } }, owner);
const line1 = (await sql("select line_total from public.quotation_lines where id = $1", [l1.id]))[0];
check("22,000 − 22% = 17,160", Number(line1?.line_total) === 17160, JSON.stringify(line1));

// The quotation PDF: green line discount + totals story + clean name.
const qpdf = Buffer.from(await (await fetch(`${base}/api/pdf/quotation/${quotationId}`, { headers: { cookie: owner } })).arrayBuffer());
const qtext = await pdfText(qpdf);
check("quote PDF: 'Discount 22%: −AED 4,840.00' under the line", /Discount 22%:\s*−AED 4,840\.00/i.test(qtext), qtext.match(/Discount 22[^A]{0,20}AED [\d,.]+/)?.[0] ?? qtext.slice(0, 160));
check("quote PDF: 'Labour and services (before discount)'", /before\s+discount/i.test(qtext));
check("quote PDF: the name loses the trailing dash", /E2E PPF - EXTERIOR(?!\s*-)/i.test(qtext.replace(/\s+/g, " ")));

// Complete, send, approve: the job is approved with the discounted labour.
const { browser, page } = await browserFor("owner", { viewport: { width: 1440, height: 1200 } });
await page.goto(`${base}/jobs/${jobId}/quote/${quotationId}`, { waitUntil: "load" });
await page.waitForTimeout(1500);
await page.getByRole("button", { name: /complete$/ }).click();
for (let i = 0; i < 20; i++) {
  await sleep(900);
  if (await page.locator("[data-low-profit-ask]").count()) { await page.locator("[data-low-profit-send]").click(); continue; }
  if (await page.locator("[data-markup-ask]").count()) { await page.locator("[data-markup-continue]").click(); continue; }
  if (await page.locator("[data-parts-ask]").count()) { await page.locator("[data-parts-add]").click(); continue; }
  if (await page.locator("[data-deposit-ask]").count()) { await page.locator("[data-deposit-skip]").click(); continue; }
  if ((await sql("select completed_at from public.quotations where id = $1", [quotationId]))[0]?.completed_at) break;
}
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1200);
const sendBtn = page.getByRole("button", { name: /^Send (the )?quotation|^Send$/ }).first();
await sendBtn.click();
await page.locator("[role='dialog']").getByRole("button", { name: /^AED |Copy/ }).first().waitFor({ timeout: 20000 }).catch(() => null);
const round = page.locator("[role='dialog']").getByRole("button", { name: /^AED .*down/ }).first();
if (await round.count()) await round.click();
const copy = page.locator("[role='dialog']").getByRole("button", { name: /^Copy/ }).first();
if (await copy.count()) { await copy.click(); await sleep(2000); }
const q = await until(async () => { const r = (await sql("select status, token from public.quotations where id = $1", [quotationId]))[0]; return ["sent", "opened"].includes(r?.status) ? r : null; });
check("sent", !!q, JSON.stringify(q));
await fetch(`${base}/api/quote/${q.token}`, { method: "POST", body: new URLSearchParams({ action: "approve", approver_name: "E2e Customer", agree: "on" }), redirect: "manual" });

// To Ready through the wash: the proforma prepares itself from the approved lines.
await sql("update public.jobs set status = 'pending_wash', stage_entered_at = now() where id = $1", [jobId]);
await page.goto(`${base}/jobs/${jobId}`, { waitUntil: "load" });
await page.waitForTimeout(1500);
await page.getByRole("button", { name: "Send to wash" }).click();
await sleep(700);
const free = page.getByRole("button", { name: /free|Yes/i }).first();
if (await free.count()) await free.click();
await sleep(1500);
await page.getByRole("button", { name: "Wash done" }).click();
await sleep(2500);
await browser.close();
const pro = await until(async () => (await sql("select token, number from public.invoices where job_id = $1 and kind = 'proforma' and is_active order by created_at desc limit 1", [jobId]))[0], 30, 600);
check("proforma prepared", !!pro?.token, JSON.stringify(pro));

// The proforma PDF: the same green story through the same template.
const ppdfRes = await fetch(`${base}/api/pdf/invoice/${pro.token}`);
check("proforma PDF answers", ppdfRes.status === 200, String(ppdfRes.status));
const pbuf = Buffer.from(await ppdfRes.arrayBuffer());
writeFileSync(`${shots}/e2e-proforma.pdf`, pbuf);
const ptext = await pdfText(pbuf);
check("proforma: green 'Discount 22%: −AED 4,840.00' under the line", /Discount 22%:\s*−AED 4,840\.00/i.test(ptext), ptext.match(/Discount 22[^A]{0,22}AED [\d,.]+/)?.[0] ?? ptext.slice(0, 200));
check("proforma: '(before discount)' + green Discount row", /before\s+discount/i.test(ptext) && /Discount\s/.test(ptext));
check("proforma: Complimentary word carried", /Complimentary/i.test(ptext));
check("proforma: clean name (no trailing dash)", !/E2E PPF - EXTERIOR\s+-/.test(ptext.replace(/\s+/g, " ")));
const mupdf = await import("mupdf");
const pdoc = mupdf.Document.openDocument(pbuf, "application/pdf");
for (let i = 0; i < pdoc.countPages(); i++) writeFileSync(`${shots}/proforma-discount-${i + 1}.png`, Buffer.from(pdoc.loadPage(i).toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB).asPNG()));

await cleanupDb();
process.exit(summary() ? 1 : 0);
