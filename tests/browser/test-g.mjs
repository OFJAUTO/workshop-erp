// Browser checks for the afternoon list of 13 October 2026: import fixes (Outlook paste with blank lines, the Land Rover
// tab order, the mapping screen with five rows and one Import, availability phrases, matching that ignores spaces, Undo
// last import), bulk delete on the Parts table (tick boxes, Delete all, one question, ordered parts kept, Undo for a
// minute), and the clear of the test data (the two dummy cars with photos, the counts, the empty job board).
// Run against `npx next dev -p 3100`:
//   node --env-file=.env.test.local tests/browser/test-g.mjs            (imports and bulk delete)
//   node --env-file=.env.test.local tests/browser/test-g.mjs --clear    (also presses Clear test data at the end: everything goes)
import fs from "node:fs";
import path from "node:path";
import { api, base, browserFor, cleanupDb, go, makeChecks, projectRoot, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const CLEAR = process.argv.includes("--clear");
const CLEAR_ONLY = process.argv.includes("--clear-only");
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 15 * 60 * 1000).unref();
cleanupDb();

const JOB = "22222222-0000-4000-8000-00000000e303";
const PA = "22222222-0000-4000-8000-00000000e306";
const PR1 = "22222222-0000-4000-8000-00000000e309";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");
const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active limit 1"))[0]?.id;

async function section(name, fn) {
  console.log(`\n== ${name}`);
  try {
    await fn();
  } catch (e) {
    check(`${name}: no crash`, false, String(e?.message ?? e).slice(0, 300));
  }
}
const until = async (fn, tries = 60, ms = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } return null; };
const linesRead = (page) => until(async () => { const n = await page.locator("[data-import-line]").count(); return n ? n : null; }, 40, 500);
const supplierValue = async (sel, re) => sel.locator("option").evaluateAll((os, src) => (os.find((o) => new RegExp(src).test(o.textContent ?? "")) ?? {}).value ?? "", re.source);

