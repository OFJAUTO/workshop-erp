// Proof for C1 of the 16 October batch: the road test results sit at the top right under "The customer says" on the
// finished report, in the advisor's quotation strip and on the customer's report link and PDF; Bad and Average come
// first, Good is one line; "+ Add job" on a flagged road test item adds a quotation line that then shows as quoted.
//   node --env-file=.env.test.local tests/browser/test-s.mjs
import { api, base, browserFor, browserForId, cleanupDb, go, makeChecks, sleep, sql, MANAGER_MECH } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 10 * 60 * 1000).unref();
cleanupDb();

const until = async (fn, tries = 60, ms = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } return null; };
async function section(name, fn) {
  console.log(`\n== ${name}`);
  try { await fn(); } catch (e) { check(`${name}: no crash`, false, String(e?.message ?? e).slice(0, 300)); }
}
const pdfText = async (buf) => {
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  let t = "";
  for (let i = 0; i < doc.countPages(); i++) t += doc.loadPage(i).toStructuredText().asText();
  return t;
};

const seed = await api("/api/e2e/stage", { stage: "quote" });
const { jobId, quotationId } = seed.json;
const ITEMS = { noises: { status: "bad", remarks: "Knocking over bumps, front left" }, braking: { status: "average", remarks: "Soft pedal" }, vibration: { status: "good" }, pulling: { status: "good" }, steering: { status: "good" }, gearbox: { status: "good" }, engine: { status: "good" }, suspension: { status: "good" } };
await sql("update public.road_tests set status = 'done', done_at = now(), decision = 'needed', items = $2::jsonb where job_id = $1", [jobId, JSON.stringify(ITEMS)]);
const inspectionId = (await sql("select id from public.inspections where job_id = $1 and is_active limit 1", [jobId]))[0]?.id;
const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0]?.id;
await sql("insert into public.report_links (job_id, inspection_id, token, status, created_by) values ($1, $2, 'e2e-road-test-token', 'sent', $3)", [jobId, inspectionId, owner]);
check("seed: approved report with a done road test (Noises bad, Brakes average)", !!jobId && !!inspectionId && (await sql("select status from public.road_tests where job_id = $1", [jobId]))[0]?.status === "done");

/* ---------------- 1. The finished report ---------------- */
await section("1 finished report", async () => {
  const { browser, page } = await browserForId(MANAGER_MECH, { viewport: { width: 1366, height: 1100 } });
  await go(page, `${base}/jobs/${jobId}/inspection`);
  const order = await page.evaluate(() => {
    const says = document.querySelector("[data-customer-says]");
    const road = document.querySelector("[data-road-test]");
    if (!says || !road) return { says: !!says, road: !!road };
    const rightColumn = road.parentElement;
    return { says: true, road: true, saysBeforeRoad: !!(says.compareDocumentPosition(road) & Node.DOCUMENT_POSITION_FOLLOWING), sameColumn: says.parentElement === rightColumn, children: Array.from(rightColumn.children).indexOf(road) };
  });
  check("1: 'The customer says' and 'Road test' sit together at the top of the right column, requests first", order.says && order.road && order.saysBeforeRoad && order.sameColumn && order.children === 1, JSON.stringify(order));
  const items = await page.locator("[data-road-test] [data-road-item]").evaluateAll((els) => els.map((e) => ({ status: e.getAttribute("data-road-item"), text: e.textContent })));
  check("1: Bad first, then Average, with the remarks", items.length === 2 && items[0].status === "bad" && /Noises/.test(items[0].text) && /Knocking over bumps/.test(items[0].text) && items[1].status === "average" && /Brakes/.test(items[1].text), JSON.stringify(items));
  const good = await page.locator("[data-road-test] [data-road-good]").textContent();
  check("1: the good items are one line", /Good:/.test(good ?? "") && /Vibration/.test(good ?? "") && /Suspension/.test(good ?? "") && !/Noises/.test(good ?? ""), good ?? "");
  check("1: the old road test card at the bottom is gone", !/Road test \(QC inspector\)/.test((await page.textContent("body")) ?? ""));
  await browser.close();
});

