// Browser tests for the first-day fixes, against the local server (npx next dev -p 3100) with E2E_SECRET.
import { fileURLToPath } from "node:url";
import { MANAGER_MECH, api, base, browserFor, browserForId, cleanupDb, loginCookies, sql } from "./pw-lib.mjs";
const BIG = fileURLToPath(new URL("./big.png", import.meta.url));
cleanupDb();

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const only = process.argv[2] ?? "";
setTimeout(() => { console.log("TIMEOUT: stopping"); process.exit(2); }, 12 * 60 * 1000).unref();
const go = async (page, url) => { await page.goto(url, { waitUntil: "load" }); await sleep(1500); };
const settle = async (page) => { await page.waitForLoadState("load"); await sleep(1500); };
const submitted = async (page) => { const before = page.url(); await page.waitForURL((u) => u.toString() !== before && /message=|error=/.test(u.toString()), { timeout: 25000 }).catch(() => null); await settle(page); };

async function section(name, fn) {
  if (only && !name.startsWith(only)) return;
  console.log(`\n== ${name}`);
  try { await fn(); } catch (e) { check(`${name}: no crash`, false, e.message.slice(0, 220)); }
}

/* ---------------- A1, A2, B3, B4: the technician's inspection ---------------- */
await section("A1-A2 inspection", async () => {
  const seed = await api("/api/e2e/stage", { stage: "inspection" });
  if (!seed.json?.jobId) throw new Error("seed: " + JSON.stringify(seed));
  const { jobId, technicianId, inspectionId } = seed.json;
  // The scan gate is on (B1): the technician has read the scan report, so the checklist is open.
  await sql("update public.inspections set scan_read_at = now() where id = $1", [inspectionId]);
  const { browser, page } = await browserForId(technicianId, { viewport: { width: 820, height: 1180 }, touch: true });
  await go(page, `${base}/my-jobs/${jobId}`);
  const text = await page.textContent("body");
  check("technician page opens with the checklist", /Tyres/i.test(text ?? ""), (text ?? "").slice(0, 60));
  check("scan gate step shown (B1)", /Scan report/i.test(text ?? ""));
  const front = page.locator("#item-m-tyre_size_front input");
  check("tyre size front in three boxes (D5)", (await front.count()) === 3, String(await front.count()));
  await front.nth(0).click();
  await page.keyboard.type("27540");
  await sleep(200);
  check("the cursor moves to the next box by itself (D5)", (await front.nth(1).inputValue()) === "40", `${await front.nth(0).inputValue()}/${await front.nth(1).inputValue()}`);
  await front.nth(2).fill("20");
  await sleep(1200);
  const savedSize = await sql("select measurements->>'tyre_size_front' as s from public.inspections where id = $1", [inspectionId]);
  check("tyre size saved as 275/40 R20 (D5)", savedSize[0]?.s === "275/40 R20", JSON.stringify(savedSize));
  const same = page.getByRole("button", { name: "Same as front" });
  check("Same as front button (D5)", (await same.count()) === 1);
  if (await same.count()) { await same.click(); await sleep(300); const rear = page.locator("#item-m-tyre_size_rear input"); check("rear = front (D5)", (await rear.nth(0).inputValue()) === "275" && (await rear.nth(2).inputValue()) === "20"); }
  const ov = page.locator("#item-m-tyre_size_rear input").nth(0);
  await ov.fill("999");
  await sleep(300);
  check("a width outside 135 to 355 turns red (D5)", /border-red/.test((await ov.getAttribute("class")) ?? ""));
  await ov.fill("275");
  const items = page.locator("[id^='item-'] button:has-text('BAD')");
  const n = await items.count();
  check("status buttons present", n > 5, String(n));
  const target = items.nth(Math.min(6, n - 1));
  await target.scrollIntoViewIfNeeded();
  await sleep(300);
  const before = await page.evaluate(() => window.scrollY);
  await target.tap();
  await sleep(3000);
  const after = await page.evaluate(() => window.scrollY);
  check("tapping BAD keeps the page where it was (A2)", Math.abs(after - before) < 120, `${before} → ${after}`);
  const chip = page.locator("button:has-text('Noise')").first();
  check("quick remark chip Noise (B3)", (await chip.count()) >= 1);
  if (await chip.count()) { await chip.tap(); await sleep(300); }
  const gallery = page.locator("input[type=file][accept*='image'][multiple]").first();
  check("gallery picker present (A1)", (await gallery.count()) >= 1);
  const mediaBefore = await page.locator("img[alt='Photo']").count();
  await gallery.setInputFiles(BIG);
  await page.waitForFunction((m) => document.querySelectorAll("img[alt='Photo']").length > m, mediaBefore, { timeout: 40000 }).catch(() => null);
  const mediaAfter = await page.locator("img[alt='Photo']").count();
  const err = await page.locator("p.text-red").allTextContents();
  check("photo uploaded from the gallery (A1)", mediaAfter > mediaBefore, err.join(" | ").slice(0, 160));
  const cam = page.locator("label:has-text('+ Photo')").first();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 5000 }).catch(() => null), cam.tap()]);
  check("+ Photo opens the camera chooser (A1)", !!chooser);
  const afterUpload = await page.evaluate(() => window.scrollY);
  check("page did not jump after the upload (A2)", afterUpload > 100, String(afterUpload));
  await browser.close();
  const rows = await sql("select kind, storage_path from public.inspection_media where inspection_id = $1 order by created_at desc limit 1", [inspectionId]);
  check("media row recorded as a jpg (A1)", /\.jpg$/.test(rows[0]?.storage_path ?? ""), JSON.stringify(rows[0] ?? null));
});

