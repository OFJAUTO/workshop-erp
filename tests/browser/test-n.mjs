// Proof for PART D of the night batch: the three-choice customer and car chooser on New estimate (existing customer
// and car, existing customer with a new car, new customer and car) with the duplicate checks, and the car photo
// thumbnail in the page headers.
//   node --env-file=.env.test.local tests/browser/test-n.mjs
import { api, base, browserFor, cleanupDb, cookieHeader, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 12 * 60 * 1000).unref();
cleanupDb();

const until = async (fn, tries = 60, ms = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } return null; };
const plainText = (html) => html.replace(/<!--.*?-->/g, "").replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
async function fetchAs(pathname, role) {
  const res = await fetch(`${base}${pathname}`, { headers: { cookie: await cookieHeader(role) }, redirect: "manual" });
  return { status: res.status, text: await res.text() };
}
async function section(name, fn) {
  console.log(`\n== ${name}`);
  try { await fn(); } catch (e) { check(`${name}: no crash`, false, String(e?.message ?? e).slice(0, 300)); }
}
const TEST_PHONE = "+971500000099";

/* ---------------- 1. Existing customer and car ---------------- */
await section("1 existing customer and car", async () => {
  const seed = await api("/api/e2e/stage", { stage: "quote" });
  check("1: seed", !!seed.json?.jobId);
  const { browser, page } = await browserFor("service_advisor", { viewport: { width: 1366, height: 1100 } });
  await go(page, `${base}/estimates/new`);
  check("1: three big choices on one page", (await page.locator("[data-chooser-choices] [data-choice]").count()) === 3);
  check("1: 'Existing customer and car' is the first choice, selected", (await page.locator('[data-choice="existing"]').getAttribute("aria-pressed")) === "true");
  await page.getByPlaceholder("Type a name, company or phone…").fill("Stage Test");
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /Stage Test Customer/ }).first().click();
  await page.waitForTimeout(400);
  const options = await page.locator("[data-vehicle-select] option").allTextContents();
  check("1: the customer's cars are listed", options.some((o) => /30303/.test(o)), options.join(" | "));
  await page.locator("[data-vehicle-select]").selectOption({ label: options.find((o) => /30303/.test(o)) ?? "" });
  await page.getByRole("button", { name: /Start the estimate/ }).click();
  await page.waitForURL((u) => /\/estimates\/[0-9a-f-]{36}/.test(u.toString()), { timeout: 30000 }).catch(() => null);
  check("1: the estimate opens", /\/estimates\/[0-9a-f-]{36}/.test(page.url()), page.url());
  await browser.close();
});

/* ---------------- 2. Existing customer, new car; the plate on record is caught ---------------- */
await section("2 existing customer, new car", async () => {
  const { browser, page } = await browserFor("service_advisor", { viewport: { width: 1366, height: 1200 } });
  await go(page, `${base}/estimates/new`);
  await page.locator('[data-choice="new_car"]').click();
  check("2: the new car fields appear", (await page.locator("[data-new-car]").count()) === 1);
  await page.getByPlaceholder("Type a name, company or phone…").fill("Stage Test");
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /Stage Test Customer/ }).first().click();
  // A plate already on record (the seeded car) is pointed out at once.
  await page.locator('input[name="plate_code"]').fill("S");
  await page.locator("[data-plate-number]").fill("30303");
  await page.locator("[data-plate-number]").press("Tab");
  const dup = await until(async () => ((await page.locator('[data-duplicate="vehicle"]').count()) ? 1 : null), 20, 300);
  check("2: a plate already on record is pointed out with Use this car", !!dup && (await page.locator("[data-use-duplicate]").count()) === 1);
  await page.locator("[data-use-duplicate]").click();
  check("2: Use this car switches to the existing car", (await page.locator('[data-choice="existing"]').getAttribute("aria-pressed")) === "true" && (await page.locator("[data-vehicle-select]").inputValue()) !== "");
  // Now a real new car for the same customer.
  await page.locator('[data-choice="new_car"]').click();
  await page.getByPlaceholder("Type a name, company or phone…").fill("Stage Test");
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /Stage Test Customer/ }).first().click();
  await page.locator('input[placeholder="Type to search…"]').first().fill("Porsche");
  await page.waitForTimeout(400);
  await page.locator('input[placeholder="Type to search…"]').nth(1).fill("E2E Macan");
  await page.locator('input[name="colour"]').fill("Grey");
  await page.locator('input[name="plate_code"]').fill("E");
  await page.locator("[data-plate-number]").fill("77001");
  await page.locator("[data-plate-number]").press("Tab");
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: /Start the estimate/ }).click();
  await page.waitForURL((u) => /\/estimates\/[0-9a-f-]{36}/.test(u.toString()), { timeout: 30000 }).catch(() => null);
  check("2: the estimate opens on the new car", /\/estimates\/[0-9a-f-]{36}/.test(page.url()), page.url());
  const car = (await sql("select v.plate_number, v.colour, m.name as model, mk.name as make from public.vehicles v join public.vehicle_models m on m.id = v.model_id join public.vehicle_makes mk on mk.id = v.make_id where v.plate_number = '77001' and v.is_active"))[0];
  check("2: the car is on record with its make, model and colour", /^e2e macan$/i.test(car?.model ?? "") && car?.make === "Porsche" && car?.colour === "Grey", JSON.stringify(car));
  await browser.close();
});

