// Proof for the evening list of 15 October 2026: an Our stock part priced after the quotation was sent lands on the next
// version (quote, PDF, link) and the advisor is told; the missing-parts check on Quotation complete; the parts desk's
// All cars and search; Parts adding or deleting parts at any time (an ordered part gets Return or Keep in stock);
// Revise quotation in the bottom bar and the header; Mark as declined as a small link; the declined job's two choices
// with an optional charge invoiced before gate-out, or a free gate-out.
// Run against `npx next dev -p 3100`:  node --env-file=.env.local tests/browser/test-l.mjs
import path from "node:path";
import { api, base, browserFor, cleanupDb, cookieHeader, go, makeChecks, projectRoot, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 18 * 60 * 1000).unref();
cleanupDb();

const until = async (fn, tries = 60, ms = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } return null; };
const afterSubmit = async (page) => { const before = page.url(); await page.waitForURL((u) => u.toString() !== before, { timeout: 30000 }).catch(() => null); await sleep(600); };
const shot = (page, name) => page.screenshot({ path: path.join(projectRoot, "tests", "browser", "shots", `${name}.png`) }).catch(() => null);
async function section(name, fn) {
  console.log(`\n== ${name}`);
  try { await fn(); } catch (e) { check(`${name}: no crash`, false, String(e?.message ?? e).slice(0, 300)); }
}
async function pdfText(buf) {
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  let text = "";
  for (let i = 0; i < doc.countPages(); i++) text += doc.loadPage(i).toStructuredText("preserve-whitespace").asText() + "\n";
  return text;
}
async function fetchAs(pathname, role) {
  const res = await fetch(`${base}${pathname}`, { headers: { cookie: await cookieHeader(role) } });
  return { status: res.status, buf: res.ok ? Buffer.from(await res.arrayBuffer()) : null };
}
const pageText = (html) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const supplierOption = async (sel, name) => sel.locator("option").evaluateAll((os, n) => (os.find((o) => (o.textContent ?? "").toLowerCase().startsWith(n.toLowerCase())) ?? {}).value ?? "", name);

let jobId = null;
let v1 = null;
let token = null;
let v2 = null;