/* ---------------- A5, A6, B2: assignment with several technicians ---------------- */
await section("A5-A6 assignment", async () => {
  const seed = await api("/api/e2e/stage", { stage: "assign" });
  const { jobId } = seed.json;
  const { browser, page } = await browserForId(MANAGER_MECH);
  await go(page, `${base}/assign`);
  const chips = page.locator("input[type=checkbox][name=technician]");
  check("assign page lists technicians as chips (A5)", (await chips.count()) >= 2, String(await chips.count()));
  const radios = page.locator("input[type=radio][name=road_test]");
  const checked = await radios.evaluateAll((rs) => rs.filter((r) => r.checked).length);
  check("no road test choice pre-chosen (B2)", (await radios.count()) >= 3 && checked === 0, `${await radios.count()} radios, ${checked} checked`);
  check("No road test is a clear choice with a hint (B2)", /No road test/.test(await page.textContent("body")) && /inspection starts now/.test(await page.textContent("body")));
  await go(page, `${base}/jobs/${jobId}`);
  const card = page.locator("form:has(input[name=technician])").first();
  const boxes = card.locator("input[type=checkbox][name=technician]");
  const count = await boxes.count();
  check("job card assign form has chips", count >= 2, String(count));
  check("assign button enabled", !(await card.locator("button[type=submit]").isDisabled()), (await card.textContent() ?? "").match(/Blocked[^.]*./)?.[0] ?? "");
  await boxes.nth(0).check({ force: true });
  await boxes.nth(1).check({ force: true });
  await card.locator("input[type=radio][name=road_test][value=not_needed]").check({ force: true });
  await card.locator("button[type=submit]").click();
  await submitted(page);
  const body = await page.textContent("body");
  check("assigned with two technicians (A5)", /Assigned to [^.]*,[^.]*\. No road test/.test(body ?? ""), (body ?? "").match(/Assigned to[^.]*\.[^.]*\./)?.[0] ?? "");
  const onCar = page.locator("#technicians");
  check("Technicians on the car card (A6)", (await onCar.count()) === 1);
  check("one lead marked (A5)", (await onCar.locator("span:text-is('Lead')").count()) === 1, String(await onCar.locator("span:text-is('Lead')").count()));
  check("two technicians listed", (await onCar.locator("li").count()) === 2, String(await onCar.locator("li").count()));
  const techRows = await sql("select count(*)::int as n from public.job_technicians where job_id = $1 and left_at is null", [jobId]);
  check("two job_technicians rows (A5)", techRows[0]?.n === 2, JSON.stringify(techRows));
  await onCar.locator("button:has-text('Take off')").last().click();
  await submitted(page);
  check("Take off removes a technician (A6)", (await page.locator("#technicians li").count()) === 1, String(await page.locator("#technicians li").count()));
  const add = page.locator("#technicians button:has-text('+ ')").first();
  await add.click();
  await submitted(page);
  check("+ name puts a technician back (A6)", (await page.locator("#technicians li").count()) === 2, String(await page.locator("#technicians li").count()));
  const makeLead = page.locator("#technicians button:has-text('Make lead')").first();
  if (await makeLead.count()) {
    await makeLead.click();
    await submitted(page);
    const lead = await sql("select j.assigned_to = i.technician_id as same from public.jobs j join public.inspections i on i.job_id = j.id where j.id = $1", [jobId]);
    check("Make lead moves the inspection to the new lead (A6)", lead[0]?.same === true, JSON.stringify(lead));
  }
  await browser.close();
});

