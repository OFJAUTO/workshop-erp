// Fixed-price service lines (20 October 2026, part 2 section 7): every labour or service line can be
// switched between Labour (hours × rate) and Fixed price (qty × price) from its three-dot menu, the
// figure carried across; a fixed line shows no hours boxes and counts nothing in labour hours; a
// service set as fixed in Settings lands fixed even when the price is typed each time; and the
// customer's PDF shows a fixed line with no "x.x h" anywhere.
//   node --env-file=.env.local tests/browser/test-fixed.mjs
import { api, base, browserFor, cleanupDb, cookieHeader, makeChecks, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shots = "C:/Users/user/Desktop/workshop ERP/tests/browser/shots";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, tries = 40, ms = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } return null; };

await cleanupDb();
const seed = (await api("/api/e2e/stage", { stage: "quote" })).json;
const { jobId, quotationId } = seed;
const labour = (await sql("select id, hours::numeric as h, labour_rate::numeric as r, line_total::numeric as t from public.quotation_lines where quotation_id = $1 and line_type = 'labour'", [quotationId]))[0];
check("seed has the labour line", !!labour, JSON.stringify(labour));

const ed = await browserFor("service_advisor", { viewport: { width: 1500, height: 1200 } });
const page = ed.page;
await page.goto(`${base}/jobs/${jobId}/quote/${quotationId}`, { waitUntil: "load" });
await page.waitForTimeout(1800);
check("the labour line shows its hours boxes", (await page.locator(`#item-line-${labour.id} [data-labour-boxes]`).count()) === 1);

// Three-dot menu: Make it Fixed price. The figure stays, the hours boxes go.
await page.locator(`#item-line-${labour.id} button[aria-label="More for this line"]`).click();
await page.waitForTimeout(400);
await page.getByRole("button", { name: "Make it Fixed price (qty × price)" }).click();
const switched = await until(async () => { const r = (await sql("select line_type as lt, unit_price::numeric as p, hours from public.quotation_lines where id = $1", [labour.id]))[0]; return r?.lt === "package" ? r : null; }, 30, 500);
check("switched to Fixed price with the figure carried", !!switched && Math.abs(Number(switched.p) - Number(labour.t)) < 0.01 && switched.hours === null, JSON.stringify(switched));
await page.waitForTimeout(600);
check("no hours boxes on a fixed line", (await page.locator(`#item-line-${labour.id} [data-labour-boxes]`).count()) === 0);
await page.screenshot({ path: `${shots}/fixed-line.png` });

// The customer's PDF shows it with no "x.x h" anywhere (this quote now has no labour lines at all).
await sql("update public.quotations set completed_at = now() where id = $1", [quotationId]);
const token = (await sql("select token from public.quotations where id = $1", [quotationId]))[0]?.token;
const jar = await cookieHeader("service_advisor");
const pdf = await fetch(`${base}/api/pdf/quote/${token}`, { headers: { cookie: jar } });
check("the quote PDF renders", pdf.status === 200, String(pdf.status));
const pdfText = await (async () => { const mupdf = await import("mupdf"); const doc = mupdf.Document.openDocument(Buffer.from(await pdf.arrayBuffer()), "application/pdf"); let s = ""; for (let i = 0; i < doc.countPages(); i++) s += doc.loadPage(i).toStructuredText("preserve-whitespace").asText(); return s; })();
check("the fixed line is on the PDF", /REPLACE FRONT BRAKE PADS/i.test(pdfText));
check("no hours text anywhere on the customer PDF", !/\d\.\d h\b/.test(pdfText), (pdfText.match(/\d\.\d h\b/) ?? []).join(","));

// And back: Make it Labour puts the hours in at the rate, same figure.
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1500);
await page.locator(`#item-line-${labour.id} button[aria-label="More for this line"]`).click();
await page.waitForTimeout(400);
check("the menu offers Make it Labour on a fixed line", (await page.getByRole("button", { name: "Make it Labour (hours × rate)" }).count()) === 1);
await page.waitForTimeout(400);
await page.getByRole("button", { name: "Make it Labour (hours × rate)" }).click();
const back = await until(async () => { const r = (await sql("select line_type as lt, hours::numeric as h, labour_rate::numeric as r, line_total::numeric as t from public.quotation_lines where id = $1", [labour.id]))[0]; return r?.lt === "labour" ? r : null; }, 30, 500);
check("switched back to Labour with the hours from the rate", !!back && Number(back.h) > 0 && Math.abs(Number(back.t) - Number(labour.t)) < 2, JSON.stringify(back));

// A service marked fixed in Settings (price typed each time) lands as a FIXED line, never hours x rate.
const cat = (await sql("select id from public.service_categories where is_active limit 1"))[0];
const svc = (await sql(`insert into public.services (category_id, name, department, price_aed, default_hours, line_kind, price_per, position)
  values ($1, 'E2E Refrigerant Recovery', 'both', null, null, 'service', 'job', 9999) returning id`, [cat.id]))[0];
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1500);
await page.evaluate(() => window.scrollTo(0, 0));
// Add it through the save route the picker uses (the same op shape).
const res = await api("/api/e2e/sql", { sql: "select 1", params: [] });
void res;
const add = await fetch(`${base}/api/quote/save`, { method: "POST", headers: { "Content-Type": "application/json", cookie: jar }, body: JSON.stringify({ quotationId, opId: `e2e-fixed-${Date.now()}`, addLine: { service_id: svc.id } }) });
check("the service line saves", add.status === 200, String(add.status));
const line = await until(async () => (await sql("select line_type as lt, title from public.quotation_lines where quotation_id = $1 and service_id = $2", [quotationId, svc.id]))[0] ?? null, 20, 400);
check("a fixed-in-Settings service lands as Fixed price (the R1234 case)", line?.lt === "package", JSON.stringify(line));
await sql("delete from public.services where id = $1", [svc.id]).catch(() => null);
await sql("update public.services set is_active = false where id = $1", [svc.id]);

await ed.browser.close();
await cleanupDb();
process.exit(summary() ? 1 : 0);