/* ---------------- 1. Our stock part priced after the quotation was sent ---------------- */
await section("1 our stock part after sending", async () => {
  const seed = await api("/api/e2e/stage", { stage: "quote" });
  ({ jobId, quotationId: v1, token } = seed.json);
  const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0]?.id;
  await sql("update public.quotations set status = 'sent', sent_at = now(), sent_by = $2, completed_at = now() where id = $1", [v1, owner]);
  // Parts price the open request from our stock, after the quotation went out.
  const { browser, page } = await browserFor("parts", { viewport: { width: 1366, height: 900 } });
  await go(page, `${base}/parts/${jobId}`);
  const row = page.locator("[data-row-key]", { has: page.getByRole("button", { name: /^rear brake discs$/i }) }).first();
  await until(async () => ((await row.count()) ? 1 : null), 30, 500);
  check("1: the open request sits on the Parts page", (await row.count()) === 1);
  await row.locator("input[aria-label='Part number']").fill("E2E-DISC-1");
  await row.locator("input[aria-label='Part number']").press("Tab");
  await sleep(800);
  await row.locator("select[aria-label='Type']").selectOption("genuine");
  await row.locator("input[aria-label='List price']").fill("49");
  await row.locator("input[aria-label='List price']").press("Tab");
  await sleep(1200);
  const supSel = row.locator("select[aria-label='Supplier']");
  const stockVal = await supplierOption(supSel, "our stock");
  check("1: Our stock is a supplier choice", !!stockVal);
  await supSel.selectOption(stockVal);
  await sleep(800);
  await row.locator("select[aria-label='Availability']").selectOption({ label: "In stock" });
  const priced = await until(async () => { const r = (await sql("select id, cost_aed, supplier, availability from public.part_items where job_id = $1 and description ilike 'rear brake discs' and is_active", [jobId]))[0]; return Number(r?.cost_aed) === 49 && /our stock/i.test(r?.supplier ?? "") ? r : null; }, 40, 500);
  check("1: the part is priced at AED 49 from Our stock", !!priced, JSON.stringify(priced));
  // The change lands on the next version by itself; the sent one is replaced; the advisor is told.
  // The next version is made, filled, and the old one replaced, in that order: wait for the last step.
  const versions = await until(async () => { const r = await sql("select id, version, status from public.quotations where job_id = $1 and kind = 'quotation' order by version", [jobId]); return r.length >= 2 && r.find((q) => q.version === 1)?.status === "superseded" ? r : null; }, 40, 500);
  await sleep(1500);
  v2 = versions?.find((q) => q.version === 2)?.id ?? null;
  check("1/3: a priced part after sending starts version 2 as a draft, version 1 replaced", !!v2 && versions?.find((q) => q.version === 1)?.status === "superseded" && versions?.find((q) => q.version === 2)?.status === "draft", JSON.stringify(versions));
  // The new version is filled and totalled after it is made: wait for the line to carry its total.
  const line = v2 ? await until(async () => { const r = (await sql("select title, quantity, unit_cost, line_total from public.quotation_lines where quotation_id = $1 and is_active and part_item_id = $2", [v2, priced?.id]))[0]; return r && Number(r.line_total) > 0 ? r : null; }, 30, 500) : null;
  check("1: the Our stock part is on version 2 with its markup like any other part", !!line && Number(line.unit_cost) === 49 && Number(line.line_total) > 49, JSON.stringify(line));
  const ev = v2 ? await until(async () => (await sql("select note from public.quotation_events where quotation_id = $1 and event_type = 'parts_added' order by created_at desc limit 1", [v2]))[0] ?? null, 30, 500) : null;
  check("3: the quote history shows 'Parts added REAR BRAKE DISCS ×2'", /Parts added rear brake discs ×2/i.test(ev?.note ?? ""), ev?.note ?? "");
  const note = await until(async () => (await sql("select title, href from public.notifications where job_id = $1 and type = 'quote_revised_by_parts' order by created_at desc limit 1", [jobId]))[0] ?? null, 30, 500);
  check("3: the advisor gets 'Parts changed on J-xxx: send the revised quotation' with a one-tap link", /Parts changed on J-/.test(note?.title ?? "") && /send=1/.test(note?.href ?? ""), JSON.stringify(note));
  await browser.close();
  // Quote screen, PDF and link all carry the part.
  const pdf = await fetchAs(`/api/pdf/quotation/${v2}`, "owner");
  const text = pdf.buf ? await pdfText(pdf.buf) : "";
  check("1: the PDF of version 2 shows the Our stock part", pdf.status === 200 && /REAR BRAKE DISCS/.test(text));
  const linkBefore = pageText(await (await fetch(`${base}/quote/${token}`)).text());
  check("1: while version 2 is a draft the customer's link says it is being updated", /being updated/i.test(linkBefore));
  await sql("update public.quotations set status = 'sent', sent_at = now(), sent_by = $2, completed_at = now() where id = $1", [v2, owner]);
  const v2tok = (await sql("select token from public.quotations where id = $1", [v2]))[0]?.token;
  // 29 October 2026: the old link says the quotation was updated and points to version 2, which opens on its own link.
  const oldLink = pageText(await (await fetch(`${base}/quote/${token}`)).text());
  const linkAfter = /This quotation has been updated/.test(oldLink) && v2tok ? pageText(await (await fetch(`${base}/quote/${v2tok}`)).text()) : oldLink;
  const pub = v2tok ? await fetch(`${base}/api/pdf/quote/${v2tok}`) : null;
  const pubText = pub && pub.ok ? await pdfText(Buffer.from(await pub.arrayBuffer())) : "";
  check("1: once sent, the customer's link opens version 2 and its PDF carries the part", /Updated on/.test(linkAfter) && /REAR BRAKE DISCS/.test(pubText), `link ${/Updated on/.test(linkAfter)} pdf ${pub?.status}`);
});

