// Proof for section E and F1 of the 16 October batch: part names in capitals on the Parts table; the import's
// availability words ("Supplier stock: 653", "Out of stock"); one availability, supplier or type set for every ticked
// part; the three-dot menus float on top and open upwards near the bottom; the tyre details window (brand, model,
// size, year, marks) builds the name "PIRELLI P ZERO 275/45 R20 N0 (2026)", a tyre cannot be priced without brand
// and size, a generic tyre with details in the part number box is told so; the VIN with Copy in every car header.
//   node --env-file=.env.local tests/browser/test-u.mjs
import { api, base, browserFor, cleanupDb, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 12 * 60 * 1000).unref();
cleanupDb();

const until = async (fn, tries = 60, ms = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } return null; };
const only = (process.env.ONLY ?? "").split(",").map((x) => x.trim()).filter(Boolean);
async function section(name, fn) {
  if (only.length && !only.some((n) => name.startsWith(n + " "))) return;
  console.log(`\n== ${name}`);
  try { await fn(); } catch (e) { check(`${name}: no crash`, false, String(e?.message ?? e).slice(0, 300)); }
}
const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0]?.id;

/* ---------------- 1. E2: the availability words (pure rules, and the stored notes) ---------------- */
await section("1 availability words", async () => {
  const mod = await import("file:///C:/Users/user/Desktop/workshop%20ERP/src/lib/price-import.ts");
  const note = (t) => mod.importAvailabilityNote(mod.parseAvailability(t));
  check("1: '653' reads 'Supplier stock: 653'", note("653") === "Supplier stock: 653", String(note("653")));
  check("1: '-35' reads 'Out of stock'", note("-35") === "Out of stock", String(note("-35")));
  check("1: 'back order' keeps its words", /Back order/.test(note("back order") ?? ""));
  check("1: an unclear text is for the supplier to confirm", note("will update") === "Supplier to confirm", String(note("will update")));
  check("1: '2 days' is a lead time, no note", note("2 days") === null);
  const old = (await sql("select count(*)::int as n from public.part_items where availability_note ~ '^Supplier to confirm \\(-?\\d+\\)$'"))[0]?.n;
  check("1: no stored note still says 'Supplier to confirm (653)'", old === 0, String(old));
});

/* ---------------- 2. E1, E3, E4 on the Parts table ---------------- */
await section("2 parts table", async () => {
  const { jobId } = (await api("/api/e2e/stage", { stage: "quote" })).json;
  const ids = [];
  for (const name of ["E2e bulk part one", "E2e bulk part two"]) {
    ids.push((await sql("insert into public.part_items (job_id, description, quantity, availability, confirm_status, confirmed_at, created_by, updated_by) values ($1, $2, 1, null, 'confirmed', now(), $3, $3) returning id", [jobId, name, owner]))[0]?.id);
  }
  const { browser, page } = await browserFor("parts", { viewport: { width: 1366, height: 640 } });
  await go(page, `${base}/parts/${jobId}`);
  const nameSpan = page.locator("[data-part-name] span").first();
  const tt = await nameSpan.evaluate((el) => getComputedStyle(el).textTransform);
  check("2 (E1): part names show in capitals", tt === "uppercase", tt);
  // E3: tick two rows, set one availability and one type for both.
  for (const id of ids) await page.locator(`[data-row-key='${id}'] [data-row-select]`).check();
  check("2 (E3): ticking rows shows 'Set for 2 ticked'", (await page.locator("[data-bulk-set]").count()) === 1 && /Set for 2 ticked/.test((await page.locator("[data-bulk-set]").textContent()) ?? ""));
  await page.locator("[data-bulk-availability]").selectOption("in_stock");
  await page.locator("[data-bulk-type]").selectOption("genuine");
  await page.locator("[data-bulk-apply]").click();
  const done = await until(async () => { const r = await sql("select availability, part_type from public.part_items where id = any($1::uuid[])", [ids]); return r.length === 2 && r.every((x) => x.availability === "in_stock" && x.part_type === "genuine") ? r : null; }, 30, 500);
  check("2 (E3): both parts got In stock and Genuine with one Apply", !!done, JSON.stringify(done));
  check("2 (E3): the ticks clear afterwards", (await page.locator("[data-bulk-set]").count()) === 0);
  // E4: the last row's menu floats on top of the page, inside the viewport, opening upwards near the bottom.
  const lastRow = page.locator("[data-row-key]").last();
  await lastRow.scrollIntoViewIfNeeded();
  await lastRow.locator("button[aria-label='More for this part']").click();
  const menu = await until(async () => ((await page.locator("[data-floating-menu][data-part-menu]").count()) ? 1 : null), 20, 200);
  const placed = menu ? await page.evaluate(() => { const m = document.querySelector("[data-floating-menu]"); const r = m.getBoundingClientRect(); return { inBody: m.parentElement === document.body, top: r.top, bottom: r.bottom, h: window.innerHeight, up: m.getAttribute("data-menu-up"), fixed: getComputedStyle(m).position }; }) : null;
  check("2 (E4): the menu is drawn on the page body, fixed, fully inside the window", !!placed && placed.inBody && placed.fixed === "fixed" && placed.top >= 0 && placed.bottom <= placed.h + 1, JSON.stringify(placed));
  await page.keyboard.press("Escape");
  check("2 (E4): Escape closes it", (await page.locator("[data-floating-menu]").count()) === 0);
  await browser.close();
});

