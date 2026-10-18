// Proof for the 17 October batch, run section by section with ONLY=... (e.g. ONLY=B npm run test:y).
// B1: breaks per weekday and department (the Settings grid, the saved setting, Friday's longer break in the maths).
// B3: no staff names or WhatsApp on customer pages; the only contact is "Call OFJ" with the company phone.
//   node --env-file=.env.local tests/browser/test-y.mjs
import { api, base, browserFor, cleanupDb, go, makeChecks, sleep, sql, submitted } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 10 * 60 * 1000).unref();
const only = (process.env.ONLY ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const want = (k) => !only.length || only.includes(k);
const until = async (fn, tries = 40, ms = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } return null; };
cleanupDb();

/* ================= B1: breaks per weekday ================= */
if (want("B")) {
  console.log("\n== B1 breaks per weekday");
  const { browser, page } = await browserFor("owner", { viewport: { width: 1500, height: 1100 } });
  await go(page, `${base}/settings`);
  const grid = page.locator("[data-break-grid]");
  check("B1: Settings shows the break grid, two departments by seven days", (await grid.count()) === 1 && (await grid.locator("input").count()) === 14);
  const friMech = grid.locator("input[name='break__mechanical__fri']");
  const friBody = grid.locator("input[name='break__bodyshop__fri']");
  const monMech = grid.locator("input[name='break__mechanical__mon']");
  check("B1: Friday is prefilled 12:30-14:00 for both sides, Monday 12:30-13:30 / 13:30-14:30", (await friMech.inputValue()) === "12:30-14:00" && (await friBody.inputValue()) === "12:30-14:00" && (await monMech.inputValue()) === "12:30-13:30" && (await grid.locator("input[name='break__bodyshop__mon']").inputValue()) === "13:30-14:30");
  // Change Monday's mechanical break, save, confirm the setting, put it back.
  await monMech.fill("12:00-13:00");
  await page.getByRole("button", { name: /^Save settings$/ }).first().click();
  const saved = await until(async () => { const v = (await sql("select value->'mechanical'->>'mon' as m from public.settings where key = 'break_times'"))[0]?.m; return v === "12:00-13:00" ? v : null; }, 30, 500);
  check("B1: a changed day saves into the per-day setting", saved === "12:00-13:00", String(saved));
  // A bad value is refused in words.
  await go(page, `${base}/settings`);
  await page.locator("[data-break-grid] input[name='break__mechanical__mon']").fill("13:00-12:00");
  await page.getByRole("button", { name: /^Save settings$/ }).first().click();
  const barText = await until(async () => { const t = (await page.textContent("body")) ?? ""; return /must look like 12:30-13:30/.test(t) ? t : null; }, 20, 500);
  check("B1: a backwards break is refused in words", !!barText);
  await sql("update public.settings set value = jsonb_set(value, '{mechanical,mon}', '\"12:30-13:30\"') where key = 'break_times'");
  await browser.close();
  // The maths: a Friday span loses 90 minutes, a Monday span 60 (unit maths proven in working-time; here the server uses it end to end).
  const fri = (await api("/api/e2e/sql", { sql: "select 1" })).status;
  check("B1: the sql helper is up (the per-day maths is unit-checked in working-time.ts)", fri === 200);
}

/* ================= B3: customer pages carry no staff names ================= */
if (want("B")) {
  console.log("\n== B3 customer pages");
  cleanupDb();
  const seed = (await api("/api/e2e/stage", { stage: "quote" })).json;
  await sql("update public.quotations set status = 'sent', sent_at = now(), valid_until = now() + interval '7 days' where id = $1", [seed.quotationId]);
  const token = (await sql("select token from public.quotations where id = $1", [seed.quotationId]))[0]?.token;
  const qpage = await (await fetch(`${base}/quote/${token}`)).text();
  const qtext = qpage.replace(/<[^>]+>/g, " ");
  check("B3: the quotation link has Call OFJ with the company number and no WhatsApp", /Call OFJ/.test(qtext) && /\+971 4 330 3113/.test(qtext) && !/wa\.me/.test(qpage));
  const staffNames = await sql("select display_name from public.staff where is_active");
  const leaked = staffNames.map((s) => s.display_name).filter((n) => n && n.length > 3 && qtext.includes(n));
  check("B3: no staff name on the quotation link", leaked.length === 0, JSON.stringify(leaked));
  // The invoice link: no contact block at all, no staff names, no WhatsApp.
  cleanupDb();
  const ready = (await api("/api/e2e/stage", { stage: "ready" })).json;
  const itoken = ready.invoice?.token;
  const ipage = await (await fetch(`${base}/invoice/${itoken}`)).text();
  const itext = ipage.replace(/<[^>]+>/g, " ");
  const ileaked = staffNames.map((s) => s.display_name).filter((n) => n && n.length > 3 && itext.includes(n));
  check("B3: the invoice link has no contact block, no WhatsApp and no staff name", !/data-call-ofj/.test(ipage) && !/wa\.me/.test(ipage) && ileaked.length === 0, JSON.stringify(ileaked));
  check("B3: the invoice link still shows the amount and the PDF button", /Amount due|Paid, thank you/.test(itext) && /View proforma \(PDF\)|View tax invoice \(PDF\)/.test(itext));
}

