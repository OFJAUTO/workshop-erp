// 19 November 2026, Section 5: ADVISORS - "+ ADD A PART" WITH A CHOICE OF HOW IT IS HANDLED. Signed in as an advisor.
//  A. The choice window: five ways, none picked.
//  B. I HAVE THE PRICE: a real supplier, cost and selling price; "OFJ Additional" is refused.
//  C. FROM OUR STOCK: the stock item's cost, nothing ordered.
//  D. CUSTOMER SUPPLIES IT: no cost, no price, "PART SUPPLIED BY CUSTOMER – NO WARRANTY ON THE PART" on the customer's page.
//  E. PROVISIONAL AMOUNT: "ADDITIONAL PARTS IF REQUIRED – UP TO AED 500.00".
//  F. After approval: "Use the provisional amount" makes a real part (Approved – to order), never above what is left.
//  G. The bill: the converted part instead of the provisional line; the unused remainder is never charged.
// TEST only.  node --env-file=.env.test.local tests/browser/test-s19-5-add-part.mjs
import fs from "node:fs";
import path from "node:path";
import { api, base, browserFor, cleanupDb, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-19-add-part";
fs.mkdirSync(OUT, { recursive: true });
const until = async (fn, tries = 60, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const text = async (loc) => (((await loc.first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim());
const shots = async (page, el, name) => {
  for (const [w, h] of [[1440, 1000], [800, 1280]]) {
    await page.setViewportSize({ width: w, height: h });
    await sleep(300);
    await (el ?? page).screenshot({ path: path.join(OUT, `${name}-${w}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
};

let stockId = null;
try {
  cleanupDb();
  const seed = (await api("/api/e2e/stage", { stage: "quote" })).json;
  const JOB = seed.jobId;
  const Q = (await sql("select id, token from public.quotations where job_id = $1 and kind = 'quotation' and status = 'draft' order by created_at desc limit 1", [JOB]))[0];
  stockId = (await sql("insert into public.stock_items (name, unit, quantity, unit_cost, item_type) values ('E2E OIL FILTER S5', 'pc', 5, 25, 'part') returning id"))[0]?.id ?? null;
  const adv = await browserFor("service_advisor", { viewport: { width: 1440, height: 1000 } });
  await go(adv.page, `${base}/jobs/${JOB}/quote/${Q.id}`);
  const openChoice = async () => { await adv.page.locator("[data-add-part]").first().click(); const w = adv.page.locator("[data-add-part-choice]"); await w.waitFor({ timeout: 20000 }); return w; };

  // A. The window.
  let w = await openChoice();
  check("A1: five ways, none picked", (await w.locator("[data-add-part-mode]").count()) === 5 && (await w.locator("[data-add-part-mode]:checked").count()) === 0);
  await shots(adv.page, w.locator("div").first(), "a-add-part-choice");

  // B. I have the price - first with "OFJ Additional" (refused), then a real supplier.
  await w.locator('[data-add-part-mode="own"]').check();
  await w.locator("[data-own-name]").fill("DOOR HANDLE");
  await w.locator("[data-own-supplier]").fill("OFJ Additional");
  await w.locator("[data-own-cost]").fill("100");
  await w.locator("[data-own-sell]").fill("150");
  await w.locator("[data-own-save]").click();
  await sleep(4000);
  const bad = (await sql("select count(*)::int as n from public.part_items where job_id = $1 and supplier ilike 'ofj%additional%' and cost_aed is not null", [JOB]))[0].n;
  check("B1: \"OFJ Additional\" is never saved as a supplier", bad === 0, String(bad));
  w = await openChoice();
  await w.locator('[data-add-part-mode="own"]').check();
  await w.locator("[data-own-name]").fill("DOOR HANDLE");
  await w.locator("[data-own-supplier]").fill("E2E Real Supplier");
  await w.locator("[data-own-cost]").fill("100");
  await w.locator("[data-own-sell]").fill("150");
  await w.locator("[data-own-save]").click();
  const own = await until(async () => (await sql("select p.supplier, p.cost_aed::float as cost, p.priced_by_advisor, l.id as line from public.part_items p left join public.quotation_lines l on l.part_item_id = p.id and l.is_active and l.quotation_id = $2 where p.job_id = $1 and p.description = 'DOOR HANDLE' and p.cost_aed is not null and p.is_active", [JOB, Q.id]))[0]?.line ? (await sql("select p.supplier, p.cost_aed::float as cost, l.id as line from public.part_items p join public.quotation_lines l on l.part_item_id = p.id and l.is_active and l.quotation_id = $2 where p.job_id = $1 and p.description = 'DOOR HANDLE' and p.is_active", [JOB, Q.id]))[0] : null, 60);
  check("B2: I HAVE THE PRICE: the part with its real supplier and cost is on the quotation", !!own && own.supplier === "E2E Real Supplier" && own.cost === 100, JSON.stringify(own ?? {}));
  // C. From our stock.
  w = await openChoice();
  await w.locator('[data-add-part-mode="stock"]').check();
  await w.locator("[data-stock-search]").fill("E2E OIL FILTER S5");
  await w.locator('[data-stock-pick="E2E OIL FILTER S5"]').click();
  const stock = await until(async () => (await sql("select p.supplier, p.cost_aed::float as cost, p.order_status, l.id as line from public.part_items p join public.quotation_lines l on l.part_item_id = p.id and l.is_active where p.job_id = $1 and p.stock_item_id = $2 and p.is_active", [JOB, stockId]))[0], 60);
  check("C1: FROM OUR STOCK: the stock cost (25.00), nothing ordered, on the quotation", !!stock && stock.supplier === "Our stock" && stock.cost === 25 && stock.order_status === "none", JSON.stringify(stock ?? {}));
  // D. Customer supplies it.
  w = await openChoice();
  await w.locator('[data-add-part-mode="customer"]').check();
  await w.locator("[data-customer-part-name]").fill("SPEAKER");
  await w.locator("[data-customer-part-save]").click();
  const cust = await until(async () => (await sql("select title, details, unit_price::float as price, source_key from public.quotation_lines where quotation_id = $1 and source_key = 'customer_supplied' and is_active", [Q.id]))[0], 40);
  check("D1: CUSTOMER SUPPLIES IT: no price, the no-warranty words", !!cust && cust.price === 0 && cust.details === "PART SUPPLIED BY CUSTOMER – NO WARRANTY ON THE PART", JSON.stringify(cust ?? {}));
  const desk = (await sql("select count(*)::int as n from public.part_requests where job_id = $1 and label ilike 'speaker%'", [JOB]))[0].n;
  check("D2: and it never reaches the parts desk", desk === 0);
  // E. Provisional amount.
  w = await openChoice();
  await w.locator('[data-add-part-mode="provisional"]').check();
  await w.locator("[data-provisional-amount]").fill("500");
  await w.locator("[data-provisional-save]").click();
  const prov = await until(async () => (await sql("select id, title, unit_price::float as price from public.quotation_lines where quotation_id = $1 and source_key = 'provisional' and is_active", [Q.id]))[0], 40);
  check("E1: PROVISIONAL: \"ADDITIONAL PARTS IF REQUIRED – UP TO AED 500.00\"", !!prov && prov.title === "ADDITIONAL PARTS IF REQUIRED – UP TO AED 500.00" && prov.price === 500, JSON.stringify(prov ?? {}));
  await go(adv.page, `${base}/jobs/${JOB}/quote/${Q.id}?v=2`);
  await shots(adv.page, null, "e-quotation-with-the-new-lines");
  // F. Approved: use the provisional amount.
  await sql("update public.quotations set status = 'approved', responded_at = now() where id = $1", [Q.id]);
  await sql("update public.jobs set status = 'waiting_parts', first_approval_at = coalesce(first_approval_at, now()) where id = $1", [JOB]);
  await go(adv.page, `${base}/jobs/${JOB}/quote/${Q.id}?v=3`);
  const box = adv.page.locator("[data-provisional-convert]");
  await box.waitFor({ timeout: 30000 });
  await box.locator("[data-provisional-use]").first().click();
  w = adv.page.locator("[data-add-part-choice]");
  await w.waitFor({ timeout: 20000 });
  check("F1: after approval only \"I have the price\" and \"From our stock\"; AED 500.00 left", (await w.locator("[data-add-part-mode]").count()) === 2 && /AED 500\.00 is left/.test(await text(w.locator("[data-convert-left]"))));
  await w.locator('[data-add-part-mode="own"]').check();
  await w.locator("[data-own-name]").fill("WIPER BLADE");
  await w.locator("[data-own-supplier]").fill("E2E Real Supplier");
  await w.locator("[data-own-cost]").fill("40");
  await w.locator("[data-own-sell]").fill("60");
  await shots(adv.page, w.locator("div").first(), "f-use-the-provisional-amount");
  await w.locator("[data-own-save]").click();
  const conv = await until(async () => (await sql("select order_status, client_key from public.part_items where job_id = $1 and description = 'WIPER BLADE' and is_active", [JOB]))[0], 40);
  check("F2: the converted part is Approved – to order for the parts desk (no new approval)", conv?.order_status === "to_order" && String(conv?.client_key ?? "").startsWith("prov:"), JSON.stringify(conv ?? {}));
  await go(adv.page, `${base}/jobs/${JOB}/quote/${Q.id}?v=4`);
  check("F3: AED 440.00 is left", /AED 440\.00 left of AED 500\.00/.test(await text(adv.page.locator("[data-provisional-convert]"))));
  // G. The bill: the money page's draft (before any proforma) shows the wiper blade, never the provisional line.
  await go(adv.page, `${base}/jobs/${JOB}/invoice`);
  const lines = await text(adv.page.locator("body"));
  check("G1: the bill shows WIPER BLADE from the provisional amount, not \"ADDITIONAL PARTS IF REQUIRED\"", /WIPER BLADE/i.test(lines) && !/ADDITIONAL PARTS IF REQUIRED/i.test(lines));
  await adv.browser.close();
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  if (stockId) await sql("update public.stock_items set is_active = false where id = $1", [stockId]).catch(() => null);
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