/* ---------------- 3. E5/E6: tyres ---------------- */
await section("3 tyres", async () => {
  cleanupDb();
  await sql("update public.settings set value = value - 'Pirelli' where key = 'tyre_models'");
  const { jobId, quotationId } = (await api("/api/e2e/stage", { stage: "quote" })).json;
  const tyreId = (await sql("insert into public.part_items (job_id, description, quantity, availability, confirm_status, confirmed_at, positions, created_by, updated_by) values ($1, 'Tyre 275/45 R20', 2, null, 'confirmed', now(), array['Front left','Front right'], $2, $2) returning id", [jobId, owner]))[0]?.id;
  const genericId = (await sql("insert into public.part_items (job_id, description, part_number, quantity, availability, confirm_status, confirmed_at, created_by, updated_by) values ($1, 'Tyre', '255/40 R19', 1, null, 'confirmed', now(), $2, $2) returning id", [jobId, owner]))[0]?.id;
  const { browser, page } = await browserFor("parts", { viewport: { width: 1600, height: 1000 } });
  await go(page, `${base}/parts/${jobId}`);
  const row = page.locator(`[data-row-key='${tyreId}']`);
  check("3: a tyre row offers 'Tyre details'", (await row.locator("[data-tyre-details]").count()) === 1);
  const generic = page.locator(`[data-row-key='${genericId}']`);
  check("3 (E6): a generic 'Tyre' with the size in the part number box is told to put the details in the name", /Add the details to the name/.test((await generic.textContent()) ?? "") && /Part numbers aren't shown to customers/.test((await generic.textContent()) ?? ""));
  // Price the tyre without brand: it stays not finished.
  await row.locator("select[aria-label='Type']").selectOption("genuine");
  await row.locator("input[aria-label='List price']").fill("900");
  await row.locator("input[aria-label='List price']").press("Tab");
  await sleep(1200);
  const supSel = row.locator("select[aria-label='Supplier']");
  const stock = await supSel.locator("option").evaluateAll((os) => (os.find((o) => /our stock/i.test(o.textContent ?? "")) ?? {}).value ?? "");
  await supSel.selectOption(stock);
  await sleep(800);
  await row.locator("select[aria-label='Availability']").selectOption({ label: "In stock" });
  const notFinished = await until(async () => (/tyre size and brand needed/i.test((await row.textContent()) ?? "") ? 1 : null), 30, 500);
  const state1 = await row.getAttribute("data-row-state");
  check("3 (E6): without brand and size the row is 'Not finished: tyre size and brand needed'", state1 !== "priced" && !!notFinished, `${state1} · ${((await row.textContent()) ?? "").slice(-160)}`);
  // The tyre details window.
  await row.locator("[data-tyre-details]").click();
  const dlg = page.locator("[data-tyre-builder]");
  check("3 (E5): the window opens with the size prefilled from the row", (await dlg.count()) === 1 && (await dlg.locator("input[placeholder='275']").inputValue()) === "275" && (await dlg.locator("input[placeholder='20']").inputValue()) === "20");
  await dlg.locator("[data-tyre-brands] button", { hasText: /^Pirelli$/ }).click();
  await dlg.locator("[data-tyre-model]").fill("P Zero");
  const year = String(new Date().getFullYear());
  await dlg.locator("[data-tyre-years] button", { hasText: year }).click();
  await dlg.locator("[data-tyre-marks] button", { hasText: /^N0$/ }).click();
  const preview = (await dlg.locator("[data-tyre-preview]").textContent()) ?? "";
  check("3 (E5): the name builds itself: PIRELLI P ZERO 275/45 R20 N0 (year)", preview === `PIRELLI P ZERO 275/45 R20 N0 (${year})`, preview);
  await dlg.locator("[data-tyre-apply]").click();
  const saved = await until(async () => { const r = (await sql("select description, tyre_spec, brand from public.part_items where id = $1", [tyreId]))[0]; return r?.tyre_spec && /PIRELLI P ZERO 275\/45 R20 N0/i.test(r.description) ? r : null; }, 30, 500);
  check("3 (E5): the row takes the built name and keeps the details", !!saved && saved.tyre_spec?.brand === "Pirelli" && saved.tyre_spec?.model === "P Zero" && saved.brand === "Pirelli", JSON.stringify(saved));
  const state2 = await until(async () => ((await row.getAttribute("data-row-state")) === "priced" ? "priced" : null), 30, 500);
  check("3 (E6): with brand and size the tyre counts as priced (no part number needed)", state2 === "priced");
  const line = await until(async () => (await sql("select title from public.quotation_lines where quotation_id = $1 and part_item_id = $2 and is_active", [quotationId, tyreId]))[0] ?? null, 30, 500);
  check("3 (E6): the quotation line carries the full built name", /PIRELLI P ZERO 275\/45 R20 N0/i.test(line?.title ?? ""), JSON.stringify(line));
  const models = (await sql("select value from public.settings where key = 'tyre_models'"))[0]?.value ?? {};
  check("3 (E5): the model is remembered under its brand for next time", Array.isArray(models?.Pirelli) && models.Pirelli.includes("P Zero"), JSON.stringify(models));
  // Next time: the model is a one-tap chip; Settings shows the list.
  await go(page, `${base}/parts/${jobId}`);
  await page.locator(`[data-row-key='${tyreId}'] [data-tyre-details]`).click();
  const chipSeen = await until(async () => ((await page.locator("[data-tyre-builder] [data-tyre-models] button", { hasText: /P Zero/ }).count()) ? 1 : null), 20, 300);
  check("3 (E5): the model is offered as a chip next time", !!chipSeen);
  await page.keyboard.press("Escape").catch(() => null);
  await page.locator("[data-tyre-builder] button", { hasText: /^Close$/ }).click().catch(() => null);
  await browser.close();
  const { browser: ob, page: op } = await browserFor("owner", { viewport: { width: 1366, height: 1000 } });
  await go(op, `${base}/settings`);
  check("3 (E5): Settings lists 'Pirelli: P Zero' under Tyre models", /Pirelli: P Zero/.test(await op.locator("[data-tyre-models-setting]").inputValue().catch(() => "")));
  await ob.close();
  await sql("update public.settings set value = value - 'Pirelli' where key = 'tyre_models'");
});

/* ---------------- 4. E4: the quotation line menu floats too ---------------- */
await section("4 quote line menu", async () => {
  cleanupDb();
  const { jobId, quotationId } = (await api("/api/e2e/stage", { stage: "quote" })).json;
  const { browser, page } = await browserFor("service_advisor", { viewport: { width: 1366, height: 700 } });
  await go(page, `${base}/jobs/${jobId}/quote/${quotationId}`);
  await until(async () => ((await page.locator("[data-labour-boxes]").count()) ? 1 : null), 30, 500);
  await page.locator("button[aria-label='More for this line']").first().click();
  const placed = await until(async () => page.evaluate(() => { const m = document.querySelector("[data-floating-menu][data-line-menu]"); if (!m) return null; const r = m.getBoundingClientRect(); return { inBody: m.parentElement === document.body, inside: r.top >= 0 && r.bottom <= window.innerHeight + 1 }; }), 20, 200);
  check("4: the line menu is drawn on the body and inside the window", !!placed && placed.inBody && placed.inside, JSON.stringify(placed));
  await page.locator("[data-floating-menu] button", { hasText: /note for the customer/i }).click();
  await sleep(400);
  check("4: tapping an item works and closes the menu", (await page.locator("[data-floating-menu]").count()) === 0 && (await page.locator("textarea[aria-label='Note for the customer'], label:has-text('Note for the customer')").count()) >= 1);
  await browser.close();
});

/* ---------------- 5. F1: the VIN in every car header ---------------- */
await section("5 vin header", async () => {
  cleanupDb();
  const { jobId, quotationId } = (await api("/api/e2e/stage", { stage: "quote" })).json;
  const veh = (await sql("select v.id, v.vin from public.vehicles v join public.jobs j on j.vehicle_id = v.id where j.id = $1", [jobId]))[0];
  if (!veh?.vin) await sql("update public.vehicles set vin = 'WDD2050421R123456' where id = $1", [veh.id]);
  const vin = veh?.vin ?? "WDD2050421R123456";
  const { browser, page } = await browserFor("owner", { viewport: { width: 1366, height: 900 } });
  for (const p of [`/jobs/${jobId}`, `/parts/${jobId}`, `/jobs/${jobId}/quote/${quotationId}`, `/jobs/${jobId}/inspection`, `/jobs/${jobId}/invoice`, `/jobs/${jobId}/gate-out`]) {
    await go(page, `${base}${p}`);
    const el = page.locator(`[data-vin='${vin}']`);
    check(`5: ${p.replace(/[0-9a-f-]{36}/g, "…")} shows the VIN with Copy`, (await el.count()) === 1 && (await el.locator("[data-vin-copy]").count()) === 1);
  }
  await go(page, `${base}/jobs/${jobId}`);
  await page.locator("[data-vin-copy]").click();
  await sleep(300);
  check("5: Copy says Copied", /Copied/.test((await page.locator("[data-vin-copy]").textContent()) ?? ""));
  await sql("update public.vehicles set vin = null where id = $1", [veh.id]);
  await go(page, `${base}/jobs/${jobId}`);
  check("5: a car with no VIN says 'VIN: add at gate-in'", (await page.locator("[data-vin-missing]").count()) === 1 && /VIN: add at gate-in/.test((await page.locator("[data-vin-missing]").textContent()) ?? ""));
  await browser.close();
});

cleanupDb();
process.exit(summary() ? 1 : 0);