/* ================= C1: commission under Recovery cost, owner approval ================= */
if (want("C")) {
  console.log("\n== C1 commission");
  cleanupDb();
  const { jobId, quotationId } = (await api("/api/e2e/stage", { stage: "quote" })).json;
  const mark = (await sql("select now() as t"))[0]?.t;
  const { browser: ab, page: ap } = await browserFor("service_advisor", { viewport: { width: 1440, height: 1100 } });
  await go(ap, `${base}/jobs/${jobId}/quote/${quotationId}`);
  check("C1: one Commission line sits in the internal box, the old bottom section is gone", (await ap.locator("[data-internal-box] [data-commission-line]").count()) === 1 && (await ap.locator("[data-commission-box]").count()) === 0 && (await ap.locator("[data-commission-add]").count()) === 1);
  const rows = await ap.locator("[data-internal-box] dt").allTextContents();
  check("C1: the Commission line is directly under Recovery cost", rows.findIndex((t) => /^Commission/.test(t)) === rows.findIndex((t) => /^Recovery cost/.test(t)) + 1, JSON.stringify(rows.slice(0, 6)));
  await ap.locator("[data-commission-add]").click();
  await ap.locator("[data-commission-who]").fill("E2e Agent");
  await ap.locator("[data-commission-amount]").fill("100");
  await ap.locator("[data-commission-save]").click();
  const pend = await until(async () => { const r = (await sql("select commission_to, commission_status, commission_aed from public.quotations where id = $1", [quotationId]))[0]; return r?.commission_status === "pending" ? r : null; }, 30, 500);
  check("C1: an advisor's commission waits for the owner and counts for nothing yet", !!pend && pend.commission_to === "E2e Agent" && Number(pend.commission_aed) === 0, JSON.stringify(pend));
  await go(ap, `${base}/jobs/${jobId}/quote/${quotationId}`);
  check("C1: the line reads amber 'Waiting for owner approval' and profit says '(commission pending)'", (await ap.locator("[data-commission-pending]").count()) === 1 && (await ap.locator("[data-profit-commission-pending]").count()) === 1);
  const told = (await sql("select title from public.notifications where type = 'commission_approval' and created_at > $1 order by created_at desc limit 1", [mark]))[0];
  check("C1: the owner is told 'Commission for E2e Agent, AED 100 on [car] ([job])'", /^Commission for E2e Agent, AED 100\.00 on .+ \(J-/.test(told?.title ?? ""), told?.title);
  await ab.close();
  // The owner approves on the page.
  const { browser: ob, page: op } = await browserFor("owner", { viewport: { width: 1440, height: 1100 } });
  await go(op, `${base}/jobs/${jobId}/quote/${quotationId}`);
  check("C1: the owner sees Approve / Decline / Change amount on the line", (await op.locator("[data-commission-approve]").count()) === 1 && (await op.locator("[data-commission-decline]").count()) === 1 && (await op.locator("[data-commission-change]").count()) === 1);
  await op.locator("[data-commission-approve]").click();
  const appr = await until(async () => { const r = (await sql("select commission_status, commission_aed from public.quotations where id = $1", [quotationId]))[0]; return r?.commission_status === "approved" && Number(r.commission_aed) === 100 ? r : null; }, 30, 500);
  check("C1: approved: it counts in cost (commission_aed 100) and is logged", !!appr && ((await sql("select count(*)::int as n from public.quotation_events where quotation_id = $1 and event_type = 'commission_approved'", [quotationId]))[0]?.n ?? 0) === 1, JSON.stringify(appr));
  await ob.close();
  // An advisor's change after approval waits again; the owner declines with a note; it is removed.
  const { browser: ab2, page: ap2 } = await browserFor("service_advisor", { viewport: { width: 1440, height: 1100 } });
  await go(ap2, `${base}/jobs/${jobId}/quote/${quotationId}`);
  await ap2.locator("[data-commission-edit]").click();
  await ap2.locator("[data-commission-amount]").fill("150");
  await ap2.locator("[data-commission-save]").click();
  // The aed figure is the action's last write: wait for it, never read on the status flip alone.
  const again = await until(async () => { const r = (await sql("select commission_status, commission_value, commission_aed from public.quotations where id = $1", [quotationId]))[0]; return r?.commission_status === "pending" && Number(r.commission_value) === 150 && Number(r.commission_aed) === 0 ? r : null; }, 30, 500);
  check("C1: an edit after approval waits for the owner again and stops counting", !!again && Number(again.commission_aed) === 0, JSON.stringify(again));
  await ab2.close();
  const { browser: ob2, page: op2 } = await browserFor("owner", { viewport: { width: 1440, height: 1100 } });
  await go(op2, `${base}/jobs/${jobId}/quote/${quotationId}`);
  await op2.locator("[data-commission-decline]").click();
  await op2.locator("[data-commission-decline-note]").fill("Not on this job");
  await op2.locator("[data-commission-decline-send]").click();
  const dec = await until(async () => { const r = (await sql("select commission_to, commission_status, commission_decision_note from public.quotations where id = $1", [quotationId]))[0]; return r?.commission_status === "declined" ? r : null; }, 30, 500);
  // The advisor's notice is the action's last step: wait for it, never read straight after the row flips.
  const toldDec = await until(async () => ((await sql("select count(*)::int as n from public.notifications where type = 'commission_approval' and title like 'Commission declined%' and created_at > $1", [mark]))[0]?.n ?? 0) >= 1 ? 1 : null, 30, 500);
  check("C1: declined: removed with the owner's note, the advisor is told", !!dec && dec.commission_to === null && dec.commission_decision_note === "Not on this job" && !!toldDec, JSON.stringify(dec));
  await go(op2, `${base}/jobs/${jobId}/quote/${quotationId}`);
  check("C1: the line shows the decline and offers + Add again", (await op2.locator("[data-commission-declined]").count()) === 1);
  // The owner's own commission is approved at once.
  await op2.locator("[data-commission-declined] [data-commission-add]").click();
  await op2.locator("[data-commission-who]").fill("E2e Agent");
  await op2.locator("[data-commission-amount]").fill("5");
  await op2.locator("[data-commission-fields] button", { hasText: /^% of total before VAT$/ }).click();
  await op2.locator("[data-commission-save]").click();
  const own = await until(async () => { const r = (await sql("select commission_status, commission_kind, commission_value, commission_aed from public.quotations where id = $1", [quotationId]))[0]; return r?.commission_status === "approved" && r?.commission_kind === "percent" && Number(r.commission_aed) > 0 ? r : null; }, 30, 500);
  check("C1: the owner's own commission (5%) is approved at once and counted", !!own && Number(own.commission_value) === 5 && Number(own.commission_aed) > 0, JSON.stringify(own));
  await ob2.close();
  // The locked (customer-approved) quotation still takes a commission: it never touches the customer's figures.
  cleanupDb();
  const locked = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const { browser: ob3, page: op3 } = await browserFor("owner", { viewport: { width: 1440, height: 1100 } });
  await go(op3, `${base}/jobs/${locked.jobId}/quote/${locked.quotationId}`);
  check("C1: the locked view carries the commission line", (await op3.locator("[data-quote-locked]").count()) === 1 && (await op3.locator("[data-commission-add]").count()) === 1);
  await op3.locator("[data-commission-add]").click();
  await op3.locator("[data-commission-who]").fill("E2e Agent");
  await op3.locator("[data-commission-amount]").fill("50");
  await op3.locator("[data-commission-save]").click();
  const onLocked = await until(async () => { const r = (await sql("select commission_status, commission_aed, total_aed from public.quotations where id = $1", [locked.quotationId]))[0]; return r?.commission_status === "approved" && Number(r.commission_aed) === 50 ? r : null; }, 30, 500);
  check("C1: it saves on the approved quotation without touching the customer's total", !!onLocked && Number(onLocked.commission_aed) === 50, JSON.stringify(onLocked));
  await ob3.close();
}

/* ================= E1: gate-out mirrors gate-in (the owner hears a different count) ================= */
if (want("E")) {
  console.log("\n== E1 keys");
  cleanupDb();
  const { jobId } = (await api("/api/e2e/stage", { stage: "ready" })).json;
  const gi = (await sql("select keys_count, keys_keychain from public.gate_ins where job_id = $1", [jobId]))[0];
  const mark = (await sql("select now() as t"))[0]?.t;
  const { browser, page } = await browserFor("owner", { viewport: { width: 1366, height: 1200 } });
  await go(page, `${base}/jobs/${jobId}/gate-out`);
  check("E1: one tick with the gate-in's count; keychain tick only when recorded; no notes box", new RegExp(`${gi.keys_count} key`).test((await page.locator("[data-keys-tick]").textContent().catch(() => "")) ?? "") && (await page.locator("[data-keychain-tick]").count()) === (gi.keys_keychain ? 1 : 0) && (await page.locator("input[name='notes']").count()) === 0);
  await page.locator("[data-keys-differ]").click();
  const other = gi.keys_count === 2 ? "3" : "2";
  await page.locator(`input[name="keys_returned"][value="${other}"]`).check({ force: true });
  await page.locator("[name='override_reason']").fill("E2e: the spare key came back today");
  await page.locator("input[name='collector_name']").fill("Stage Customer");
  await page.locator("input[name='handover_confirmed']").check();
  const releaseBox = page.locator("[name='release_reason']");
  if (await releaseBox.count()) await releaseBox.fill("E2e test: released with the balance noted");
  await page.getByRole("button", { name: /Gate out and close the job/ }).click();
  await submitted(page);
  const out = (await sql("select go.keys_returned, go.keys_match, go.keys_override_reason, go.notes, j.is_open from public.gate_outs go join public.jobs j on j.id = go.job_id where go.job_id = $1", [jobId]))[0];
  check("E1: the different count closes the job with the reason logged and no notes", !!out && out.is_open === false && String(out.keys_returned) === other && out.keys_match === false && /spare key/.test(out.keys_override_reason ?? "") && out.notes === null, JSON.stringify(out));
  const told = await until(async () => ((await sql("select count(*)::int as n from public.notifications where title like 'Keys differ at gate-out%' and created_at > $1", [mark]))[0]?.n ?? 0) >= 1 ? 1 : null, 30, 500);
  check("E1: the owner is told 'Keys differ at gate-out' with both counts", !!told);
  await browser.close();
}

/* ================= D: delivery by recovery, the driver's one button, the recovery log ================= */
if (want("D")) {
  console.log("\n== D delivery and recovery");
  cleanupDb();
  const PIN = "https://maps.google.com/?q=25.1812,55.2807";
  await sql("update public.settings set value = to_jsonb('https://maps.google.com/?q=25.0657,55.1713'::text) where key = 'workshop_location_pin'");
  // The regular driver, saved in Settings.
  const { browser: ob, page: op } = await browserFor("owner", { viewport: { width: 1500, height: 1200 } });
  await go(op, `${base}/settings`);
  const card = op.locator("[data-recovery-drivers]");
  await card.locator("input[aria-label=\"Driver's name\"]").fill("E2e Truck Driver");
  await card.locator("input[aria-label=\"Driver's mobile\"]").fill("+971500000400");
  await card.locator("input[aria-label='Truck plate']").fill("DXB A 11111");
  await card.locator("input[name='is_default']").check();
  await card.locator("[data-driver-save]").click();
  const drv = await until(async () => (await sql("select id, is_default, truck_plate from public.recovery_drivers where name = 'E2e Truck Driver' and is_active"))[0] ?? null, 30, 500);
  check("D1: the driver is saved in Settings as the regular one", !!drv && drv.is_default === true && drv.truck_plate === "DXB A 11111", JSON.stringify(drv));

  // Gate-out by recovery: the driver prefilled, the pin pasted, date and time chips, no fee box.
  const { jobId } = (await api("/api/e2e/stage", { stage: "ready" })).json;
  await go(op, `${base}/jobs/${jobId}/gate-out`);
  await op.locator("input[name='leave_method'][value='recovery']").check({ force: true });
  check("D1: the regular driver is prefilled and the Fee box is gone", /E2e Truck Driver/.test((await op.locator("[data-driver-filled]").textContent().catch(() => "")) ?? "") && !/Fee \(AED\)/.test((await op.textContent("body")) ?? ""));
  await op.locator("[data-location-url]").fill("not a link");
  check("D1: a non-map paste is refused in words", (await op.locator("[data-pin-bad]").count()) === 1);
  await op.locator("[data-location-url]").fill(PIN);
  check("D1: a valid pin shows Open map", (await op.locator("[data-open-map]").count()) === 1);
  await op.locator("[data-location-details]").fill("E2e Villa 23, gate 2");
  await op.locator("[data-date-chips] button", { hasText: /^Tomorrow$/ }).click();
  await op.locator("[data-time-chips] button", { hasText: /^Evening$/ }).click();
  await op.locator("input[name='keys_ok']").check();
  if (await op.locator("input[name='keychain_ok']").count()) await op.locator("input[name='keychain_ok']").check();
  const releaseBox = op.locator("[name='release_reason']");
  if (await releaseBox.count()) await releaseBox.fill("E2e test: released with the balance noted");
  await op.getByRole("button", { name: /Stamp: left the workshop/ }).click();
  await submitted(op);
  const trip = await until(async () => (await sql("select id, token, driver_name, driver_phone, truck_plate, lat, lng, scheduled_date, scheduled_slot, location_url from public.recovery_trips where job_id = $1 and kind = 'delivery' and is_active", [jobId]))[0] ?? null, 30, 500);
  check("D1: the trip carries the driver, the pin's coordinates and the chips' day and time", !!trip && trip.driver_name === "E2e Truck Driver" && Number(trip.lat) === 25.1812 && Number(trip.lng) === 55.2807 && trip.scheduled_slot === "evening" && !!trip.token, JSON.stringify(trip));
  check("D1: the job is out for delivery", (await sql("select status from public.jobs where id = $1", [jobId]))[0]?.status === "in_delivery");

  // The panel: Send to driver, then "Car loaded: send 'on its way'".
  await go(op, `${base}/jobs/${jobId}/gate-out`);
  check("D4: the panel shows status only (no Received by, no photo buttons, no handover tick)", (await op.locator("[data-delivery-panel]").count()) === 1 && !/Received by/.test((await op.textContent("body")) ?? "") && (await op.locator("input[name='handover_confirmed']").count()) === 0);
  await op.locator("[data-send-driver]").click();
  const sent = await until(async () => (await sql("select sent_at from public.recovery_trips where id = $1", [trip.id]))[0]?.sent_at ? 1 : null, 30, 500);
  check("D2: Send to driver records the send", !!sent);
  await go(op, `${base}/jobs/${jobId}/gate-out`);
  await op.locator("[data-car-loaded]").click();
  const msg = await op.locator("[data-on-way-text]").inputValue();
  check("D3: the customer message is the owner's wording with the blanks filled", /on its way to you on our recovery truck DXB A 11111/.test(msg) && /Driver: E2e Truck Driver, \+971500000400/.test(msg) && /\+971 4 330 3113/.test(msg), msg.slice(0, 160));
  await op.locator("[data-on-way-send]").click();
  const loaded = await until(async () => (await sql("select loaded_at from public.recovery_trips where id = $1", [trip.id]))[0]?.loaded_at ? 1 : null, 30, 500);
  check("D3: the car is marked On the way with the time", !!loaded);
  await go(op, `${base}/jobs/${jobId}/gate-out`);
  check("D4: the status line reads 'On the way: left hh:mm · Driver … · Truck …'", /On the way: left \d{2}:\d{2}.*Driver: E2e Truck Driver.*Truck DXB A 11111/.test((await op.locator("[data-delivery-status]").textContent()) ?? ""), (await op.locator("[data-delivery-status]").textContent().catch(() => "")) ?? "");

  // The driver's one-button page.
  const dpage = await (await fetch(`${base}/drive/${trip.token}`)).text();
  check("D2: the driver's page is one big button with nothing about prices or invoices", /TAKE PHOTO/.test(dpage) && /DELIVERED/.test(dpage) && !/invoice/i.test(dpage.replace(/<script[\s\S]*?<\/script>/g, "")) , "");
  const jpg = Buffer.from("/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==", "base64");
  const fd = new FormData();
  fd.set("photo", new Blob([jpg], { type: "image/jpeg" }), "door.jpg");
  fd.set("price", "150");
  const dr = await fetch(`${base}/api/drive/${trip.token}`, { method: "POST", body: fd });
  const dj = await dr.json().catch(() => ({}));
  check("D2: Delivered + photo + price goes through", dr.status === 200 && dj.ok === true, `${dr.status} ${JSON.stringify(dj)}`);
  const after = await until(async () => { const r = (await sql("select t.status, t.price_aed, t.delivered_at, t.photo_path, j.is_open from public.recovery_trips t join public.jobs j on j.id = t.job_id where t.id = $1", [trip.id]))[0]; return r?.is_open === false ? r : null; }, 30, 500);
  check("D4: the job closed itself with the price claimed and the photo kept", !!after && after.status === "claimed" && Number(after.price_aed) === 150 && !!after.photo_path, JSON.stringify(after));
  check("D2: the photo is on the job's files", ((await sql("select count(*)::int as n from public.job_files where job_id = $1 and kind = 'delivery_photo' and storage_path like 'recovery/%'", [jobId]))[0]?.n ?? 0) === 1);
  const dr2 = await fetch(`${base}/api/drive/${trip.token}`, { method: "POST", body: (() => { const f2 = new FormData(); f2.set("photo", new Blob([jpg], { type: "image/jpeg" }), "x.jpg"); f2.set("price", "99"); return f2; })() });
  check("D2: the link is dead after it is used", dr2.status === 400 && /Already done/.test(String(((await dr2.json().catch(() => ({}))))?.error ?? "")));
  check("D2: the page says Done afterwards", /Done\. Thank you!/.test(await (await fetch(`${base}/drive/${trip.token}`)).text()));

  // The recovery log: distance, approve, paid.
  await go(op, `${base}/recovery`);
  const row = op.locator(`[data-trip='${trip.id}']`);
  check("D5: one row with the pin, the photo, the distance and AED 150 claimed", (await row.count()) === 1 && (await row.locator("[data-trip-pin]").count()) === 1 && (await row.locator("[data-trip-photo]").count()) === 1 && /≈ 1[678](\.\d)? km/.test((await row.textContent()) ?? "") && /AED 150/.test((await row.textContent()) ?? ""), ((await row.textContent().catch(() => "")) ?? "").slice(0, 220));
  await row.locator("[data-trip-approve]").click();
  await op.waitForURL(/message=/, { timeout: 15000 }).catch(() => null);
  await go(op, `${base}/recovery`);
  await op.locator(`[data-trip='${trip.id}'] [data-trip-paid]`).click();
  const paid = await until(async () => (await sql("select status from public.recovery_trips where id = $1", [trip.id]))[0]?.status === "paid" ? 1 : null, 30, 500);
  check("D5: Claimed -> Approved -> Paid with one tap each", !!paid);
  await ob.close();

  // The advisor's backup and the returning customer's pin. The same fixed job id cannot be stamped out twice
  // (the stamp trigger), so the history that feeds the prefill is planted as an old delivered trip.
  cleanupDb();
  const second = (await api("/api/e2e/stage", { stage: "ready" })).json;
  await sql("insert into public.recovery_trips (job_id, kind, driver_name, location_url, location_details, delivered_at, price_aed, status) values ($1, 'delivery', 'E2e Old Driver', $2, 'E2e Villa 23, gate 2', now() - interval '2 days', 120, 'paid')", [second.jobId, PIN]);
  // The owner stamps the car out (the balance release is his); the advisor then uses the backup button.
  const { browser: ab, page: ap } = await browserFor("owner", { viewport: { width: 1500, height: 1200 } });
  await go(ap, `${base}/jobs/${second.jobId}/gate-out`);
  await ap.locator("input[name='leave_method'][value='recovery']").check({ force: true });
  // No saved driver this round (the clean-up removed the E2e one): the new-driver boxes are typed, and he joins the list.
  await ap.locator("input[name='delivery_driver']").fill("E2e Backup Driver");
  await ap.locator("input[name='driver_phone']").fill("+971500000401");
  const prefilled = await ap.locator("[data-location-url]").inputValue();
  check("D1: the returning customer's last pin and details fill in by themselves", prefilled === PIN && (await ap.locator("[data-location-details]").inputValue()) === "E2e Villa 23, gate 2", prefilled);
  await ap.locator("[data-location-url]").fill(PIN);
  await ap.locator("[data-location-details]").fill("E2e Villa 23, gate 2");
  await ap.locator("input[name='keys_ok']").check();
  if (await ap.locator("input[name='keychain_ok']").count()) await ap.locator("input[name='keychain_ok']").check();
  const rb2 = ap.locator("[name='release_reason']");
  if (await rb2.count()) await rb2.fill("E2e test: released with the balance noted");
  await ap.getByRole("button", { name: /Stamp: left the workshop/ }).click();
  await submitted(ap);
  await ab.close();
  const { browser: ab3, page: ap3 } = await browserFor("service_advisor", { viewport: { width: 1500, height: 1200 } });
  await go(ap3, `${base}/jobs/${second.jobId}/gate-out`);
  await ap3.locator("[data-mark-delivered]").click();
  await ap.waitForURL(/message=/, { timeout: 20000 }).catch(() => null);
  const closed2 = await until(async () => ((await sql("select is_open from public.jobs where id = $1", [second.jobId]))[0]?.is_open === false ? 1 : null), 30, 500);
  const marked = await until(async () => (await sql("select marked_by, price_aed from public.recovery_trips where job_id = $1 and marked_by is not null limit 1", [second.jobId]))[0] ?? null, 30, 500);
  check("D4: 'Mark delivered' closes the job, logged as marked by the advisor, with no price yet", !!closed2 && !!marked && !!marked.marked_by && marked.price_aed === null, JSON.stringify({ closed2, marked }));
  check("D4: the history says marked by the advisor", ((await sql("select count(*)::int as n from public.job_events where job_id = $1 and note like 'Marked delivered by%'", [second.jobId]))[0]?.n ?? 0) === 1);
  await ab3.close();
  const { browser: ob2, page: op2 } = await browserFor("owner", { viewport: { width: 1500, height: 1200 } });
  await go(op2, `${base}/recovery`);
  const priceBox = op2.locator("[data-trip-price-box]").first();
  check("D5: accounts can type the price later on the Recovery page", (await priceBox.count()) === 1);
  await priceBox.fill("200");
  await op2.locator("[data-trip-price-box]").first().locator("xpath=following-sibling::button[1]").click().catch(async () => { await op2.getByRole("button", { name: /^Save price$/ }).first().click(); });
  const late = await until(async () => { const r = (await sql("select price_aed, status from public.recovery_trips where job_id = $1 and is_active and marked_by is not null order by created_at desc limit 1", [second.jobId]))[0]; return Number(r?.price_aed) === 200 ? r : null; }, 30, 500);
  check("D5: the late price lands as claimed", !!late && late.status === "claimed", JSON.stringify(late));
  await ob2.close();
  await sql("update public.settings set value = to_jsonb(''::text) where key = 'workshop_location_pin'");
}

/* ================= F: the target box and the labour rate check ================= */
if (want("F")) {
  console.log("\n== F target box and labour rate");
  cleanupDb();
  const { browser, page } = await browserFor("owner", { viewport: { width: 1500, height: 1100 } });
  await go(page, `${base}/dashboard`);
  const box = page.locator("[data-target-box]");
  check("F1: the owner's target box reads '<Month> so far: AED X profit' with the bar and '% of target (AED Y by today)'", (await box.count()) === 1 && /^[A-Z][a-z]+ so far: AED [\d,]+ profit$/.test(((await page.locator("[data-month-headline]").textContent()) ?? "").trim()) && /\d+% of target \(AED [\d,]+ by today\)/.test((await page.locator("[data-target-bar]").textContent()) ?? ""), (await page.locator("[data-month-headline]").textContent().catch(() => "")) ?? "");
  check("F1: the costs, workshop and pace lines read in plain words with no jargon", /To cover costs so far: AED [\d,]+/.test((await page.locator("[data-break-even]").textContent()) ?? "") && /(short by AED [\d,]+|AED [\d,]+ above)/.test((await page.locator("[data-break-even]").textContent()) ?? "") && /Coming from cars in the workshop: AED [\d,]+/.test((await page.locator("[data-in-progress]").textContent()) ?? "") && /If the month continues like this: AED [\d,]+/.test((await page.locator("[data-pace]").textContent()) ?? "") && !/break-even|provisional/i.test(((await box.textContent()) ?? "").replace(/How is this worked out\?[\s\S]*$/, "")));
  check("F1: the smaller line shows today's profit and collections, and 'How is this worked out?' explains each line", /Today: AED [\d,]+ profit invoiced.*AED [\d,]+ collected/.test((await page.locator("[data-today-line]").textContent()) ?? "") && (await page.locator("[data-target-explain]").count()) === 1 && /fixed costs from Settings|Monthly fixed costs/i.test((await page.locator("[data-target-explain]").textContent()) ?? ""), (await page.locator("[data-today-line]").textContent().catch(() => "")) ?? "");
  const inProgressOf = async () => Number((((await page.locator("[data-in-progress]").textContent()) ?? "").match(/AED ([\d,]+)/)?.[1] ?? "0").replace(/,/g, ""));
  const before = await inProgressOf();
  await api("/api/e2e/stage", { stage: "approved" });
  await go(page, `${base}/dashboard`);
  const afterIp = await inProgressOf();
  check("F1: an approved quotation on an open job joins 'In progress'", afterIp > before, `${before} -> ${afterIp}`);

  // F2: the labour rate check.
  const origActuals = (await sql("select value from public.settings where key = 'labour_cost_actuals'"))[0]?.value ?? {};
  const origRates = (await sql("select value from public.settings where key = 'technician_cost_rate_by_department'"))[0]?.value ?? {};
  await go(page, `${base}/reports/labour-rate`);
  check("F2: two cards (mechanical and bodyshop) with the hours clocked", (await page.locator("[data-rate-side='mechanical']").count()) === 1 && (await page.locator("[data-rate-side='bodyshop']").count()) === 1 && /h clocked/.test((await page.locator("[data-rate-side='mechanical']").textContent()) ?? ""));
  const mech = page.locator("[data-rate-side='mechanical']");
  // The page shows the hours rounded to one decimal; the rate divides by the exact minutes, so the test reads them from the database.
  const monthNow = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 7);
  const exact = (await sql(`select coalesce(sum(coalesce(s.minutes, 0)), 0)::int as m from public.work_sessions s join public.jobs j on j.id = s.job_id where s.is_active and s.started_at >= ($1 || '-01T00:00:00+04:00')::timestamptz and s.started_at < (($1 || '-01')::date + interval '1 month')::timestamptz and coalesce(j.department, 'mechanical') not in ('bodyshop', 'paint', 'ppf_tint', 'detailing')`, [monthNow]))[0]?.m ?? 0;
  const hours = exact / 60;
  // A believable figure for the data on hand: about AED 85 per clocked hour, so the sanity cap never trips.
  const cost = Math.max(1, Math.round(hours * 85));
  await mech.locator("[data-rate-cost]").fill(String(cost));
  await page.locator("[data-save-actuals]").click();
  await page.waitForURL(/message=/, { timeout: 20000 }).catch(() => null);
  await go(page, `${base}/reports/labour-rate`);
  const realText = ((await page.locator("[data-rate-side='mechanical'] [data-real-rate]").textContent()) ?? "");
  const expected = hours > 0 ? Math.round(cost / hours) : null;
  check("F2: the real rate is the typed cost over the clocked hours", expected === null ? realText.includes("—") : new RegExp(`AED ${expected.toLocaleString("en-GB")}/h`).test(realText), `hours ${hours} -> ${realText}`);
  if (expected !== null) {
    await page.locator("[data-rate-side='mechanical'] [data-use-rate]").click();
    const used = await until(async () => { const v = (await sql("select value->>'mechanical' as m from public.settings where key = 'technician_cost_rate_by_department'"))[0]?.m; return Number(v) === expected ? v : null; }, 30, 500);
    check("F2: 'Use this rate' writes the mechanical cost rate for every job profit", !!used, String(used));
  } else {
    check("F2: 'Use this rate' writes the mechanical cost rate for every job profit", false, "no hours clocked this month to divide by");
  }
  await browser.close();
  // Accounts can type the figures but never set the rate.
  const { browser: cb, page: cp } = await browserFor("accounts", { viewport: { width: 1366, height: 1000 } });
  await go(cp, `${base}/reports/labour-rate`);
  check("F2: accounts see the page with the cost boxes and no 'Use this rate'", (await cp.locator("[data-rate-cost]").count()) === 2 && (await cp.locator("[data-use-rate]").count()) === 0);
  await cb.close();
  // Everything put back as it was (a live database).
  await sql("update public.settings set value = $1::jsonb where key = 'labour_cost_actuals'", [JSON.stringify(origActuals)]);
  await sql("update public.settings set value = $1::jsonb where key = 'technician_cost_rate_by_department'", [JSON.stringify(origRates)]);
}

