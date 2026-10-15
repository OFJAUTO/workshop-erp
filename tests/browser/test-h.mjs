// Browser checks for the list of 14 October 2026: Parts pricing (Type width, "15 days" in the one box, Our stock,
// Pricing done that locks the rows with Edit and "Send updated prices", the green Priced chip), the PDF import,
// the quotation editor (estimate hours, labour discount, commission, markup rules), the customer PDF with nothing
// internal on it, the LPO flow (Send LPO for approval, one approval, supplier LPOs with Copy / PDF / Ordered,
// arrival dates, one date changed with a tap, "All parts here by"), commissions on the monthly report with Mark
// paid, the inspection photo icons, the viewer and the X, the Saved tick, and the sidebar logo.
// Run against `npx next dev -p 3100`:  node --env-file=.env.local tests/browser/test-h.mjs
import fs from "node:fs";
import path from "node:path";
import { api, base, browserFor, browserForId, cleanupDb, cookieHeader, go, makeChecks, projectRoot, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 20 * 60 * 1000).unref();
cleanupDb();

const JOB = "22222222-0000-4000-8000-00000000e303";
const PA = "22222222-0000-4000-8000-00000000e306";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");
const scratchPng = path.join(projectRoot, "tests", "browser", "e2e-dot.png");
fs.writeFileSync(scratchPng, PNG);

async function section(name, fn) {
  console.log(`\n== ${name}`);
  try {
    await fn();
  } catch (e) {
    check(`${name}: no crash`, false, String(e?.message ?? e).slice(0, 300));
  }
}
const until = async (fn, tries = 60, ms = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } return null; };
const dubaiPlus = async (days) => (await sql(`select to_char((now() at time zone 'Asia/Dubai')::date + ${days}, 'YYYY-MM-DD') as d`))[0]?.d;
/** Waits for the redirect after a form submit: the address must change (the old one may already carry a message). */
const afterSubmit = async (page) => { const before = page.url(); await page.waitForURL((u) => u.toString() !== before && /message=|error=/.test(u.toString()), { timeout: 30000 }).catch(() => null); await sleep(800); };
const urlText = (page) => decodeURIComponent(page.url());
/** The words of a PDF, read with mupdf (the same reader the import uses). */
async function pdfText(buf) {
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  let text = "";
  for (let i = 0; i < doc.countPages(); i++) text += doc.loadPage(i).toStructuredText("preserve-whitespace").asText() + "\n";
  return text;
}
async function fetchPdf(pathname, role) {
  const res = await fetch(`${base}${pathname}`, { headers: { cookie: await cookieHeader(role) } });
  return { status: res.status, buf: res.ok ? Buffer.from(await res.arrayBuffer()) : null };
}