/* ---------------- 1b. The missing-parts check on Quotation complete ---------------- */
await section("1b missing-parts check", async () => {
  const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0]?.id;
  // A fresh draft (version 3) and a priced part slipped in with no line, as the bug had it.
  const r = await api("/api/e2e/sql", { sql: "select 1" });
  check("1b: sql route alive", r.status === 200);
  const { browser, page } = await browserFor("owner", { viewport: { width: 1366, height: 900 } });
  await go(page, `${base}/jobs/${jobId}/quote/${v2}`);
  await until(async () => ((await page.locator("[data-revise]").count()) ? 1 : null), 30, 500);
  await page.locator("[data-revise]").click();
  await page.waitForURL((u) => !u.toString().includes(v2), { timeout: 30000 }).catch(() => null);
  const v3 = page.url().match(/\/quote\/([0-9a-f-]{36})/)?.[1] ?? null;
  check("1b: version 3 opens as a draft", !!v3 && (await sql("select status from public.quotations where id = $1", [v3]))[0]?.status === "draft");
  const ghost = (await sql("insert into public.part_items (job_id, description, quantity, cost_aed, supplier, availability, confirm_status, confirmed_at, priced_at, created_by, updated_by) values ($1, 'E2e stock filter', 1, 30, 'Our Stock', 'in_stock', 'confirmed', now(), now(), $2, $2) returning id", [jobId, owner]))[0]?.id;
  await sql("update public.quotation_lines set markup_percent = 5 where quotation_id = $1 and line_type = 'part'", [v3]);
  await sql("update public.part_requests set status = 'rejected', removed_at = now(), removed_reason = 'E2e' where job_id = $1 and status = 'open'", [jobId]);
  await sql("update public.inspections set estimated_hours_manager = coalesce(estimated_hours_manager, estimated_hours, 2) where job_id = $1", [jobId]);
  await sql("update public.jobs set parts_pricing_done_at = now(), parts_pricing_reopened_at = null where id = $1", [jobId]);
  await page.reload();
  await until(async () => ((await page.locator("[data-labour-boxes]").count()) ? 1 : null), 30, 500);
  await page.locator("button", { hasText: /^Quotation complete$/ }).click();
  const markup = await until(async () => ((await page.locator("[data-markup-ask]").count()) ? 1 : null), 20, 500);
  if (await page.locator("[data-low-profit-send]").count()) await page.locator("[data-low-profit-send]").click();
  if (markup) await page.locator("[data-markup-continue]").click();
  await sleep(600);
  if (await page.locator("[data-low-profit-send]").count()) await page.locator("[data-low-profit-send]").click();
  const asked = await until(async () => ((await page.locator("[data-parts-ask]").count()) ? 1 : null), 30, 500);
  check("1b: 'Quotation complete' says '1 priced part is missing from the quote' and names it", !!asked && /1 priced part is missing/.test((await page.locator("[data-parts-ask]").textContent().catch(() => "")) ?? "") && /E2E STOCK FILTER/i.test((await page.locator("[data-parts-ask]").textContent().catch(() => "")) ?? ""), (await page.locator("[data-parts-ask]").textContent().catch(() => "no ask")) ?? "");
  await shot(page, "13-missing-part-check");
  if (asked) await page.locator("[data-parts-add]").click();
  const added = await until(async () => { const r = (await sql("select id from public.quotation_lines where quotation_id = $1 and part_item_id = $2 and is_active", [v3, ghost]))[0]; return r ? r : null; }, 30, 500);
  const done = await until(async () => { const r = (await sql("select completed_at from public.quotations where id = $1", [v3]))[0]; return r?.completed_at ? r : null; }, 30, 500);
  check("1b: one tap adds it and the quotation completes", !!added && !!done);
  v2 = v3;
  await browser.close();
});

