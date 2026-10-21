// Section 11 proof: quotation lines reorder by the ↑↓, the menu (Move up / down / to top) and the ⋮⋮
// drag handle; the numbering and every customer document follow the same order; an approved quotation
// refuses a reorder; the typed name boxes and the customer-note box carry the browser's spell check.
// Run: node --env-file=.env.local tests/browser/test-reorder.mjs   (dev server on :3100)
import path from "node:path";
import { api, base, browserFor, cleanupDb, cookieHeader, go, here, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shot = (name) => path.join(here, "shots", name);
const until = async (fn, tries = 40, gap = 400) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const pdfText = async (buf) => {
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  let out = "";
  for (let i = 0; i < doc.countPages(); i++) out += doc.loadPage(i).toStructuredText("preserve-whitespace").asText();
  return out.replace(/\s+/g, " ").toUpperCase();
};

cleanupDb();
const seed = await api("/api/e2e/stage", { stage: "quote" });
const jobId = seed.json?.jobId;
const qid = seed.json?.quotationId;
if (!jobId || !qid) { console.error("seed failed:", JSON.stringify(seed).slice(0, 300)); process.exit(1); }
const advisor = (await sql("select id from public.staff where role_id = 'service_advisor' and is_active limit 1"))[0].id;
// The tidy trigger sentence-cases titles, so every comparison here ignores case.
for (const [pos, t] of [[2, "Flush brake fluid"], [3, "Wheel alignment"]]) {
  await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, hours, labour_rate, created_by, updated_by) select $1, $2, 'labour', $3, 'manual', 1, 1, 300, $4, $4 where not exists (select 1 from public.quotation_lines where quotation_id = $1 and lower(title) = lower($3))", [qid, pos, t, advisor]);
}
const idOf = async (title) => (await sql("select id from public.quotation_lines where quotation_id = $1 and lower(title) = lower($2)", [qid, title]))[0].id;
const PADS = await idOf("Replace front brake pads");
const FLUID = await idOf("Flush brake fluid");
const ALIGN = await idOf("Wheel alignment");
const dbOrder = async () => (await sql("select title from public.quotation_lines where quotation_id = $1 and line_type = 'labour' and is_active order by position", [qid])).map((r) => r.title.toUpperCase());

const { browser, page } = await browserFor("service_advisor", { viewport: { width: 1440, height: 950 } });
await go(page, `${base}/jobs/${jobId}/quote/${qid}`);
const visual = async () => page.$$eval('[id^="item-line-"] textarea[id^="name-"]', (els) => els.map((e) => e.value.toUpperCase()));

/* ---------------- 1. The controls and the spell check ---------------- */
check("1: every job line carries the ⋮⋮ handle and the ↑↓", (await page.locator("[data-drag-handle]").count()) === 3 && (await page.locator("[data-move-up]").count()) === 3);
const sc = await page.locator('textarea[id^="name-"]').first().evaluate((el) => ({ spell: el.spellcheck, lang: el.lang }));
check("1: the typed name box has spell check on, in English", sc.spell === true && sc.lang === "en", JSON.stringify(sc));
await page.locator(`#item-line-${PADS} [aria-label="More for this line"]`).click();
await sleep(300);
const noteItem = page.getByText("Add a note for the customer", { exact: true });
await noteItem.click();
await sleep(400);
const noteSc = await page.locator(`#item-line-${PADS} textarea`).last().evaluate((el) => ({ spell: el.spellcheck, lang: el.lang }));
check("1: the customer-note box has spell check on too", noteSc.spell === true && noteSc.lang === "en", JSON.stringify(noteSc));
await page.getByText("Done", { exact: true }).first().click();
check("1: the order starts as quoted", JSON.stringify(await visual()) === JSON.stringify(["REPLACE FRONT BRAKE PADS", "FLUSH BRAKE FLUID", "WHEEL ALIGNMENT"]), JSON.stringify(await visual()));

/* ---------------- 2. ↑ moves a line up, at once and in the database ---------------- */
await page.locator(`[data-move-up="${FLUID}"]`).click();
check("2: the ↑ swaps the rows on screen at once", JSON.stringify(await visual()) === JSON.stringify(["FLUSH BRAKE FLUID", "REPLACE FRONT BRAKE PADS", "WHEEL ALIGNMENT"]), JSON.stringify(await visual()));
const after2 = await until(async () => (JSON.stringify(await dbOrder()) === JSON.stringify(["FLUSH BRAKE FLUID", "REPLACE FRONT BRAKE PADS", "WHEEL ALIGNMENT"]) ? 1 : null));
check("2: the database renumbers to match", !!after2, JSON.stringify(await dbOrder()));

