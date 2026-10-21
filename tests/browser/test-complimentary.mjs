// Complimentary / Included lines (21 October 2026, section 1): a price of 0 asks "Mark as Complimentary?",
// the line turns valid (no red, no "enter the price" blocker), the word prints on the PDF instead of a
// price, the internal cost still counts, and a free recovery reads "Complimentary pick-up & drop-off".
//   node --env-file=.env.local tests/browser/test-complimentary.mjs
import { api, base, browserFor, cleanupDb, cookieHeader, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shots = "C:/Users/user/Desktop/workshop ERP/tests/browser/shots";
const until = async (fn, tries = 30, ms = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } return null; };

await cleanupDb();
const seed = (await api("/api/e2e/stage", { stage: "quote" })).json;
const jobId = seed.jobId;
const quotationId = (await sql("select id from public.quotations where job_id = $1 order by created_at desc limit 1", [jobId]))[0]?.id;
// The seed's open part requests are not this test's subject: price the items, close the stray requests.
await sql("update public.part_items set cost_aed = coalesce(cost_aed, 150), availability = 'in_stock', supplier = coalesce(supplier, 'Our Stock') where job_id = $1 and is_active", [jobId]);
await sql("update public.part_requests set status = 'unavailable', closed_reason = 'E2e: not in this test' where job_id = $1 and is_active and id not in (select part_request_id from public.part_items where job_id = $1 and part_request_id is not null)", [jobId]);
const advisorId = (await sql("select gated_in_by from public.jobs where id = $1", [jobId]))[0]?.gated_in_by;
const cookie = await cookieHeader(advisorId);
// Two fixed-price lines to play with, and one recovery line.
const svc = (await sql("select id from public.services where is_active and price_aed is not null and line_kind is distinct from 'labour' order by position limit 1"))[0];
const l1 = (await api("/api/quote/save", { quotationId, addLine: { title: "E2E PPF Exterior", line_type: "package", unit_price: 12000 } }, cookie)).json;
const l2 = (await api("/api/quote/save", { quotationId, addLine: { title: "E2E PPF Interior", line_type: "package", unit_price: 1, unit_cost: 80 } }, cookie)).json;
void svc;

const adv = await browserFor("service_advisor", { viewport: { width: 1500, height: 1300 } });
const page = adv.page;
await page.goto(`${base}/jobs/${jobId}/quote/${quotationId}`, { waitUntil: "load" });
await page.waitForTimeout(1800);

// 1. Typing 0 asks; Yes makes a valid Complimentary line.
const amount2 = page.locator(`#amount-${l2.id}`);
await amount2.click({ clickCount: 3 });
await amount2.pressSequentially("0", { delay: 30 });
await page.keyboard.press("Tab");
await page.waitForTimeout(600);
check("typing 0 asks 'Mark as Complimentary?'", (await page.locator("[data-complimentary-ask]").count()) === 1);
await page.locator("[data-comp-yes]").click();
await page.waitForTimeout(1500);
check("the line shows the green word", (await page.locator(`[data-complimentary="complimentary"]`).count()) >= 1);
check("the price box is not red", !/border-red-bar/.test((await amount2.getAttribute("class")) ?? ""));
const row2 = await until(async () => { const r = (await sql("select price_display, line_total, unit_cost from public.quotation_lines where id = $1", [l2.id]))[0]; return r?.price_display === "complimentary" ? r : null; });
check("saved: complimentary, sells for 0, cost kept", !!row2 && Number(row2.line_total) === 0 && Number(row2.unit_cost) === 80, JSON.stringify(row2));

// 2. The ... menu marks another line "Included in package".
await page.locator(`#item-line-${l1.id} [data-line-menu] > button`).first().click();
await page.waitForTimeout(400);
await page.getByRole("button", { name: "Included in package" }).first().click();
await page.waitForTimeout(1500);
const row1 = await until(async () => { const r = (await sql("select price_display, line_total from public.quotation_lines where id = $1", [l1.id]))[0]; return r?.price_display === "included" ? r : null; });
check("menu: Included in package saves and sells for 0", !!row1 && Number(row1.line_total) === 0, JSON.stringify(row1));

// 3. No "enter the price" blocker; the estimate completes.
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1500);
const body = ((await page.locator("main").innerText().catch(() => "")) ?? "").replace(/\s+/g, " ");
check("'Before sending' no longer flags the free lines", !/enter the price/i.test(body), body.match(/BEFORE SENDING.{0,140}/)?.[0] ?? "");
await page.screenshot({ path: `${shots}/complimentary-editor.png`, fullPage: true });

// 4. Free recovery reads as a gift.
const rec = (await api("/api/quote/save", { quotationId, addLine: { line_type: "recovery", title: "Recovery", recovery_type: "normal", recovery_trips: 2, unit_cost: 150, unit_price: 0 } }, cookie)).json;
const freed = (await api("/api/quote/save", { quotationId, patchLine: { id: rec.id, recovery_paid_by: "us", recovery_mention_free: true } }, cookie)).json;
check("free recovery saves", freed?.ok === true || !freed?.error, JSON.stringify(freed).slice(0, 120));
const recRow = await until(async () => { const r = (await sql("select title, price_display, unit_cost from public.quotation_lines where id = $1", [rec.id]))[0]; return r?.price_display === "complimentary" ? r : null; });
check("it reads 'Complimentary pick-up & drop-off', cost kept", /complimentary pick-up & drop-off/i.test(recRow?.title ?? "") && Number(recRow?.unit_cost) === 150, JSON.stringify(recRow));

// 5. The PDF prints the words, never "free of charge", and still prices the priced line.
const pdfRes = await fetch(`${base}/api/pdf/quotation/${quotationId}`, { headers: { cookie } });
check("the staff PDF answers", pdfRes.status === 200, String(pdfRes.status));
const buf = Buffer.from(await pdfRes.arrayBuffer());
const { writeFileSync } = await import("node:fs");
writeFileSync(`${shots}/e2e-comp.pdf`, buf);
const mupdf = await import("mupdf");
const doc = mupdf.Document.openDocument(buf, "application/pdf");
let text = "";
for (let i = 0; i < doc.countPages(); i++) text += JSON.parse(doc.loadPage(i).toStructuredText().asJSON()).blocks.map((b) => b.lines.map((ln) => ln.text).join(" ")).join(" ") + " ";
check("PDF: 'Complimentary' and 'Included' printed", /Complimentary/i.test(text) && /Included/i.test(text), text.slice(0, 200));
check("PDF: no 'free of charge' wording", !/free of charge/i.test(text));
check("PDF: complimentary pick-up & drop-off", /Complimentary pick-up & drop-off/i.test(text));

await adv.browser.close();
await cleanupDb();
process.exit(summary() ? 1 : 0);
