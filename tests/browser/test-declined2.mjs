// Batch 29 Oct (2), section 2: time spent on a car + "Customer declined all work".
//  A  J-00655 (read only): the owner's job card shows the TIME SPENT panel (the inspection by its technician, clocked
//     totals with cost and worth, the days in the workshop).
//  B  a test car (approved report with a Bad and an Average finding, a draft quotation, AED 750 agreed at gate-in):
//     an advisor cannot charge a different amount without a reason; the owner charges the AED 750 → a tax invoice with
//     ONE line "INSPECTION CHARGES" + VAT, no typed cost, the declined-work note for the customer (web page and PDF);
//     the quotation is declined with every line kept; the findings are saved as DECLINED WORK with their status; the
//     car is Ready to collect; the Declined cars report books the clocked time as the cost.
//  C  the advisor's follow-up on Waiting on you ("Call … about the declined work on …"), and "Called ✓" closes it.
//   E2E_BASE=http://localhost:3101 node --env-file=.env.local tests/browser/test-declined2.mjs
import path from "node:path";
import fs from "node:fs";
import * as mupdf from "mupdf";
import { api, base, browserFor, browserForId, cleanupDb, go, here, makeChecks, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const SHOTS = path.join(here, "shots", "declined2");
fs.mkdirSync(SHOTS, { recursive: true });
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 14 * 60 * 1000).unref();
const until = async (fn, tries = 60, gap = 250) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, gap)); } return null; };
const month = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 7);