/* ---------------- B. Import fixes ---------------- */
if (!CLEAR_ONLY) await section("B import fixes", async () => {
  const seed = await api("/api/e2e/stage", { stage: "quote" });
  const { jobId } = seed.json;
  await sql("insert into public.suppliers (name, default_discount_percent, discount_by_type, created_by) values ('E2e Land Rover Dealer', 0, '{}'::jsonb, $1) on conflict do nothing", [owner]);
  // The seed's part gets a part number with no spaces: the import's "pad stage 1"-style number must still match it.
  await sql("update public.part_items set part_number = 'A1673306800' where id = $1", [PA]);
  const { browser, page } = await browserFor("parts", { viewport: { width: 1366, height: 900 } });
  await go(page, `${base}/parts/${jobId}/import`);
  const supplierSel = page.locator("[data-import-supplier]");

  // 1. Outlook / Gmail plain text: one value per line with blank lines between them.
  await page.locator("[data-way='paste']").click();
  await page.locator("[data-paste-box]").fill(fs.readFileSync(path.join(projectRoot, "docs", "landrover-paste-outlook.txt"), "utf8"));
  await page.locator("[data-read-text]").click();
  const n1 = await linesRead(page);
  check("B1: Outlook text with blank lines reads the 3 parts, headings and totals ignored", n1 === 3 && (await page.locator("[data-mapping-step]").count()) === 0, `${n1} lines`);
  const t1 = await page.locator("[data-import-line]").allTextContents();
  check("B7: 'in stock' = Same day, '1 day-1 psc' = Next day, 'will update' = Supplier to confirm", /Same day/.test(t1[0] ?? "") && /Next day/.test(t1[1] ?? "") && /Supplier to confirm/.test(t1[2] ?? ""), t1.map((t) => t.slice(0, 70)).join(" || "));
  check("B2: the totals rows are never parts and the lines add up to the Gross Amount", /✓/.test((await page.locator("[data-totals-check]").textContent()) ?? "") && !t1.some((t) => /Gross|Vat|Net AED/.test(t)));
  await page.getByRole("button", { name: "Start again" }).click();

  // 1b. Tab-separated in the Land Rover order (WipNo first, Availability last), "available" and "back order".
  await page.locator("[data-paste-box]").fill(fs.readFileSync(path.join(projectRoot, "docs", "landrover-paste-sample-tabs-2.txt"), "utf8"));
  await page.locator("[data-read-text]").click();
  const n2 = await linesRead(page);
  const t2 = await page.locator("[data-import-line]").allTextContents();
  check("B1: the tab-separated Land Rover order reads 3 parts with the price from Unit Price, not Total", n2 === 3 && /1 × 7,849\.00/.test(t2[0] ?? "") && /2 × 1,250\.50/.test(t2[1] ?? ""), t2.map((t) => t.slice(0, 70)).join(" || "));
  check("B7: 'available' = Same day and 'back order' = Back order", /Same day/.test(t2[0] ?? "") && /Back order/.test(t2[2] ?? ""));
  check("B3: WipNo and LineNo are ignored (no 45512 or line numbers in the lines)", !t2.some((t) => /45512/.test(t)));
  await page.getByRole("button", { name: "Start again" }).click();

  // 4. The mapping screen: no headings at all, five rows, a dropdown above each column, one Import.
  await page.locator("[data-paste-box]").fill("X1\nE2e widget\n2\n10.00\n\nX2\nE2e gadget\n1\n5.50\n\nX3\nE2e gizmo\n3\n7.00\n\nX4\nE2e thing\n1\n2.00\n\nX5\nE2e other\n2\n4.00\n\nX6\nE2e last\n1\n1.00");
  await page.locator("[data-read-text]").click();
  await until(async () => ((await page.locator("[data-mapping-step]").count()) ? 1 : null), 40, 500);
  check("B4: a paste with no headings opens the mapping screen", (await page.locator("[data-mapping-step]").count()) === 1);
  check("B4: five rows are shown, with a dropdown above each of the 4 columns", (await page.locator("[data-mapping-row]").count()) === 5 && (await page.locator("[data-mapping-select]").count()) === 4, `${await page.locator("[data-mapping-row]").count()} rows, ${await page.locator("[data-mapping-select]").count()} selects`);
  const picked = await page.locator("[data-mapping-select]").evaluateAll((els) => els.map((e) => e.value));
  check("B4: the meanings are filled in by themselves (part number, name, qty, price)", picked[0] === "partNumber" && picked[1] === "description" && picked[2] === "qty" && picked[3] === "net", picked.join(","));
  const opts = await page.locator("[data-mapping-select]").first().locator("option").allTextContents();
  check("B4: the dropdown offers Part number, Name, Qty, Price, Availability, Ignore", ["Part number", "Name", "Qty", "Price", "Availability", "Ignore"].every((o) => opts.includes(o)), opts.join("|"));
  check("B4: one Import button", (await page.locator("[data-apply-mapping]").count()) === 1 && (await page.locator("[data-apply-mapping]").textContent())?.trim() === "Import");
  await page.locator("[data-apply-mapping]").click();
  const n3 = await linesRead(page);
  check("B4: Import reads the 6 lines with the chosen meanings", n3 === 6 && /E2e widget/.test((await page.locator("[data-import-line]").first().textContent()) ?? "") && /× 10\.00/.test((await page.locator("[data-import-line]").first().textContent()) ?? ""));
  await page.getByRole("button", { name: "Start again" }).click();

  // 5. B2BConnect: the net is the cost, the list is kept, a part number with spaces matches one without.
  await page.locator("[data-way='file']").click();
  await page.locator("[data-file-input]").setInputFiles(path.join(projectRoot, "docs", "B2BConnect_Format_9.xlsx"));
  const n4 = await linesRead(page);
  check("B5: the Mercedes file reads 98 lines", n4 === 98);
  const pulley = page.locator("[data-import-line]", { hasText: "A 156 202 08 19" }).first();
  check("B5: list price kept for reference next to the net", /List 170\.00/.test((await pulley.textContent()) ?? "") && /× 76\.50/.test((await pulley.textContent()) ?? ""));
  const bolt = page.locator("[data-import-line]", { hasText: "N910105 012018" }).first();
  void bolt;
  // A line whose number is "A 167 330 68 00" (spaces) must find the seed part saved as A1673306800.
  const spaced = page.locator("[data-import-line]", { hasText: "A 167 330 68 00" });
  if (await spaced.count()) {
    const v = await spaced.first().locator("[data-match-select]").inputValue();
    check("B5: 'A 167 330 68 00' matches the part saved as 'A1673306800' (spaces ignored)", v === PA, v);
  } else {
    // Not in this file: check the rule through the pasted text instead.
    check("B5: (the Mercedes sample has no A 167 330 68 00 line; matching checked below)", true);
  }
  await page.getByRole("button", { name: "Start again" }).click();
  await page.locator("[data-way='paste']").click();
  await page.locator("[data-paste-box]").fill("Part\tDescription\tQty\tNet Price\nA 167 330 68 00\tGUIDE PULLEY\t1\t76.50");
  await page.locator("[data-read-text]").click();
  await linesRead(page);
  const mv = await page.locator("[data-import-line]").first().locator("[data-match-select]").inputValue();
  check("B5: 'A 167 330 68 00' is matched to the row saved as 'A1673306800'", mv === PA, mv);

  // 8. Apply the Outlook paste, then Undo last import takes back exactly what it did.
  await page.getByRole("button", { name: "Start again" }).click();
  await page.locator("[data-paste-box]").fill(fs.readFileSync(path.join(projectRoot, "docs", "landrover-paste-outlook.txt"), "utf8"));
  await page.locator("[data-read-text]").click();
  await linesRead(page);
  const before = (await sql("select part_number, cost_aed, supplier, availability from public.part_items where id = $1", [PA]))[0];
  const partsBefore = (await sql("select count(*)::int as n from public.part_items where job_id = $1 and is_active", [jobId]))[0]?.n ?? 0;
  // Line 1 onto the seed part, the other two as new parts.
  await page.locator("[data-import-line]").nth(0).locator("[data-match-select]").selectOption(PA);
  await page.locator("[data-import-line]").nth(1).locator("[data-match-select]").selectOption("new");
  await page.locator("[data-import-line]").nth(2).locator("[data-match-select]").selectOption("new");
  await supplierSel.selectOption(await supplierValue(supplierSel, /E2e Land Rover Dealer/));
  await page.locator("[data-confirm-all]").click();
  await page.locator("[data-apply]").click();
  await page.waitForURL((u) => /\/parts\/.*message=/.test(u.toString()), { timeout: 60000 }).catch(() => null);
  check("B8: Apply lands on the Parts page saying Undo last import is there", /3 prices imported/.test(decodeURIComponent(page.url())) && /Undo last import/.test(decodeURIComponent(page.url())), decodeURIComponent(page.url()).slice(-120));
  await sleep(1500);
  const after = (await sql("select part_number, cost_aed, supplier, availability, delivery_date, availability_note from public.part_items where id = $1", [PA]))[0];
  check("B8: the matched part took the import (number, cost, supplier, Same day)", after?.part_number === "LR123456" && Number(after?.cost_aed) === 7849 && /Land Rover/.test(after?.supplier ?? "") && after?.availability === "to_order" && !!after?.delivery_date, JSON.stringify(after));
  const sensor = (await sql("select availability, availability_note, cost_aed from public.part_items where job_id = $1 and part_number = 'LR555111' and is_active", [jobId]))[0];
  check("B7: 'will update' leaves the availability open with the note, the price untouched", !!sensor && sensor.availability === null && /Supplier to confirm/.test(sensor.availability_note ?? "") && Number(sensor.cost_aed) === 1503, JSON.stringify(sensor));
  const partsAfter = (await sql("select count(*)::int as n from public.part_items where job_id = $1 and is_active", [jobId]))[0]?.n ?? 0;
  check("B8: two new parts were added", partsAfter === partsBefore + 2, `${partsBefore} → ${partsAfter}`);
  check("B8: the Parts page shows Undo last import (3)", (await page.locator("[data-undo-import]").count()) === 1 && /Undo last import \(3\)/.test((await page.locator("[data-undo-import]").textContent()) ?? ""));
  check("B8: the row shows the supplier's note on its status line", /Supplier to confirm/.test((await page.locator("[data-row-key]", { hasText: /wear sensor front/i }).first().locator("[data-status-line]").textContent()) ?? ""));
  await page.locator("[data-undo-import]").click();
  // The undo works line by line; wait for it to be marked done before reading the results.
  await until(async () => ((await sql("select undone_at from public.price_imports where job_id = $1 order by created_at desc limit 1", [jobId]))[0]?.undone_at ? "done" : null), 40, 500);
  const undone = await until(async () => { const r = (await sql("select part_number, cost_aed, supplier, availability from public.part_items where id = $1", [PA]))[0]; return r?.part_number === before.part_number ? r : null; }, 30, 500);
  check("B8: Undo put the matched part's earlier figures back", !!undone && Number(undone.cost_aed) === Number(before.cost_aed) && (undone.supplier ?? null) === (before.supplier ?? null) && (undone.availability ?? null) === (before.availability ?? null), JSON.stringify({ before, undone }));
  const partsUndone = (await sql("select count(*)::int as n from public.part_items where job_id = $1 and is_active", [jobId]))[0]?.n ?? 0;
  check("B8: Undo removed the two parts the import added, nothing else", partsUndone === partsBefore, `${partsBefore} → ${partsUndone}`);
  const imp = (await sql("select undone_at from public.price_imports where job_id = $1 order by created_at desc limit 1", [jobId]))[0];
  check("B8: the import is marked undone", !!imp?.undone_at);
  await until(async () => ((await page.locator("[data-undo-import]").count()) === 0 ? "gone" : null), 20, 500);
  check("B8: the Undo button is gone afterwards", (await page.locator("[data-undo-import]").count()) === 0);

  // 9. Part numbers off the customer's quotation page and PDF (the seed's title still carries one; the PDF strips it).
  const r = await fetch(`${base}/api/pdf/quote/${seed.json.token}`);
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(Buffer.from(await r.arrayBuffer()), "application/pdf");
  let text = "";
  for (let i = 0; i < doc.countPages(); i++) text += doc.loadPage(i).toStructuredText("preserve-whitespace").asText();
  check("B9: the customer quotation PDF carries no part number", !/pad-stage-1|A1673306800|LR123456/i.test(text), text.replace(/\s+/g, " ").slice(0, 120));
  const qpage = await (await fetch(`${base}/quote/${seed.json.token}`)).text();
  check("B9: the customer quotation page carries no part number", !/PAD-STAGE-1|A1673306800|LR123456/i.test(qpage));
  await browser.close();
});

