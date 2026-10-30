// Evening section 13 proof: document clean-up.
// 1. The totals box: "Labour and services discount (10%)" wraps and never runs over its amount (checked on the PDF by
//    the text positions), discounts bold green. 2. A line named just "PART" (or blank) is flagged in Before sending
//    and refused on completion. 3. "Internal cost only – hide from customer" on any line: counts in the cost, never on
//    a customer document.
// Run: node --env-file=.env.test.local tests/browser/test-doc13.mjs   (dev server on :3100)
import path from "node:path";
import fs from "node:fs";
import { api, base, browserFor, cleanupDb, cookieHeader, go, here, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shot = (name) => path.join(here, "shots", name);
const until = async (fn, tries = 30, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const pdfOf = async (url, cookie) => {
  const r = await fetch(`${base}${url}`, cookie ? { headers: { cookie } } : undefined);
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(Buffer.from(await r.arrayBuffer()), "application/pdf");
  let text = "";
  const lines = [];
  for (let i = 0; i < doc.countPages(); i++) {
    const st = doc.loadPage(i).toStructuredText("preserve-whitespace");
    text += st.asText();
    for (const b of JSON.parse(st.asJSON()).blocks ?? []) for (const l of b.lines ?? []) lines.push({ page: i, text: l.text, x: l.bbox.x, y: l.bbox.y, w: l.bbox.w, h: l.bbox.h });
  }
  return { status: r.status, text: text.replace(/\s+/g, " "), lines, doc, mupdf };
};

cleanupDb();
const seed = await api("/api/e2e/stage", { stage: "quote" });
const jobId = seed.json?.jobId;
const qid = seed.json?.quotationId;
if (!jobId || !qid) { console.error("seed failed"); process.exit(1); }
const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active limit 1"))[0].id;
// Two services and a labour line; 10% off labour and services.
const svc1 = (await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, unit_price, created_by, updated_by) values ($1, 1, 'package', 'Wheel alignment', 'manual', 1, 400, $2, $2) returning id", [qid, owner]))[0].id;
const film = (await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, unit_price, unit_cost, created_by, updated_by) values ($1, 2, 'package', 'E2e film roll used', 'manual', 1, 0, 350, $2, $2) returning id", [qid, owner]))[0].id;
await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, hours, labour_rate, created_by, updated_by) values ($1, 3, 'labour', 'Replace front brake pads', 'manual', 1, 2, 350, $2, $2)", [qid, owner]);
await sql("update public.quotations set discount_kind = 'percent', discount_value = 10, discount_scope = 'labour_services' where id = $1", [qid]);

/* ---------------- 3. Internal cost only: from the line's menu, and "+ Internal cost" ---------------- */
const { browser, page } = await browserFor("service_advisor", { viewport: { width: 1440, height: 1100 } });
await go(page, `${base}/jobs/${jobId}/quote/${qid}`);
await page.locator(`#item-line-${film} [data-line-menu] button[aria-label="More for this line"]`).click();
await page.getByRole("button", { name: "Internal cost only – hide from customer" }).click();
check("3: the line's menu offers 'Internal cost only – hide from customer' and it saves", !!(await until(async () => ((await sql("select visible_to_customer from public.quotation_lines where id = $1", [film]))[0]?.visible_to_customer === false ? 1 : null))));
check("3: the line says Internal instead of a price", (await page.locator(`[data-internal-line="${film}"]`).count()) === 1 && (await page.locator(`#item-line-${film} [data-internal-badge]`).count()) === 1);
await page.locator("[data-add-internal]").click();
check("3: '+ Internal cost' adds a hidden Other line", !!(await until(async () => ((await sql("select count(*)::int as n from public.quotation_lines where quotation_id = $1 and line_type = 'other' and visible_to_customer = false and is_active", [qid]))[0]?.n === 1 ? 1 : null))));
await go(page, `${base}/jobs/${jobId}/quote/${qid}`);
const ownCost = (await page.locator("[data-own-service-cost]").textContent().catch(() => "")) ?? "";
check("3: its cost still counts in the internal breakdown (our services' cost AED 350)", /350/.test(ownCost), ownCost);
await page.locator(`#item-line-${film}`).scrollIntoViewIfNeeded();
await page.screenshot({ path: shot("doc13-1-internal-line.png"), clip: (await page.locator(`#item-line-${film}`).boundingBox()) ?? undefined });

/* ---------------- 2. A line named just "PART" is flagged ---------------- */
await sql("update public.quotation_lines set title = 'PART' where id = $1", [svc1]);
await go(page, `${base}/jobs/${jobId}/quote/${qid}`);
const before = (await page.locator("#item-parts").textContent().catch(() => "")) ?? "";
check('2: Before sending flags a line named just "PART"', /A line is named just "PART": write what it is/.test(before), before.slice(0, 300));
await page.locator("#item-parts").scrollIntoViewIfNeeded();
await page.screenshot({ path: shot("doc13-2-part-flag.png"), clip: (await page.locator("#item-parts").boundingBox()) ?? undefined });
const pdfPart = await pdfOf(`/api/pdf/quotation/${qid}`, await cookieHeader("owner"));
void pdfPart;
await sql("update public.quotation_lines set title = '' where id = $1", [svc1]);
await go(page, `${base}/jobs/${jobId}/quote/${qid}`);
check("2: and a line with no name", /A line has no name: write what it is/.test((await page.locator("#item-parts").textContent().catch(() => "")) ?? ""));
await sql("update public.quotation_lines set title = 'Wheel alignment' where id = $1", [svc1]);

/* ---------------- 1. The totals box on the PDF: the long label wraps, the amount keeps its space ---------------- */
const pdf = await pdfOf(`/api/pdf/quotation/${qid}`, await cookieHeader("owner"));
const labelLines = pdf.lines.filter((l) => /Labour and services|discount \(10%\)/i.test(l.text) && !/subtotal|before discount/i.test(l.text) && l.x > 300);
const amountLine = pdf.lines.find((l) => /^\s*[−-]\s*(AED\s*)?[\d,]+\.\d\d\s*$/.test(l.text) && l.x > 400);
const overlap = labelLines.some((a) => amountLine && a.page === amountLine.page && a.x + a.w > amountLine.x + 0.5 && Math.abs(a.y - amountLine.y) < Math.max(a.h, amountLine.h));
check("1: the totals box shows 'Labour and services discount (10%)'", /Labour and services discount \(10%\)/i.test(pdf.text), pdf.text.match(/discount.{0,60}/i)?.[0] ?? "");
check("1: the long label never runs over its amount (text positions on the PDF)", labelLines.length >= 1 && !!amountLine && !overlap, JSON.stringify({ labelLines, amountLine }));
check("3: the internal line never appears on the customer's PDF", !/E2e film roll used/i.test(pdf.text));
const pix = pdf.doc.loadPage(0).toPixmap(pdf.mupdf.Matrix.scale(1.6, 1.6), pdf.mupdf.ColorSpace.DeviceRGB, false, true);
fs.writeFileSync(shot("doc13-3-quote-pdf.png"), Buffer.from(pix.asPNG()));
await sql("update public.quotations set status = 'sent', sent_at = now(), token = coalesce(token, 'e2e-doc13-token-0001'), valid_until = now() + interval '7 days' where id = $1", [qid]);
const token = (await sql("select token from public.quotations where id = $1", [qid]))[0].token;
const link = await (await fetch(`${base}/quote/${token}`)).text();
check("3: nor on the customer's link page", !/E2e film roll used/i.test(link));

await browser.close();
cleanupDb();
process.exit(summary() ? 1 : 0);