/* ---------------- A. Parts pricing and the PDF import ---------------- */
await section("A pricing table and PDF import", async () => {
  const seed = await api("/api/e2e/stage", { stage: "quote" });
  const { jobId, quotationId } = seed.json;
  const { browser, page } = await browserFor("parts", { viewport: { width: 1366, height: 900 } });

  // The PDF import: four lines over two pages, totals left out.
  await go(page, `${base}/parts/${jobId}/import`);
  check("2: Upload PDF is the fourth way in", (await page.locator("[data-way='pdf']").count()) === 1);
  await page.locator("[data-way='pdf']").click();
  await page.locator("[data-pdf-input]").setInputFiles(path.join(projectRoot, "docs", "supplier-pdf-sample.pdf"));
  const n = await until(async () => { const k = await page.locator("[data-import-line]").count(); return k ? k : null; }, 60, 500);
  const texts = await page.locator("[data-import-line]").allTextContents();
  check("2: the PDF reads 4 part lines over its two pages", n === 4, `${n} lines: ${texts.map((t) => t.slice(0, 40)).join(" || ")}`);
  check("2: totals and page footers are never lines", !texts.some((t) => /Net Amount|Total AED|Page 2/.test(t)));
  check("2: the lines add up to the PDF's Net Amount", /✓/.test((await page.locator("[data-totals-check]").textContent().catch(() => "")) ?? ""), (await page.locator("[data-totals-check]").textContent().catch(() => "")) ?? "");
  check("2: availability sits in its own column (no availability words inside the names)", !texts.some((t) => /Brake pad set front \d/.test(t)));

  await go(page, `${base}/parts/${jobId}`);
  const row = page.locator("[data-row-key]", { hasText: /front brake pads/i }).first();
  // 7. The Type dropdown is wide enough to read.
  const typeW = await row.locator("select[aria-label='Type']").evaluate((el) => el.getBoundingClientRect().width);
  check("7: the Type dropdown is at least 100px wide at 1366", typeW >= 100, `${Math.round(typeW)}px`);

  // 8. Other… → 15 → the one box says "15 days".
  await row.locator("select[aria-label='Availability']").selectOption("other");
  await row.locator("input[aria-label='Days until it arrives']").fill("15");
  await page.keyboard.press("Tab");
  await sleep(300);
  const shown = await row.locator("select[aria-label='Availability']").evaluate((s) => s.options[s.selectedIndex]?.textContent ?? "");
  check("8: the availability box shows '15 days' with no second box", shown === "15 days" && (await row.locator("input[aria-label='Days until it arrives']").count()) === 0, shown);
  const d15 = await dubaiPlus(15);
  const saved15 = await until(async () => { const r = (await sql("select delivery_date::text as d from public.part_items where id = $1", [PA]))[0]; return r?.d === d15 ? r : null; }, 30, 500);
  check("8: the delivery date saved as today + 15", !!saved15, `${d15}`);

  // Our stock on the request row.
  const req = page.locator("[data-row-key]", { hasText: /rear brake discs/i }).first();
  await req.locator("input[aria-label='Part number']").fill("E2E-DISC");
  await req.locator("select[aria-label='Type']").selectOption("genuine");
  await req.locator("input[aria-label='Cost before VAT']").fill("150");
  await req.locator("select[aria-label='Supplier']").selectOption("__stock");
  await page.keyboard.press("Tab");
  const stock = await until(async () => { const r = (await sql("select supplier, availability from public.part_items where job_id = $1 and description ilike 'rear brake discs' and is_active", [jobId]))[0]; return (r?.supplier ?? "").toLowerCase() === "our stock" && r?.availability === "in_stock" ? r : null; }, 30, 500);
  check("17: 'Our stock' as the supplier saves In stock (no LPO later)", !!stock, stock ? JSON.stringify(stock) : `${JSON.stringify(await sql("select description, supplier, availability from public.part_items where job_id = $1 and is_active", [jobId]))} · ${await req.locator("[data-status-line]").textContent()}`);
  await sleep(1200);

  // 6. Pricing done locks the rows; Edit reopens; Send updated prices tells the advisor.
  await go(page, `${base}/parts/${jobId}`);
  const btn = page.locator("[data-pricing-bar] button", { hasText: /^Pricing done$/ });
  check("6: the bar offers Pricing done once every row is priced", (await btn.count()) === 1, await page.locator("[data-pricing-bar]").textContent());
  await btn.click();
  if (await page.locator("[data-pricing-bar] button", { hasText: /^Send what you have$/ }).count()) { console.log("   (rows still open: " + (await page.locator("[data-bar-text]").textContent()) + ")"); await page.locator("[data-pricing-bar] button", { hasText: /^Send what you have$/ }).click(); }
  await afterSubmit(page);
  check("6: Pricing done turns green and locks the rows", (await page.locator("[data-pricing-locked]").count()) === 1 && (await page.locator("[data-pricing-edit]").count()) === 1 && (await row.locator("input[aria-label='Part number']").count()) === 0 && (await page.locator("[data-add-part]").count()) === 0, urlText(page).slice(-100));
  const notifiedDone = (await sql("select count(*)::int as n from public.notifications where job_id = $1 and title like 'Parts pricing done%'", [jobId]))[0]?.n ?? 0;
  check("6: the advisor is told Pricing done", notifiedDone >= 1);
  // The job board shows Priced.
  const { browser: ob, page: op } = await browserFor("owner", { viewport: { width: 1366, height: 900 } });
  await go(op, `${base}/dashboard`);
  const card = op.locator("a[href='/jobs/" + jobId + "']").first();
  check("6: the job board shows a green Priced chip on the car", /Priced/.test((await card.textContent().catch(() => "")) ?? ""), ((await card.textContent().catch(() => "")) ?? "").slice(0, 160));
  // Edit → change a price → Send updated prices.
  await page.locator("[data-pricing-edit]").click();
  await afterSubmit(page);
  const reopenedUi = await until(async () => ((await page.locator("[data-pricing-editing]").count()) === 1 && (await page.locator("[data-pricing-bar] button", { hasText: /^Send updated prices$/ }).count()) === 1 && (await row.locator("input[aria-label='Part number']").count()) === 1 ? 1 : null), 30, 500);
  check("6: Edit reopens the rows and the bar offers Send updated prices", !!reopenedUi, `${urlText(page).slice(-90)} · editing ${await page.locator("[data-pricing-editing]").count()} · buttons ${JSON.stringify(await page.locator("[data-pricing-bar] button").allTextContents())} · pn inputs ${await row.locator("input[aria-label='Part number']").count()}`);
  await row.locator("input[aria-label='Cost before VAT']").fill("210");
  await page.keyboard.press("Tab");
  const changed = await until(async () => { const r = (await sql("select cost_aed from public.part_items where id = $1", [PA]))[0]; return Number(r?.cost_aed) === 210 ? r : null; }, 30, 500);
  check("6: a changed price saves while editing", !!changed);
  // With a row still open the first tap outlines it and the second tap sends anyway.
  const beforeSend = page.url();
  await page.locator("[data-pricing-bar] button", { hasText: /^Send updated prices$/ }).first().click();
  await sleep(800);
  if (page.url() === beforeSend && (await page.locator("[data-pricing-bar] button", { hasText: /^Send updated prices$/ }).count())) await page.locator("[data-pricing-bar] button", { hasText: /^Send updated prices$/ }).first().click();
  await page.waitForURL((u) => u.toString() !== beforeSend && /message=|error=/.test(u.toString()), { timeout: 30000 }).catch(() => null);
  await sleep(800);
  const changedNote = await until(async () => { const r = (await sql("select title, body from public.notifications where job_id = $1 and title like 'Prices changed on%' order by created_at desc limit 1", [jobId]))[0]; return r ?? null; }, 20, 500);
  check("6: the advisor is told 'Prices changed on [car]'", !!changedNote && /Prices changed on .*30303/i.test(changedNote.title), changedNote?.title);
  check("6: the rows are locked again after Send updated prices", (await page.locator("[data-pricing-locked]").count()) === 1 && /Updated prices sent/.test(urlText(page)));
  const reopened = (await sql("select parts_pricing_reopened_at from public.jobs where id = $1", [jobId]))[0];
  check("6: the reopened flag is cleared", reopened?.parts_pricing_reopened_at === null);

  /* ---------------- B. The quotation editor (owner) ---------------- */
  console.log("\n== B quotation editor");
  await go(op, `${base}/jobs/${jobId}/quote/${quotationId}`);
  const est = op.locator("[data-estimate]").first();
  check("9: the labour line has an est. box", (await est.count()) === 1);
  if (await est.count()) {
    await est.fill("3");
    await op.keyboard.press("Tab");
    const h = await until(async () => { const r = (await sql("select hours_estimate from public.quotation_lines where quotation_id = $1 and line_type = 'labour' and is_active limit 1", [quotationId]))[0]; return Number(r?.hours_estimate) === 3 ? r : null; }, 30, 500);
    check("9: the estimate saves on the line", !!h);
    await sleep(800);
    check("9: the internal box says 'Labour at cost (… estimate × AED …)'", /Labour at cost \(.*estimate/.test((await op.locator("[data-labour-cost-label]").textContent().catch(() => "")) ?? ""), (await op.locator("[data-labour-cost-label]").textContent().catch(() => "")) ?? "");
  }
  // 14. Discount: 10% on the labour.
  await op.locator("[data-labour-discount]").click();
  await op.locator("[data-labour-discount-dialog] input[aria-label='Discount amount']").fill("10");
  await op.locator("[data-labour-discount-dialog] button", { hasText: /^Apply$/ }).click();
  const disc = await until(async () => { const r = (await sql("select discount_kind, discount_value, discount_percent from public.quotations where id = $1", [quotationId]))[0]; return r?.discount_kind === "percent" && Number(r?.discount_value) === 10 ? r : null; }, 30, 500);
  check("14: the labour discount saves as 10% (percent kind)", !!disc, JSON.stringify(disc));
  await sleep(800);
  check("14: the summary shows 'Labour discount (10%)' in bold green", /Labour discount \(10%\)/.test((await op.locator("[data-labour-discount-row]").textContent().catch(() => "")) ?? "") && /text-green/.test((await op.locator("[data-labour-discount-row]").getAttribute("class").catch(() => "")) ?? ""));
  // 13. Commission: a typed name joins the list, AED 100.
  await op.locator("[data-commission-box] button", { hasText: /\+ Name/ }).click();
  await op.locator("input[aria-label='Commission to']").fill("E2e Agent");
  await op.keyboard.press("Enter");
  await until(async () => ((await op.locator("[data-commission-amount]").count()) ? 1 : null), 20, 300);
  await sleep(1500);
  await op.locator("[data-commission-amount]").fill("100");
  await op.keyboard.press("Tab");
  const com = await until(async () => { const r = (await sql("select commission_to, commission_kind, commission_value, commission_aed from public.quotations where id = $1", [quotationId]))[0]; return r?.commission_to === "E2e Agent" && Number(r?.commission_aed) === 100 ? r : null; }, 40, 500);
  check("13: the commission saves (E2e Agent, AED 100) and counts as cost", !!com, JSON.stringify(com));
  const people = (await sql("select value from public.settings where key = 'commission_people'"))[0]?.value;
  check("13: the name joined the Settings list", Array.isArray(people) && people.includes("E2e Agent"), JSON.stringify(people));
  // 12. Markup: 500% asks once; the owner may go below 5%.
  // The first part row on the screen and the same line in the database (several part lines exist after the import).
  const firstPartRow = op.locator("[data-part-line]").first();
  const firstLineId = ((await firstPartRow.getAttribute("id").catch(() => "")) ?? "").replace(/^item-line-/, "");
  const markupBox = firstPartRow.locator("input[aria-label*='arkup']").first();
  if (await markupBox.count()) {
    await markupBox.fill("500");
    await op.keyboard.press("Tab");
    const dlg = await until(async () => ((await op.locator("[data-confirm-markup]").count()) ? 1 : null), 30, 500);
    check("12: a markup of 500% is asked about once ('Yes, keep it' / 'Change')", !!dlg);
    if (dlg) {
      await op.locator("[data-confirm-markup]").click();
      const kept = await until(async () => { const r = (await sql("select markup_percent, markup_confirmed from public.quotation_lines where id = $1", [firstLineId]))[0]; return Number(r?.markup_percent) === 500 && r?.markup_confirmed ? r : null; }, 30, 500);
      check("12: 'Yes, keep it' keeps 500% and never asks again", !!kept, JSON.stringify(kept));
    }
    await markupBox.fill("2");
    await op.keyboard.press("Tab");
    const low = await until(async () => { const r = (await sql("select markup_percent from public.quotation_lines where id = $1", [firstLineId]))[0]; return Number(r?.markup_percent) === 2 ? r : null; }, 30, 500);
    check("12: the owner may go below the 5% minimum", !!low);
  } else check("12: markup box found", false, "no input with 'arkup' in its label");
  // The settings floor is 5%, no maximum.
  const floor = (await sql("select value from public.settings where key = 'parts_min_markup_percent'"))[0]?.value;
  check("12: the minimum parts markup setting is 5%", Number(floor) === 5, String(floor));
  // The staff PDF of the quotation: nothing internal on it.
  const pdf = await fetchPdf(`/api/pdf/quotation/${quotationId}`, "owner");
  check("16: the quotation PDF renders", pdf.status === 200 && !!pdf.buf, `${pdf.status}`);
  if (pdf.buf) {
    const t = await pdfText(pdf.buf);
    check("14/16: the PDF shows the labour discount line and the sections", /labour discount/i.test(t) && /labour and services/i.test(t) && /parts/i.test(t), t.replace(/\s+/g, " ").slice(0, 200));
    check("13/AT THE END: no commission, no E2e Agent, no 'our cost', no staff name on the customer PDF", !/commission|e2e agent|our cost|prepared by/i.test(t));
  }
  await browser.close();
  await ob.close();
});

/* ---------------- C. The LPO flow ---------------- */
await section("C LPO flow", async () => {
  const seed = await api("/api/e2e/stage", { stage: "approved" });
  const { jobId, quotationId: approvedQid } = seed.json;
  await sql("update public.part_items set supplier = 'E2e Supplier' where id = $1", [PA]);
  const { browser, page } = await browserFor("parts", { viewport: { width: 1366, height: 900 } });
  await go(page, `${base}/parts/${jobId}`);
  const body = (await page.textContent("body")) ?? "";
  check("17: no 'Planning: the approved parts' screen; a short summary and one button instead", !/Planning: the approved parts/.test(body) && (await page.locator("[data-lpo-card]").count()) === 1 && (await page.locator("[data-send-lpo]").count()) === 1, ((await page.locator("[data-lpo-summary]").textContent().catch(() => "")) ?? "").slice(0, 160));
  check("17: the summary names the parts to order", /1 to order/.test((await page.locator("[data-lpo-summary]").textContent()) ?? ""));
  await page.locator("[data-send-lpo]").click();
  await afterSubmit(page);
  const main = (await sql("select id, number, kind, status, total_cost_aed from public.purchase_orders where job_id = $1 and kind = 'main' and is_active order by created_at desc limit 1", [jobId]))[0];
  check("17: one main LPO waits for approval", !!main && main.status === "pending_approval" && /^LPO-\d{5}$/.test(main.number), JSON.stringify(main));
  const pa1 = (await sql("select po_id from public.part_items where id = $1", [PA]))[0];
  check("17: the part points at the main LPO", pa1?.po_id === main?.id);
  check("17: the owner is told with one tap to approve", ((await sql("select count(*)::int as n from public.notifications where job_id = $1 and title like 'LPO to approve%'", [jobId]))[0]?.n ?? 0) >= 1);
  const cardAfter = await until(async () => ((await page.locator("[data-lpo-card]").count()) ? await page.textContent("[data-lpo-card]") : null), 20, 500);
  check("17: the Parts page shows the LPO waiting", /waiting for approval/i.test(cardAfter ?? ""), cardAfter ? cardAfter.slice(0, 120) : `no card · ${urlText(page).slice(-80)} · ${((await page.textContent("body")) ?? "").replace(/\s+/g, " ").slice(0, 200)}`);

  // The owner approves: grouped by supplier with a subtotal each and a grand total.
  const { browser: ob, page: op } = await browserFor("owner", { viewport: { width: 1366, height: 900 } });
  await go(op, `${base}/parts/orders/${main.id}`);
  check("17: the main LPO is grouped by supplier with a subtotal and a grand total", (await op.locator("[data-lpo-group]").count()) === 1 && (await op.locator("[data-lpo-subtotal]").count()) === 1 && /200\.00/.test((await op.locator("[data-lpo-grand-total]").textContent()) ?? ""));
  if (await op.locator("textarea[name='override_reason']").count()) await op.locator("textarea[name='override_reason']").fill("E2e test: deposit override");
  await op.locator("button", { hasText: /^Approve$/ }).click();
  await afterSubmit(op);
  const sub = (await sql("select id, number, status, parent_id, supplier_name, verify_token from public.purchase_orders where job_id = $1 and kind = 'supplier' and is_active order by created_at desc limit 1", [jobId]))[0];
  check("17: one Approve makes the supplier LPO numbered from the main one (LPO-xxxxx-1)", !!sub && sub.number === `${main.number}-1` && sub.status === "approved" && sub.parent_id === main.id && sub.supplier_name === "E2e Supplier", JSON.stringify(sub));
  const pa2 = (await sql("select po_id from public.part_items where id = $1", [PA]))[0];
  check("17: the part now points at its supplier LPO", pa2?.po_id === sub?.id);
  check("17: Parts are told the LPO is approved", ((await sql("select count(*)::int as n from public.notifications where job_id = $1 and title like '%approved%supplier LPO%'", [jobId]))[0]?.n ?? 0) >= 1);
  // The supplier copy: part number, name, quantity, our price and the VIN; never the customer.
  const lpoPdf = await fetchPdf(`/api/pdf/lpo/${sub.verify_token}`, "parts");
  check("17: the supplier PDF opens", lpoPdf.status === 200 && !!lpoPdf.buf, `${lpoPdf.status}`);
  if (lpoPdf.buf) {
    const t = await pdfText(lpoPdf.buf);
    check("17: the supplier PDF carries the part number, the name, the VIN and our price", /PAD-STAGE-1/i.test(t) && /front brake pads/i.test(t) && /WBA1234567STAGE01/i.test(t) && /200\.00/.test(t), t.replace(/\s+/g, " ").slice(0, 200));
    check("17: the supplier PDF never names the customer or shows a selling price", !/stage test customer/i.test(t) && !/300\.00/.test(t));
  }
  // Parts: the card with Copy, PDF and Ordered.
  await go(page, `${base}/parts/${jobId}`);
  const cardSel = `[data-supplier-lpo='${sub.number}']`;
  check("17: the Parts page shows one card per supplier LPO with Copy, PDF and Ordered", (await page.locator(cardSel).count()) === 1 && (await page.locator(`${cardSel} [data-lpo-copy]`).count()) === 1 && (await page.locator(`${cardSel} [data-lpo-pdf]`).count()) === 1 && (await page.locator(`${cardSel} [data-lpo-ordered]`).count()) === 1);
  await page.locator(`${cardSel} [data-lpo-ordered]`).click();
  await afterSubmit(page);
  const d3 = await dubaiPlus(3);
  const ordered = (await sql("select p.order_status, p.expected_date::text as expected, po.status as po_status, j.plan_parts_done_at, j.plan_parts_ready_date::text as ready from public.part_items p join public.purchase_orders po on po.id = p.po_id join public.jobs j on j.id = p.job_id where p.id = $1", [PA]))[0];
  check("17: Ordered computes the arrival date from the availability given at pricing (3 days)", ordered?.po_status === "ordered" && ordered?.order_status === "ordered" && ordered?.expected === d3, JSON.stringify(ordered));
  check("17: the job's Parts step is done with 'All parts here by' that date", !!ordered?.plan_parts_done_at && ordered?.ready === d3, JSON.stringify(ordered));
  check("17: the workshop manager is told to plan the work", ((await sql("select count(*)::int as n from public.notifications where job_id = $1 and title like 'Plan the work%'", [jobId]))[0]?.n ?? 0) >= 1);
  check("17: the card shows the expected date", /Expected/.test((await page.locator(`${cardSel} [data-part-date]`).textContent().catch(() => "")) ?? ""));
  // One part's date changed with a tap.
  const d5 = await dubaiPlus(5);
  await page.locator(`${cardSel} [data-part-date]`).click();
  await page.locator(`${cardSel} input[name='date']`).fill(d5);
  await page.locator(`${cardSel} button`, { hasText: /^Save$/ }).click();
  await afterSubmit(page);
  const moved = await until(async () => { const r = (await sql("select p.expected_date::text as expected, j.plan_parts_ready_date::text as ready from public.part_items p join public.jobs j on j.id = p.job_id where p.id = $1", [PA]))[0]; return r?.ready === d5 ? r : null; }, 30, 500) ?? (await sql("select p.expected_date::text as expected, j.plan_parts_ready_date::text as ready from public.part_items p join public.jobs j on j.id = p.job_id where p.id = $1", [PA]))[0];
  check("17: a part's date changes with a tap and 'All parts here by' follows", moved?.expected === d5 && moved?.ready === d5, JSON.stringify(moved));
  await go(op, `${base}/jobs/${jobId}`);
  check("17: the job card's planning shows 'All parts here by'", /All parts here by/.test((await op.textContent("body")) ?? ""));
  // The LPO list: the main one is not listed twice once approved.
  await go(op, `${base}/parts/orders`);
  const listBody = (await op.textContent("body")) ?? "";
  check("17: the LPO list shows the supplier LPO and not the approved main one", listBody.includes(sub.number) && !new RegExp(`${main.number}(?!-)`).test(listBody.replace(sub.number, "")));

  /* ---------------- D. Commissions on the monthly report ---------------- */
  console.log("\n== D commissions");
  await sql("update public.quotations set commission_to = 'E2e Agent', commission_kind = 'aed', commission_value = 100, commission_aed = 100, commission_paid_at = null where id = $1", [approvedQid]);
  await go(op, `${base}/reports/monthly`);
  const crow = op.locator("[data-commission='Q-STAGE-1']");
  check("13: the monthly summary lists the commission as Not paid", (await crow.count()) === 1 && /Not paid/.test((await crow.textContent().catch(() => "")) ?? "") && /E2e Agent/.test((await crow.textContent().catch(() => "")) ?? ""), ((await crow.textContent().catch(() => "")) ?? "").slice(0, 160));
  // The PDF carries the same list (read while the commission is still unpaid: this car is not gated out this month, so once paid it waits for its gate-out month).
  const monthly = await fetchPdf(`/api/pdf/monthly?month=${new Date().toISOString().slice(0, 7)}`, "owner");
  const monthlyText = monthly.buf ? await pdfText(monthly.buf) : "";
  check("13: the monthly PDF renders with the commissions", monthly.status === 200 && /commissions/i.test(monthlyText) && /E2e Agent/i.test(monthlyText), `${monthly.status} · ${monthlyText.replace(/\s+/g, " ").slice(0, 120)}`);
  if (await crow.count()) {
    await crow.locator("[data-mark-paid]").click();
    await afterSubmit(op);
    const paid = await until(async () => { const r = (await sql("select commission_paid_at, commission_paid_by from public.quotations where id = $1", [approvedQid]))[0]; return r?.commission_paid_at ? r : null; }, 20, 500);
    check("13: Mark paid is one tap and is written down", !!paid?.commission_paid_at && !!paid?.commission_paid_by && /Marked paid/.test(urlText(op)), `${JSON.stringify(paid)} · ${urlText(op).slice(-80)}`);
  }
  // 18. The sidebar logo: centred and a quarter bigger.
  const logo = op.locator("aside img[alt='OFJ Automotive']").first();
  const cls = (await logo.getAttribute("class")) ?? "";
  const centred = await logo.evaluate((el) => getComputedStyle(el.parentElement.parentElement).justifyContent);
  check("18: the sidebar logo is bigger (h-11 / md:h-15) and centred", /h-11/.test(cls) && /md:h-15/.test(cls) && centred === "center", `${cls} · ${centred}`);
  await browser.close();
  await ob.close();
});

/* ---------------- E. Inspection photos ---------------- */
await section("E inspection photos and viewer", async () => {
  const seed = await api("/api/e2e/stage", { stage: "inspection" });
  const { jobId, technicianId } = seed.json;
  // The pre-scan gate would keep every button disabled until a scan is uploaded; it is off for this test and put back after.
  const gateBefore = (await sql("select value from public.settings where key = 'prescan_gate_enabled'"))[0]?.value;
  await sql("update public.settings set value = 'false'::jsonb where key = 'prescan_gate_enabled'");
  const { browser, page } = await browserForId(technicianId, { viewport: { width: 1024, height: 1366 } });
  await go(page, `${base}/my-jobs/${jobId}`);
  const icons = await page.locator("[data-icon-media]").count();
  check("1: a camera icon on every tyre and on the AC vent reading", icons >= 5, `${icons} icons`);
  // The photo row of an item appears once the item is marked (Bad here); the first enabled Bad is tapped.
  const bad = page.locator("button:not([disabled])", { hasText: /^Bad$/ }).first();
  await bad.click();
  await until(async () => ((await page.locator("[data-inspection-media]", { hasText: "Gallery" }).count()) ? 1 : null), 30, 500);
  const media = page.locator("[data-inspection-media]", { hasText: "Gallery" }).first();
  const rowText = (await media.textContent().catch(() => "")) ?? "";
  check("4: one row of buttons: Photo, Gallery, Video, with the phone icon beside them", /Photo/.test(rowText) && /Gallery/.test(rowText) && /Video/.test(rowText) && (await page.locator("[data-phone-photo]").count()) >= 1, `${rowText.slice(0, 120)} · phone icons ${await page.locator("[data-phone-photo]").count()}`);
  // Upload one picture through Gallery, open the viewer, remove it with the X.
  // Gallery opens the file picker (the input is made on the tap), so the chooser is answered with the picture.
  const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 15000 }), media.locator("button", { hasText: /^Gallery$/ }).click()]);
  await chooser.setFiles(scratchPng);
  const thumb = await until(async () => ((await page.locator("[data-inspection-thumb]").count()) ? 1 : null), 80, 500);
  check("1: the photo shows as a thumbnail", !!thumb);
  if (thumb) {
    await page.locator("[data-inspection-thumb] button").first().click();
    const lb = await until(async () => ((await page.locator("[data-lightbox]").count()) ? 1 : null), 20, 300);
    check("3: the viewer opens on the same tab with 'n of m'", !!lb && /1 of 1/.test((await page.locator("[data-lightbox-count]").textContent().catch(() => "")) ?? ""));
    await page.keyboard.press("Escape");
    await sleep(400);
    check("3: Esc closes the viewer", (await page.locator("[data-lightbox]").count()) === 0);
    await page.locator("[data-inspection-thumb] [data-remove-file]").first().click();
    const gone = await until(async () => ((await page.locator("[data-inspection-thumb]").count()) === 0 ? 1 : null), 20, 500);
    const removed = (await sql("select count(*)::int as n from public.inspection_media m join public.inspections i on i.id = m.inspection_id where i.job_id = $1 and m.removed_at is not null", [jobId]))[0]?.n ?? 0;
    check("1: the X removes the photo (kept in the database as removed)", !!gone && removed >= 1, `${removed} removed`);
  }
  // 5. The Saved tick next to the item name, not over the Bad button (the item was tapped above).
  const tick = await until(async () => ((await page.locator("[data-item-saved]").count()) ? 1 : null), 20, 500);
  check("5: a small tick appears next to the item name after a tap", !!tick);
  const badBox = await bad.boundingBox();
  const tickBox = tick ? await page.locator("[data-item-saved]").first().boundingBox() : null;
  check("5: the tick does not cover the Bad button", !badBox || !tickBox || tickBox.y + tickBox.height <= badBox.y || tickBox.x + tickBox.width <= badBox.x || tickBox.x >= badBox.x + badBox.width, JSON.stringify({ badBox, tickBox }));
  await browser.close();
  if (gateBefore !== undefined) await sql("update public.settings set value = $1::jsonb where key = 'prescan_gate_enabled'", [JSON.stringify(gateBefore)]);
});

// Clean up: the settings list entry and the test rows.
await sql("update public.settings set value = (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements_text(value) x where x <> 'E2e Agent') where key = 'commission_people'").catch(() => null);
try { fs.unlinkSync(scratchPng); } catch {}
cleanupDb();
// A hard exit: a section that crashed may have left a browser open, and an idle process would fire the 20-minute clean-up while another suite runs.
process.exit(summary() ? 1 : 0);