try {
  /* ---------------- A ---------------- */
  const real = (await sql("select j.id from public.jobs j where j.job_number = 'J-00655'"))[0] ?? null;
  if (real) {
    const { browser, page } = await browserFor("owner", { viewport: { width: 1440, height: 900 } });
    await go(page, `${base}/jobs/${real.id}`);
    const panel = page.locator("[data-time-spent]");
    const text = (await panel.textContent().catch(() => "")) ?? "";
    check("A J-00655: the owner sees TIME SPENT ON THIS CAR with the inspection, the clocked total, cost, worth and days in the workshop", /Time spent on this car/i.test(text) && /Inspection/.test(text) && /Total clocked/.test(text) && /cost AED/.test(text) && /worth AED/.test(text) && /Car in the workshop/.test(text), text.slice(0, 200));
    await panel.screenshot({ path: path.join(SHOTS, "A-J-00655-time-spent.png") }).catch(() => null);
    await browser.close();
  } else check("A J-00655 exists", false);

  /* ---------------- B ---------------- */
  const seed = (await api("/api/e2e/stage", { stage: "quote" })).json;
  const jobId = seed.jobId;
  const advisor = (await sql("select id from public.staff where role_id = 'service_advisor' and is_active order by created_at limit 1"))[0].id;
  await sql("update public.inspections set started_at = now() - interval '3 hours', submitted_at = now() - interval '90 minutes', elapsed_minutes = 90 where job_id = $1", [jobId]);
  await sql("update public.jobs set inspection_fee_aed = 750, advisor_id = $2 where id = $1", [jobId, advisor]);
  const linesBefore = Number((await sql("select count(*)::int as n from public.quotation_lines where quotation_id = $1 and is_active", [seed.quotationId]))[0].n);

  {
    const { browser, page } = await browserFor("service_advisor", { viewport: { width: 800, height: 1280 }, touch: true });
    await go(page, `${base}/jobs/${jobId}`);
    await page.locator("[data-declined-all]").first().click();
    await page.locator("[data-declined-dialog]").waitFor({ timeout: 8000 });
    check("B the window asks to charge the fee agreed at gate-in", /Charge the inspection fee of AED 750 agreed at gate-in\?/.test((await page.locator("[data-declined-question]").textContent()) ?? ""));
    await page.locator("[data-declined-change]").click();
    await page.locator("[data-declined-amount]").fill("500");
    await page.locator("[data-declined-confirm]").click();
    await page.locator("[data-declined-error]").waitFor({ timeout: 15000 });
    check("B an advisor cannot charge a different amount without a reason", /give the reason/i.test((await page.locator("[data-declined-error]").textContent()) ?? ""));
    await page.screenshot({ path: path.join(SHOTS, "B-advisor-other-amount-refused-800x1280.png") });
    const job = (await sql("select declined_out_at from public.jobs where id = $1", [jobId]))[0];
    check("B …and nothing was recorded", !job.declined_out_at);
    await browser.close();
  }
  const { browser: ob, page: op } = await browserFor("owner", { viewport: { width: 1440, height: 900 } });
  await go(op, `${base}/jobs/${jobId}`);
  const timeText = (await op.locator("[data-time-spent]").textContent().catch(() => "")) ?? "";
  check("B the test car's time panel shows the inspection: 1 h 30 min", /Inspection[^]*1 h 30 min/.test(timeText), timeText.slice(0, 160));
  const costMatch = timeText.match(/cost AED ([\d,]+\.\d\d)/);
  const clockedCost = costMatch ? Number(costMatch[1].replace(/,/g, "")) : NaN;
  await op.locator("[data-declined-all]").first().click();
  await op.locator("[data-declined-charge]").click();
  await op.locator("[data-declined-result]").waitFor({ timeout: 30000 });
  const resultText = (await op.locator("[data-declined-result]").textContent()) ?? "";
  check("B the owner charges AED 750: the answer shows in the window (invoice made, car Ready to collect)", /INV-\d+ made for the inspection \(AED 787\.50 with VAT\)/.test(resultText) && /Ready to collect/.test(resultText), resultText);
  await op.screenshot({ path: path.join(SHOTS, "B-owner-charged-1440x900.png") });

  const inv = (await sql("select id, number, token, notes, total_aed, vat_aed, taxable_aed from public.invoices where job_id = $1 and kind = 'tax_invoice' and is_active order by created_at desc limit 1", [jobId]))[0];
  const lines = await sql("select description, amount_aed, vat_aed, total_aed, coalesce(cost_aed, 0) as cost from public.invoice_lines where invoice_id = $1 and is_active", [inv?.id]);
  check("B the invoice has ONE line INSPECTION CHARGES, AED 750 + VAT 37.50, no typed cost", lines.length === 1 && lines[0].description === "INSPECTION CHARGES" && Number(lines[0].amount_aed) === 750 && Number(lines[0].vat_aed) === 37.5 && Number(lines[0].cost) === 0, JSON.stringify(lines));
  check("B the invoice note lists the declined work by name and status", /^Recommended work declined by the customer:/.test(inv?.notes ?? "") && /– (Replace|Replace now|Advisory)/.test(inv?.notes ?? ""), inv?.notes);
  const q = (await sql("select status from public.quotations where id = $1", [seed.quotationId]))[0];
  const linesAfter = Number((await sql("select count(*)::int as n from public.quotation_lines where quotation_id = $1 and is_active", [seed.quotationId]))[0].n);
  check("B the quotation is marked declined and keeps every line", q.status === "declined" && linesAfter === linesBefore, `${q.status} · ${linesBefore} → ${linesAfter}`);
  const dw = await sql("select title, severity, follow_up_due_at::text as due from public.declined_work where job_id = $1 and is_active order by created_at", [jobId]);
  check("B the declined work is saved on the car with its status and a follow-up date", dw.length >= 2 && dw.some((d) => d.severity === "Replace") && dw.some((d) => d.severity === "Advisory") && dw.every((d) => !!d.due), JSON.stringify(dw).slice(0, 220));
  const jobAfter = (await sql("select status, declined_out_at from public.jobs where id = $1", [jobId]))[0];
  check("B the car is Ready to collect", jobAfter.status === "ready" && !!jobAfter.declined_out_at);

  // The customer's copy: the web page and the PDF carry the note.
  const cp = await (await fetch(`${base}/invoice/${inv.token}`)).text();
  check("B the customer's invoice page shows the declined-work note", /Recommended work declined by the customer/.test(cp));
  const pdf = Buffer.from(await (await fetch(`${base}/api/pdf/invoice/${inv.token}`)).arrayBuffer());
  const doc = mupdf.Document.openDocument(pdf, "application/pdf");
  let pdfText = "";
  for (let i = 0; i < doc.countPages(); i++) pdfText += doc.loadPage(i).toStructuredText().asText();
  check("B the invoice PDF shows INSPECTION CHARGES and the declined-work note", /INSPECTION CHARGES/i.test(pdfText) && /Recommended work declined by the customer/i.test(pdfText));
  fs.writeFileSync(path.join(SHOTS, "B-invoice.pdf"), pdf);

  // Profit and the report: the cost is the clocked time, booked as labour.
  await go(op, `${base}/reports/declined?month=${month}`);
  const row = op.locator("[data-declined-cars] tr", { hasText: (await sql("select job_number from public.jobs where id = $1", [jobId]))[0].job_number }).first();
  const rowText = (await row.textContent().catch(() => "")) ?? "";
  const costs = [...rowText.matchAll(/AED ([\d,]+\.\d\d)/g)].map((m) => Number(m[1].replace(/,/g, "")));
  check("B the Declined cars report: cost = the clocked time's cost, fee AED 750, net = fee − cost", costs.length >= 3 && costs[0] === clockedCost && costs[1] === 750 && Math.abs(costs[2] - (750 - clockedCost)) < 0.01, `${rowText} · clocked cost ${clockedCost}`);
  await op.screenshot({ path: path.join(SHOTS, "B-declined-cars-report-1440x900.png"), fullPage: true });
  await ob.close();

  /* ---------------- C ---------------- */
  await sql("update public.declined_work set follow_up_due_at = now() - interval '1 hour' where job_id = $1", [jobId]);
  const { browser: ab, page: ap } = await browserForId(advisor, { viewport: { width: 1440, height: 900 } });
  await go(ap, `${base}/dashboard`);
  await ap.evaluate(() => document.querySelectorAll("[data-waiting-panel] details").forEach((d) => { d.open = true; }));
  const callRow = ap.locator("[data-waiting-row]", { hasText: "about the declined work on" }).first();
  check("C the advisor's Waiting on you: \"Call Stage Test Customer about the declined work on …\"", /Call Stage Test Customer about the declined work on/i.test((await callRow.textContent().catch(() => "")) ?? ""));
  await callRow.screenshot({ path: path.join(SHOTS, "C-follow-up-row.png") }).catch(() => null);
  await callRow.locator("[data-declined-called]").click();
  check("C \"Called ✓\" closes the follow-up", !!(await until(async () => Number((await sql("select count(*)::int as n from public.declined_work where job_id = $1 and followed_up_at is null", [jobId]))[0].n) === 0)));
  await ab.close();
} catch (e) {
  check("walked without a crash", false, (e?.message ?? String(e)).slice(0, 300));
} finally {
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