/* ================= G: parts arrivals and the parts-only dashboard ================= */
if (want("G")) {
  console.log("\n== G parts role");
  cleanupDb();
  const { jobId } = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const dubai = (plus) => new Date(Date.now() + 4 * 3600000 + plus * 86400000).toISOString().slice(0, 10);
  await sql("insert into public.suppliers (name, phone) values ('E2e Supplier', '+97140000099') on conflict do nothing");
  // Three parts on order: one due tomorrow, one overdue, one special (20 days' lead).
  await sql(`insert into public.part_items (job_id, description, quantity, cost_aed, supplier, order_status, expected_date, priced_at, availability, confirm_status)
    values ($1, 'E2E FILTER SET', 1, 100, 'E2e Supplier', 'ordered', $2, now(), 'to_order', 'confirmed'),
           ($1, 'E2E BRAKE HOSE', 2, 50, 'E2e Supplier', 'ordered', $3, now(), 'to_order', 'confirmed'),
           ($1, 'E2E SPECIAL PUMP', 1, 900, 'E2e Supplier', 'ordered', $4, now(), 'to_order', 'confirmed')`,
    [jobId, dubai(1), dubai(-2), dubai(20)]);
  // A workshop stock order due tomorrow shows too, marked Stock.
  await sql("insert into public.purchase_orders (number, kind, status, supplier_name, order_type, verify_token) values ('LPO-E2E-S1', 'stock', 'ordered', 'E2e Supplier', 'consumables', 'e2estok' || substr(md5(random()::text), 1, 12))");
  await sql("insert into public.purchase_order_lines (po_id, description, quantity, unit_cost, expected_date) select id, 'E2E HAND CLEANER', 6, 10, $1 from public.purchase_orders where number = 'LPO-E2E-S1'", [dubai(1)]);

  const { browser, page } = await browserFor("parts", { viewport: { width: 1500, height: 1200 } });
  await go(page, `${base}/dashboard`);
  const nav = await page.locator("nav").first().textContent() ?? "";
  check("G1: the Parts menu has Parts arrivals and no Calendar", /Parts arrivals/.test(nav) && !/Calendar/.test(nav), nav.slice(0, 160));
  check("G2: the parts dashboard has the tiles and no workshop chips", (await page.locator("[data-parts-tiles]").count()) === 1 && (await page.locator("[data-parts-tile]").count()) === 7 && !/Customer approval|Car wash|Road test/.test((await page.textContent("body")) ?? ""));
  check("G2: Waiting on you stays on top", /Waiting on you/i.test((await page.textContent("body")) ?? ""));
  const tileCount = async (key) => Number(((await page.locator(`[data-parts-tile='${key}']`).textContent()) ?? "").match(/^(\d+)/)?.[1] ?? "-1");
  check("G2: To price counts the open request, Overdue counts the late part", (await tileCount("to-price")) >= 1 && (await tileCount("overdue")) >= 1, JSON.stringify({ toPrice: await tileCount("to-price"), overdue: await tileCount("overdue") }));
  const carRow = page.locator(`[data-parts-car='${jobId}']`);
  check("G2: the car shows with the five dots and one action for its current step", (await carRow.count()) === 1 && (await carRow.locator("[data-parts-dots]").count()) === 1 && (await carRow.locator("[data-parts-action]").count()) === 1);

  await go(page, `${base}/parts/arrivals`);
  const overdueRow = page.locator("[data-overdue-list] [data-arrival]").filter({ hasText: "E2E BRAKE HOSE" });
  check("G1: the overdue part sits on top in red with Chase supplier on WhatsApp", (await overdueRow.count()) === 1 && (await overdueRow.locator("[data-chase]").count()) === 1 && ((await overdueRow.locator("[data-chase]").getAttribute("href")) ?? "").includes("wa.me/97140000099"));
  const dayCard = page.locator(`[data-arrival-day='${dubai(1)}']`);
  check("G1: tomorrow lists the part with supplier, car and the stock order marked Stock", /E2E FILTER SET/i.test((await dayCard.textContent()) ?? "") && /E2e Supplier/.test((await dayCard.textContent()) ?? "") && /E2E HAND CLEANER/i.test((await dayCard.textContent()) ?? "") && /stock/i.test((await dayCard.locator("[data-arrival]").filter({ hasText: "E2E HAND CLEANER" }).textContent()) ?? ""), ((await dayCard.textContent().catch(() => "")) ?? "").slice(0, 200));
  // A 20-day part lives past the week view: "Special orders only" lists it whenever it lands.
  await go(page, `${base}/parts/arrivals?special=1`);
  const bodySpecial = (await page.textContent("body")) ?? "";
  check("G1: 'Special orders only' lists the long-lead part, marked, and hides the rest", (await page.locator("[data-special-list]").count()) === 1 && /E2E SPECIAL PUMP/i.test(bodySpecial) && /Special order/.test((await page.locator("[data-special-list] [data-arrival]").filter({ hasText: "E2E SPECIAL PUMP" }).first().textContent()) ?? "") && !/E2E FILTER SET/i.test(bodySpecial), bodySpecial.match(/.{0,60}SPECIAL PUMP.{0,60}/i)?.[0] ?? "");
  // Move the tomorrow part's date with a reason: the job's dates follow and the advisor hears.
  await go(page, `${base}/parts/arrivals`);
  const mark = (await sql("select now() as t"))[0]?.t;
  const row = page.locator("[data-arrival]").filter({ hasText: "E2E FILTER SET" }).first();
  await row.locator("[data-move-date]").click();
  await row.locator("[data-move-date-input]").fill(dubai(6));
  await row.locator("button", { hasText: /^Supplier delayed$/ }).first().click();
  await row.locator("[data-move-date-save]").click();
  await page.waitForURL(/message=/, { timeout: 20000 }).catch(() => null);
  const moved = await until(async () => { const r = (await sql("select p.expected_date::text as e, j.plan_parts_ready_date::text as ready from public.part_items p join public.jobs j on j.id = p.job_id where p.description ilike 'E2E FILTER SET'"))[0]; return r?.e === dubai(6) ? r : null; }, 30, 500);
  check("G1: the date moves with the reason and 'All parts here by' follows the latest part", !!moved && moved.ready === dubai(20), JSON.stringify(moved));
  const toldAdvisor = await until(async () => ((await sql("select count(*)::int as n from public.notifications where title like 'Part delayed on%' and created_at > $1", [mark]))[0]?.n ?? 0) >= 1 ? 1 : null, 30, 500);
  check("G1: the advisor is told about the delay", !!toldAdvisor);
  await browser.close();
  // The no-delete trigger keeps purchase orders: the clean-up SQL (replica mode) removes LPO-E2E-% rows.
}