/* ---------------- 2. The advisor's quotation strip and "+ Add job" ---------------- */
await section("2 quotation strip", async () => {
  const { browser, page } = await browserFor("service_advisor", { viewport: { width: 1366, height: 1000 } });
  await go(page, `${base}/jobs/${jobId}/quote/${quotationId}`);
  await until(async () => ((await page.locator("[data-labour-boxes]").count()) ? 1 : null), 30, 500);
  const stripButton = page.locator("button[aria-expanded]").filter({ hasText: /From the inspection report/ }).first();
  check("2: the strip's header counts the road test", /road test: 2 noted/i.test((await stripButton.textContent()) ?? ""), (await stripButton.textContent()) ?? "");
  check("2: a bad road test item with no job is named as not quoted yet", /Nothing quoted yet for:.*Noises \(road test\)/.test((await stripButton.textContent()) ?? ""));
  if ((await stripButton.getAttribute("aria-expanded")) !== "true") await stripButton.click();
  const strip = page.locator("[data-road-strip]");
  const underRequests = await page.evaluate(() => { const road = document.querySelector("[data-road-strip]"); const prev = road?.previousElementSibling; return !!prev && /customer says/i.test(prev.textContent ?? ""); });
  check("2: the strip has a Road test block right under the customer's requests", (await strip.count()) === 1 && underRequests);
  const items = await strip.locator("[data-road-item]").evaluateAll((els) => els.map((e) => e.getAttribute("data-road-item")));
  check("2: Bad first, then Average, each with '+ Add job'", items.join(",") === "bad,average" && (await strip.locator("[data-road-add]").count()) === 2, items.join(","));
  check("2: the good items are one line in the strip", /Good:.*Steering/.test((await strip.locator("[data-road-good]").textContent()) ?? ""));
  await strip.locator("[data-road-add]").first().click();
  const dialog = page.locator("[role='dialog']").first();
  const heading = await until(async () => { const t = await dialog.textContent().catch(() => null); return /Add a job for: Noises \(road test\)/.test(t ?? "") ? t : null; }, 20, 300);
  check("2: '+ Add job' opens the picker for that item", !!heading);
  await dialog.locator("input[aria-label='Search']").fill("Front left suspension noise check");
  await dialog.getByRole("button", { name: /as typed/ }).click();
  await dialog.getByRole("button", { name: /^Done/ }).click();
  const line = await until(async () => (await sql("select id, title, source_type, source_key from public.quotation_lines where quotation_id = $1 and source_key = 'road:noises'", [quotationId]))[0] ?? null, 40, 500);
  check("2: the job lands on the quotation pointing at the road test item", !!line && line.source_type === "item" && /front left suspension noise check/i.test(line.title ?? ""), JSON.stringify(line));
  const quoted = await until(async () => (/✓ Quoted/.test((await strip.locator("[data-road-item='bad']").textContent()) ?? "") ? 1 : null), 20, 300);
  check("2: the strip now shows the item as quoted", !!quoted);
  check("2: the header no longer names Noises as not quoted", !/Noises \(road test\)/.test((await stripButton.textContent()) ?? ""));
  await browser.close();
});

/* ---------------- 3. The customer's link and PDF ---------------- */
await section("3 customer link and pdf", async () => {
  const { browser, page } = await browserFor("owner", { viewport: { width: 420, height: 900 } });
  await go(page, `${base}/report/e2e-road-test-token`);
  // 29 October 2026 (section 8): the road test is its own block of the report, its findings also in Needs attention.
  const box = page.locator("[data-report-section=road_test]");
  check("3: the customer's report shows the road test", (await box.count()) === 1);
  const items = await box.locator("[data-finding]").evaluateAll((els) => els.map((e) => ({ s: e.querySelector("[data-chip]")?.textContent ?? "", t: e.textContent })));
  check("3: Bad first with its remark, then Average; Good as one line", items.length === 2 && /bad/i.test(items[0].s) && /Noises · Knocking over bumps/.test(items[0].t) && /average/i.test(items[1].s) && /Good.*Engine/.test((await box.textContent()) ?? ""), JSON.stringify(items));
  check("3: the road test's findings are in Needs attention too", (await page.locator("[data-report-attention]").textContent())?.includes("Noises") === true);
  await browser.close();
  const res = await fetch(`${base}/api/pdf/report/e2e-road-test-token`);
  check("3: the report PDF opens", res.status === 200 && /pdf/.test(res.headers.get("content-type") ?? ""), String(res.status));
  const text = (await pdfText(Buffer.from(await res.arrayBuffer()))).replace(/\s+/g, " ");
  const iRoad = text.search(/ROAD TEST/);
  const iAttention = text.search(/NEEDS ATTENTION/);
  check("3: the PDF has its ROAD TEST block after 'Needs attention' (the report's order)", iRoad >= 0 && iAttention >= 0 && iRoad > iAttention, `${iRoad} / ${iAttention}`);
  check("3: the PDF lists Noises (Bad) with the remark and the good items on one line", /Bad\s+Noises/i.test(text.slice(iRoad)) && /Knocking over bumps/.test(text.slice(iRoad)) && /Good .*Steering/.test(text.slice(iRoad)) && !/Noted on the road test/.test(text), text.slice(iRoad, iRoad + 260));
});

cleanupDb();
process.exit(summary() ? 1 : 0);
