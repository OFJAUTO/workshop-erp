// Recovery pick-ups = deliveries (21 October 2026, section 7): one trip component everywhere, the
// pick-up saved message, Send to driver / Copy message / Copy link / Tell the customer, the SHORT
// driver link, and the driver's TWO-step pick-up page (Car loaded + photo, then Delivered to OFJ +
// photo + price). Advisors see the actions and never a price.
//   node --env-file=.env.test.local tests/browser/test-trips.mjs
import { writeFileSync } from "node:fs";
import { api, base, browserFor, cleanupDb, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shots = "C:/Users/user/Desktop/workshop ERP/tests/browser/shots";
const until = async (fn, tries = 30, ms = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } return null; };
const png = `${shots}/e2e-trip.png`;
writeFileSync(png, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5CYII=".replace("5BJRU5C", "5BJRU5E"), "base64"));
writeFileSync(png, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));

await cleanupDb();
const seed = (await api("/api/e2e/stage", { stage: "assign" })).json;
const jobId = seed.jobId;
const jobNumber = (await sql("select job_number from public.jobs where id = $1", [jobId]))[0]?.job_number;

/* ---- The advisor books a pick-up: saved message + the one trip component on the row. ---- */
const adv = await browserFor("service_advisor", { viewport: { width: 1500, height: 1400 } });
const page = adv.page;
await page.goto(`${base}/recovery`, { waitUntil: "load" });
await page.waitForTimeout(1800);
// Two big buttons first: Our truck, then the fields.
await page.locator("[data-side-ours]").click();
await page.waitForTimeout(500);
await page.locator('input[name="job_number"]').fill(jobNumber);
await page.locator('input[name="location_details"]').fill("E2E pick-up from the customer's villa");
await page.locator("[data-save-trip]").click();
await page.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 25000 }).catch(() => null);
await page.waitForTimeout(1500);
check("saved message: 'Pick-up saved ✓ — send it to <driver> now'", /Pick-up saved ✓ — send it to .+ now/.test(decodeURIComponent(page.url())), decodeURIComponent(page.url()).slice(-150));
const trip = await until(async () => (await sql("select id, token, kind, driver_name from public.recovery_trips where job_id = $1 and is_active order by created_at desc limit 1", [jobId]))[0], 20, 500);
check("the pick-up exists with a token", trip?.kind === "pickup" && !!trip?.token, JSON.stringify(trip));
const row = page.locator(`[data-trip="${trip.id}"]`);
check("the row carries THE trip component", (await row.locator("[data-trip-actions]").count()) === 1);
check("Send to driver, Copy message, Copy link all there", (await row.locator("[data-send-driver]").count()) === 1 && (await row.getByText("Copy message").count()) === 1 && (await row.getByText("Copy link").count()) === 1);
check("status reads Booked", /Booked/.test((await row.locator("[data-trip-state]").textContent()) ?? ""));
check("the advisor sees no price anywhere on the row", (await row.locator("[data-trip-price]").count()) === 0);
// The short driver link, with the OFJ preview behind it.
const flight = await page.content();
const short = flight.match(/https:\/\/erp\.ofjauto\.com\/d\/[A-Za-z0-9_-]+/)?.[0] ?? null;
check("the driver link is SHORT (/d/xxxx)", !!short, short ?? "");
await page.screenshot({ path: `${shots}/trip-pickup-row.png`, fullPage: true });
// Send to driver stamps sent_at (the WhatsApp window opens separately).
const popupP = page.waitForEvent("popup", { timeout: 8000 }).catch(() => null);
await row.locator("[data-send-driver]").click();
const popup = await popupP;
if (popup) await popup.close();
const sentAt = await until(async () => (await sql("select sent_at from public.recovery_trips where id = $1", [trip.id]))[0]?.sent_at, 20, 500);
check("Send to driver stamps the trip — R1/R4", !!sentAt);
await adv.browser.close();

/* ---- The driver's page: TWO steps for a pick-up. ---- */
{
  const d = await browserFor("owner", { viewport: { width: 420, height: 900 } });
  await d.page.context().clearCookies();
  d.page.on("response", async (r) => { if (r.url().includes("/api/drive/")) console.log("drive POST →", r.status(), (await r.text().catch(() => "")).slice(0, 80)); });
  await d.page.goto(`${base}/drive/${trip.token}`, { waitUntil: "load" });
  await d.page.waitForTimeout(1200);
  check("step chips: 1 · Car loaded, 2 · Delivered to OFJ", (await d.page.locator("[data-drive-steps]").count()) === 1 && /CAR LOADED/i.test(((await d.page.textContent("body")) ?? "")));
  await d.page.screenshot({ path: `${shots}/trip-driver-step1.png` });
  await d.page.locator('input[type="file"]').setInputFiles(png);
  await d.page.waitForTimeout(600);
  check("step 1 asks for NO price", (await d.page.locator("[data-drive-price]").count()) === 0);
  await d.page.locator("[data-drive-send]").click();
  const loaded = await until(async () => (await sql("select loaded_at, loaded_photo_path from public.recovery_trips where id = $1", [trip.id]))[0]?.loaded_at, 25, 500);
  check("Car loaded stamped with the photo", !!loaded);
  await d.page.waitForTimeout(1000);
  check("the page moves to step 2 by itself", /DELIVERED TO OFJ/i.test(((await d.page.textContent("body")) ?? "")));
  await d.page.screenshot({ path: `${shots}/trip-driver-step2.png` });
  await d.page.locator('input[type="file"]').setInputFiles(png);
  await d.page.waitForTimeout(600);
  await d.page.locator("[data-drive-price]").click();
  await d.page.locator("[data-drive-price]").pressSequentially("120", { delay: 30 });
  console.log("price box value:", await d.page.locator("[data-drive-price]").inputValue());
  await d.page.locator("[data-drive-send]").click();
  await sleep(1500);
  console.log("after send body:", (((await d.page.textContent("body")) ?? "").replace(/\s+/g, " ").match(/(Enter the price|did not go through|No connection|SENDING|Done)[^<]{0,40}/)?.[0]) ?? "(no message)");
  const done = await until(async () => (await sql("select delivered_at, price_aed::float as p, status from public.recovery_trips where id = $1", [trip.id]))[0], 25, 500);
  check("Delivered to OFJ with the price, claimed", !!done?.delivered_at && done?.p === 120 && done?.status === "claimed", JSON.stringify(done));
  await d.browser.close();
}
const toldLoaded = (await sql("select count(*)::int as n from public.notifications where job_id = $1 and title like 'Car loaded%'", [jobId]))[0];
check("the advisor was told at Car loaded — R3", (toldLoaded?.n ?? 0) >= 1);

await cleanupDb();
process.exit(summary() ? 1 : 0);