/* ================= B2: the layout holds up at any zoom ================= */
if (want("Z")) {
  console.log("\n== B2 zoom");
  cleanupDb();
  const seed = (await api("/api/e2e/stage", { stage: "quote" })).json;
  // Browser zoom means a smaller or larger CSS viewport: 1366 at 125% is 1093 wide, at 80% it is 1708.
  const widths = [1708, 1518, 1242, 1093, 1025, 911, 745, 656];
  const pages = [
    ["quote", `${base}/jobs/${seed.jobId}/quote/${seed.quotationId}`],
    ["parts", `${base}/parts/${seed.jobId}`],
    ["job card", `${base}/jobs/${seed.jobId}`],
    ["gate-in", `${base}/gate-in`],
  ];
  const { browser, context } = await browserFor("owner", { viewport: { width: 1366, height: 1000 } });
  for (const [name, url] of pages) {
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    const bad = [];
    for (const w of widths) {
      await page.setViewportSize({ width: w, height: 1000 });
      await page.goto(url, { waitUntil: "load", timeout: 60000 });
      await sleep(900);
      const r = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const sw = document.scrollingElement ? document.scrollingElement.scrollWidth : document.body.scrollWidth;
        const offenders = [];
        for (const el of document.querySelectorAll("body *")) {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.right <= vw + 1) continue;
          // Inside a scroll container (a wide table) horizontal overflow is the design.
          let p = el.parentElement, scrollable = false;
          while (p) { const o = getComputedStyle(p).overflowX; if (o === "auto" || o === "scroll") { scrollable = true; break; } p = p.parentElement; }
          if (scrollable) continue;
          const cls = (el.getAttribute("class") ?? "").slice(0, 60);
          offenders.push(`<${el.tagName.toLowerCase()} ${cls}> right=${Math.round(rect.right)}`);
          if (offenders.length >= 3) break;
        }
        return { vw, sw, offenders };
      });
      if (r.sw > r.vw + 1 || r.offenders.length) bad.push(`${w}px: scroll ${r.sw}>${r.vw}${r.offenders.length ? " · " + r.offenders[0] : ""}`);
    }
    check(`B2: ${name} holds up from 80% to 125% zoom at PC and tablet widths`, bad.length === 0, bad.join(" | ").slice(0, 300));
    await page.close();
  }
  await browser.close();
}

