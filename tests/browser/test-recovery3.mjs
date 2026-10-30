// Overnight 22-23 October 2026, section 3: change the price of a queried recovery trip.
// A queried flatbed pick-up (AED 120 for 12.7 km) is flagged against the normal rate (~AED 85), the owner changes it
// to AED 90 with a reason, the original stays crossed out, the WhatsApp to the driver is prepared, his page shows the
// change, Approve at the new price, the month and the Excel use the final price; accounts may change a price too;
// the rates are set in Settings.
// Run: node --env-file=.env.test.local tests/browser/test-recovery3.mjs   (dev server; E2E_BASE for another port)
import path from "node:path";
import { base, browserFor, cleanupDb, cookieHeader, go, here, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shot = (name) => path.join(here, "shots", name);
const text = async (loc) => ((await loc.first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();

cleanupDb();
const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active limit 1"))[0].id;
const ratesBefore = (await sql("select value::text as v from public.settings where key = 'recovery_rates'"))[0]?.v;
const today = (await sql("select to_char(now() at time zone 'Asia/Dubai', 'YYYY-MM-DD') as d"))[0].d;
const mk = async (status, price, place, phone) => (await sql(
  "insert into public.recovery_trips (kind, company, recovery_kind, driver_name, driver_phone, location_details, road_km, km_source, price_aed, price_at, status, query_note, delivered_at, loaded_at, token, created_by, updated_by) values ('pickup', 'E2e Flatbed Co', 'flatbed', 'E2e Driver', $1, $2, 12.7, 'manual', $3, now(), $4, $5, now(), now(), $6, $7, $7) returning id, token",
  [phone, place, price, status, status === "queried" ? "Price looks high for the distance" : null, `e2etok${Math.random().toString(36).slice(2, 14)}`, owner],
))[0];
const a = await mk("queried", 120, "E2e Frond C Villa 18", "0500000001");
const b = await mk("claimed", 200, "E2e Marina Gate 2", "0500000002");

/* 1. The owner: the flag, Change price, the history, the WhatsApp */
const { browser, page } = await browserFor("owner", { viewport: { width: 1366, height: 1000 } });
await go(page, `${base}/recovery`);
const row = page.locator(`[data-trip="${a.id}"]`);
check("1: the queried trip is flagged 'AED 120 vs expected ~AED 85 for 12.7 km'", /AED 120 vs expected ~AED 85 for 12\.7 km/.test(await text(row.locator("[data-trip-flag]"))), await text(row.locator("[data-trip-flag]")));
await row.locator("[data-change-price] summary").click();
check("1: the suggested price (AED 85) is next to Change price, pre-filled", (await row.locator("[data-change-price-box]").inputValue()) === "85" && /Suggested: AED 85/.test(await text(row.locator("[data-change-price-suggested]"))));
await row.scrollIntoViewIfNeeded();
await page.screenshot({ path: shot("rec3-1-flag-and-change.png") });
await row.locator("[data-change-price-box]").fill("90");
await row.locator('input[name="reason"]').fill("Price looks high for the distance");
await row.locator("[data-change-price-save]").click();
await page.waitForURL(/message=/, { timeout: 30000 });
const t1 = (await sql("select price_aed::float8 as p, original_price_aed::float8 as o, jsonb_array_length(price_history) as n, status from public.recovery_trips where id = $1", [a.id]))[0];
check("1: the price is AED 90 now, the driver's AED 120 kept, one change written", t1.p === 90 && t1.o === 120 && t1.n === 1 && t1.status === "queried", JSON.stringify(t1));
const row2 = page.locator(`[data-trip="${a.id}"]`);
check("1: the original AED 120 is crossed out in the history", (await row2.locator("[data-price-original]").count()) === 1 && /line-through/.test((await row2.locator("[data-price-original]").getAttribute("class")) ?? "") && /AED 90/.test(await text(row2.locator("[data-price-history]"))));
const dayWord = new Date(`${today}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const msg = await text(row2.locator("[data-price-change-message]"));
check(`1: the WhatsApp to the driver is prepared: 'Pick-up ${dayWord} E2e Frond C Villa 18: price changed from AED 120 to AED 90 – Price looks high for the distance'`, msg.includes(`Pick-up ${dayWord} E2e Frond C Villa 18: price changed from AED 120 to AED 90 – Price looks high for the distance`), msg);
check("1: the WhatsApp button goes to the driver's number", /wa\.me\/971500000001\?text=/.test((await row2.locator("[data-price-change-whatsapp]").getAttribute("href")) ?? ""));
await row2.scrollIntoViewIfNeeded();
await page.screenshot({ path: shot("rec3-2-changed.png") });

/* 2. The driver's page shows the change */
const { browser: db, page: dp } = await browserFor("owner", { viewport: { width: 400, height: 800 } });
await go(dp, `${base}/drive/${a.token}`);
check("2: the driver's page shows 'Price changed from AED 120 to AED 90' with the reason", /Price changed from AED 120 to AED 90/.test(await text(dp.locator("[data-drive-price-change]"))) && /Price looks high/.test(await text(dp.locator("[data-drive-price-change]"))));
await dp.screenshot({ path: shot("rec3-3-driver-page.png") });
await db.close();

/* 3. Approve at the new price; the month and the Excel use the final price */
await row2.locator("[data-trip-approve]").click();
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const appr = await until(async () => { const r = (await sql("select status, price_aed::float8 as p from public.recovery_trips where id = $1", [a.id]))[0]; return r?.status === "approved" ? r : null; });
check("3: approved at AED 90", !!appr && appr.p === 90, JSON.stringify(appr));
await go(page, `${base}/recovery`);
const monthRow = await text(page.locator('[data-recovery-who="E2e Flatbed Co"]'));
check("3: the month's total for the company uses the final price (90 + 200 = AED 290)", /AED 290/.test(monthRow), monthRow);
const res = await fetch(`${base}/api/export/recovery?month=${today.slice(0, 7)}`, { headers: { cookie: await cookieHeader("owner") } });
const ExcelJS = (await import("exceljs")).default;
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
const ws = wb.worksheets[0];
const head = ws.getRow(1).values.map((v) => String(v ?? ""));
const col = (h) => head.indexOf(h);
let xl = null;
ws.eachRow((r) => { if (String(r.getCell(col("From")).value ?? "").includes("Frond C Villa 18")) xl = { price: r.getCell(col("Price (AED)")).value, claimed: r.getCell(col("Claimed (AED)")).value, change: String(r.getCell(col("Price change")).value ?? "") }; });
check("3: the Excel row: price 90 (final), claimed 120, the change with its reason", xl && Number(xl.price) === 90 && Number(xl.claimed) === 120 && /120 → 90: Price looks high/.test(xl.change), JSON.stringify(xl));
await browser.close();

/* 4. Accounts may change a price too */
const { browser: ab, page: ap } = await browserFor("accounts", { viewport: { width: 1366, height: 1000 } });
await go(ap, `${base}/recovery`);
const brow = ap.locator(`[data-trip="${b.id}"]`);
await brow.locator("[data-change-price] summary").click();
await brow.locator("[data-change-price-box]").fill("150");
await brow.locator('input[name="reason"]').fill("Agreed with the driver");
await brow.locator("[data-change-price-save]").click();
await ap.waitForURL(/message=/, { timeout: 30000 });
const t2 = (await sql("select price_aed::float8 as p, original_price_aed::float8 as o from public.recovery_trips where id = $1", [b.id]))[0];
check("4: accounts changed a claimed trip from AED 200 to AED 150", t2.p === 150 && t2.o === 200, JSON.stringify(t2));
await ab.close();

/* 5. Settings > Recovery rates */
const { browser: sb, page: sp } = await browserFor("owner", { viewport: { width: 1366, height: 1000 } });
await go(sp, `${base}/settings`);
const card = sp.locator("[data-recovery-rates]");
check("5: Settings shows the rates for our truck, external flatbed and closed box", (await card.locator("[data-rate-row]").count()) === 3);
await card.locator('input[name="flatbed_per_km"]').fill("7");
await card.locator("[data-rates-save]").click();
await sp.waitForURL(/message=/, { timeout: 30000 });
const saved = JSON.parse((await sql("select value::text as v from public.settings where key = 'recovery_rates'"))[0].v);
check("5: the flatbed rate saved (AED 7 per km)", Number(saved.flatbed?.per_km) === 7, JSON.stringify(saved));
await sp.locator("[data-recovery-rates]").scrollIntoViewIfNeeded();
await sp.screenshot({ path: shot("rec3-4-settings-rates.png") });
await sb.close();

// Put the owner's rates back exactly as they were.
if (ratesBefore) await sql("update public.settings set value = $1::jsonb where key = 'recovery_rates'", [ratesBefore]);
cleanupDb();
const left = await sql("select count(*)::int as n from public.recovery_trips where company = 'E2e Flatbed Co'");
check("cleanup: no test trips left", left[0].n === 0);
process.exit(summary() ? 1 : 0);