/* ---------------- 2. The parts desk never loses a car ---------------- */
await section("2 parts desk all cars and search", async () => {
  const { browser, page } = await browserFor("parts", { viewport: { width: 1366, height: 900 } });
  await go(page, `${base}/parts`);
  check("2: 'All cars' lists the open car with its dots and status", (await page.locator(`[data-all-cars] [data-all-car='${jobId}']`).count()) === 1 && (await page.locator(`[data-all-cars] [data-all-car='${jobId}'] [data-step-dot]`).count()) === 5);
  check("2: the search box sits at the top of the parts desk", (await page.locator("[data-parts-search]").count()) === 1);
  for (const [what, q] of [["plate", "30303"], ["job number", "J-00"], ["VIN", "STAGE01"], ["customer name", "stage test"]]) {
    await go(page, `${base}/parts?q=${encodeURIComponent(q)}`);
    check(`2: search by ${what} finds the car`, (await page.locator(`[data-search-results] [data-all-car='${jobId}']`).count()) === 1);
  }
  await page.locator(`[data-search-results] [data-all-car='${jobId}']`).click();
  await page.waitForURL((u) => u.toString().includes(`/parts/${jobId}`), { timeout: 20000 }).catch(() => null);
  check("2: tapping a row opens the car's parts page", page.url().includes(`/parts/${jobId}`));
  // Every part handed over: the row turns green and stays. Gone out: it leaves the list but the search still finds it.
  await sql("update public.part_items set order_status = 'received', received_qty = coalesce(confirmed_quantity, quantity), issue_status = 'confirmed' where job_id = $1 and is_active", [jobId]);
  await go(page, `${base}/parts`);
  check("2: with every part handed over the row turns green and stays in the list", (await page.locator(`[data-all-cars] [data-all-car='${jobId}'][data-all-done='1']`).count()) === 1);
  await shot(page, "14-parts-desk-all-cars");
  await sql("update public.jobs set is_open = false, status = 'closed' where id = $1", [jobId]);
  await go(page, `${base}/parts?q=30303`);
  check("2: after gate-out the car leaves All cars but the search still finds it as gated out", (await page.locator(`[data-all-cars] [data-all-car='${jobId}']`).count()) === 0 && (await page.locator(`[data-search-results] [data-all-car='${jobId}'][data-gone='1']`).count()) === 1);
  await sql("update public.jobs set is_open = true, status = 'pending_customer_approval' where id = $1", [jobId]);
  await sql("update public.part_items set order_status = 'none', received_qty = 0, issue_status = default where job_id = $1 and is_active", [jobId]);
  await browser.close();
});

/* ---------------- 3. Parts delete parts: the quotation follows; an ordered part needs Return or Keep in stock ---------------- */
await section("3 parts delete", async () => {
  const { browser, page } = await browserFor("parts", { viewport: { width: 1366, height: 900 } });
  // Version 3 is complete; the next change from Parts lands on it (still a draft).
  await sql("update public.quotations set completed_at = null where id = $1", [v2]);
  // Pricing done locks the rows: Parts press Edit first (the same as the flag here).
  await sql("update public.jobs set parts_pricing_done_at = null, parts_pricing_reopened_at = null where id = $1", [jobId]);
  await go(page, `${base}/parts/${jobId}`);
  const row = page.locator("[data-row-key]", { hasText: /E2e stock filter/i }).first();
  const seen = await until(async () => ((await row.count()) ? 1 : null), 30, 500);
  check("3: the part Parts added sits on the Parts page", !!seen, (await page.locator("[data-row-key]").allTextContents()).map((s) => s.slice(0, 40)).join(" | "));
  const menuBtn = row.locator("button[aria-label='More for this part']");
  check("3: the row has its three-dot menu (Parts may edit at any time)", (await menuBtn.count()) === 1, `buttons: ${(await row.locator("button").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? e.textContent?.slice(0, 20)))).join(" | ")} · job ${JSON.stringify((await sql("select is_open, status, parts_pricing_done_at from public.jobs where id = $1", [jobId]))[0])}`);
  await menuBtn.first().click();
  await page.locator("button", { hasText: /^Remove: not needed$/ }).first().click();
  await until(async () => ((await page.locator("[data-remove-dialog]").count()) ? 1 : null), 20, 300);
  await page.locator("[data-remove-dialog] button", { hasText: /^Remove$/ }).first().click().catch(() => null);
  const anyChip = page.locator("[data-remove-dialog] button").filter({ hasNotText: /Remove|Cancel/ }).first();
  if (await page.locator("[data-remove-dialog]").count()) { if (await anyChip.count()) await anyChip.click(); await page.locator("[data-remove-dialog] button", { hasText: /^Remove$/ }).first().click(); }
  const gone = await until(async () => { const r = (await sql("select is_active from public.quotation_lines where quotation_id = $1 and part_item_id = (select id from public.part_items where job_id = $2 and description ilike 'E2e stock filter' limit 1)", [v2, jobId]))[0]; return r && r.is_active === false ? r : null; }, 30, 500);
  check("3: a part deleted by Parts leaves the draft quotation at once", !!gone, JSON.stringify(gone));
  const ev = (await sql("select note from public.quotation_events where quotation_id = $1 and event_type = 'parts_removed' order by created_at desc limit 1", [v2]))[0];
  check("3: the quote history shows 'Parts removed E2E STOCK FILTER'", /Parts removed e2e stock filter/i.test(ev?.note ?? ""), ev?.note ?? "");
  // An ordered part: the menu offers Return to supplier or Keep in stock.
  await sql("update public.part_items set order_status = 'ordered' where job_id = $1 and description ilike 'rear brake discs' and is_active", [jobId]);
  await page.reload();
  const row2 = page.locator("[data-row-key]", { has: page.getByRole("button", { name: /^rear brake discs$/i }) }).first();
  await until(async () => ((await row2.count()) ? 1 : null), 30, 500);
  await row2.locator("button[aria-label='More for this part']").first().click();
  await page.locator("button", { hasText: /choose its ending/ }).first().click();
  await until(async () => ((await page.locator("[data-remove-dialog]").count()) ? 1 : null), 20, 300);
  check("3: an ordered part cannot be deleted without choosing Return to supplier or Keep in stock", (await page.locator("[data-remove-return]").count()) === 1 && (await page.locator("[data-remove-stock]").count()) === 1);
  const chip = page.locator("[data-remove-dialog] button").filter({ hasNotText: /Return to supplier|Keep in stock|Cancel/ }).first();
  if (await chip.count()) await chip.click();
  await page.locator("[data-remove-stock]").click();
  const kept = await until(async () => { const r = (await sql("select not_needed_at, disposition from public.part_items where job_id = $1 and description ilike 'rear brake discs' limit 1", [jobId]))[0]; return r?.not_needed_at && r?.disposition === "stock" ? r : null; }, 30, 500);
  check("3: Keep in stock marks the ordered part not needed, kept in stock", !!kept, JSON.stringify(kept));
  await browser.close();
});

