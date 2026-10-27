// Section 1 of 27 October (afternoon): tyre / part positions. The name keeps its width (no letter-per-line squash),
// positions sit on their own small line in THE short form, the quote PDF prints the short form under the name, and
// positions that disagree with the quantity stop "Quotation complete" (the owner may override).
//   node --env-file=.env.local tests/browser/test-positions.mjs   (dev server)
import { api, base, browserFor, cleanupDb, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 12 * 60 * 1000).unref();
cleanupDb();

const seed = await api("/api/e2e/stage", { stage: "quote" });
const jobId = seed.json?.jobId;
const qid = seed.json?.quotationId;
if (!jobId || !qid) { console.error("seed failed"); process.exit(1); }
const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active limit 1"))[0].id;
const ALL5 = ["Front left", "Front right", "Rear left", "Rear right", "Spare"];
// Parts priced by the Parts desk (a quotation part line must point at its part item to be sendable).
const partItem = async (name, qty, cost, positions) => (await sql("insert into public.part_items (job_id, description, quantity, confirmed_quantity, cost_aed, availability, confirm_status, priced_at, positions, created_by, updated_by) values ($1, $2, $3, $3, $4, 'in_stock', 'confirmed', now(), $5, $6, $6) returning id", [jobId, name, qty, cost, positions, owner]))[0].id;
const tyreItem = await partItem("PIRELLI 275/45 R21", 4, 900, ALL5);
const discItem = await partItem("E2e brake discs", 2, 300, ["Front left", "Front right"]);
const [tyre] = await sql(
  "insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, unit_cost, markup_percent, positions, part_item_id, created_by, updated_by) values ($1, 30, 'part', 'PIRELLI 275/45 R21', 'manual', 4, 900, 20, $2, $4, $3, $3) returning id",
  [qid, ALL5, owner, tyreItem],
);
await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, unit_cost, markup_percent, positions, part_item_id, created_by, updated_by) values ($1, 31, 'part', 'E2e brake discs', 'manual', 2, 300, 20, $2, $4, $3, $3)", [qid, ["Front left", "Front right"], owner, discItem]);
// Nothing else blocks "Quotation complete": the seed's part requests are closed and pricing is done.
await sql("update public.part_requests set status = 'unavailable' where job_id = $1 and status = 'open'", [jobId]);
await sql("update public.jobs set parts_pricing_done_at = now() where id = $1", [jobId]);
await sql("update public.part_items set cost_aed = coalesce(cost_aed, 200), priced_at = coalesce(priced_at, now()) where job_id = $1", [jobId]);

const { browser, page } = await browserFor("service_advisor", { viewport: { width: 1366, height: 1300 } });
try {
  await go(page, `${base}/jobs/${jobId}/quote/${qid}`);
  await page.waitForSelector("[data-line-positions]", { timeout: 30000 });
  const row = page.locator("[data-line-positions]", { hasText: "ALL 4 + SPARE" }).first();
  check("1: the tyre's positions read ALL 4 + SPARE on their own line", (await row.count()) === 1);
  check("1: the discs read FRONT PAIR", (await page.locator("[data-line-positions]", { hasText: "FRONT PAIR" }).count()) >= 1);
  const nameBox = await page.locator("span", { hasText: /^PIRELLI 275\/45 R21$/i }).first().boundingBox();
  check("1: the part name keeps a real width and wraps by words (at most 2 lines here, never a letter per line)", !!nameBox && nameBox.width > 90 && nameBox.height <= 44, JSON.stringify(nameBox));
  check("1: 5 positions with qty 4 shows the warning on the line", ((await page.locator("[data-positions-mismatch]").first().textContent()) ?? "").includes("5 positions ticked but qty is 4 – fix one"));
  await page.screenshot({ path: "tests/browser/shots/positions-quote.png", fullPage: false });
  // The advisor cannot complete it.
  const r = await page.evaluate(async () => null);
  void r;
  const done = await page.locator("button", { hasText: /^Quotation complete$/ }).first();
  if (await done.count()) {
    await done.click();
    await sleep(2500);
  }
  const completedAdvisor = (await sql("select completed_at from public.quotations where id = $1", [qid]))[0]?.completed_at;
  check("1: the advisor cannot mark it complete while they disagree", !completedAdvisor, String(completedAdvisor));
} finally {
  await browser.close();
}

// The owner sees the question and may complete anyway (logged). The advisor's edit lock is released first.
await sql("update public.quotations set editing_by = null, editing_at = null where id = $1", [qid]);
const ob = await browserFor("owner", { viewport: { width: 1366, height: 1300 } });
try {
  await go(ob.page, `${base}/jobs/${jobId}/quote/${qid}`);
  await ob.page.waitForSelector("[data-line-positions]", { timeout: 30000 });
  const done = ob.page.locator("button", { hasText: /^Quotation complete$/ }).first();
  if (await done.count()) await done.click();
  const ask = await ob.page.waitForSelector("[data-positions-ask]", { timeout: 20000 }).catch(() => null);
  if (!ask) { await ob.page.screenshot({ path: "tests/browser/shots/positions-owner-debug.png" }); console.log("BTN", await done.count(), await done.isDisabled().catch(() => "?")); }
  check("1: the owner is asked (Go back and fix / Complete anyway)", !!ask && /5 positions ticked but qty is 4/.test((await ask.textContent()) ?? ""));
} finally {
  await ob.browser.close();
}

// The customer PDF prints the short form under the name, never the long list after it.
await sql("update public.quotation_lines set quantity = 5 where id = $1", [tyre.id]);
const [tok] = await sql("select token from public.quotations where id = $1", [qid]);
if (tok?.token) {
  const pdf = await fetch(`${base}/api/pdf/quote/${tok.token}`);
  const buf = Buffer.from(await pdf.arrayBuffer());
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  let text = "";
  for (let i = 0; i < doc.countPages(); i++) text += doc.loadPage(i).toStructuredText().asText();
  check("1: the quote PDF prints ALL 4 + SPARE", /ALL 4 \+ SPARE/i.test(text), text.slice(0, 200));
  check("1: the PDF no longer prints the long position list after the name", !/FRONT LEFT, FRONT RIGHT, REAR LEFT/i.test(text));
} else {
  check("1: the quotation has a customer token for the PDF", false, "no token");
}

cleanupDb();
process.exit(summary() ? 1 : 0);