/* ---------------- 3. New customer and car; a phone on file is caught; create anyway ---------------- */
await section("3 new customer and car", async () => {
  const existingPhone = (await sql("select phone from public.customers where id = '22222222-0000-4000-8000-00000000e301'"))[0]?.phone;
  const { browser, page } = await browserFor("service_advisor", { viewport: { width: 1366, height: 1200 } });
  await go(page, `${base}/estimates/new`);
  await page.locator('[data-choice="new_customer"]').click();
  check("3: the new customer fields appear", (await page.locator("[data-new-customer]").count()) === 1 && (await page.locator("[data-new-car]").count()) === 1);
  await page.locator('input[name="full_name"]').fill("E2E Second Owner");
  await page.locator("[data-phone]").fill(existingPhone ?? "+971500000000");
  await page.locator("[data-phone]").press("Tab");
  const dup = await until(async () => ((await page.locator('[data-duplicate="customer"]').count()) ? 1 : null), 20, 300);
  check("3: a phone already on file names the customer", !!dup && /Stage Test Customer/.test(await page.locator('[data-duplicate="customer"]').textContent()));
  check("3: the two ways out: use the customer, or create a second one on purpose", (await page.locator("[data-use-duplicate]").count()) === 1 && (await page.locator("[data-create-anyway]").count()) === 1);
  await page.locator("[data-use-duplicate]").click();
  check("3: Use this customer switches to existing customer, new car", (await page.locator('[data-choice="new_car"]').getAttribute("aria-pressed")) === "true" && /Stage Test/.test(await page.getByPlaceholder("Type a name, company or phone…").inputValue()));
  // A truly new customer with a new phone.
  await page.locator('[data-choice="new_customer"]').click();
  await page.locator('input[name="full_name"]').fill("E2E New Owner");
  await page.locator("[data-phone]").fill(TEST_PHONE);
  await page.locator("[data-phone]").press("Tab");
  await page.waitForTimeout(600);
  check("3: a new phone raises no warning", (await page.locator("[data-duplicate]").count()) === 0);
  await page.locator('input[placeholder="Type to search…"]').first().fill("Porsche");
  await page.waitForTimeout(400);
  await page.locator('input[placeholder="Type to search…"]').nth(1).fill("E2E Taycan");
  await page.locator('input[name="plate_code"]').fill("E");
  await page.locator("[data-plate-number]").fill("77002");
  await page.getByRole("button", { name: /Start the estimate/ }).click();
  await page.waitForURL((u) => /\/estimates\/[0-9a-f-]{36}/.test(u.toString()), { timeout: 30000 }).catch(() => null);
  check("3: the estimate opens for the new customer", /\/estimates\/[0-9a-f-]{36}/.test(page.url()), page.url());
  const cust = (await sql("select full_name, phone from public.customers where phone = $1", [TEST_PHONE]))[0];
  check("3: the customer is on record", /^e2e new owner$/i.test(cust?.full_name ?? ""), JSON.stringify(cust));
  await browser.close();
  // The same chooser on the bodyshop quotation page.
  const bs = await fetchAs("/bodyshop/new", "service_advisor");
  check("3: the bodyshop quotation page uses the same three choices", bs.status === 200 && (bs.text.match(/data-choice="/g) ?? []).length === 3);
});

/* ---------------- 4. The car photo in the page header ---------------- */
await section("4 car photo header", async () => {
  const seed = await api("/api/e2e/stage", { stage: "quote" });
  const job = await fetchAs(`/jobs/${seed.json.jobId}`, "service_advisor");
  check("4: the job card header carries the car thumbnail slot", /data-car-thumb=/.test(job.text));
  const parts = await fetchAs(`/parts`, "parts");
  check("4: the parts desk rows carry a small thumbnail", /data-car-thumb=/.test(parts.text));
});

cleanupDb();
process.exit(summary() ? 1 : 0);
