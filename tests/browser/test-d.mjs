// Proof for PART 1 of the evening list of 12 October 2026: the Parts pricing table never moves a row or loses the
// cursor while typing, every row keeps one height, availability is one dropdown; every number box keeps what is typed
// ("2.2", "0.5", ".5", "10.25", "2,5") and saves the right figure; one definition of a part's state feeds the counter,
// the "Show only unpriced" filter, the bottom bar, the advisor's notification and the quotation, and "Pricing done"
// goes straight through when every part is priced or marked not available. Run against `npx next dev -p 3100`:
//   node --env-file=.env.local tests/browser/test-d.mjs
import { MANAGER_MECH, api, base, browserFor, browserForId, cleanupDb, cookieHeader, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 15 * 60 * 1000).unref();
cleanupDb();

async function section(name, fn) {
  console.log(`\n== ${name}`);
  try {
    await fn();
  } catch (e) {
    check(`${name}: no crash`, false, String(e?.message ?? e).slice(0, 300));
  }
}
const dubai = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const TYPED = ["2.2", "0.5", ".5", "10.25", "2,5"];
const EXPECT = { "2.2": "2.2", "0.5": "0.5", ".5": "0.5", "10.25": "10.25", "2,5": "2.5" };

/** Clears the box, then types one character at a time; after every keystroke the box must show exactly what was typed so far. */
async function typeKeys(box, text) {
  await box.click();
  await box.press("Control+a");
  await box.press("Backspace");
  const seen = [];
  let ok = true;
  for (let i = 0; i < text.length; i++) {
    await box.press(text[i]);
    const v = await box.inputValue();
    seen.push(v);
    if (v !== text.slice(0, i + 1)) ok = false;
  }
  return { ok, seen };
}
const pdfText = async (buf) => {
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  const pages = [];
  for (let i = 0; i < doc.countPages(); i++) pages.push(doc.loadPage(i).toStructuredText("preserve-whitespace").asText());
  return pages.join("\n");
};
const addRequest = (jobId, inspId, key, label) => sql("insert into public.part_requests (job_id, inspection_id, source_type, source_key, label, requested_text, status, quantity, unit) values ($1, $2, 'item', $3, $4, 'check', 'open', 1, 'pc')", [jobId, inspId, key, label]);
const supplierOption = async (sel, name) => sel.locator("option").evaluateAll((os, n) => (os.find((o) => (o.textContent ?? "").toLowerCase().startsWith(n.toLowerCase())) ?? {}).value ?? "", name);
/** Waits until a row's "Saving…" tag has gone (the first save of a test run also compiles the action on the dev server). */
const settled = async (row) => {
  for (let i = 0; i < 80; i++) {
    const t = (await row.locator("[data-row-tag]").textContent().catch(() => "")) ?? "";
    if (t !== "Saving…") break;
    await sleep(250);
  }
  await sleep(300);
};

