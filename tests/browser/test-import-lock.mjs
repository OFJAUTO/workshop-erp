// 22 October 2026 proof: the Autovivo PDF (Part No. column empty) imported through the real screens, the courier as
// a supplier charge on the LPO, the totals check ✓, and the safety lock blocking the old broken reading.
// Run: node --env-file=.env.test.local tests/browser/test-import-lock.mjs   (dev server on :3100)
import path from "node:path";
import fs from "node:fs";
import { api, base, browserFor, cleanupDb, cookieHeader, go, here, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shot = (name) => path.join(here, "shots", name);
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const FIX = path.join(here, "..", "fixtures", "supplier-autovivo-q2206129.pdf");
const exp = JSON.parse(fs.readFileSync(path.join(here, "..", "fixtures", "supplier-autovivo-q2206129.expected.json"), "utf8"));
const text = async (loc) => ((await loc.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();

cleanupDb();
const seed = await api("/api/e2e/stage", { stage: "quote" });
const jobId = seed.json?.jobId;
if (!jobId) { console.error("seed failed", seed); process.exit(1); }
// The real car (J-00016) holds this VIN and VINs are unique, so the test car keeps its own: the PDF's VIN is checked by the warning.
const autovivo = (await sql("select id from public.suppliers where name = 'Auto Vivo Italian Luxury Car Parts'"))[0]?.id;

const { browser, page } = await browserFor("parts", { viewport: { width: 1440, height: 1000 } });

/* 1. The PDF through the screen */
await go(page, `${base}/parts/${jobId}/import`);
await page.locator('[data-way="pdf"]').click();
await page.locator("[data-pdf-input]").setInputFiles(FIX);
await page.locator("[data-check-screen]").waitFor({ timeout: 30000 });
check("1: the supplier is pre-filled (Auto Vivo Italian Luxury Car Parts)", (await page.locator("[data-import-supplier]").inputValue()) === autovivo);
check("1: the VIN in the PDF (ZPBEC3ZL2RLA32299) is read and compared with the car", /ZPBEC3ZL2RLA32299/.test(await text(page.locator("[data-vin-warning], [data-vin-ok]").first())));
const vinTick = page.locator("[data-vin-warning] input[type=checkbox]");
if (await vinTick.count()) await vinTick.check();
const totals = await text(page.locator("[data-totals-check]"));
check("1: totals 255,394.00 · VAT 12,769.70 · 268,163.70 ✓ matches the PDF total", (await page.locator('[data-totals-check][data-totals-state="ok"]').count()) === 1 && /255,394\.00/.test(totals) && /12,769\.70/.test(totals) && /268,163\.70/.test(totals) && /✓ matches the PDF total/.test(totals), totals);
check("1: 62 part lines + 1 supplier charge", (await page.locator("[data-import-line]").count()) === 62 && (await page.locator("[data-import-charge]").count()) === 1);
const lineRow = (n) => page.locator("[data-import-line]").filter({ has: page.locator(`[data-line-serial]:text-is("${n}")`) }).first();
for (const n of [1, 3, 21, 47, 58]) {
  const [name, qty, price] = exp.parts[n - 1];
  const t = await text(lineRow(n));
  const fig = `${qty} × ${price.toLocaleString("en-GB", { minimumFractionDigits: 2 })} = ${(qty * price).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`;
  check(`1: line ${n} ${name} · ${fig} · Part no. —`, t.includes(name) && t.includes(fig) && t.includes("Part no. —"), t.slice(0, 160));
}
check("1: the courier is a supplier charge (AED 7,500.00), not a part", /COURIER CHARGE/.test(await text(page.locator("[data-import-charges]"))) && /7,500\.00/.test(await text(page.locator("[data-charge-amount]"))));
check("1: nothing red, nothing locked", (await page.locator('[data-line-state="red"], [data-line-state="amber"]').count()) === 0 && (await page.locator("[data-import-lock]").count()) === 0);
await page.screenshot({ path: shot("import-1-check-top.png") });
await page.locator("[data-import-charges]").scrollIntoViewIfNeeded();
await page.screenshot({ path: shot("import-2-check-courier.png") });

await page.locator("[data-confirm-all]").click();
await page.locator("[data-apply]").click();
await page.waitForURL(/\/parts\/[^/]+\?message=/, { timeout: 120000 });
const msg = decodeURIComponent(page.url().split("message=")[1] ?? "");
check("1: Apply: 62 prices and 1 supplier charge imported", /62 prices and 1 supplier charge/.test(msg), msg);

/* 2. What landed */
const rows = await sql("select description, confirmed_quantity::float8 as q, cost_aed::float8 as c, part_number, supplier from public.part_items where job_id = $1 and is_active and description <> all($2) order by created_at", [jobId, ["Brake pads (front)"]]);
const imported = rows.filter((r) => exp.parts.some(([n]) => n === r.description));
check("2: 62 parts on the car's list", imported.length === 62, String(imported.length));
for (const n of [1, 3, 21, 47, 58]) {
  const [name, qty, price] = exp.parts[n - 1];
  const r = imported.find((x) => x.description === name && x.c === price);
  check(`2: ${name} saved as qty ${qty} × net ${price}`, !!r && r.q === qty && r.part_number === null, JSON.stringify(r));
}
check("2: no part has a quantity above 6 or a part number", imported.every((r) => r.q <= 6 && r.part_number === null));
const ch = await sql("select description, amount_aed::float8 as a, supplier_name, po_id from public.supplier_charges where job_id = $1 and is_active", [jobId]);
check("2: COURIER CHARGE AED 7,500 saved as a supplier charge of Auto Vivo", ch.length === 1 && ch[0].a === 7500 && /auto vivo/i.test(ch[0].supplier_name), JSON.stringify(ch));
await go(page, `${base}/parts/${jobId}`);
const strip = await text(page.locator("[data-supplier-charges]"));
check("2: the Parts page shows the courier under Supplier charges, not as a part", /COURIER CHARGE/i.test(strip) && /7,500\.00/.test(strip) && (await page.locator("text=COURIER CHARGE").count()) >= 1);
const bar = await text(page.locator("[data-cost-bar]"));
// The seeded car has one AED 200 part of its own; Auto Vivo's share is the PDF: 247,894 of parts + 7,500 courier.
check("2: Our cost counts the courier: Auto Vivo AED 255,394.00 (parts + courier)", /Auto Vivo Italian Luxury Car Parts AED 255,394\.00/.test(bar) && /incl\. supplier charges AED 7,500\.00/.test(bar), bar.slice(0, 200));
await page.locator("[data-supplier-charges]").scrollIntoViewIfNeeded();
await page.screenshot({ path: shot("import-3-parts-page-charge.png") });
await page.locator("[data-cost-bar]").first().scrollIntoViewIfNeeded().catch(() => null);
await page.screenshot({ path: shot("import-4-parts-page-cost.png") });

/* 3. The LPO carries the courier */
await sql("update public.part_items set order_status = 'to_order' where job_id = $1 and is_active and supplier is not null and cost_aed is not null", [jobId]);
await sql("update public.jobs set status = 'waiting_parts', stage = 'parts' where id = $1", [jobId]);
await go(page, `${base}/parts/${jobId}`);
const send = page.locator("[data-send-lpo]");
if (await send.count()) {
  await send.click();
  await page.waitForURL(/message=/, { timeout: 60000 });
}
const main = (await sql("select id, number, total_cost_aed::float8 as t from public.purchase_orders where job_id = $1 and kind = 'main' and is_active order by created_at desc limit 1", [jobId]))[0];
const onMain = (await sql("select po_id from public.supplier_charges where job_id = $1 and is_active", [jobId]))[0];
check("3: the main LPO includes the courier (total 255,394.00)", !!main && main.t >= 255394 && onMain?.po_id === main.id, JSON.stringify({ main, onMain }));
await browser.close();

const { browser: ob, page: op } = await browserFor("owner", { viewport: { width: 1440, height: 1000 } });
if (main) {
  await go(op, `${base}/parts/orders/${main.id}`);
  const why = op.locator("textarea[name=override_reason]");
  if (await why.count()) await why.fill("E2e test approval without deposit");
  await op.locator('button[name="decision"][value="approve"]').click();
  await op.waitForURL(/message=|error=/, { timeout: 60000 });
  const sup = (await sql("select id, number, total_cost_aed::float8 as t from public.purchase_orders where parent_id = $1 and is_active", [main.id]))[0];
  const onSup = (await sql("select po_id from public.supplier_charges where job_id = $1 and is_active", [jobId]))[0];
  check("3: at approval the courier moves to Auto Vivo's own LPO (total incl. courier)", !!sup && onSup?.po_id === sup.id && Math.abs(sup.t - 255394) < 0.01, JSON.stringify({ sup, onSup }));
  if (sup) {
    await go(op, `${base}/parts/orders/${sup.id}`);
    check("3: the LPO page lists 'Other charge · COURIER CHARGE'", (await op.locator("[data-lpo-charge]").count()) >= 1);
    await op.locator("[data-lpo-charge]").first().scrollIntoViewIfNeeded();
    await op.screenshot({ path: shot("import-5-lpo-courier.png") });
    const r = await fetch(`${base}/api/pdf/po/${sup.id}`, { headers: { cookie: await cookieHeader("owner") } });
    const mupdf = await import("mupdf");
    const doc = mupdf.Document.openDocument(Buffer.from(await r.arrayBuffer()), "application/pdf");
    let t = "";
    for (let i = 0; i < doc.countPages(); i++) t += doc.loadPage(i).toStructuredText("preserve-whitespace").asText();
    t = t.replace(/\s+/g, " ");
    check("3: the supplier's LPO PDF carries COURIER CHARGE 7,500.00 and net 255,394.00", /COURIER CHARGE/i.test(t) && /7,500\.00/.test(t) && /255,394\.00/.test(t), t.slice(-300));
    fs.writeFileSync(shot("import-6-lpo-pdf-last-page.png"), Buffer.from(doc.loadPage(doc.countPages() - 1).toPixmap(mupdf.Matrix.scale(1.4, 1.4), mupdf.ColorSpace.DeviceRGB, false, true).asPNG()));
  }
}
await ob.close();

/* 4. The safety lock: the old left-to-right reading pasted in (the empty Part No. column dropped) */
const { browser: b2, page: p2 } = await browserFor("parts", { viewport: { width: 1440, height: 1000 } });
await go(p2, `${base}/parts/${jobId}/import`);
await p2.locator('[data-way="paste"]').click();
const broken = ["Sl No.\tPart No.\tDescription\tQty\tPrice\tTotal", ...exp.parts.map(([n, q, p], i) => `${i + 1}\t${n}\t${q.toFixed(2)}\t${p.toLocaleString("en-GB", { minimumFractionDigits: 2 })}\t${(q * p).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`), "Total\t255,394.00", "VAT 5%\t12,769.70", "Net Total\t268,163.70"].join("\n");
await p2.locator("[data-paste-box]").fill(broken);
await p2.locator("[data-read-text]").click();
await p2.locator("[data-check-screen]").waitFor({ timeout: 30000 });
await p2.locator("[data-import-supplier]").selectOption(autovivo);
if (await p2.locator("[data-vin-warning] input[type=checkbox]").count()) await p2.locator("[data-vin-warning] input[type=checkbox]").check();
const confirmAll = p2.locator("[data-confirm-all]");
if (await confirmAll.count()) await confirmAll.click();
const lockText = await text(p2.locator("[data-import-lock]"));
check("4: the broken reading is BLOCKED: 'Lines add up to AED 6.9 bn but the pasted text total is AED 255,394 – check the red lines'", /Lines add up to AED 6\.9 bn but the pasted text total is AED 255,394 – check the red lines/.test(lockText), lockText.slice(0, 200));
check("4: Apply is disabled and says locked", (await p2.locator("[data-apply]").isDisabled()) && /locked/i.test(await text(p2.locator("[data-apply]"))));
check("4: the bad lines are flagged (qty 4,350 is unusual)", (await p2.locator('[data-line-state="amber"], [data-line-state="red"]').count()) >= 60);
await p2.locator("[data-totals-check]").scrollIntoViewIfNeeded();
await p2.screenshot({ path: shot("import-7-lock-totals.png") });
await p2.locator("[data-import-bar]").scrollIntoViewIfNeeded();
await p2.screenshot({ path: shot("import-8-lock-apply.png") });
const before = (await sql("select count(*)::int as n from public.part_items where job_id = $1", [jobId]))[0].n;
await p2.locator("[data-apply]").click({ force: true }).catch(() => null);
await sleep(1500);
check("4: nothing was written", (await sql("select count(*)::int as n from public.part_items where job_id = $1", [jobId]))[0].n === before);
await b2.close();

cleanupDb();
process.exit(summary() ? 1 : 0);
