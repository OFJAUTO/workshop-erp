// 17 November 2026, Section 7: TIGHTER PART-NUMBER CHECK (BLADE78, FILTER69, FILTER859, FRONT PAD145, SOLITE859).
//  A. The Parts page flags a part number that is the part's name with digits added ("Part number is the name").
//  B. The LPO approval screen flags it on its line, until a real number is entered.
//  C. "Part number check" lists it by car and who typed it (owner and parts desk).
//  D. A real number clears the flag everywhere.
// TEST only.  node --env-file=.env.test.local tests/browser/test-s17-7-part-numbers.mjs
import fs from "node:fs";
import path from "node:path";
import { api, base, browserFor, cleanupDb, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-17-part-numbers";
fs.mkdirSync(OUT, { recursive: true });
const text = async (page, sel) => (((await page.locator(sel).first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim());
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
  const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const JOB = seed.jobId;
  const part = (await sql("select id from public.part_items where job_id = $1 and description ilike '%brake pads%' limit 1", [JOB]))[0];
  await sql("update public.part_items set part_number = 'FRONT PAD145', supplier = 'E2E PN Supplier' where id = $1", [part.id]);
  const po = (await sql("insert into public.purchase_orders (number, kind, job_id, supplier_name, status, total_cost_aed, supplier_invoice_status) values ('LPO-E2E-PN-1', 'main', $1, 'E2E PN Supplier', 'pending_approval', 200, 'none') returning id", [JOB]))[0].id;
  const line = (await sql("insert into public.purchase_order_lines (po_id, part_item_id, position, description, part_number, quantity, unit_cost) values ($1, $2, 1, 'FRONT BRAKE PADS', 'FRONT PAD145', 1, 200) returning id", [po, part.id]))[0].id;
  await sql("update public.part_items set po_id = $1, po_line_id = $2 where id = $3", [po, line, part.id]);

  const parts = await browserFor("parts", { viewport: { width: 1440, height: 1000 } });
  // A. The Parts page.
  await go(parts.page, `${base}/parts/${JOB}`);
  await parts.page.locator("[data-pn-flag]").first().waitFor({ timeout: 30000 });
  check("A1: the Parts page flags \"FRONT PAD145\" (the name with a number added)", /Part number is the name/.test(await text(parts.page, "[data-pn-flag]")));
  // B. The LPO approval screen (the owner approves).
  const own = await browserFor("owner", { viewport: { width: 1440, height: 1000 } });
  await go(own.page, `${base}/parts/orders/${po}`);
  const flag = own.page.locator("[data-lpo-pn-flag]").first();
  await flag.waitFor({ timeout: 30000 });
  check("B1: the LPO approval screen flags it on its line", /FRONT PAD145.*name with a number added/.test(await text(own.page, "[data-lpo-pn-flag]")));
  await shots(own.page, own.page.locator("[data-lpo-group]").first(), "b-lpo-approval-flag");
  // C. The check page.
  await go(parts.page, `${base}/parts/part-number-check`);
  await parts.page.locator("[data-pn-check]").waitFor({ timeout: 30000 });
  const row = await text(parts.page, '[data-pn-check-row="FRONT PAD145"]');
  check("C1: Part number check lists it by car and who typed it", /FRONT BRAKE PADS/.test(row) && /typed by/.test(row), row);
  await shots(parts.page, parts.page.locator("[data-pn-check]").first(), "c-part-number-check");
  // D. A real number clears it.
  await sql("update public.part_items set part_number = '04465-0K290' where id = $1", [part.id]);
  await sql("update public.purchase_order_lines set part_number = '04465-0K290' where po_id = $1", [po]);
  await go(own.page, `${base}/parts/orders/${po}?v=2`);
  await own.page.locator("[data-lpo-group]").first().waitFor({ timeout: 30000 });
  check("D1: a real number clears the flag on the LPO", (await own.page.locator("[data-lpo-pn-flag]").count()) === 0);
  await own.browser.close();
  await go(parts.page, `${base}/parts/part-number-check?v=2`);
  check("D2: and it leaves the check list", (await parts.page.locator('[data-pn-check-row="FRONT PAD145"]').count()) === 0);
  await parts.browser.close();
  // Refused for a technician.
  const tech = await browserFor("technician", { viewport: { width: 1440, height: 1000 } });
  await go(tech.page, `${base}/parts/part-number-check`);
  check("E1: a technician is refused the check page", (await tech.page.locator("[data-pn-check]").count()) === 0);
  await tech.browser.close();
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