/* ---------------- U1. The Parts table: rows never move, the cursor never leaves, one height, one dropdown ---------------- */
await section("U1 Parts table", async () => {
  const seed = await api("/api/e2e/stage", { stage: "quote" });
  const { jobId } = seed.json;
  const insp = (await sql("select id from public.inspections where job_id = $1 limit 1", [jobId]))[0];
  const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active limit 1"))[0]?.id;
  await sql("insert into public.suppliers (name, default_discount_percent, discount_by_type, created_by) values ('e2e Supplier D', 20, '{}'::jsonb, $1) on conflict do nothing", [owner]);
  for (let i = 1; i <= 14; i++) await addRequest(jobId, insp?.id ?? null, `e2e-d-${i}`, `E2e part ${String(i).padStart(2, "0")}`);
  const { browser, page } = await browserFor("parts", { viewport: { width: 1600, height: 900 } });
  await go(page, `${base}/parts/${jobId}`);
  const boxes = () => page.$$eval("[data-row-key]", (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { k: e.dataset.rowKey, t: Math.round(r.top + window.scrollY), h: Math.round(r.height) }; }));
  const active = () => page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName ?? "");
  const same = (a, b) => a.length === b.length && a.every((x, i) => x.k === b[i].k && x.t === b[i].t && x.h === b[i].h);
  const b0 = await boxes();
  check("U1: the table has at least 15 rows", b0.length >= 15, String(b0.length));
  check("U1: every row has the same height whatever its state (wide screen, one line)", new Set(b0.map((b) => b.h)).size === 1, b0.map((b) => b.h).join(","));
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(400);
  const b1 = await boxes();
  // Rows by name: the seed's own part sits last, the test requests before it.
  const byName = (name) => page.locator("[data-row-key]", { has: page.getByRole("button", { name: new RegExp(`^${name}$`, "i") }) }).first();
  const last = byName("E2e part 14");
  const second = byName("E2e part 11");
  // One row filled completely, at the bottom of the page.
  const pn = last.locator("input[aria-label='Part number']");
  const r1 = await typeKeys(pn, "A2223200438");
  check("U1 row A, part number typed key by key: stays as typed", r1.ok, r1.seen.join("|"));
  check("U1 row A: cursor still in the part number box", (await active()) === "Part number", await active());
  check("U1 row A: no row moved while the part number was typed", same(b1, await boxes()));
  await last.locator("select[aria-label='Type']").selectOption("genuine");
  const list = last.locator("input[aria-label='List price']");
  const r2 = await typeKeys(list, "1234.5");
  check("U1 row A, list price 1234.5 typed key by key: stays as typed", r2.ok, r2.seen.join("|"));
  await sleep(1400);
  check("U1 row A: cursor still in the list box a second after typing stopped", (await active()) === "List price", await active());
  check("U1 row A: the net followed the list price after the pause", (await last.locator("input[aria-label='Cost before VAT']").inputValue()) === "1234.5", await last.locator("input[aria-label='Cost before VAT']").inputValue());
  check("U1 row A: no row moved after the pause", same(b1, await boxes()));
  const disc = last.locator("input[aria-label='Discount percent']");
  await typeKeys(disc, "10");
  await disc.press("Tab");
  const supSel = last.locator("select[aria-label='Supplier']");
  const supVal = await supplierOption(supSel, "e2e Supplier D");
  check("U1: the supplier list has the test supplier", !!supVal);
  // A person picks the supplier with a tap, which takes the cursor out of the net box; the test does the same.
  await supSel.focus();
  await supSel.selectOption(supVal);
  await sleep(300);
  check("U1 row A: the supplier's 20% replaced the typed discount and the net followed (987.6)", (await disc.inputValue()) === "20" && (await last.locator("input[aria-label='Cost before VAT']").inputValue()) === "987.6", `${await disc.inputValue()} / ${await last.locator("input[aria-label='Cost before VAT']").inputValue()}`);
  await last.locator("select[aria-label='Availability']").selectOption("d1");
  await sleep(1200);
  await settled(last);
  check("U1 row A: no row moved after the whole row was filled and saved", same(b1, await boxes()));
  check("U1 row A: the finished row is Priced (✓)", (await last.getAttribute("data-row-state")) === "priced", await last.getAttribute("data-row-state"));
  const saved = await sql("select part_number, part_type, cost_aed, supplier, availability, to_char(delivery_date, 'YYYY-MM-DD') as delivery_date from public.part_items where job_id = $1 and description = 'E2e part 14'", [jobId]);
  check("U1 row A saved: part number, type, net 987.6, supplier, Next day = delivery tomorrow", saved.length === 1 && saved[0].part_number === "A2223200438" && saved[0].part_type === "genuine" && Number(saved[0].cost_aed) === 987.6 && /e2e supplier d/i.test(saved[0].supplier ?? "") && saved[0].availability === "to_order" && saved[0].delivery_date === dubai(new Date(Date.now() + 86400000)), JSON.stringify(saved));
  // A second row typed quickly across three boxes.
  const list2 = second.locator("input[aria-label='List price']");
  await list2.click();
  await list2.pressSequentially("250.75", { delay: 15 });
  check("U1 row B, quick typing: the list box shows 250.75 and the cursor stayed", (await list2.inputValue()) === "250.75" && (await active()) === "List price", `${await list2.inputValue()} / ${await active()}`);
  await second.locator("input[aria-label='Discount percent']").click();
  await page.keyboard.type("5", { delay: 15 });
  await second.locator("input[aria-label='Part number']").click();
  await page.keyboard.type("QUICK-1", { delay: 15 });
  check("U1 row B: cursor in the part number box after quick typing", (await active()) === "Part number", await active());
  check("U1 row B: no row moved during quick typing across three boxes", same(b1, await boxes()));
  await sleep(1400);
  await settled(second);
  const tagB = (await second.locator("[data-row-tag]").textContent()) ?? "";
  check("U1 row B: the 'Not finished' tag sits on the status line and the row height did not change", /Not finished: no supplier, no availability/.test(tagB) && same(b1, await boxes()), tagB);
  check("U1 row B: net followed list and discount (238.21)", (await second.locator("input[aria-label='Cost before VAT']").inputValue()) === "238.21", await second.locator("input[aria-label='Cost before VAT']").inputValue());
  await page.locator("h1").click();
  await sleep(1600);
  check("U1 row B: the part number stays a box (never swapped for text), with Copy beside it, after leaving the row", (await second.locator("input[aria-label='Part number']").count()) === 1 && (await second.locator("input[aria-label='Part number']").inputValue()) === "QUICK-1" && (await second.getByRole("button", { name: "Copy the part number" }).count()) === 1);
  check("U1: the row order is the one the page opened with, after saves and refreshes", b1.map((b) => b.k).join(",") === (await boxes()).map((b) => b.k).join(","));
  check("U1: every row still has the same height after the edits", new Set((await boxes()).map((b) => b.h)).size === 1, (await boxes()).map((b) => b.h).join(","));
  await browser.close();
  // A laptop: two lines per row, still every row the same height; the dropdown; Same day.
  const lap = await browserFor("parts", { viewport: { width: 1366, height: 768 } });
  await go(lap.page, `${base}/parts/${jobId}`);
  const hs = await lap.page.$$eval("[data-row-key]", (els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
  check("U1: on a 1366 laptop every row has the same height too (finished, half-finished and empty rows)", hs.length >= 15 && new Set(hs).size === 1, hs.join(","));
  const opts = await lap.page.locator("select[aria-label='Availability']").first().locator("option").allTextContents();
  check("U1: availability is one dropdown: In stock, Same day, Next day, 2 days, 3 days, Other…", ["In stock", "Same day", "Next day", "2 days", "3 days", "Other…"].every((o) => opts.includes(o)), opts.join("|"));
  const row13 = lap.page.locator("[data-row-key]", { has: lap.page.getByRole("button", { name: "E2e part 13" }) }).first();
  await row13.locator("input[aria-label='Part number']").fill("SD-13");
  await row13.locator("select[aria-label='Type']").selectOption("genuine");
  await row13.locator("input[aria-label='List price']").fill("100");
  await row13.locator("input[aria-label='List price']").press("Tab");
  await row13.locator("select[aria-label='Supplier']").selectOption(await supplierOption(row13.locator("select[aria-label='Supplier']"), "e2e Supplier D"));
  await row13.locator("select[aria-label='Availability']").selectOption("d0");
  await sleep(1200);
  await settled(row13);
  const sd = (await sql("select availability, to_char(delivery_date, 'YYYY-MM-DD') as delivery_date from public.part_items where job_id = $1 and description = 'E2e part 13'", [jobId]))[0];
  check("U1: Same day saves as ordered (to_order) arriving today", sd?.availability === "to_order" && sd?.delivery_date === dubai(new Date()), JSON.stringify(sd));
  await lap.page.reload({ waitUntil: "load" });
  await sleep(1500);
  check("U1: after reload the dropdown shows Same day for that row", (await row13.locator("select[aria-label='Availability']").inputValue()) === "d0", await row13.locator("select[aria-label='Availability']").inputValue());
  // "Other…" opens the days box on the same line; 7 days.
  const row12 = lap.page.locator("[data-row-key]", { has: lap.page.getByRole("button", { name: "E2e part 12" }) }).first();
  const h12 = await row12.evaluate((e) => Math.round(e.getBoundingClientRect().height));
  await row12.locator("select[aria-label='Availability']").selectOption("other");
  await sleep(200);
  check("U1: Other… puts the cursor in the days box beside the dropdown, same row height", (await lap.page.evaluate(() => document.activeElement?.getAttribute("aria-label"))) === "Days until it arrives" && (await row12.evaluate((e) => Math.round(e.getBoundingClientRect().height))) === h12);
  await lap.page.keyboard.type("7");
  await lap.page.keyboard.press("Tab");
  await sleep(1200);
  await settled(row12);
  const d7 = (await sql("select availability, to_char(delivery_date, 'YYYY-MM-DD') as delivery_date from public.part_items where job_id = $1 and description = 'E2e part 12'", [jobId]))[0];
  check("U1: Other with 7 days saves a delivery date a week away", d7?.availability === "to_order" && d7?.delivery_date === dubai(new Date(Date.now() + 7 * 86400000)), JSON.stringify(d7));
  await lap.browser.close();
});

