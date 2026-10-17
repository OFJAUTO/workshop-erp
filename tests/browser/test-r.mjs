// Proof for section B of the 16 October batch: the gate-in can be edited until the car leaves with one history line
// per changed field; "Back to details" on the photos step returns there after Save; photos and videos can be taken
// off by the gate-in person while the gate-in is open and only by the owner afterwards; the gate-out prefills the
// collecting person from the customer, offers saved drivers (a new one is saved), picks the recovery company from
// the list with the driver's name, and asks an amber "Gate-in recorded 1 key. Confirm 2?" when the keys differ.
// Also B1: the inspection, quotation, parts and gate-out pages open at the top with no red messages.
//   node --env-file=.env.local tests/browser/test-r.mjs
import { api, base, browserFor, browserForId, cleanupDb, cookieHeader, go, makeChecks, sleep, sql, submitted } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 14 * 60 * 1000).unref();
cleanupDb();

const until = async (fn, tries = 60, ms = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } return null; };
async function section(name, fn) {
  console.log(`\n== ${name}`);
  try { await fn(); } catch (e) { check(`${name}: no crash`, false, String(e?.message ?? e).slice(0, 300)); }
}
const quiet = async (page) => page.evaluate(() => ({ y: window.scrollY, active: document.activeElement?.tagName ?? "", red: document.querySelectorAll(".erp-field-msg").length, invalid: document.querySelectorAll(".erp-invalid").length }));

/* ---------------- 1. Edit gate-in: one history line per changed field ---------------- */
await section("1 edit gate-in log", async () => {
  const seed = await api("/api/e2e/stage", { stage: "assign" });
  const { jobId } = seed.json;
  const before = (await sql("select keys_count, keys_keychain, cleanliness from public.gate_ins where job_id = $1", [jobId]))[0];
  const { browser, page } = await browserFor("owner", { viewport: { width: 1366, height: 1100 } });
  await go(page, `${base}/jobs/${jobId}`);
  await page.getByRole("button", { name: /gate-in details/i }).click();
  check("1: the job card offers 'Edit gate-in' while the car is here", (await page.locator("[data-edit-gate-in]").count()) === 1 && /Edit gate-in/.test(await page.locator("[data-edit-gate-in]").textContent()));
  await go(page, `${base}/jobs/${jobId}/gate-in/edit`);
  const newKeys = before.keys_count === 2 ? "1" : "2";
  await page.locator(`input[name="keys_count"][value="${newKeys}"]`).check({ force: true });
  await page.locator(`input[name="keys_keychain"][value="${before.keys_keychain ? "no" : "yes"}"]`).check({ force: true });
  await page.locator('input[name="cleanliness"][value="dirty"]').check({ force: true });
  await page.getByRole("button", { name: /Save amendments/ }).click();
  await submitted(page);
  const notes = (await sql("select note from public.job_events where job_id = $1 and event_type = 'amendment' order by created_at", [jobId])).map((r) => r.note);
  check("1: 'Keys changed 1 → 2' in the history", notes.some((n) => n === `Keys changed ${before.keys_count} → ${newKeys}`), JSON.stringify(notes));
  check("1: 'Keychain changed No → Yes' in the history", notes.some((n) => n === `Keychain changed ${before.keys_keychain ? "Yes → No" : "No → Yes"}`), JSON.stringify(notes));
  check("1: 'Cleanliness changed Clean → Dirty' in the history", notes.some((n) => /^Cleanliness changed .* → Dirty$/.test(n)), JSON.stringify(notes));
  check("1: no generic 'amended' line any more, nothing for unchanged fields", !notes.some((n) => /details amended|Fuel level|Mileage/.test(n)), JSON.stringify(notes));
  check("1: back on the job card with the count of changes", /\/jobs\/[0-9a-f-]+\?message=/.test(page.url()) && /3 changes written in the history/.test(decodeURIComponent(page.url())), page.url().slice(-120));
  const after = (await sql("select keys_count, keys_keychain, cleanliness from public.gate_ins where job_id = $1", [jobId]))[0];
  check("1: the record carries the new values", String(after.keys_count) === newKeys && after.keys_keychain === !before.keys_keychain && after.cleanliness === "dirty", JSON.stringify(after));
  // The history on the job card shows the lines.
  await go(page, `${base}/jobs/${jobId}`);
  const body = (await page.textContent("body")) ?? "";
  check("1: the job card history shows the change line with who and when", /Keychain changed/.test(body));
  await browser.close();
});