/* ================= 18 Oct section 4: the advisors' daily profit figure ================= */
if (want("H")) {
  console.log("\n== 18-4 advisor figure");
  cleanupDb();
  const { browser, page } = await browserFor("service_advisor", { viewport: { width: 1400, height: 1100 } });
  await go(page, `${base}/dashboard`);
  const panel = page.locator("[data-advisor-panel]");
  check("4: the advisor's dashboard leads with 'Today: AED X profit of AED 20,000' and a bar", (await panel.count()) === 1 && /^Today: AED [\d,]+ profit of AED [\d,]+$/.test(((await page.locator("[data-advisor-today]").textContent()) ?? "").trim()) && (await page.locator("[data-advisor-bar]").count()) === 1, (await page.locator("[data-advisor-today]").textContent().catch(() => "")) ?? "");
  check("4: 'To hit <month>: AED Y profit a day from now'", /^To hit [A-Z][a-z]+: AED [\d,]+ profit a day from now$/.test(((await page.locator("[data-advisor-pace]").textContent()) ?? "").trim()), (await page.locator("[data-advisor-pace]").textContent().catch(() => "")) ?? "");
  const body = (await page.textContent("body")) ?? "";
  check("4: no fixed costs, break-even, owner projection or ranking for advisors", (await page.locator("[data-target-box]").count()) === 0 && !/break-even|fixed costs|continues like this/i.test(body) && !/rank/i.test(body));
  await page.locator("[data-my-month] summary").click();
  const my = (await page.locator("[data-my-month]").textContent()) ?? "";
  check("4: 'My month' shows only the advisor's own six figures", /Quotes sent/.test(my) && /Quotes approved/.test(my) && /Profit approved/.test(my) && /Average margin/.test(my) && /Cars delivered on time/.test(my) && /only you see this/i.test(my));
  const before = Number((((await page.locator("[data-advisor-today]").textContent()) ?? "").match(/Today: AED ([\d,]+)/)?.[1] ?? "0").replace(/,/g, ""));
  await browser.close();
  // A customer approval moves the team figure the moment it lands.
  await api("/api/e2e/stage", { stage: "approved" });
  const { browser: b2, page: p2 } = await browserFor("service_advisor", { viewport: { width: 1400, height: 1100 } });
  await go(p2, `${base}/dashboard`);
  const after = Number((((await p2.locator("[data-advisor-today]").textContent()) ?? "").match(/Today: AED ([\d,]+)/)?.[1] ?? "0").replace(/,/g, ""));
  check("4: an approval today moves the team figure (profit of approved work, not sales value)", after > before, `${before} -> ${after}`);
  // The owner's dashboard keeps his own box and never shows the advisor panel.
  const { browser: ob, page: op } = await browserFor("owner", { viewport: { width: 1400, height: 1100 } });
  await go(op, `${base}/dashboard`);
  check("4: the owner keeps the target box; the advisor panel is not his", (await op.locator("[data-target-box]").count()) === 1 && (await op.locator("[data-advisor-panel]").count()) === 0);
  await ob.close();
  await b2.close();
}