/* ---------------- 3. The menu: Move to top ---------------- */
await page.locator(`#item-line-${ALIGN} [aria-label="More for this line"]`).click();
await sleep(300);
await page.getByText("Move to top", { exact: true }).click();
check("3: Move to top puts the line first", JSON.stringify(await visual()) === JSON.stringify(["WHEEL ALIGNMENT", "FLUSH BRAKE FLUID", "REPLACE FRONT BRAKE PADS"]), JSON.stringify(await visual()));
const after3 = await until(async () => (JSON.stringify(await dbOrder()) === JSON.stringify(["WHEEL ALIGNMENT", "FLUSH BRAKE FLUID", "REPLACE FRONT BRAKE PADS"]) ? 1 : null));
check("3: the database follows", !!after3, JSON.stringify(await dbOrder()));
await page.locator(`#item-line-${ALIGN}`).scrollIntoViewIfNeeded();
await page.screenshot({ path: shot("reorder-1-rows.png"), clip: await page.locator(`#item-line-${ALIGN}`).evaluate((el) => { const r = el.closest("[data-quote-block]")?.getBoundingClientRect() ?? el.parentElement.getBoundingClientRect(); return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.min(r.width, 1400), height: Math.min(r.height, 500) }; }) });

/* ---------------- 4. The ⋮⋮ drag handle ---------------- */
const handle = await page.locator(`[data-drag-handle="${PADS}"]`).boundingBox();
const target = await page.locator(`#item-line-${ALIGN}`).boundingBox();
await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
await page.mouse.down();
await page.mouse.move(target.x + target.width / 2, target.y + 10, { steps: 10 });
await sleep(250);
await page.mouse.up();
check("4: dragging the handle moves the line", JSON.stringify(await visual()) === JSON.stringify(["REPLACE FRONT BRAKE PADS", "WHEEL ALIGNMENT", "FLUSH BRAKE FLUID"]), JSON.stringify(await visual()));
const after4 = await until(async () => (JSON.stringify(await dbOrder()) === JSON.stringify(["REPLACE FRONT BRAKE PADS", "WHEEL ALIGNMENT", "FLUSH BRAKE FLUID"]) ? 1 : null));
check("4: the dragged order is saved", !!after4, JSON.stringify(await dbOrder()));

/* ---------------- 5. The customer document follows the same order ---------------- */
const cookie = await cookieHeader("service_advisor");
const pdfRes = await fetch(`${base}/api/pdf/quotation/${qid}`, { headers: { cookie } });
const text = await pdfText(Buffer.from(await pdfRes.arrayBuffer()));
const iPads = text.indexOf("REPLACE FRONT BRAKE PADS");
const iAlign = text.indexOf("WHEEL ALIGNMENT");
const iFluid = text.indexOf("FLUSH BRAKE FLUID");
check("5: the PDF prints the lines in the new order", pdfRes.status === 200 && iPads >= 0 && iPads < iAlign && iAlign < iFluid, `${pdfRes.status} · ${iPads} < ${iAlign} < ${iFluid}`);

/* ---------------- 6. Locked after approval ---------------- */
const approvedRow = await sql("update public.quotations set status = 'approved' where id = $1 returning status", [qid]);
if (approvedRow[0]?.status !== "approved") { console.error("could not mark the quotation approved"); process.exit(1); }
const refused = await fetch(`${base}/api/quote/save`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ quotationId: qid, reorder: { ids: [FLUID, ALIGN, PADS] } }) });
const refusedBody = await refused.json().catch(() => ({}));
check("6: an approved quotation refuses a reorder in words", refused.status === 423, `${refused.status} ${JSON.stringify(refusedBody).slice(0, 120)}`);
check("6: the order it had stays", JSON.stringify(await dbOrder()) === JSON.stringify(["REPLACE FRONT BRAKE PADS", "WHEEL ALIGNMENT", "FLUSH BRAKE FLUID"]), JSON.stringify(await dbOrder()));
await go(page, `${base}/jobs/${jobId}/quote/${qid}`);
check("6: the locked editor shows no reorder controls", (await page.locator("[data-quote-locked]").count()) === 1 && (await page.locator("[data-drag-handle]").count()) === 0);

await browser.close();
cleanupDb();
process.exit(summary() ? 1 : 0);