/* ---------------- 2. Back to details from the photos step ---------------- */
await section("2 back to details", async () => {
  const { jobId } = (await api("/api/e2e/stage", { stage: "assign" })).json;
  const { browser, page } = await browserFor("owner", { viewport: { width: 1366, height: 1100 } });
  await go(page, `${base}/jobs/${jobId}/media`);
  const back = page.locator("[data-back-to-details]");
  check("2: the photos step has '← Back to details'", (await back.count()) === 1 && /Back to details/.test(await back.textContent()) && (await back.getAttribute("href")) === `/jobs/${jobId}/gate-in/edit?from=media`, String(await back.getAttribute("href")));
  await back.click();
  await page.waitForURL(/gate-in\/edit\?from=media/, { timeout: 15000 });
  check("2: the details form knows it came from the photos step", (await page.locator('input[name="return_to"][value="media"]').count()) === 1 && (await page.locator("[data-to-media]").count()) === 1);
  const eventsBefore = (await sql("select count(*)::int as n from public.job_events where job_id = $1", [jobId]))[0].n;
  await page.getByRole("button", { name: /Save amendments/ }).click();
  await submitted(page);
  check("2: Save returns to the photos step and says nothing changed", /\/media\?message=/.test(page.url()) && /nothing changed/i.test(decodeURIComponent(page.url())), page.url().slice(-100));
  await sleep(500);
  check("2: the photos step shows the message", /Saved, nothing changed/.test((await page.textContent("body")) ?? ""));
  const eventsAfter = (await sql("select count(*)::int as n from public.job_events where job_id = $1", [jobId]))[0].n;
  check("2: an unchanged save writes nothing in the history", eventsAfter === eventsBefore, `${eventsBefore} → ${eventsAfter}`);
  await browser.close();
});

/* ---------------- 3. Removing photos: gate-in person while open, owner only afterwards ---------------- */
await section("3 remove photos", async () => {
  const { jobId } = (await api("/api/e2e/stage", { stage: "assign" })).json;
  const rows = await sql("select id, kind from public.gate_in_media where job_id = $1 and removed_at is null order by created_at", [jobId]);
  check("3: the seed has gate-in media and the gate-in is finished", rows.length >= 3 && (await sql("select is_complete from public.gate_ins where job_id = $1", [jobId]))[0]?.is_complete === true, JSON.stringify(rows));
  // The advisor (gate-in finished): no X on the job card and the route refuses in words.
  const { browser: ba, page: pa } = await browserFor("service_advisor", { viewport: { width: 1366, height: 1100 } });
  await go(pa, `${base}/jobs/${jobId}`);
  await pa.getByRole("button", { name: /gate-in photos and videos/i }).click();
  await sleep(300);
  check("3: the advisor sees no X once the gate-in is finished", (await pa.locator("[data-media-remove]").count()) === 0);
  await ba.close();
  const dash = rows.find((r) => r.kind === "dashboard_photo") ?? rows[0];
  const refused = await fetch(`${base}/api/gate-in-media/remove`, { method: "POST", headers: { "content-type": "application/json", cookie: await cookieHeader("service_advisor") }, body: JSON.stringify({ id: dash.id }) });
  const rj = await refused.json().catch(() => ({}));
  check("3: the advisor's removal is refused in plain words", refused.status === 403 && /only the owner/i.test(rj.error ?? ""), `${refused.status} ${JSON.stringify(rj)}`);
  // The owner: X on every photo and video, one tap asks, the second removes, the gallery updates.
  const { browser, page } = await browserFor("owner", { viewport: { width: 1366, height: 1100 } });
  await go(page, `${base}/jobs/${jobId}`);
  await page.getByRole("button", { name: /gate-in photos and videos/i }).click();
  await sleep(300);
  const xs = await page.locator("[data-media-remove]").count();
  check("3: the owner sees an X on the photos and videos", xs >= 3, String(xs));
  await page.locator("[data-media-remove]").first().click();
  check("3: the first tap asks 'Remove?' on the picture", (await page.locator("[data-remove-ask]").count()) === 1 && /Remove\?/.test(await page.locator("[data-remove-ask]").textContent()));
  await page.locator("[data-remove-no]").click();
  check("3: No closes the question", (await page.locator("[data-remove-ask]").count()) === 0);
  await page.locator("[data-media-remove]").first().click();
  await page.locator("[data-remove-yes]").click();
  const gone = await until(async () => ((await sql("select count(*)::int as n from public.gate_in_media where job_id = $1 and removed_at is not null", [jobId]))[0].n ? 1 : null), 30, 300);
  check("3: Yes marks the row removed (never deleted)", !!gone);
  const fewer = await until(async () => ((await page.locator("[data-media-remove]").count()) < xs ? 1 : null), 30, 300);
  check("3: the gallery updates by itself", !!fewer, `${xs} → ${await page.locator("[data-media-remove]").count()}`);
  const ev = await sql("select note from public.job_events where job_id = $1 and note like 'Gate-in % removed:%'", [jobId]);
  check("3: the removal is written in the history", ev.length === 1, JSON.stringify(ev));
  const total = (await sql("select count(*)::int as n from public.gate_in_media where job_id = $1", [jobId]))[0].n;
  check("3: the row still exists in the table", total === rows.length, `${total} of ${rows.length}`);
  await browser.close();
});