/* ---------------- U2. Number boxes keep what is typed ---------------- */
await section("U2 number boxes", async () => {
  // 1 and 4: the quotation's hours box and the parts markup box.
  cleanupDb();
  const seed = await api("/api/e2e/stage", { stage: "quote" });
  const { jobId, quotationId } = seed.json;
  const adv = await browserFor("service_advisor", { viewport: { width: 1366, height: 900 } });
  await go(adv.page, `${base}/jobs/${jobId}/quote/${quotationId}`);
  const hours = adv.page.locator("input[aria-label='Hours']").first();
  check("U2 quotation: the hours box is on the page", (await hours.count()) === 1);
  for (const t of TYPED) {
    const r = await typeKeys(hours, t);
    check(`U2 quotation hours box: "${t}" typed key by key stays "${t}"`, r.ok, r.seen.join("|"));
    await sleep(2600);
    const db = (await sql("select hours from public.quotation_lines where quotation_id = $1 and line_type = 'labour' and is_active order by position limit 1", [quotationId]))[0];
    check(`U2 quotation hours box: "${t}" saved as ${EXPECT[t]}`, Number(db?.hours) === Number(EXPECT[t]), String(db?.hours));
    await adv.page.reload({ waitUntil: "load" });
    await sleep(1500);
    check(`U2 quotation hours box: "${t}" shows ${EXPECT[t]} after reload`, (await hours.inputValue()) === EXPECT[t], await hours.inputValue());
  }
  const markup = adv.page.locator("input[aria-label='Markup percent']").first();
  check("U2 quotation: the parts markup box is on the page", (await markup.count()) === 1);
  for (const t of TYPED) {
    const r = await typeKeys(markup, t);
    check(`U2 parts markup box: "${t}" typed key by key stays "${t}"`, r.ok, r.seen.join("|"));
  }
  // Below the 5% minimum a markup is raised to the minimum on leaving the box, so the saved figures are checked above it.
  for (const [t, want] of [["10.25", "10.25"], ["12,5", "12.5"]]) {
    await typeKeys(markup, t);
    await markup.press("Tab");
    let db = null;
    for (let i = 0; i < 24; i++) {
      await sleep(500);
      db = (await sql("select markup_percent from public.quotation_lines where quotation_id = $1 and line_type = 'part' and is_active order by position limit 1", [quotationId]))[0];
      if (Number(db?.markup_percent) === Number(want)) break;
    }
    check(`U2 parts markup box: "${t}" saved as ${want}`, Number(db?.markup_percent) === Number(want), String(db?.markup_percent));
    await adv.page.reload({ waitUntil: "load" });
    await sleep(1500);
    check(`U2 parts markup box: "${t}" shows ${want} after reload`, (await markup.inputValue()) === want, await markup.inputValue());
  }
  await adv.browser.close();

  // 2: the manager's hours estimate on the inspection review.
  const s2 = await api("/api/e2e/stage", { stage: "inspection" });
  const job2 = s2.json.jobId;
  await sql("update public.inspections set status = 'submitted', submitted_at = now(), estimated_hours = 3, parts_list_confirmed_at = now(), parts_list_confirmed_by = $2 where job_id = $1", [job2, MANAGER_MECH]);
  const mgr = await browserForId(MANAGER_MECH, { viewport: { width: 1366, height: 900 } });
  await go(mgr.page, `${base}/jobs/${job2}/inspection`);
  const est = mgr.page.locator("input[name='estimated_hours_manager']");
  check("U2 manager's hours box is on the review page", (await est.count()) === 1);
  for (const t of TYPED) {
    const r = await typeKeys(est, t);
    check(`U2 manager's hours box: "${t}" typed key by key stays "${t}"`, r.ok, r.seen.join("|"));
  }
  await typeKeys(est, "10.25");
  await est.press("Tab");
  await sleep(400);
  const reason = mgr.page.locator("input[name='hours_reason']");
  check("U2 manager's hours box: the reason box appears once the figure differs from the technician's", (await reason.count()) === 1);
  await reason.fill("Seized or rusted parts likely");
  await mgr.page.locator("textarea[name='manager_note']").fill("Test note for the customer.");
  await mgr.page.getByRole("button", { name: "Approve and send to the advisor" }).click();
  await mgr.page.waitForURL((u) => /message=|error=/.test(u.toString()) || !/\/inspection$/.test(u.pathname), { timeout: 25000 }).catch(() => null);
  await sleep(1200);
  const ins = (await sql("select estimated_hours_manager, status from public.inspections where job_id = $1", [job2]))[0];
  check("U2 manager's hours box: 10.25 saved as 10.25 on approval", Number(ins?.estimated_hours_manager) === 10.25 && ins?.status === "approved", `${JSON.stringify(ins)} url=${mgr.page.url()}`);
  await mgr.browser.close();

  // 3: the hours box of a labour job in Settings.
  const own = await browserFor("owner", { viewport: { width: 1366, height: 900 } });
  await go(own.page, `${base}/settings/services?list=labour`);
  const details = own.page.locator("details", { has: own.page.locator("summary", { hasText: "+ Add a labour job" }) }).first();
  await details.locator("summary").click();
  const hoursBox = details.locator("input[aria-label='Hours']");
  check("U2 Settings: the service hours box is on the page", (await hoursBox.count()) === 1);
  for (const t of TYPED) {
    const r = await typeKeys(hoursBox, t);
    check(`U2 Settings service hours box: "${t}" typed key by key stays "${t}"`, r.ok, r.seen.join("|"));
  }
  await typeKeys(hoursBox, "10.25");
  await details.locator("input[name='name']").fill("e2e hours job");
  await details.getByRole("button", { name: "Add labour job" }).click();
  await own.page.waitForURL(/message=|error=/, { timeout: 20000 }).catch(() => null);
  await sleep(800);
  const svc = (await sql("select default_hours from public.services where name ilike 'e2e hours job'"))[0];
  check("U2 Settings service hours box: 10.25 saved as 10.25", Number(svc?.default_hours) === 10.25, `${JSON.stringify(svc)} url=${own.page.url()}`);
  await go(own.page, `${base}/settings/services?list=labour`);
  check("U2 Settings: the list shows 10.25 h after reload", /10\.25 h/.test(await own.page.textContent("body")));
  await sql("delete from public.services where name ilike 'e2e hours job'");
  await own.browser.close();
});

