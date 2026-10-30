// Evening section 8 proof: the packages page keeps each item on ONE tidy row (name · warranty · Only if
// with its condition inside the row · ×); "Estimated completion" replaces "Time in workshop" everywhere
// and closes the included list; an unticked "only if" item never reaches a customer document; a package
// quotation's discount reads "Package discount (10%)" in bold green.
// Run: node --env-file=.env.test.local tests/browser/test-packages8.mjs   (dev server on :3100)
import path from "node:path";
import { api, base, browserFor, cleanupDb, cookieHeader, go, here, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shot = (name) => path.join(here, "shots", name);
const until = async (fn, tries = 30, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const pdfText = async (buf) => {
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  let out = "";
  for (let i = 0; i < doc.countPages(); i++) out += doc.loadPage(i).toStructuredText("preserve-whitespace").asText();
  return out.replace(/\s+/g, " ");
};

cleanupDb();

/* ---------------- 1. The packages page: one tidy row per item ---------------- */
const { browser, page } = await browserFor("owner", { viewport: { width: 1366, height: 1000 } });
await go(page, `${base}/settings/packages`);
const body = ((await page.textContent("body")) ?? "").replace(/\s+/g, " ");
check("1: the field reads Estimated completion, never Time in workshop", /Estimated completion/.test(body) && !/Time in workshop/i.test(body));
for (const width of [1920, 1366, 1024]) {
  await page.setViewportSize({ width, height: 1000 });
  await sleep(300);
  const row = page.locator("[data-package-item]", { has: page.locator('[data-only-if-toggle][aria-pressed="true"]') }).first();
  const geo = await row.evaluate((el) => {
    const top = (sel) => { const n = el.querySelector(sel); return n ? Math.round(n.getBoundingClientRect().top + n.getBoundingClientRect().height / 2) : null; };
    const t = el.querySelector("[data-only-if-toggle]");
    return { name: top("input"), toggle: top("[data-only-if-toggle]"), cond: top("[data-only-if-text]"), x: top("[data-item-remove]"), cut: t ? t.scrollWidth > t.clientWidth + 1 : true };
  });
  const same = [geo.toggle, geo.cond, geo.x].every((v) => v !== null && Math.abs(v - geo.name) < 8);
  check(`1: @${width} name, Only if, its condition and × sit on one row; the label is not cut`, same && !geo.cut, JSON.stringify(geo));
}
await page.setViewportSize({ width: 1366, height: 1000 });
await sleep(300);
const card = page.locator("[data-package-card]", { has: page.locator('[data-only-if-toggle][aria-pressed="true"]') }).first();
await card.scrollIntoViewIfNeeded();
await page.screenshot({ path: shot("pkg8-1-rows.png"), clip: (await card.boundingBox()) ?? undefined });

/* ---------------- 2. Adding the package: the advisor answers "does the car have it?" ---------------- */
const seed = await api("/api/e2e/stage", { stage: "quote" });
const jobId = seed.json?.jobId;
const qid = seed.json?.quotationId;
if (!jobId || !qid) { console.error("seed failed"); process.exit(1); }
const { browser: ab, page: ap } = await browserFor("service_advisor", { viewport: { width: 1440, height: 1000 } });
await go(ap, `${base}/jobs/${jobId}/quote/${qid}`);
async function addPlatinum(tickRoof) {
  await ap.locator("[data-add-package]").scrollIntoViewIfNeeded();
  await ap.locator("[data-add-package]").click({ timeout: 20000 });
  await sleep(300);
  const choice = ap.locator("[data-package-choice]", { hasText: "Matte" }).first();
  if (await choice.count()) await choice.click();
  await sleep(300);
  check(`2: the dialog asks "Does the car have it?"${tickRoof ? " (ticked)" : ""}`, (await ap.locator("[data-package-optionals]").count()) === 1);
  const roof = ap.locator("[data-package-optional]").first();
  if (tickRoof) await roof.check();
  const preview = ((await ap.locator("[data-package-preview]").textContent()) ?? "");
  check(`2: the preview ${tickRoof ? "shows" : "hides"} the roof item, and ends with Estimated completion`, (tickRoof ? /Panoramic roof/.test(preview) : !/Panoramic roof/.test(preview)) && /Estimated completion: 3-5 working days\s*$/.test(preview), preview.slice(-120));
  if (!tickRoof) await ap.screenshot({ path: shot("pkg8-2-dialog.png"), fullPage: false });
  await ap.locator("[data-package-add]").click();
}
await addPlatinum(false);
const first = await until(async () => (await sql("select id, package_items::text as items from public.quotation_lines where quotation_id = $1 and package_key = 'ofj_platinum' and is_active order by created_at limit 1", [qid]))[0]);
check("2: not ticked = the roof item is NOT on the line", !!first && !/Panoramic roof/.test(first.items), (first?.items ?? "").slice(0, 160));
await sleep(800);
await go(ap, `${base}/jobs/${jobId}/quote/${qid}`);
await addPlatinum(true);
const second = await until(async () => { const r = await sql("select package_items::text as items from public.quotation_lines where quotation_id = $1 and package_key = 'ofj_platinum' and is_active order by created_at", [qid]); return r.length === 2 ? r[1] : null; });
check("2: ticked = the roof item IS on the line", !!second && /Panoramic roof/.test(second.items));
await sql("update public.quotation_lines set is_active = false where quotation_id = $1 and package_key = 'ofj_platinum' and package_items::text like '%Panoramic roof%'", [qid]);

/* ---------------- 3. The documents: the package discount, the completion line, no unticked item ---------------- */
await sql("update public.quotation_lines set unit_price = 18000 where id = $1", [first.id]);
await sql("update public.quotation_lines set is_active = false where quotation_id = $1 and package_key is null", [qid]);
await sql("update public.quotations set discount_kind = 'percent', discount_value = 10, discount_scope = 'labour' where id = $1", [qid]);
const cookie = await cookieHeader("service_advisor");
const pdf = await fetch(`${base}/api/pdf/quotation/${qid}`, { headers: { cookie } });
const text = await pdfText(Buffer.from(await pdf.arrayBuffer()));
check("3: the PDF says Package discount (10%) for AED 1,800", pdf.status === 200 && /PACKAGE DISCOUNT \(10%\)/i.test(text) && /1,800\.00/.test(text), text.match(/package discount[^A-Z]{0,40}/i)?.[0] ?? `${pdf.status}`);
check("3: the PDF carries Estimated completion and never Time in workshop", /Estimated completion: 3-5 working days/i.test(text) && !/Time in workshop/i.test(text));
check("3: the unticked roof item is on no document", !/Panoramic roof/i.test(text));
await go(ap, `${base}/jobs/${jobId}/quote/${qid}`);
const row = ap.locator("[data-labour-discount-row]");
const color = await row.evaluate((el) => ({ text: el.textContent, weight: getComputedStyle(el).fontWeight, color: getComputedStyle(el).color }));
check("3: the editor's discount row reads Package discount (10%), bold green", /Package discount \(10%\)/.test(color.text ?? "") && Number(color.weight) >= 700 && /rgb\(\s*2[0-9]?,|rgb\(27, 107, 47\)|rgb\(\d+, 1[0-4]\d, \d+\)/.test(color.color), JSON.stringify(color));

await browser.close(); await ab.close();
cleanupDb();
process.exit(summary() ? 1 : 0);