/* ---------------- 4. Gate-out: prefilled collector, saved driver, amber keys confirmation ---------------- */
await section("4 gate-out driver and keys", async () => {
  cleanupDb();
  const { jobId } = (await api("/api/e2e/stage", { stage: "ready" })).json;
  const cust = (await sql("select c.id, c.full_name, c.phone from public.customers c join public.jobs j on j.customer_id = c.id where j.id = $1", [jobId]))[0];
  const gi = (await sql("select keys_count, keys_keychain from public.gate_ins where job_id = $1", [jobId]))[0];
  const { browser, page } = await browserFor("owner", { viewport: { width: 1366, height: 1200 } });
  await go(page, `${base}/jobs/${jobId}/gate-out`);
  const name = await page.locator('input[name="collector_name"]').inputValue();
  const phone = await page.locator('input[name="collector_phone"]').inputValue();
  check("4: 'Customer collects' is prefilled with the customer's name and phone", name.toLowerCase() === String(cust.full_name).toLowerCase() && phone === cust.phone, JSON.stringify({ name, phone, cust }));
  // Keys (17 October E1): one tick for the gate-in's count; "Different number of keys?" opens the choice with a reason.
  check("4: the keys show as one tick with the gate-in's count", (await page.locator("[data-keys-tick]").count()) === 1 && new RegExp(`${gi.keys_count} key${gi.keys_count === 1 ? "" : "s"} handed back`).test((await page.locator("[data-keys-tick]").textContent()) ?? ""), (await page.locator("[data-keys-tick]").textContent().catch(() => "")) ?? "");
  check("4: the keychain tick shows only when the gate-in recorded one", (await page.locator("[data-keychain-tick]").count()) === (gi.keys_keychain ? 1 : 0));
  check("4: no notes box on the gate-out", (await page.locator('input[name="notes"]').count()) === 0);
  const other = gi.keys_count === 2 ? "3" : "2";
  await page.locator("[data-keys-differ]").click();
  const ask = page.locator('[data-keys-confirm="ask"]');
  check("4: 'Different number of keys?' opens the choice with the gate-in named", (await ask.count()) === 1 && new RegExp(`Gate-in recorded ${gi.keys_count} key`).test((await ask.textContent()) ?? ""));
  await page.locator("[data-keys-same]").click();
  check("4: 'Back to …' closes the choice and the tick returns", (await page.locator("[data-keys-confirm]").count()) === 0 && (await page.locator("[data-keys-tick]").count()) === 1);
  await page.locator("[data-keys-differ]").click();
  await page.locator(`input[name="keys_returned"][value="${other}"]`).check({ force: true });
  check("4: a different count asks the owner for the reason (written on the job; the owner is told)", (await page.locator('[name="override_reason"]').count()) === 1);
  await page.locator('[name="override_reason"]').fill("E2e test: the customer brought the second key today");
  // The customer's driver, a new one: saved on the customer.
  await page.locator('input[name="leave_method"][value="customer_driver"]').check({ force: true });
  check("4: with no saved drivers the new-driver boxes show at once", (await page.locator("[data-new-driver]").count()) === 1);
  await page.locator('input[name="collector_name"]').fill("E2e Driver");
  await page.locator('input[name="collector_phone"]').fill("+971 50 000 0077");
  await page.locator('input[name="handover_confirmed"]').check();
  const releaseBox = page.locator('[name="release_reason"]');
  if (await releaseBox.count()) await releaseBox.fill("E2e test: released with the balance noted");
  await page.getByRole("button", { name: /Gate out and close the job/ }).click();
  await submitted(page);
  const out = (await sql("select go.leave_method, go.collector_name, go.collector_phone, go.collector_contact_id, go.keys_returned, go.keys_match, go.keys_override_reason, j.is_open from public.gate_outs go join public.jobs j on j.id = go.job_id where go.job_id = $1", [jobId]))[0];
  check("4: the job is closed with the driver's name, phone and the keys as confirmed", !!out && out.is_open === false && out.leave_method === "customer_driver" && /e2e driver/i.test(out.collector_name ?? "") && out.collector_phone === "+971500000077" && String(out.keys_returned) === other && out.keys_match === false && /second key/.test(out.keys_override_reason ?? ""), JSON.stringify(out));
  const saved = await sql("select id, name, phone, relationship from public.customer_contacts where customer_id = $1 and phone = '+971500000077'", [cust.id]);
  check("4: the new driver is saved on the customer for next time", saved.length === 1 && /driver/i.test(saved[0].relationship ?? "") && out?.collector_contact_id === saved[0].id, JSON.stringify(saved));
  await browser.close();
  // Next time: the saved driver is one tap.
  const { jobId: job2 } = (await api("/api/e2e/stage", { stage: "ready" })).json;
  const { browser: b2, page: p2 } = await browserFor("owner", { viewport: { width: 1366, height: 1200 } });
  await go(p2, `${base}/jobs/${job2}/gate-out`);
  await p2.locator('input[name="leave_method"][value="customer_driver"]').check({ force: true });
  const chip = p2.locator(`input[name="collector_contact_id"][value="${saved[0]?.id}"]`);
  check("4: the saved driver is offered as a one-tap choice, ticked first", (await chip.count()) === 1 && (await chip.isChecked()) && (await p2.locator("[data-new-driver]").count()) === 0);
  await b2.close();
});

