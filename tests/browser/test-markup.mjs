// 22 October 2026 proof: a part's markup as % or AED, a typed selling price, "Apply to all" in both modes, no upper
// limit, the 5% minimum (owner excepted), and the profit figures moving with it.
// Run: node --env-file=.env.test.local tests/browser/test-markup.mjs   (dev server on :3100)
import path from "node:path";
import fs from "node:fs";
import { api, base, browserFor, cleanupDb, cookieHeader, go, here, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shot = (name) => path.join(here, "shots", name);
const until = async (fn, tries = 30, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const lineOf = async (id) => (await sql("select markup_mode, markup_percent::float8 as pct, markup_aed::float8 as aed, markup_confirmed from public.quotation_lines where id = $1", [id]))[0];
const typeInto = async (loc, text) => { await loc.click({ clickCount: 3 }); await loc.press("Backspace"); await loc.pressSequentially(text); await loc.press("Tab"); };

cleanupDb();
const seed = await api("/api/e2e/stage", { stage: "quote" });
const jobId = seed.json?.jobId;
const qid = seed.json?.quotationId;
if (!jobId || !qid) { console.error("seed failed"); process.exit(1); }
const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active limit 1"))[0].id;
const add = async (pos, title, cost, qty = 1) => (await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, unit_cost, markup_percent, created_by, updated_by) values ($1, $2, 'part', $3, 'manual', $4, $5, 5, $6, $6) returning id", [qid, pos, title, qty, cost, owner]))[0].id;
const a = await add(20, "E2e oil cooler", 955.8);
const b = await add(21, "E2e water pump", 955.8);
const c = await add(22, "E2e thermostat housing", 400, 2);

const { browser, page } = await browserFor("service_advisor", { viewport: { width: 1600, height: 1200 } });
await go(page, `${base}/jobs/${jobId}/quote/${qid}`);
const row = (id) => page.locator(`#item-line-${id}`);
const chipBefore = (await page.locator("[data-margin-chip]").textContent().catch(() => "")) ?? "";

/* 1. % markup: 31% on cost 955.80 → AED 296.30, selling 1,252.10 */
await typeInto(row(a).locator("[data-markup-percent-input]"), "31");
const la = await until(async () => { const r = await lineOf(a); return r?.markup_mode === "percent" && r?.pct === 31 ? r : null; });
check("1: a % markup saves (31% on AED 955.80)", !!la, JSON.stringify(await lineOf(a)));
check("1: the line shows cost · markup % · markup AED · selling · total", /296\.30/.test((await row(a).locator("[data-markup-aed]").textContent()) ?? "") && (await row(a).locator("[data-selling-input]").inputValue()) === "1252.1" && /1,252\.10/.test((await row(a).textContent()) ?? ""), (await row(a).textContent())?.replace(/\s+/g, " ").slice(0, 200));

/* 2. AED markup: + AED 300 on cost 955.80 → selling 1,255.80, 31.39% */
await row(b).locator('[data-markup-mode-chip="aed"]').click();
await until(async () => ((await lineOf(b))?.markup_mode === "aed" ? 1 : null));
await typeInto(row(b).locator("[data-markup-aed-input]"), "300");
const lb = await until(async () => { const r = await lineOf(b); return r?.markup_mode === "aed" && r?.aed === 300 ? r : null; });
check("2: an AED markup saves (cost 955.80 + AED 300)", !!lb, JSON.stringify(await lineOf(b)));
check("2: selling 1,255.80 and the % worked out (31.39%)", (await row(b).locator("[data-selling-input]").inputValue()) === "1255.8" && /31\.39%/.test((await row(b).locator("[data-markup-percent]").textContent()) ?? ""));

/* 3. Typed selling price: 520 on cost 400 → 30% and AED 120 worked out */
await typeInto(row(c).locator("[data-selling-input]"), "520");
const lc = await until(async () => { const r = await lineOf(c); return r?.markup_mode === "percent" && Math.abs(r?.pct - 30) < 1e-6 ? r : null; });
check("3: a typed selling price works the markup out (AED 400 → 520 = 30%)", !!lc, JSON.stringify(await lineOf(c)));
check("3: the line shows 30% and AED 120.00, total 1,040.00 for two", (await row(c).locator("[data-markup-percent-input]").inputValue()) === "30" && /120\.00/.test((await row(c).locator("[data-markup-aed]").textContent()) ?? "") && /1,040\.00/.test((await row(c).textContent()) ?? ""));
const partsCard = page.locator("[data-markup-all]").locator("xpath=ancestor::div[contains(@class,'rounded-card')][1]");
await partsCard.scrollIntoViewIfNeeded();
await page.evaluate(() => document.querySelectorAll(".overflow-x-auto").forEach((e) => { e.scrollLeft = 0; }));
await page.screenshot({ path: shot("markup-1-three-modes.png"), clip: (await partsCard.boundingBox()) ?? undefined });

/* 4. No upper limit: 900% saves with nothing asked; below the minimum goes back to 5% for an advisor */
await typeInto(row(a).locator("[data-markup-percent-input]"), "900");
check("4: 900% saves at once, nothing is asked (no upper limit)", !!(await until(async () => ((await lineOf(a))?.pct === 900 ? 1 : null))) && (await page.locator("[data-confirm-markup]").count()) === 0);
await typeInto(row(c).locator("[data-markup-percent-input]"), "2");
check("4: an advisor's 2% goes back to the 5% minimum, with the red note", !!(await until(async () => ((await lineOf(c))?.pct === 5 ? 1 : null))) && (await row(c).locator("[data-min-markup]:not(.hidden)").count()) === 1);
await typeInto(row(b).locator("[data-markup-aed-input]"), "10");
check("4: in AED mode too: AED 10 on 955.80 goes back to the minimum AED 47.79", !!(await until(async () => ((await lineOf(b))?.aed === 47.79 ? 1 : null))), JSON.stringify(await lineOf(b)));

/* 5. Apply to all, AED mode: every part + AED 200 each; the profit figures move */
const marginBefore = (await page.locator("[data-margin-chip]").textContent().catch(() => "")) ?? "";
await page.locator('[data-markup-all-mode="aed"]').click();
await typeInto(page.locator("[data-markup-all-value]"), "200");
await page.locator("[data-markup-apply-all]").click();
const all = await until(async () => { const rows = await sql("select markup_mode, markup_aed::float8 as aed from public.quotation_lines where quotation_id = $1 and line_type = 'part' and is_active and not coalesce(left_off, false)", [qid]); return rows.length >= 3 && rows.every((r) => r.markup_mode === "aed" && r.aed === 200) ? rows : null; }, 40, 500);
check("5: 'Apply to all' in AED mode sets every part to + AED 200", !!all, JSON.stringify(await sql("select title, markup_mode, markup_aed::float8 as aed from public.quotation_lines where quotation_id = $1 and line_type = 'part' and is_active", [qid])));
check("5: the lines read cost + 200 (oil cooler 1,155.80; thermostat housing 600.00 each)", (await row(a).locator("[data-selling-input]").inputValue()) === "1155.8" && (await row(c).locator("[data-selling-input]").inputValue()) === "600");
await sleep(800);
const marginAfter = (await page.locator("[data-margin-chip]").textContent().catch(() => "")) ?? "";
check("6: the profit chip moved at once with the markup", marginAfter !== marginBefore && /Profit/.test(marginAfter), `${chipBefore} → ${marginBefore} → ${marginAfter}`);
const partsMargin = (await page.locator("[data-internal-box]").textContent().catch(() => "")) ?? "";
check("6: the internal box's parts margin counts the AED markups", /Parts margin/.test(partsMargin));
await partsCard.scrollIntoViewIfNeeded();
await page.evaluate(() => document.querySelectorAll(".overflow-x-auto").forEach((e) => { e.scrollLeft = 0; }));
await page.screenshot({ path: shot("markup-2-apply-all-aed.png"), clip: (await partsCard.boundingBox()) ?? undefined });
const summaryCard = page.locator("[data-internal-box]").locator("xpath=ancestor::div[contains(@class,'rounded-card')][1]");
await summaryCard.scrollIntoViewIfNeeded();
await page.screenshot({ path: shot("markup-4-summary.png"), clip: (await summaryCard.boundingBox()) ?? undefined });

/* 7. The owner may go below the minimum; the customer's PDF sells at cost + markup */
await browser.close();
// The advisor's editing lock lasts 90 seconds after the page closes: hand the quotation over at once.
await sql("update public.quotations set editing_by = null, editing_at = null where id = $1", [qid]);
const { browser: ob, page: op } = await browserFor("owner", { viewport: { width: 1600, height: 1200 } });
await go(op, `${base}/jobs/${jobId}/quote/${qid}`);
await op.locator(`#item-line-${c} [data-markup-mode-chip="percent"]`).click();
await until(async () => ((await lineOf(c))?.markup_mode === "percent" ? 1 : null));
await typeInto(op.locator(`#item-line-${c} [data-markup-percent-input]`), "2");
check("7: the owner may set 2% (below the minimum, kept)", !!(await until(async () => { const r = await lineOf(c); return r?.pct === 2 && r?.markup_confirmed ? 1 : null; })), JSON.stringify(await lineOf(c)));
const r = await fetch(`${base}/api/pdf/quotation/${qid}`, { headers: { cookie: await cookieHeader("owner") } });
const mupdf = await import("mupdf");
const doc = mupdf.Document.openDocument(Buffer.from(await r.arrayBuffer()), "application/pdf");
let text = "";
for (let i = 0; i < doc.countPages(); i++) text += doc.loadPage(i).toStructuredText("preserve-whitespace").asText();
text = text.replace(/\s+/g, " ");
check("7: the customer's PDF shows the selling prices (1,155.80 for cost 955.80 + AED 200)", /1,155\.80/.test(text) && !/markup/i.test(text), text.match(/OIL COOLER.{0,80}/i)?.[0] ?? String(r.status));
fs.writeFileSync(shot("markup-3-quote-pdf.png"), Buffer.from(doc.loadPage(0).toPixmap(mupdf.Matrix.scale(1.4, 1.4), mupdf.ColorSpace.DeviceRGB, false, true).asPNG()));
await ob.close();
cleanupDb();
process.exit(summary() ? 1 : 0);
