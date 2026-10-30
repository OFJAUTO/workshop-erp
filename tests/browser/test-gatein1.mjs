// Section 1 proof (23 October 2026, afternoon): gate-in for an existing customer with a new car. As the gate-in role:
// one box finds the customer by mobile (and by name, plate, VIN), "+ New car for this customer" adds the car with the
// customer fixed, the gate-in goes through to the photos step; a new customer with a mobile already on record is asked
// "This number belongs to … – add the car to … instead?" (on the form and again on the server); the gate-in role sees no
// customer page, no history and no money.
//   node --env-file=.env.test.local tests/browser/test-gatein1.mjs   (dev server; E2E_BASE for another port)
import path from "node:path";
import { base, browserFor, cleanupDb, go, here, makeChecks, settle, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shot = (name) => path.join(here, "shots", name);
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 10 * 60 * 1000).unref();
// Types the VIN like a person (the form re-draws as the VIN fills the make and year) and makes sure all 17 landed.
const typeVin = async (page, vin) => { const box = page.locator('input[name="vin"]'); for (let i = 0; i < 3; i++) { await box.click({ clickCount: 3 }); await page.keyboard.press("Backspace"); await box.pressSequentially(vin, { delay: 70 }); await sleep(300); if ((await box.inputValue()) === vin) return true; } return false; };
const pick = (page, name, value) => page.locator(`input[name="${name}"][value="${value}"]`).first().evaluate((el) => el.click());
cleanupDb();

const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active limit 1"))[0].id;
const merc = (await sql("select m.id as make_id, md.id as model_id, md.name as model from public.vehicle_makes m join public.vehicle_models md on md.make_id = m.id where m.name ilike 'mercedes%' and m.is_active and md.is_active order by md.name limit 1"))[0];
const cust = (await sql("insert into public.customers (customer_type, full_name, phone, created_by, updated_by) values ('individual', 'E2e Gate Customer', '+971500000077', $1, $1) returning id", [owner]))[0];
const oldPlate = String(70000 + (Date.now() % 9999));
await sql("insert into public.vehicles (customer_id, plate_country, plate_emirate, plate_code, plate_number, has_plate, make_id, model_id, model_year, created_by, updated_by) values ($1, 'UAE', 'Dubai', 'K', $2, true, $3, $4, 2020, $5, $5)", [cust.id, oldPlate, merc.make_id, merc.model_id, owner]);
const gate = (await sql("select display_name from public.staff where role_id = 'gate_in' and is_active order by display_name limit 1"))[0]?.display_name;
console.log(`gate-in person: ${gate}`);