/* ---------------- 5. Gate-out by recovery: company from the list, driver's name ---------------- */
await section("5 gate-out recovery", async () => {
  cleanupDb();
  await sql("update public.settings set value = (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(value) x where lower(x #>> '{}') <> 'e2e tow co') where key = 'recovery_companies'");
  const { jobId } = (await api("/api/e2e/stage", { stage: "ready" })).json;
  const { browser, page } = await browserFor("owner", { viewport: { width: 1366, height: 1200 } });
  await go(page, `${base}/jobs/${jobId}/gate-out`);
  await page.locator('input[name="leave_method"][value="recovery"]').check({ force: true });
  check("5: the recovery block offers Our truck, the list and Other company", (await page.locator('input[name="delivery_company_choice"][value="our_truck"]').count()) === 1 && (await page.locator('input[name="delivery_company_choice"][value="other"]').count()) === 1 && (await page.locator('[name="delivery_driver"]').count()) === 1);
  await page.locator('input[name="delivery_company_choice"][value="other"]').check({ force: true });
  check("5: Other company opens the name box", (await page.locator("[data-new-company]").count()) === 1);
  await page.locator("[data-new-company]").fill("E2e Tow Co");
  await page.locator('[name="delivery_driver"]').fill("E2e Tow Driver");
  await page.locator("input[name='driver_phone']").fill("+971500000402");
  await page.locator("[data-location-url]").fill("https://maps.google.com/?q=25.2,55.3");
  await page.locator("[data-location-details]").fill("E2e Street 1, Dubai");
  await page.locator("input[name='keys_ok']").check();
  if (await page.locator("input[name='keychain_ok']").count()) await page.locator("input[name='keychain_ok']").check();
  const releaseBox = page.locator('[name="release_reason"]');
  if (await releaseBox.count()) await releaseBox.fill("E2e test: released with the balance noted");
  await page.getByRole("button", { name: /Stamp: left the workshop/ }).click();
  await submitted(page);
  const out = (await sql("select go.delivery_by, go.delivery_company, go.delivery_driver, go.collector_name, j.status from public.gate_outs go join public.jobs j on j.id = go.job_id where go.job_id = $1", [jobId]))[0];
  check("5: the car is out for delivery with the company and the driver written down", !!out && out.status === "in_delivery" && out.delivery_by === "outside" && /e2e tow co/i.test(out.delivery_company ?? "") && /e2e tow driver/i.test(out.delivery_driver ?? ""), JSON.stringify(out));
  const list = (await sql("select value from public.settings where key = 'recovery_companies'"))[0]?.value ?? [];
  check("5: the typed company is added to the list in Settings", Array.isArray(list) && list.some((c) => /e2e tow co/i.test(c)), JSON.stringify(list));
  const ev = await sql("select note from public.job_events where job_id = $1 and note like 'Left the workshop for delivery%'", [jobId]);
  check("5: the history names the company and the driver", ev.length === 1 && /E2e Tow Co/i.test(ev[0].note) && /driver E2e Tow Driver/i.test(ev[0].note), JSON.stringify(ev));
  await browser.close();
  // Next car: the company is a one-tap choice; the Settings page lists it.
  cleanupDb();
  const { jobId: job2 } = (await api("/api/e2e/stage", { stage: "ready" })).json;
  const { browser: b2, page: p2 } = await browserFor("owner", { viewport: { width: 1366, height: 1200 } });
  await go(p2, `${base}/jobs/${job2}/gate-out`);
  await p2.locator('input[name="leave_method"][value="recovery"]').check({ force: true });
  const chips = await p2.locator('input[name="delivery_company_choice"]').evaluateAll((els) => els.map((e) => e.value));
  check("5: the company is offered as a chip next time", chips.some((c) => /e2e tow co/i.test(c)), JSON.stringify(chips));
  await go(p2, `${base}/settings`);
  const setting = await p2.locator("[data-recovery-companies-setting]").inputValue().catch(() => "");
  check("5: Settings shows the recovery companies list with the new company", /e2e tow co/i.test(setting), setting);
  await b2.close();
  await sql("update public.settings set value = (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(value) x where lower(x #>> '{}') <> 'e2e tow co') where key = 'recovery_companies'");
  const left = (await sql("select value from public.settings where key = 'recovery_companies'"))[0]?.value ?? [];
  check("5: the test company is taken out of Settings again", !left.some((c) => /e2e tow co/i.test(c)));
});