/* ---------------- 4 and 5. Revise placement, Mark as declined, the declined job's two choices ---------------- */
await section("4-5 revise, declined, gate-out", async () => {
  const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0]?.id;
  await sql("update public.quotations set status = 'sent', sent_at = now(), sent_by = $2, completed_at = now() where id = $1", [v2, owner]);
  const { browser, page } = await browserFor("owner", { viewport: { width: 1366, height: 900 } });
  await go(page, `${base}/jobs/${jobId}/quote/${v2}`);
  await until(async () => ((await page.locator("[data-revise-bar]").count()) ? 1 : null), 30, 500);
  check("4: 'Revise quotation' sits in the bottom bar next to Send again, and at the top next to Preview PDF", (await page.locator("[data-revise-bar]").count()) === 1 && (await page.locator("[data-revise]").count()) === 1 && (await page.locator("button", { hasText: /Send again/ }).count()) === 1);
  check("4: the separate Revise box is gone", (await page.locator("button", { hasText: /^Start version/ }).count()) === 0);
  const det = page.locator("[data-mark-declined]");
  check("4: 'Mark as declined' is a small link whose reason box only opens when tapped", (await det.count()) === 1 && !(await det.locator("textarea").isVisible()));
  const pad = await page.evaluate(() => parseInt(getComputedStyle(document.querySelector("main")).paddingBottom, 10));
  check("4: every page leaves room at the bottom for the fixed bar", pad >= 96, `padding-bottom ${pad}px`);
  await shot(page, "15-revise-in-bar");
  await det.locator("summary").click();
  await det.locator("textarea[name='reason']").fill("E2e: customer said no");
  await det.locator("button[type='submit']").click();
  await afterSubmit(page);
  await until(async () => ((await page.locator("[data-declined-next]").count()) ? 1 : null), 30, 500);
  check("5: after Mark as declined the two big choices show", (await page.locator("[data-declined-next] [data-declined-revise]").count()) === 1 && (await page.locator("[data-declined-next] [data-declined-gateout]").count()) === 1, `url ${decodeURIComponent(page.url()).slice(-120)} · ${JSON.stringify((await sql("select status from public.quotations where id = $1", [v2]))[0])} · job ${JSON.stringify((await sql("select is_open, declined_out_at from public.jobs where id = $1", [jobId]))[0])}`);
  await shot(page, "16-declined-choices");
  // Proceed to gate-out with a charge.
  await page.locator("[data-add-charge] summary").click();
  await page.locator("[data-charge-description]").fill("Diagnosis");
  await page.locator("[data-charge-amount]").fill("150");
  await page.locator("[data-declined-gateout]").click();
  await afterSubmit(page);
  const job = (await sql("select status, stage, declined_out_at, declined_charge_invoice_id from public.jobs where id = $1", [jobId]))[0];
  check("5: the job becomes 'Declined, car going out' (ready for gate-out)", job?.status === "ready" && !!job?.declined_out_at, JSON.stringify(job));
  const inv = (await sql("select number, kind, status, total_aed from public.invoices where job_id = $1 and is_active order by created_at desc limit 1", [jobId]))[0];
  check("5: the charge became a small tax invoice (AED 150 + VAT = 157.50) to be paid before gate-out", inv?.kind === "tax_invoice" && Number(inv?.total_aed) === 157.5, JSON.stringify(inv));
  check("5: open parts requests are cancelled", (await sql("select count(*)::int as n from public.part_requests where job_id = $1 and status = 'open' and is_active", [jobId]))[0]?.n === 0);
  const told = (await sql("select title from public.notifications where job_id = $1 and type = 'job_declined_out' order by created_at desc limit 1", [jobId]))[0];
  check("5: the workshop manager gets 'J-xxx declined: make sure the car is put back together and ready for collection'", /declined: make sure the car is put back together and ready for collection/.test(told?.title ?? ""), told?.title ?? "");
  check("5: the job card reads 'Declined, car going out'", /Declined, car going out/.test((await page.locator("[data-job-status]").textContent().catch(() => "")) ?? ""));
  await go(page, `${base}/jobs/${jobId}/gate-out`);
  const body = (await page.textContent("body")) ?? "";
  check("5: the gate-out page opens as normal and holds the car until the charge is paid", /Declined, car going out/.test(body) && /Balance due AED 157\.50/.test(body), body.match(/Balance due[^.]*\./)?.[0] ?? "");
  await browser.close();
});