/* ---------------- C. Bulk delete on the Parts table ---------------- */
if (!CLEAR_ONLY) await section("C bulk delete", async () => {
  const jobId = JOB;
  // Three more parts: one of them ordered (kept), two free.
  await sql("insert into public.part_items (job_id, description, part_number, quantity, cost_aed, order_status, confirm_status, is_active, created_by, updated_by) values ($1, 'E2e ordered part', 'ORD-1', 1, 100, 'ordered', 'confirmed', true, $2, $2), ($1, 'E2e free part one', 'FREE-1', 1, 50, 'none', 'confirmed', true, $2, $2), ($1, 'E2e free part two', 'FREE-2', 1, 60, 'none', 'confirmed', true, $2, $2)", [jobId, owner]);
  const { browser, page } = await browserFor("parts", { viewport: { width: 1366, height: 900 } });
  await go(page, `${base}/parts/${jobId}`);
  const rowsBefore = await page.locator("[data-row-key]").count();
  check("C1: every row has a tick box and the heading has Select all", (await page.locator("[data-row-select]").count()) === rowsBefore && (await page.locator("[data-select-all]").count()) === 1, `${rowsBefore} rows`);
  const del = page.locator("[data-delete-all]");
  check("C2: a Delete all button sits left of Show only unpriced", (await del.count()) === 1 && (await del.textContent())?.trim() === "Delete all" && (await del.evaluate((b) => b.getBoundingClientRect().left)) < (await page.getByRole("button", { name: /Show only unpriced/ }).evaluate((b) => b.getBoundingClientRect().left)));
  // Tick two rows: the button says how many, the question names the count, no reason box.
  await page.locator("[data-row-key]", { hasText: "E2e free part one" }).locator("[data-row-select]").check();
  await page.locator("[data-row-key]", { hasText: "E2e ordered part" }).locator("[data-row-select]").check();
  check("C1: the button counts the ticked rows", (await del.textContent())?.trim() === "Delete 2 ticked");
  await del.click();
  await sleep(200);
  const dlg = page.locator("[data-delete-confirm]");
  check("C2/C5: one question with the count, saying the ordered part is kept", (await dlg.count()) === 1 && /Delete 1 part\?/.test((await dlg.textContent()) ?? "") && /1 ordered part is kept/.test((await dlg.textContent()) ?? ""), ((await dlg.textContent()) ?? "").slice(0, 160));
  check("C3: no reason box in the question", (await dlg.locator("input, textarea").count()) === 0);
  await page.locator("[data-delete-confirm-yes]").click();
  await until(async () => ((await page.locator("[data-row-key]", { hasText: "E2e free part one" }).count()) === 0 ? "gone" : null), 20, 300);
  check("C6: the deleted row vanished at once, the ordered one stays", (await page.locator("[data-row-key]", { hasText: "E2e free part one" }).count()) === 0 && (await page.locator("[data-row-key]", { hasText: "E2e ordered part" }).count()) === 1);
  const toast = page.locator("[data-delete-toast]");
  check("C4/C5: '1 part deleted · 1 ordered part was kept' with Undo", /1 part deleted/.test((await toast.textContent()) ?? "") && /1 ordered part was kept/.test((await toast.textContent()) ?? "") && (await page.locator("[data-undo-delete]").count()) === 1, (await toast.textContent()) ?? "");
  const gone = (await sql("select is_active, deleted_at, delete_batch from public.part_items where job_id = $1 and part_number = 'FREE-1'", [jobId]))[0];
  check("C6: the deleted part is inactive with a batch id", !!gone && gone.is_active === false && !!gone.deleted_at && !!gone.delete_batch, JSON.stringify(gone));
  const kept = (await sql("select is_active from public.part_items where job_id = $1 and part_number = 'ORD-1'", [jobId]))[0];
  check("C5: the ordered part was not touched", kept?.is_active === true);
  await page.locator("[data-undo-delete]").click();
  const back = await until(async () => ((await sql("select is_active from public.part_items where job_id = $1 and part_number = 'FREE-1'", [jobId]))[0]?.is_active ? "yes" : null), 30, 500);
  check("C4: Undo brings the deleted part back", back === "yes");
  await until(async () => ((await page.locator("[data-row-key]", { hasText: "E2e free part one" }).count()) === 1 ? "yes" : null), 30, 500);
  check("C4: the row is back on the screen", (await page.locator("[data-row-key]", { hasText: "E2e free part one" }).count()) === 1);
  // Nothing ticked: Delete all takes every unordered row of the job and keeps the ordered one.
  const liveBefore = (await sql("select count(*)::int as n from public.part_items where job_id = $1 and is_active", [jobId]))[0]?.n ?? 0;
  await del.click();
  await sleep(200);
  const txt = (await page.locator("[data-delete-confirm]").textContent()) ?? "";
  check("C2: with nothing ticked the question counts every unordered part", /Delete \d+ parts?\?/.test(txt) && /1 ordered part is kept/.test(txt), txt.slice(0, 120));
  await page.locator("[data-delete-confirm-yes]").click();
  await until(async () => ((await page.locator("[data-row-key]").count()) === 1 ? "yes" : null), 30, 500);
  check("C6: only the ordered row is left on the screen", (await page.locator("[data-row-key]").count()) === 1 && /E2e ordered part/.test((await page.locator("[data-row-key]").first().textContent()) ?? ""));
  const liveAfter = (await sql("select count(*)::int as n from public.part_items where job_id = $1 and is_active", [jobId]))[0]?.n ?? 0;
  check("C5: in the database only the ordered part is still live", liveAfter === 1 && liveBefore > 1, `${liveBefore} → ${liveAfter}`);
  const reqs = (await sql("select count(*)::int as n from public.part_requests where job_id = $1 and is_active", [jobId]))[0]?.n ?? 0;
  check("C6: the requests without a part went too", reqs === 0, `${reqs} live requests`);
  const lines = (await sql("select count(*)::int as n from public.quotation_lines l join public.part_items p on p.id = l.part_item_id where p.job_id = $1 and l.is_active and p.is_active = false", [jobId]))[0]?.n ?? 0;
  check("C6: deleted parts have no live quotation line", lines === 0);
  await browser.close();
});