/* ---------------- U3. One part state: counter, filter, bar, notification, quotation; Pricing done straight through ---------------- */
await section("U3 one part state", async () => {
  cleanupDb();
  const seed = await api("/api/e2e/stage", { stage: "quote" });
  const { jobId, quotationId, token } = seed.json;
  const insp = (await sql("select id from public.inspections where job_id = $1 limit 1", [jobId]))[0];
  for (const [k, n] of [["e2e-u3-1", "E2e disc"], ["e2e-u3-2", "E2e sensor"], ["e2e-u3-3", "E2e hose"]]) await addRequest(jobId, insp?.id ?? null, k, n);
  const { browser, page } = await browserFor("parts", { viewport: { width: 1600, height: 900 } });
  await go(page, `${base}/parts/${jobId}`);
  const counter = async () => (await page.locator("[data-pricing-counter]").textContent()) ?? "";
  const barText = async () => (await page.locator("[data-bar-text]").textContent()) ?? "";
  const n = (t, re) => Number(t.match(re)?.[1] ?? 0);
  const parseCounts = (t) => ({ priced: n(t, /(\d+) priced/), na: n(t, /(\d+) not available/), nf: n(t, /(\d+) not finished/) });
  const rowStates = () => page.$$eval("[data-row-key]", (els) => els.map((e) => e.dataset.rowState));
  const agree = async (label, want) => {
    const text = await counter();
    const c = parseCounts(text);
    const states = await rowStates();
    const rows = { priced: states.filter((s) => s === "priced").length, na: states.filter((s) => s === "not_available").length, nf: states.filter((s) => s === "not_finished").length };
    const bar = await barText();
    await page.getByRole("button", { name: /Show only unpriced/ }).click();
    await sleep(250);
    const shown = (await rowStates()).length;
    await page.getByRole("button", { name: /Show only unpriced/ }).click();
    await sleep(250);
    const barAgrees = bar.includes(text) || (c.nf > 0 && new RegExp(`${c.nf} parts? not finished`).test(bar));
    check(`U3 agreement, ${label}: counter ${JSON.stringify(c)} = rows = filter (${shown} shown) = bar`, c.priced === rows.priced && c.na === rows.na && c.nf === rows.nf && shown === states.length - rows.priced && barAgrees && (!want || (c.priced === want.priced && c.na === want.na && c.nf === want.nf)), `rows=${JSON.stringify(rows)} bar="${bar}"`);
  };
  // Names are sentence-cased by the database ("Front brake pads"), so the match ignores case.
  const rowOf = (name) => page.locator("[data-row-key]", { has: page.getByRole("button", { name: new RegExp(`^${name}$`, "i") }) }).first();
  const supName = (await sql("select name from public.suppliers where is_active order by name limit 1"))[0]?.name ?? "";
  const fill = async (row, { pn, list, disc, net, avail }) => {
    if (pn) await row.locator("input[aria-label='Part number']").fill(pn);
    if ((await row.locator("select[aria-label='Type']").inputValue()) === "") await row.locator("select[aria-label='Type']").selectOption("genuine");
    if (list) { await row.locator("input[aria-label='List price']").fill(list); await row.locator("input[aria-label='List price']").press("Tab"); }
    if (net !== undefined) { await row.locator("input[aria-label='Cost before VAT']").fill(net); await row.locator("input[aria-label='Cost before VAT']").press("Tab"); }
    if (disc !== undefined) { await row.locator("input[aria-label='Discount percent']").fill(disc); await row.locator("input[aria-label='Discount percent']").press("Tab"); }
    const sel = row.locator("select[aria-label='Supplier']");
    await sel.focus();
    await sel.selectOption(await supplierOption(sel, supName));
    if (disc !== undefined) { await row.locator("input[aria-label='Discount percent']").fill(disc); await row.locator("input[aria-label='Discount percent']").press("Tab"); }
    if (avail) await row.locator("select[aria-label='Availability']").selectOption(avail);
    await sleep(1200);
    await settled(row);
  };
  await agree("at the start (nothing priced)", { priced: 0, na: 0, nf: 5 });
  // A row with every box filled but a net price of 0 is NOT priced (a 100% discount would wait for the owner instead: item 11).
  await fill(rowOf("E2e disc"), { pn: "DISC-1", net: "0", avail: "in_stock" });
  const discTag = (await rowOf("E2e disc").locator("[data-row-tag]").textContent()) ?? "";
  check("U3: a net price of 0 never counts as priced; the row says so", (await rowOf("E2e disc").getAttribute("data-row-state")) === "not_finished" && /net price is 0/.test(discTag), discTag);
  // Not available from the row's menu.
  await rowOf("E2e sensor").getByRole("button", { name: "More for this part" }).click();
  await page.getByRole("button", { name: "Not available" }).click();
  await sleep(4000);
  const sensorDb = (await sql("select status from public.part_requests where job_id = $1 and label ilike 'E2e sensor'", [jobId]))[0];
  check("U3: Not available is its own state (never blocks)", (await rowOf("E2e sensor").getAttribute("data-row-state")) === "not_available", `${await rowOf("E2e sensor").getAttribute("data-row-state")} db=${JSON.stringify(sensorDb)}`);
  await fill(rowOf("E2e hose"), { pn: "HOSE-1", list: "50", avail: "in_stock" });
  await fill(rowOf("front brake pads"), { avail: "d3" });
  await fill(rowOf("rear brake discs"), { pn: "RD-2", list: "400", avail: "d2" });
  await agree("after pricing: one net 0, one not available", { priced: 3, na: 1, nf: 1 });
  // Pricing done with one unfinished row: no browser prompt; the row goes red, the bar names it, Go to next and Send what you have appear.
  const urlBefore = page.url();
  await page.getByRole("button", { name: "Pricing done", exact: true }).click();
  await sleep(400);
  const bar1 = await barText();
  check("U3/12: the bar names the part and the missing piece: 1 part not finished · E2e disc: net price is 0", /1 part not finished · E2e disc: net price is 0/.test(bar1), bar1);
  check("U3/12: the unfinished row is outlined red, the others are not", (await page.locator("[data-row-state='not_finished'].border-red-bar").count()) === 1 && (await page.locator("[data-row-key].border-red-bar").count()) === 1);
  check("U3/12: Go to next and Send what you have are offered; nothing was submitted", (await page.getByRole("button", { name: "Go to next" }).count()) === 1 && (await page.getByRole("button", { name: "Send what you have" }).count()) === 1 && page.url() === urlBefore);
  await agree("after Pricing done was pressed", { priced: 3, na: 1, nf: 1 });
  await page.getByRole("button", { name: "Go to next" }).click();
  await sleep(600);
  check("U3/12: Go to next puts the cursor in the net box of the red row", (await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))) === "Cost before VAT", await page.evaluate(() => document.activeElement?.getAttribute("aria-label")));
  await page.keyboard.press("Control+a");
  await page.keyboard.type("80");
  await page.keyboard.press("Tab");
  await sleep(2600);
  check("U3/12: once fixed the row turns green and the count drops to none", (await rowOf("E2e disc").getAttribute("data-row-state")) === "priced" && (await page.locator("[data-row-key].border-red-bar").count()) === 0);
  await agree("every part priced or not available", { priced: 4, na: 1, nf: 0 });
  check("U3: the bar says every part is priced or marked not available", /Every part is priced or marked not available \(4 priced, 1 not available\)/.test(await barText()), await barText());
  check("U3: no 'Send what you have' when nothing is open", (await page.getByRole("button", { name: "Send what you have" }).count()) === 0);
  const urlAtDone = page.url();
  await page.getByRole("button", { name: "Pricing done", exact: true }).click();
  await page.waitForURL((u) => u.toString() !== urlAtDone && /message=|error=/.test(u.toString()), { timeout: 25000 }).catch(() => null);
  await sleep(800);
  check("U3: Pricing done went straight through to the advisor", /Sent%20to%20the%20advisor|Sent\+to\+the\+advisor/.test(page.url()), page.url());
  const job = (await sql("select parts_pricing_done_at from public.jobs where id = $1", [jobId]))[0];
  check("U3: the job records pricing done", !!job?.parts_pricing_done_at);
  const note = (await sql("select body from public.notifications where job_id = $1 and type = 'parts_priced' order by id desc limit 1", [jobId]))[0];
  check("U3: the advisor's notification carries the breakdown (4 priced, 1 not available)", /4 priced, 1 not available/.test(note?.body ?? ""), note?.body ?? "");
  await browser.close();
  // The quotation reads the same state: 4 of 5 parts priced, the one not available listed, no open request holding it.
  const adv = await browserFor("service_advisor", { viewport: { width: 1366, height: 900 } });
  await go(adv.page, `${base}/jobs/${jobId}/quote/${quotationId}`);
  const body = (await adv.page.textContent("body")) ?? "";
  check("U3 quotation: '4 of 5 parts priced' and the not-available part listed", /4 of 5 parts priced/.test(body) && /Not available from Parts/.test(body) && /E2e sensor/.test(body), body.match(/\d of \d parts priced[^·]*/)?.[0] ?? "");
  check("U3 quotation: no part request is still holding the quotation", !/part requests? still with Parts/.test(body) && !/requests? still open/.test(body));
  await adv.browser.close();
  // The customer's wording on the PDF: In stock, In 2 days, In 3 days.
  const cookie = await cookieHeader("service_advisor");
  const res = await fetch(`${base}/api/pdf/quote/${token}`, { headers: { cookie } });
  const text = res.ok ? await pdfText(Buffer.from(await res.arrayBuffer())) : "";
  check("U1 customer wording on the quotation PDF: In stock, In 2 days, In 3 days", /In stock/i.test(text) && /In 2 days/i.test(text) && /In 3 days/i.test(text), text.match(/In \d days|In stock/gi)?.join("|") ?? `status ${res.status}`);
});

const failed = summary();
cleanupDb();
process.exit(failed ? 1 : 0);