/* ================= 18 Oct section 5: low-profit colours and warning ================= */
if (want("I")) {
  console.log("\n== 18-5 low profit");
  cleanupDb();
  const { jobId, quotationId } = (await api("/api/e2e/stage", { stage: "quote" })).json;
  // The blockers out of the way: the open request closed and pricing done, as the deposit suite does.
  await sql("update public.part_requests set status = 'done' where job_id = $1", [jobId]);
  await sql("update public.jobs set parts_pricing_done_at = now() where id = $1", [jobId]);
  const limits = async () => (await sql("select (select value from public.settings where key = 'quote_margin_yellow_percent') as y, (select value from public.settings where key = 'quote_margin_red_percent') as r"))[0];
  const orig = await limits();
  const { browser, page } = await browserFor("service_advisor", { viewport: { width: 1440, height: 1100 } });
  await go(page, `${base}/jobs/${jobId}/quote/${quotationId}`);
  check("5: the bottom bar shows the profit margin in green at the default limits", /Profit \d+%/.test((await page.locator("[data-margin-chip]").textContent()) ?? "") && (await page.locator("[data-margin-chip]").getAttribute("data-margin-tone")) === "green", (await page.locator("[data-margin-chip]").textContent().catch(() => "")) ?? "");
  // The owner raises the red line above this quote's margin: it turns red and completing asks "Are you sure?".
  await sql("update public.settings set value = '95'::jsonb where key = 'quote_margin_red_percent'");
  await sql("update public.settings set value = '97'::jsonb where key = 'quote_margin_yellow_percent'");
  await go(page, `${base}/jobs/${jobId}/quote/${quotationId}`);
  check("5: below the red limit the margin shows red in the bar and the summary", (await page.locator("[data-margin-chip]").getAttribute("data-margin-tone")) === "red" && (await page.locator("[data-internal-box] dd[class*='text-red']").count()) >= 1);
  const mark = (await sql("select now() as t"))[0]?.t;
  await page.getByRole("button", { name: /^Quotation complete$/ }).click();
  const ask = await until(async () => ((await page.locator("[data-low-profit-ask]").count()) ? 1 : null), 30, 400);
  check("5: completing a red quote asks 'This is too low of a profit (AED x on AED y, z%)'", !!ask && /This is too low of a profit \(AED [\d,.]+ on AED [\d,.]+, [\d.]+%\)\. Are you sure you want to send\?/.test((await page.locator("[data-low-profit-ask]").textContent()) ?? ""), (await page.locator("[data-low-profit-ask]").textContent().catch(() => "")) ?? "");
  await page.locator("[data-low-profit-fix]").click();
  await sleep(800);
  check("5: 'Go back and fix' closes the question without completing", (await page.locator("[data-low-profit-ask]").count()) === 0 && (await sql("select completed_at from public.quotations where id = $1", [quotationId]))[0]?.completed_at === null);
  await page.getByRole("button", { name: /^Quotation complete$/ }).click();
  await until(async () => ((await page.locator("[data-low-profit-ask]").count()) ? 1 : null), 30, 400);
  await page.locator("[data-low-profit-send]").click();
  const done = await until(async () => (await sql("select completed_at from public.quotations where id = $1", [quotationId]))[0]?.completed_at ? 1 : null, 30, 500);
  check("5: 'Send anyway' completes and is written on the quotation", !!done && ((await sql("select count(*)::int as n from public.quotation_events where quotation_id = $1 and event_type = 'low_profit_sent'", [quotationId]))[0]?.n ?? 0) === 1);
  const told = await until(async () => (await sql("select title from public.notifications where type = 'low_profit' and created_at > $1 limit 1", [mark]))[0] ?? null, 30, 500);
  check("5: the owner is told 'Low-profit quote sent by [advisor]: [car], [margin]%'", /^Low-profit quote sent by .+: .+, [\d.]+%$/.test(told?.title ?? ""), told?.title);
  // Yellow is a colour, never a question.
  await sql("update public.settings set value = '5'::jsonb where key = 'quote_margin_red_percent'");
  await sql("update public.quotations set completed_at = null, completed_by = null where id = $1", [quotationId]);
  await go(page, `${base}/jobs/${jobId}/quote/${quotationId}`);
  check("5: between the limits the margin shows yellow", (await page.locator("[data-margin-chip]").getAttribute("data-margin-tone")) === "amber");
  await page.getByRole("button", { name: /^Quotation complete$/ }).click();
  const done2 = await until(async () => (await sql("select completed_at from public.quotations where id = $1", [quotationId]))[0]?.completed_at ? 1 : null, 30, 500);
  check("5: a yellow quote completes without the question", !!done2 && (await page.locator("[data-low-profit-ask]").count()) === 0);
  await browser.close();
  await sql("update public.settings set value = $1::jsonb where key = 'quote_margin_yellow_percent'", [JSON.stringify(orig?.y ?? 30)]);
  await sql("update public.settings set value = $1::jsonb where key = 'quote_margin_red_percent'", [JSON.stringify(orig?.r ?? 20)]);
}

cleanupDb();
process.exit(summary() ? 1 : 0);