/* ---------------- A3, A4, C1, C3, D1, D2, B5: the quotation editor ---------------- */
await section("A3-A4 quotation", async () => {
  const seed = await api("/api/e2e/stage", { stage: "quote" });
  const { jobId, quotationId } = seed.json;
  const { browser, page } = await browserFor("owner");
  await go(page, `${base}/jobs/${jobId}/quote/${quotationId}`);
  const body = await page.textContent("body");
  // 11 October rule: the quotation is a plain labour list and a parts list; nothing from the report follows it.
  check("no request headings on the quotation (main rule, 11 Oct)", !/Request:/.test(body ?? ""), (body ?? "").match(/Request:[^·"]{0,40}/)?.[0] ?? "");
  check("no findings list or ratings on the quotation (main rule, 11 Oct)", !/not quoted|\bBAD\b|\bAVG\b/.test(body ?? "") && (await page.getByRole("button", { name: "Add to quotation" }).count()) === 0);
  const askBtn = page.getByRole("button", { name: "+ Add a part" }).first();
  await askBtn.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 200));
  await sleep(300);
  const y0 = await page.evaluate(() => window.scrollY);
  await askBtn.click();
  await page.getByPlaceholder(/Type to find a part/).fill("Rear brake discs set");
  await page.getByRole("button", { name: /as a custom part/ }).first().click();
  const sendBtn = page.getByRole("button", { name: "Done" }).first();
  await sendBtn.dblclick();
  await sleep(3000);
  const y1 = await page.evaluate(() => window.scrollY);
  check("page stays put after Ask Parts (A3)", Math.abs(y1 - y0) < 150, `${y0} → ${y1}`);
  const q = await sql("select count(*)::int as n from public.part_requests where job_id = $1 and label ilike 'Rear brake discs set'", [jobId]);
  check("double tap made exactly one part request (A4)", q[0]?.n === 1, JSON.stringify(q[0]));
  const hours = page.locator("input[aria-label='Hours']").first();
  check("hours box found (C1)", (await hours.count()) >= 1);
  if (await hours.count()) {
    await hours.fill("1.3");
    await hours.press("Tab");
    await sleep(1500);
    const hrs = await sql("select hours from public.quotation_lines where quotation_id = $1 and line_type = 'labour' and is_active order by position limit 1", [quotationId]);
    check("hours accept 0.1 steps (C1)", Number(hrs[0]?.hours) === 1.3, JSON.stringify(hrs));
  }
  // Remove sits behind the row's three-dot menu (F2).
  const more = page.locator("button[aria-label='More for this line']").last();
  await more.scrollIntoViewIfNeeded();
  await more.click();
  await sleep(300);
  const remove = page.getByRole("button", { name: "Remove" }).last();
  const y4 = await page.evaluate(() => window.scrollY);
  await remove.click();
  await sleep(3000);
  const y5 = await page.evaluate(() => window.scrollY);
  check("removing a line keeps the scroll (A3)", Math.abs(y5 - y4) < 400, `${y4} → ${y5}`);
  await browser.close();
  const { browser: b2, page: p2 } = await browserFor("parts");
  await go(p2, `${base}/parts/${jobId}`);
  check("VIN with Copy on the Parts screen (D1)", (await p2.getByRole("button", { name: "Copy the VIN" }).count()) >= 1);
  // "Not available" sits behind "Cannot supply this one?" on the request's row (E5).
  const cannot = p2.locator("summary:has-text('Cannot supply this one?')").first();
  if (await cannot.count()) { await cannot.click(); await sleep(300); }
  const na = p2.getByRole("button", { name: "Not available" }).first();
  check("Not available button (D2)", (await na.count()) >= 1);
  if (await na.count()) {
    await na.click();
    await p2.getByPlaceholder(/Note for the advisor/).fill("discontinued by the maker");
    await p2.getByRole("button", { name: "Confirm: not available" }).click();
    await submitted(p2);
    check("request marked not available (D2)", /Not available/.test(await p2.textContent("body")));
  }
  await b2.close();
  const { browser: b3, page: p3 } = await browserFor("owner");
  await go(p3, `${base}/jobs/${jobId}/quote/${quotationId}`);
  check("editor flags the part not available (D2)", /Not available from Parts/.test(await p3.textContent("body")));
  await go(p3, `${base}/jobs/${jobId}/inspection`);
  const rb = await p3.textContent("body");
  check("review page shows one compact checklist (B5)", /One line per item, Bad and Required first/.test(rb ?? "") && /tap to see them/.test(rb ?? ""));
  await b3.close();
});

/* ---------------- A8, F1, F2, C9, A7, E1: proforma, payments, tax invoice, customer pages ---------------- */
await section("F1 proforma", async () => {
  const seed = await api("/api/e2e/stage", { stage: "ready" });
  const inv = seed.json?.invoice;
  check("proforma prepared by itself when the car is Ready (F1)", inv?.kind === "proforma" && /^PRO-\d{5}$/.test(inv?.number ?? ""), JSON.stringify(inv));
  if (!inv) return;
  const { jobId } = seed.json;
  const html = await (await fetch(`${base}/invoice/${inv.token}`)).text();
  check("customer page says it is not a tax invoice (F1)", /This is not a tax invoice/.test(html));
  check("customer page shows Bank details (C9)", /Bank details/.test(html) && !/Bank transfer/.test(html));
  check("no staff names on the customer page (C6)", !/Prepared by|>Advisor</.test(html));
  const head = html.slice(0, html.indexOf("</head>"));
  check("link preview image is the 1200x630 JPEG with size tags (A7)", /og:image" content="https:\/\/erp\.ofjauto\.com\/preview\.jpg"/.test(head) && /og:image:width" content="1200"/.test(head) && /image_src/.test(head), head.match(/og:image[^>]*/g)?.slice(0, 2).join(" ") ?? "");
  const { browser, page } = await browserFor("accounts");
  await go(page, `${base}/jobs/${jobId}/invoice`);
  const b = await page.textContent("body");
  check("payment box shows Full amount and Partial (A8)", /Full amount/.test(b ?? "") && /Partial/.test(b ?? ""));
  check("bank charge note under the method buttons (F2)", /No bank charge on cash/.test(b ?? ""));
  await page.getByRole("button", { name: "Card", exact: true }).first().click();
  await sleep(200);
  check("card shows its 2.26% charge (F2)", /Bank charge 2\.26% on card/.test(await page.textContent("body")));
  await page.getByRole("button", { name: "Partial" }).first().click();
  await page.locator("label:has-text('Amount received') input").first().fill("100");
  await page.getByRole("button", { name: /^Record/ }).first().click();
  await submitted(page);
  let rows = await sql("select method, amount_aed::float as amount, bank_charge_aed::float as charge, status from public.payments where job_id = $1 order by created_at", [jobId]);
  check("card payment recorded with 2.26% charge (F2)", rows.length === 1 && Math.abs(rows[0].charge - 2.26) < 0.01, JSON.stringify(rows));
  await go(page, `${base}/jobs/${jobId}/invoice`);
  await page.getByRole("button", { name: "Cash", exact: true }).first().click();
  await page.getByRole("button", { name: "Full amount" }).first().click();
  await page.getByRole("button", { name: /^Record/ }).first().click();
  await submitted(page);
  await sleep(2500);
  const invs = await sql("select number, kind, converted_to is not null as converted, converted_from is not null as from_pro, status from public.invoices where job_id = $1 order by created_at", [jobId]);
  check("tax invoice generated at zero balance, proforma converted (F1)", invs.length === 2 && invs[0].kind === "proforma" && invs[0].converted && invs[1].kind === "tax_invoice" && /^INV-\d{5}$/.test(invs[1].number) && invs[1].from_pro, JSON.stringify(invs));
  rows = await sql("select count(*)::int as n from public.payments p join public.invoices i on i.id = p.invoice_id where p.job_id = $1 and i.kind = 'tax_invoice'", [jobId]);
  check("payments moved to the tax invoice (F1)", rows[0]?.n === 2, JSON.stringify(rows));
  const job = await sql("select status from public.jobs where id = $1", [jobId]);
  check("job is Ready after full payment (F1)", job[0]?.status === "ready", JSON.stringify(job));
  const notes = await sql("select title from public.notifications where job_id = $1 and title ilike '%tax invoice%' order by created_at", [jobId]);
  check("accounts and the advisor notified about the tax invoice (F1)", notes.some((n) => /generated/.test(n.title)) && notes.some((n) => /ready to send/.test(n.title)), JSON.stringify(notes.map((n) => n.title)));
  const after = await (await fetch(`${base}/invoice/${inv.token}`)).text();
  check("old proforma link now shows the paid tax invoice (F1)", /Tax invoice/.test(after) && /Paid, thank you/.test(after) && !/not a tax invoice/.test(after));
  const receipt = after.match(/\/api\/pdf\/receipt\/[^"]+/)?.[0];
  if (receipt) {
    const r = await fetch(`${base}${receipt.replace(/&amp;/g, "&")}`);
    check("customer can open a receipt from the invoice page", r.status === 200 && (r.headers.get("content-type") ?? "").includes("pdf"), `${r.status} ${r.headers.get("content-type")}`);
  } else check("receipt link on the customer page", false);
  await go(page, `${base}/jobs/${jobId}`);
  const jb = await page.textContent("body");
  check("job card says tax invoice ready to send (F1)", /Tax invoice ready to send|Send the tax invoice/.test(jb ?? ""));
  await browser.close();
  const { browser: bm, page: pm } = await browserForId(MANAGER_MECH);
  await go(pm, `${base}/jobs/${jobId}`);
  const mb = await pm.textContent("body");
  check("manager sees no invoice tile or amounts (E1)", !/INV-\d|PRO-\d|AED \d/.test(mb ?? "") && /QC passed and the car is ready/.test(mb ?? ""), (mb ?? "").match(/INV-\d+|PRO-\d+|AED \d+/g)?.slice(0, 3).join(",") ?? "no amounts");
  await bm.close();
});

/* ---------------- PDFs: no staff names, availability, LPO ---------------- */
await section("PDF checks", async () => {
  const seed = await api("/api/e2e/stage", { stage: "quote" });
  const { token, jobId } = seed.json;
  const cookie = (await loginCookies("owner")).map((c) => `${c.name}=${c.value}`).join("; ");
  const mupdf = await import("mupdf");
  const textOf = async (url, withCookie) => {
    const r = await fetch(`${base}${url}`, withCookie ? { headers: { cookie } } : undefined);
    if (r.status !== 200) return `HTTP ${r.status}`;
    const doc = mupdf.Document.openDocument(Buffer.from(await r.arrayBuffer()), "application/pdf");
    let t = "";
    for (let i = 0; i < doc.countPages(); i++) t += doc.loadPage(i).toStructuredText().asText();
    return t;
  };
  const qt = await textOf(`/api/pdf/quote/${token}`);
  check("quotation PDF has no Prepared by or Advisor (C6)", !/HTTP/.test(qt) && !/Prepared by|Advisor/.test(qt), qt.match(/Prepared by[^\n]*|Advisor[^\n]*/)?.[0] ?? qt.slice(0, 30));
  check("quotation PDF shows part availability (C10)", /Arrives in \d+ days?|In stock/i.test(qt), qt.match(/Arrives in[^\n]*/)?.[0] ?? "");
  const rtok = "stagereport" + Date.now();
  const ins = await api("/api/e2e/sql", { sql: "insert into public.report_links (job_id, inspection_id, token, status) values ($1, $2, $3, 'sent') returning id", params: [jobId, seed.json.inspectionId, rtok] });
  if (ins.json?.rows?.length) {
    const rt = await textOf(`/api/pdf/report/${rtok}`);
    check("report PDF without Technician, Prepared by or Needs (C6, C7)", !/HTTP/.test(rt) && !/Technician\b|Needs:|Prepared by/.test(rt), rt.match(/Technician[^\n]*|Needs:[^\n]*|Prepared by[^\n]*/)?.[0] ?? rt.slice(0, 30));
  } else check("report link for the PDF test", false, JSON.stringify(ins.json ?? ins.text).slice(0, 120));
  const lpo = await sql("select id from public.purchase_orders order by created_at desc limit 1");
  if (lpo[0]) {
    const lt = await textOf(`/api/pdf/po/${lpo[0].id}`, true);
    const flat = lt.replace(/\s+/g, "");
    check("LPO PDF titled Local purchase order with LPO no. (D4)", /LOCALPURCHASEORDER/i.test(flat) && /LPONO\./i.test(flat), lt.slice(0, 200).replace(/\n/g, " / "));
  } else console.log("   (no LPO to check yet)");
});

/* ---------------- Suppliers, LPO naming, settings, text tidying ---------------- */
await section("D3-D4-G suppliers and text", async () => {
  await sql("delete from public.suppliers where trn = '100000000000003' and not exists (select 1 from public.purchase_orders where supplier_id = suppliers.id)").catch(() => null);
  const { browser, page } = await browserFor("parts");
  await go(page, `${base}/parts/suppliers`);
  await page.locator("input[name=name]").first().fill("al futtaim AUTO PARTS llc");
  await page.locator("input[name=trn]").first().fill("100000000000003");
  await page.locator("input[name=payment_terms]").first().fill("30 DAYS");
  await page.getByRole("button", { name: "Add supplier" }).dblclick();
  await submitted(page);
  const sup = await sql("select name, trn, payment_terms from public.suppliers where trn = '100000000000003'");
  check("supplier added once with tidy case (D3, G, A4)", sup.length === 1 && sup[0].name === "Al Futtaim Auto Parts LLC" && sup[0].payment_terms === "30 days", JSON.stringify(sup));
  await go(page, `${base}/parts/orders`);
  check("purchase orders are called LPOs (D4)", /LPOs/.test(await page.textContent("h1")));
  await go(page, `${base}/parts`);
  const sel = page.locator("select[name=supplier_id]");
  check("LPO form picks the supplier from the list (D3)", (await sel.count()) === 0 || (await sel.first().locator("option").allTextContents()).some((t) => /Al Futtaim Auto Parts/.test(t)), (await sel.count()) ? "options present" : "no parts to order on this desk right now");
  await browser.close();
  const { browser: b2, page: p2 } = await browserFor("service_advisor");
  await go(p2, `${base}/customers/new`);
  const name = p2.locator("input[name=full_name]");
  check("customer form found (G)", (await name.count()) === 1);
  await name.fill("mohammed ALI bmw");
  await name.press("Tab");
  await sleep(300);
  check("customer name tidied on blur with known word (G)", (await name.inputValue()) === "Mohammed Ali BMW", await name.inputValue());
  await b2.close();
  const { browser: b3, page: p3 } = await browserFor("owner");
  await go(p3, `${base}/settings`);
  const st = await p3.textContent("body");
  check("settings show quick remarks, advisor discount, known words, four bank charges, and no CAPITALS switch (A8, 11 Oct)", /Quick remarks/.test(st ?? "") && /Advisors can discount labour/.test(st ?? "") && !/CAPITALS/.test(st ?? "") && /Known words/.test(st ?? "") && /Bank charge, cheque/.test(st ?? ""));
  await b3.close();
});

/* ---------------- E2: the manager's time budget ---------------- */
await section("E2 budget", async () => {
  const seed = await api("/api/e2e/stage", { stage: "approved" });
  const { jobId } = seed.json;
  await sql("update public.jobs set status = 'in_work', stage = 'work', plan_released_at = now() where id = $1", [jobId]);
  const { browser, page } = await browserForId(MANAGER_MECH);
  await go(page, `${base}/jobs/${jobId}/work`);
  const open = page.locator("summary:has-text('time budget')");
  check("budget form on the work order (E2)", (await open.count()) === 1, (await page.textContent("body") ?? "").slice(0, 80));
  if (await open.count()) {
    await open.click();
    await page.locator("input[name=budget_hours]").fill("6.5");
    await page.locator("input[name=reason]").fill("Seized bolts, extra time agreed");
    await page.getByRole("button", { name: "Save budget" }).click();
    await submitted(page);
    const t = await page.textContent("body");
    check("budget saved and shown with reason (E2)", /Budget 6\.5 h set by the manager/.test(t ?? "") && /Seized bolts/.test(t ?? ""), (t ?? "").match(/Time budget[^.]*\./)?.[0] ?? "");
    const ev = await sql("select note from public.job_events where job_id = $1 and event_type = 'budget'", [jobId]);
    check("budget change logged (E2)", ev.length === 1 && /6\.5 h/.test(ev[0].note), JSON.stringify(ev));
  }
  await browser.close();
});

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(0);