const { browser, page } = await browserFor("gate_in", { viewport: { width: 1180, height: 900 } });
try {
  /* 1. The three buttons and the one search box. */
  await go(page, `${base}/gate-in`);
  check("1: three clear buttons: Existing car · Existing customer, new car · New customer and car", (await page.locator("[data-gatein-mode]").count()) === 3 && /Existing car/.test(await page.locator('[data-gatein-mode="car"]').textContent()) && /Existing customer, new car/.test(await page.locator('[data-gatein-mode="customer"]').textContent()) && /New customer and car/.test(await page.locator('[data-gatein-mode="new"]').textContent()));
  check("1: Loose items, no car is still there", (await page.locator('a[href="/gate-in/loose"]').count()) >= 1);
  await page.screenshot({ path: shot("gatein1-1-buttons.png") });

  /* 2. Find the customer by MOBILE (typed the local way), then by name; the car by plate and by VIN. */
  await page.locator('[data-gatein-mode="customer"]').click();
  await settle(page);
  await page.locator("[data-gatein-search]").fill("050 000 0077");
  await page.locator("[data-gatein-search]").press("Enter");
  await page.waitForURL(/q=/, { timeout: 20000 });
  await settle(page);
  const card = page.locator(`[data-gatein-customer="${cust.id}"]`);
  check("2: the mobile finds the customer: name and mobile with their car listed", (await card.count()) === 1 && /E2E GATE CUSTOMER/i.test((await card.textContent()) ?? "") && /\+971500000077/.test((await card.textContent()) ?? "") && (await card.locator("[data-gatein-customer-car]").count()) === 1);
  check("2: '+ New car for this customer' is offered", (await card.locator(`[data-new-car-for="${cust.id}"]`).count()) === 1);
  const html = (await page.content()).replace(/\s+/g, " ");
  check("2: the gate-in role gets no customer page, no money, no car details", !/href="\/customers\//.test(html) && !/AED/.test((await page.textContent("main")) ?? "") && !/Car details/.test(html));
  await page.screenshot({ path: shot("gatein1-2-found-by-mobile.png") });
  for (const [label, term, sel] of [["name", "e2e gate cust", `[data-gatein-customer="${cust.id}"]`], ["plate", oldPlate, "[data-gatein-car]"]]) {
    await go(page, `${base}/gate-in?q=${encodeURIComponent(term)}`);
    check(`2: the ${label} finds it too`, (await page.locator(sel).count()) >= 1);
  }

  /* 3. + New car for this customer → car details → gate-in → the photos step. */
  await go(page, `${base}/gate-in?mode=customer&q=0500000077`);
  await page.locator(`[data-new-car-for="${cust.id}"]`).click();
  await page.waitForURL(/new-car\?customer=/, { timeout: 20000 });
  await settle(page);
  check("3: the car form has the customer fixed (name and mobile), no customer boxes to fill", (await page.locator(`[data-existing-customer="${cust.id}"]`).count()) === 1 && (await page.locator('input[name="full_name"]').count()) === 0);
  const newPlate = String(80000 + (Date.now() % 9999));
  const vin = `WDD2050421E2E${String(Date.now() % 10000).padStart(4, "0")}`;
  await page.locator('input[name="plate_code"]').fill("J");
  await page.locator('input[name="plate_number"]').fill(newPlate);
  check("3: the VIN is typed in full", await typeVin(page, vin));
  await sleep(300);
  const modelBox = page.getByPlaceholder("Type to search…").nth(1);
  await modelBox.click();
  await modelBox.pressSequentially(merc.model, { delay: 20 });
  await page.getByRole("button", { name: merc.model, exact: true }).first().click().catch(() => null);
  await pick(page, "fuel_type", "petrol");
  await page.screenshot({ path: shot("gatein1-3-new-car-form.png"), fullPage: true });
  await page.getByText("Save and gate in", { exact: true }).click();
  await page.waitForURL(/\/gate-in\/new\?vehicle=/, { timeout: 30000 }).catch(() => null);
  await settle(page);
  const veh = (await sql("select id, customer_id, plate_number from public.vehicles where vin = $1", [vin]))[0];
  check("3: the new car is saved under the existing customer (no second customer)", !!veh && veh.customer_id === cust.id && (await sql("select count(*)::int as n from public.customers where phone like '%500000077'"))[0].n === 1, JSON.stringify(veh));
  const body = (await page.textContent("main")) ?? "";
  check("3: the gate-in form shows no earlier visits, no declined work and no customer page link", !/Previous visits/i.test(body) && !/declined work/i.test(body) && !/href="\/customers\//.test(await page.content()));
  await page.screenshot({ path: shot("gatein1-4-gatein-form.png") });
  await pick(page, "arrived_by", "customer_drove");
  await pick(page, "condition", "runs_drives");
  await pick(page, "fuel_level", "half");
  await pick(page, "cleanliness", "clean");
  await pick(page, "dash_cam", "no");
  await pick(page, "major_damage", "no");
  await pick(page, "keys_count", "1");
  await pick(page, "keys_keychain", "no");
  await pick(page, "old_parts_return", "no");
  await pick(page, "department", "mechanical");
  const addr = page.locator('textarea[name="location_address"]');
  if (await addr.count()) await addr.fill("E2e test address");
  await page.locator('input[name="mileage_display"]').pressSequentially("12500");
  await page.keyboard.press("Tab");
  await page.locator('input[name="requests"]:visible').first().pressSequentially("Service and check the brakes");
  await sleep(400);
  await page.getByText("Save and continue to photos and video").click();
  await page.waitForURL((u) => /\/media/.test(u.toString()), { timeout: 30000 }).catch(() => null);
  await settle(page);
  const job = (await sql("select id, job_number, customer_id from public.jobs where vehicle_id = $1 order by created_at desc limit 1", [veh?.id ?? null]))[0];
  check("3: gated in: the job opened for the existing customer and the photos step is next", !!job && job.customer_id === cust.id && /\/media/.test(page.url()), `${job?.job_number} ${page.url()}`);
  await page.screenshot({ path: shot("gatein1-5-photos-step.png") });

  /* 4. New customer and car with a mobile already on record: the question, on the form and on the server. */
  await go(page, `${base}/gate-in/new-car`);
  await page.locator('input[name="full_name"]').fill("E2e Other Person");
  await page.locator("[data-new-customer-phone]").fill("+971 50 000 0077");
  await page.locator('input[name="plate_number"]').click();
  const dup = page.locator(`[data-dup-phone="${cust.id}"]`);
  await dup.waitFor({ timeout: 15000 }).catch(() => null);
  check("4: leaving the mobile box asks 'This number belongs to E2E GATE CUSTOMER – add the car to … instead?'", (await dup.count()) === 1 && /This number belongs to E2e Gate Customer – add the car to E2e Gate Customer instead\?/i.test(((await dup.textContent()) ?? "").replace(/\s+/g, " ")), (await dup.textContent().catch(() => "")) ?? "");
  check("4: with Yes and No, different person", (await page.locator("[data-dup-yes]").count()) === 1 && (await page.locator("[data-dup-no]").count()) === 1);
  await dup.scrollIntoViewIfNeeded();
  await page.screenshot({ path: shot("gatein1-6-same-number.png"), clip: (await page.locator("[data-dup-phone]").locator("xpath=ancestor::div[contains(@class,'flex-col')][1]").boundingBox()) ?? undefined });
  await page.locator("[data-dup-yes]").click();
  check("4: Yes turns the form into a new car for that customer", (await page.locator(`[data-existing-customer="${cust.id}"]`).count()) === 1 && (await page.locator('input[name="full_name"]').count()) === 0);
  await page.screenshot({ path: shot("gatein1-7-yes.png") });

  // The server asks too, whatever the browser sends: submit without leaving the mobile box.
  await go(page, `${base}/gate-in/new-car`);
  await page.locator('input[name="full_name"]').fill("E2e Other Person");
  await page.locator("[data-new-customer-phone]").evaluate((el) => { el.value = "0500000077"; });
  await page.locator('input[name="plate_number"]').fill(String(90000 + (Date.now() % 9999)));
  await typeVin(page, `WDD2050421E2F${String(Date.now() % 10000).padStart(4, "0")}`);
  const mb = page.getByPlaceholder("Type to search…").nth(1);
  await mb.click();
  await mb.pressSequentially(merc.model, { delay: 20 });
  await page.getByRole("button", { name: merc.model, exact: true }).first().click().catch(() => null);
  await pick(page, "fuel_type", "petrol");
  // Submit the car form itself (the first form on the page is the Sign out form in the menu).
  await page.locator("[data-new-customer-phone]").evaluate((el) => el.form.requestSubmit());
  await page.locator(`[data-dup-phone="${cust.id}"]`).waitFor({ timeout: 20000 }).catch(() => null);
  check("4: the server refuses a second customer with the same mobile and asks the same question", (await page.locator(`[data-dup-phone="${cust.id}"]`).count()) === 1 && (await sql("select count(*)::int as n from public.customers where phone like '%500000077'"))[0].n === 1);
  await page.locator("[data-dup-no]").click();
  check("4: No, a different person is remembered on the form", (await page.locator("[data-dup-different]").count()) === 1);

  /* 5. Still no Customers page for the gate-in role. */
  await go(page, `${base}/customers/${cust.id}`);
  check("5: the Customers page stays closed to the gate-in role", !/\/customers\//.test(page.url()) || /not allowed|no access/i.test((await page.textContent("body")) ?? ""), page.url());
} catch (e) {
  check("walked without a crash", false, (e?.message ?? String(e)).slice(0, 300));
} finally {
  await browser.close();
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