/* ---------------- A. Clear test data ---------------- */
if (CLEAR) {
  await section("A clear test data", async () => {
    cleanupDb();
    // Two dummy cars with photos, made the way the screens make them.
    const cars = [];
    for (let i = 0; i < 2; i++) {
      const r = await api("/api/e2e/car", { plate: String(900 + i) });
      cars.push(r.json);
    }
    check("A6: two dummy cars made", cars.length === 2 && cars.every((c) => c?.job_id), JSON.stringify(cars));
    const cookies = await (await import("./pw-lib.mjs")).cookieHeader("owner");
    for (const c of cars) {
      const prep = await api("/api/media/prepare", { jobId: c.job_id, kind: "car_picture", contentType: "image/png" }, cookies);
      await fetch(prep.json.url, { method: "PUT", headers: { "Content-Type": "image/png", "x-upsert": "false", apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "" }, body: PNG });
      const reg = await api("/api/media/register", { jobId: c.job_id, kind: "car_picture", path: prep.json.path }, cookies);
      check("A6: a photo saved for the dummy car", !!reg.json?.ok);
    }
    const countsBefore = (await sql("select json_build_object('jobs', (select count(*) from jobs), 'vehicles', (select count(*) from vehicles), 'customers', (select count(*) from customers), 'gate_in_media', (select count(*) from gate_in_media), 'files', (select count(*) from storage.objects where bucket_id in ('gate-in-media','vehicle-photos','inspection-media','job-files')), 'audit_log', (select count(*) from audit_log)) as c"))[0]?.c;
    console.log("   counts before:", JSON.stringify(countsBefore));
    const { browser, page } = await browserFor("owner", { viewport: { width: 1366, height: 900 } });
    await go(page, `${base}/settings`);
    const box = page.locator("input[name=confirm]");
    check("A: the Clear test data card is on Settings (testing phase on)", (await box.count()) === 1);
    await box.fill("CLEAR TEST DATA");
    await page.getByRole("button", { name: "Clear test data" }).click();
    const report = await until(async () => { const t = (await page.locator("pre").first().textContent().catch(() => "")) ?? ""; return /Deleted \d+ rows/.test(t) ? t : null; }, 240, 1000);
    check("A1: the clear ran through with a report and no error", !!report && !/Could not/.test((await page.textContent("body")) ?? ""), (report ?? ((await page.textContent("body")) ?? "")).slice(0, 400));
    console.log("   report:", (report ?? "").replace(/\s+/g, " ").slice(0, 600));
    check("A2: the backup skipped the change log and is in compressed files", /compressed files; the change log is not backed up/.test(report ?? ""));
    const countsAfter = (await sql("select json_build_object('jobs', (select count(*) from jobs), 'vehicles', (select count(*) from vehicles), 'customers', (select count(*) from customers), 'gate_in_media', (select count(*) from gate_in_media), 'files', (select count(*) from storage.objects where bucket_id in ('gate-in-media','vehicle-photos','inspection-media','job-files')), 'audit_log', (select count(*) from audit_log), 'staff', (select count(*) from staff), 'suppliers', (select count(*) from suppliers), 'settings', (select count(*) from settings), 'part_catalogue', (select count(*) from part_catalogue)) as c"))[0]?.c;
    console.log("   counts after:", JSON.stringify(countsAfter));
    check("A5: cars, customers, jobs, media and their files are gone", Number(countsAfter.jobs) === 0 && Number(countsAfter.vehicles) === 0 && Number(countsAfter.customers) === 0 && Number(countsAfter.gate_in_media) === 0 && Number(countsAfter.files) === 0, JSON.stringify(countsAfter));
    check("A5: staff, suppliers, settings, the parts list and the change log stay", Number(countsAfter.staff) > 0 && Number(countsAfter.suppliers) > 0 && Number(countsAfter.settings) > 0 && Number(countsAfter.part_catalogue) > 0 && Number(countsAfter.audit_log) > 0);
    const seqs = await sql("select (select is_called from public.job_number_seq) as job_called, (select is_called from public.customer_number_seq) as cust_called, (select is_called from public.invoice_number_seq) as inv_called");
    check("A5: numbering starts again at 00001 (the counters are reset)", seqs[0]?.job_called === false && seqs[0]?.cust_called === false && seqs[0]?.inv_called === false, JSON.stringify(seqs[0]));
    await go(page, `${base}/dashboard`);
    const dash = (await page.textContent("body")) ?? "";
    check("A: the job board is empty", /No cars in the workshop/i.test(dash) && !/J-0\d{4}/.test(dash), dash.replace(/\s+/g, " ").slice(0, 160));
    await browser.close();
  });
}

cleanupDb();
const failed = summary();
process.exit(failed ? 1 : 0);