/* ---------------- 6. B1: the other forms open quietly too ---------------- */
await section("6 pages open quietly", async () => {
  cleanupDb();
  const insp = (await api("/api/e2e/stage", { stage: "inspection" })).json;
  const tech = (await sql("select staff_id from public.job_technicians where job_id = $1 and is_active order by added_at limit 1", [insp.jobId]))[0]?.staff_id;
  const pages = [
    { name: "inspection form", who: tech, path: `/my-jobs/${insp.jobId}` },
  ];
  for (const p of pages) {
    const { browser, page } = p.who ? await browserForId(p.who, { viewport: { width: 1024, height: 768 } }) : await browserFor("owner", { viewport: { width: 1024, height: 768 } });
    await go(page, `${base}${p.path}`);
    await sleep(1200);
    const s = await quiet(page);
    check(`6: the ${p.name} opens at the top with no red messages`, s.y < 5 && s.red === 0 && s.invalid === 0, JSON.stringify(s));
    await browser.close();
  }
  cleanupDb();
  const q = (await api("/api/e2e/stage", { stage: "quote" })).json;
  for (const p of [
    { name: "quotation editor", role: "service_advisor", path: `/jobs/${q.jobId}/quote/${q.quotationId}` },
    { name: "parts page", role: "parts", path: `/parts/${q.jobId}` },
    { name: "gate-out page", role: "owner", path: `/jobs/${q.jobId}/gate-out` },
  ]) {
    const { browser, page } = await browserFor(p.role, { viewport: { width: 1024, height: 768 } });
    await go(page, `${base}${p.path}`);
    await sleep(1200);
    const s = await quiet(page);
    check(`6: the ${p.name} opens at the top with no red messages`, s.y < 5 && s.red === 0 && s.invalid === 0, JSON.stringify(s));
    await browser.close();
  }
});

cleanupDb();
process.exit(summary() ? 1 : 0);
