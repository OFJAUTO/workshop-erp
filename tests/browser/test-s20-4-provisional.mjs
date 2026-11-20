// 20 November 2026, Section 4: THE PROVISIONAL "ADDITIONAL PARTS" AMOUNT. Signed in as an advisor, on TEST.
//  A. On the quotation screen the provisional line sits in the PARTS block, not under Other charges.
//  B. The profit says "Profit n% – plus AED 370.00 provisional, not yet costed" (zero profit until converted).
//  C. The customer's quotation PDF lists it under PARTS.
// TEST only.  node --env-file=.env.test.local tests/browser/test-s20-4-provisional.mjs
import fs from "node:fs";
import path from "node:path";
import * as mupdf from "mupdf";
import { api, base, browserFor, cleanupDb, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-20-provisional";
fs.mkdirSync(OUT, { recursive: true });
const text = async (loc) => (((await loc.first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim());
const shots = async (page, el, name) => {
  for (const [w, h] of [[1440, 1000], [800, 1280]]) {
    await page.setViewportSize({ width: w, height: h });
    await sleep(300);
    await (el ?? page).screenshot({ path: path.join(OUT, `${name}-${w}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
};

try {
  cleanupDb();
  const seed = (await api("/api/e2e/stage", { stage: "quote" })).json;
  const JOB = seed.jobId;
  const Q = (await sql("select id, token from public.quotations where job_id = $1 and kind = 'quotation' and status = 'draft' order by created_at desc limit 1", [JOB]))[0];
  const adv = (await sql("select id from public.staff where role_id = 'service_advisor' and is_active order by created_at limit 1"))[0].id;
  await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, quantity, unit_price, unit_cost, markup_percent, created_by) values ($1, 90, 'part', 'BRAKE PADS', 1, 600, 400, 50, $2)", [Q.id, adv]);
  await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, quantity, unit_price, source_key, created_by) values ($1, 91, 'other', 'ADDITIONAL PARTS IF REQUIRED – UP TO AED 370.00', 1, 370, 'provisional', $2)", [Q.id, adv]);
  const a = await browserFor("service_advisor", { viewport: { width: 1440, height: 1000 } });
  await go(a.page, `${base}/jobs/${JOB}/quote/${Q.id}`);
  const inParts = a.page.locator("[data-provisional-in-parts]");
  await inParts.waitFor({ timeout: 30000 });
  const vals = await inParts.evaluate((el) => [el.textContent ?? "", ...Array.from(el.querySelectorAll("input, textarea")).map((x) => x.value)].join(" "));
  check("A1: the provisional line sits in the PARTS block", /ADDITIONAL PARTS IF REQUIRED/i.test(vals), vals.slice(0, 120));
  await shots(a.page, inParts, "a-provisional-in-parts");
  const pw = await text(a.page.locator("[data-provisional-profit]"));
  check("B1: \"plus AED 370.00 provisional, not yet costed\"", /plus AED 370\.00 provisional, not yet costed/.test(pw), pw);
  await a.browser.close();

  // C. The customer's PDF: PARTS, then the provisional line, before any other section.
  const res = await fetch(`${base}/api/pdf/quote/${Q.token}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  let all = "";
  for (let i = 0; i < doc.countPages(); i++) all += doc.loadPage(i).toStructuredText().asText() + "\n";
  const up = all.toUpperCase();
  const partsAt = up.indexOf("PARTS\n") >= 0 ? up.indexOf("PARTS\n") : up.indexOf("PARTS");
  const provAt = up.indexOf("ADDITIONAL PARTS IF REQUIRED");
  const otherAt = up.indexOf("OTHER CHARGES");
  check("C1: the customer's quotation lists it under PARTS", provAt > partsAt && partsAt >= 0 && (otherAt < 0 || provAt < otherAt), `parts ${partsAt} prov ${provAt} other ${otherAt}`);
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