await section("5b declined without a charge leaves free", async () => {
  const seed = await api("/api/e2e/stage", { stage: "quote" });
  const { jobId: j2, quotationId: q2 } = seed.json;
  const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0]?.id;
  await sql("update public.quotations set status = 'declined', sent_at = now(), sent_by = $2, responded_at = now() where id = $1", [q2, owner]);
  // The seed reuses the job of section 5: its declined-out mark is cleared for this fresh scenario.
  await sql("update public.jobs set declined_out_at = null, declined_charge_invoice_id = null where id = $1", [j2]);
  await sql("update public.payments set is_active = false where job_id = $1", [j2]);
  await sql("update public.invoices set is_active = false where job_id = $1", [j2]);
  const { browser, page } = await browserFor("owner", { viewport: { width: 1366, height: 900 } });
  await go(page, `${base}/jobs/${j2}/quote/${q2}`);
  await until(async () => ((await page.locator("[data-declined-gateout]").count()) ? 1 : null), 30, 500);
  await page.locator("[data-declined-gateout]").click();
  await afterSubmit(page);
  const job = (await sql("select status, declined_out_at from public.jobs where id = $1", [j2]))[0];
  const inv = (await sql("select count(*)::int as n from public.invoices where job_id = $1 and is_active", [j2]))[0];
  check("5b: without a charge no invoice is made and the car goes to gate-out", job?.status === "ready" && !!job?.declined_out_at && inv?.n === 0);
  await browser.close();
  const { browser: ab, page: ap } = await browserFor("owner", { viewport: { width: 1366, height: 900 } });
  await go(ap, `${base}/jobs/${j2}/gate-out`);
  check("5b: the gate-out says the car leaves free of charge and is not blocked", (await ap.locator("[data-declined-free]").count()) === 1 && !/Gate-out is blocked/.test((await ap.textContent("body")) ?? ""));
  await ab.close();
});

cleanupDb();
process.exit(summary() ? 1 : 0);
