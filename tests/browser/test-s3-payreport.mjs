// Section 3 of 2 November 2026: PAYMENT HAND-OVER (J-00969). Proves through the screens, on the TEST database:
//   A  3.1 the cause: a real accounts login HAS Record payment in the job card's money tile (the J-00969 sequence: the
//      owner records an advance, then accounts see the button with the balance); the owner in View as sees the same
//      button greyed with "View as is read-only – use Act as to record"; accounts reach the job card from a money row.
//   B  3.2 the Record payment window's search: "S 30303" (code and number apart) finds the car; each row shows the car
//      picture, plate, make, the customer, the job number and the balance; accounts have the button on the car and
//      customer pages too.
//   C  3.3 the advisor's "Payment received – send to accounts": the balance pre-filled, Send held until the photo is on the
//      server (and the server refuses without one), the report, the bells to accounts AND the owner, the amber line on the
//      job card, the Waiting on you line in the owner's exact words with the slip, a second report asks once, Withdraw.
//   D  accounts Record from Waiting on you: the window pre-filled (method, amount, the slip as the proof), the confirm
//      question, one receipt keyed by the report, the advisor told "Recorded ✓ RCT-…", a second Record says "Already
//      recorded", Undo puts the report back (the advisor told) and it can be recorded again.
//   E  Query: from the bell's address (?pay-report=) the window opens on the report; Query with a comment; the advisor's
//      red line and Waiting line; Send again carries the photo and replaces the queried report.
//   F  3.4 the reminder after 4 WORKING hours: one bell to accounts and the owner per report, the line turns red, never twice.
//   G  Settings > Money shows the reminder hours.
//   H  the review fixes of 3 November 2026 (proforma sent): the tile's main button opens the report and only its car, a
//      different payment never closes it (auth code), a voided receipt reopens it, a PDF slip is a PDF tile, a queried
//      report is closed by the money recorded later and Send again then asks, a copied tab's key is refused and renewed,
//      a car that left owing keeps the advisor's button on both pages, and the search by name shows that car and balance.
//   npm run test:s3-payreport     (TEST server: E2E_BASE=http://localhost:3101 for the dev server)
import fs from "node:fs";
import path from "node:path";
import { api, base, browserFor, cleanupDb, go, here, makeChecks, pressRecord, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const SHOTS = path.join(here, "shots", "s3-payreport");
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (name) => path.join(SHOTS, name);
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 25 * 60 * 1000).unref();
const ONLY = (process.env.ONLY ?? "").split(",").filter(Boolean);
const want = (s) => !ONLY.length || ONLY.includes(s);
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGklEQVR4nGP4z8BAEmIY1TCqYVTDqIbhqgEAOK8f8Rf2cHcAAAAASUVORK5CYII=", "base64");
const text = async (loc) => ((await loc.first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
const aed = (n) => `AED ${Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const code = (p) => `${p}${String(Date.now()).slice(-5)}`.slice(0, 6).toUpperCase();
const dialog = (page) => page.locator("[data-record-payment-dialog]");
const first = (name) => String(name ?? "").trim().split(/\s+/)[0];

const STORAGE = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object`;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ownerB = await browserFor("owner", { viewport: { width: 1366, height: 950 } });
const accountsB = await browserFor("accounts", { viewport: { width: 1366, height: 950 } });
const advisorB = await browserFor("service_advisor", { viewport: { width: 800, height: 1280 } });
const owner = ownerB.page;
const accounts = accountsB.page;
const advisor = advisorB.page;
const staffOf = async (role) => (await sql("select id::text as id, display_name from public.staff where role_id = $1 and is_active order by display_name limit 1", [role]))[0];
const OWNER = await staffOf("owner");
const ACC = await staffOf("accounts");
const ADV = await staffOf("service_advisor");
const moneyPeople = (await sql("select count(*)::int as n from public.staff where role_id in ('accounts','owner') and is_active"))[0].n;
const accountsCount = (await sql("select count(*)::int as n from public.staff where role_id = 'accounts' and is_active"))[0].n;

/** A fresh "approved" car (the J-00969 shape: waiting for parts, no proforma), with an advance already in. */
async function freshCar(advance = 300) {
  cleanupDb();
  const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const jobId = seed.jobId;
  const j = (await sql("select j.job_number, j.customer_id::text as c, j.vehicle_id::text as v, coalesce(c.company_name, c.full_name) as customer, v.plate_code, v.plate_number, v.plate_emirate, m.name as make from public.jobs j join public.customers c on c.id = j.customer_id join public.vehicles v on v.id = j.vehicle_id left join public.vehicle_makes m on m.id = v.make_id where j.id = $1", [jobId]))[0];
  const total = (await sql("select total_aed::float8 as t from public.quotations where job_id = $1 and status = 'approved' order by version desc limit 1", [jobId]))[0]?.t ?? 0;
  if (advance) await sql("insert into public.payments (job_id, customer_id, method, amount_aed, is_deposit, status, received_by, created_by, updated_by, received_at, verified_at, verified_by) values ($1, $2, 'cash', $3, true, 'recorded', $4, $4, $4, now(), now(), $4)", [jobId, j.c, advance, OWNER.id]);
  return { jobId, ...j, total, balance: Math.round((total - advance) * 100) / 100 };
}

/** The advisor sends a payment from the job card: method, optional amount / auth code / reference, photo (or a PDF), note. */
async function advisorReports(car, { method = "card", amount = null, auth = "", reference = "", note = "Paid at the counter", photo = true, file = null } = {}) {
  await go(advisor, `${base}/jobs/${car.jobId}`);
  await advisor.locator('[data-money-tile] [data-payment-report-open="new"]').click();
  const d = advisor.locator("[data-payment-report-dialog]");
  await d.waitFor();
  await d.locator(`[data-report-method="${method}"]`).click();
  if (amount !== null) await d.locator("[data-report-amount]").fill(String(amount));
  if (auth) await d.locator("[data-auth-code]").fill(auth);
  if (reference) await d.locator("[data-report-reference]").fill(reference);
  await d.locator("[data-report-note]").fill(note);
  if (photo) {
    await d.locator('[data-job-file-upload] input[type="file"]').first().setInputFiles(file ?? { name: "slip.png", mimeType: "image/png", buffer: png });
    await until(async () => (await d.locator("[data-report-photo-missing]").count()) === 0, 60, 500);
  }
  const key = await d.locator('input[name="report_id"]').inputValue();
  return { d, key };
}

/** In an open Record payment window: method, a part amount, optional auth code / reference / proof, Record + Yes. */
async function payInWindow(page, { method = "card", amount, auth = null, reference = null, proof = true }) {
  const d = dialog(page);
  await d.locator(`[data-method="${method}"]`).click();
  if (await d.locator("[data-amount-partial]").count()) await d.locator("[data-amount-partial]").click();
  await d.locator("[data-amount-input]").fill("");
  await d.locator("[data-amount-input]").pressSequentially(String(amount));
  if (auth) await d.locator("[data-auth-code]").fill(auth);
  if (reference) await d.locator("[data-reference]").fill(reference);
  if (proof) {
    await d.locator('[data-payment-form] [data-job-file-upload] input[type="file"]').first().setInputFiles({ name: `${method}-proof.png`, mimeType: "image/png", buffer: png });
    await until(async () => (await d.locator("[data-proof-missing]").count()) === 0, 60, 500);
  }
  await pressRecord(d);
  return until(async () => (await d.locator("[data-record-payment-done]").count()) ? await d.locator("[data-record-payment-done]").getAttribute("data-record-payment-done") : null, 50, 500);
}

try {
  /* ---------------- A. 3.1 The cause: accounts DO have it on the job card; View as hides it (now greyed with words) ---------------- */
  if (want("A") || want("B") || want("C") || want("D") || want("E") || want("F")) {
    const car = await freshCar(300);
    if (want("A")) {
      await go(accounts, `${base}/jobs/${car.jobId}`);
      const inTile = await accounts.locator("[data-money-tile] [data-record-payment-open]").count();
      const tile = await text(accounts.locator("[data-paid-so-far]"));
      check("A1: a real accounts login has Record payment in the job card's money tile (J-00969 shape)", inTile === 1, `count ${inTile}`);
      check("A1: after the owner's advance the tile says Paid so far AED 300.00 · Balance", tile.includes("Paid so far AED 300.00") && tile.includes(`Balance ${aed(car.balance)}`), tile);
      await accounts.locator("[data-money-tile]").screenshot({ path: shot("A1-accounts-job-card-tile.png") });
      // The owner in View as accounts: the same button, greyed, with the words (the window is not there to open).
      const r = await ownerB.context.request.post(`${base}/api/view-as/set`, { data: { kind: "view", id: ACC.id } });
      await go(owner, `${base}/jobs/${car.jobId}`);
      const ro = owner.locator("[data-money-tile] [data-record-payment-readonly]");
      check("A2: owner viewing as accounts sees the Record payment button greyed with the reason", r.ok() && (await ro.count()) === 1 && (await ro.locator("button").isDisabled()) && /View as is read-only – use Act as to record/.test(await text(ro)), await text(ro));
      check("A2: and no live button (nothing records in View as)", (await owner.locator("[data-record-payment-open]").count()) === 0);
      await owner.locator("[data-money-tile]").screenshot({ path: shot("A2-view-as-read-only.png") });
      // A tab that did not start View as itself drops it on its next page (ModeGuard): ask again, as the menu would.
      await ownerB.context.request.post(`${base}/api/view-as/set`, { data: { kind: "view", id: ACC.id } });
      await go(owner, `${base}/customers/${car.c}`);
      check("A2: the customer page shows it greyed too", (await owner.locator("[data-record-payment-readonly]").count()) === 1 && (await owner.locator("[data-record-payment-open]").count()) === 0);
      await ownerB.context.request.post(`${base}/api/view-as/set`, { data: { kind: "none" } });
      // Accounts have no Jobs menu: the money rows and Waiting lines carry "Job card".
      await sql("update public.jobs set status = 'ready', stage = 'ready' where id = $1", [car.jobId]);
      await go(accounts, `${base}/invoices`);
      const row = accounts.locator(`[data-money-row="${car.jobId}"] [data-money-row-job-card]`);
      check("A3: accounts' money row has a Job card link to the job card", (await row.count()) === 1 && (await row.getAttribute("href")) === `/jobs/${car.jobId}`);
      await sql("update public.jobs set status = 'waiting_parts', stage = 'parts' where id = $1", [car.jobId]);
    }

    /* ---------------- B. 3.2 The window's search rows, and the car/customer pages ---------------- */
    if (want("B")) {
      // A real picture for the test car (TEST storage only), so the row's thumbnail is proved.
      const photoPath = `e2e/s3-${car.v}.png`;
      const up = await fetch(`${STORAGE}/vehicle-photos/${photoPath}`, { method: "POST", headers: { authorization: `Bearer ${KEY}`, "content-type": "image/png", "x-upsert": "true" }, body: png });
      await sql("update public.vehicles set photo_path = $2 where id = $1", [car.v, photoPath]);
      await go(accounts, `${base}/invoices`);
      await accounts.locator("[data-record-payment-open]").first().click();
      await dialog(accounts).waitFor();
      const plateQ = `${car.plate_code} ${car.plate_number}`;
      await dialog(accounts).locator("[data-payer-search-input]").fill(plateQ);
      const hit = dialog(accounts).locator(`[data-payer-hit][data-payer-job="${car.job_number}"]`);
      const found = await until(async () => (await hit.count()) > 0, 40, 400);
      check(`B1: "${plateQ}" (code and number kept apart) finds the car in the window`, !!found);
      if (found) {
        const carW = await text(hit.locator("[data-payer-car]"));
        const who = await text(hit.locator("[data-payer-who]"));
        const bal = await text(hit.locator("[data-payer-balance]"));
        const shown = await until(async () => hit.locator('[data-car-thumb="photo"] img').evaluate((img) => img.complete && img.naturalWidth > 0).catch(() => false), 30, 300);
        check("B2: the row shows the car picture (loaded)", up.ok && (await hit.locator('[data-car-thumb="photo"]').count()) === 1 && !!shown, `upload ${up.status}`);
        check("B2: plate and make, then the customer and the job number", carW.includes(`${car.plate_code} ${car.plate_number}`.toUpperCase()) && (!car.make || carW.includes(String(car.make).toUpperCase())) && who.toUpperCase().includes(String(car.customer).toUpperCase()) && who.includes(car.job_number), `${carW} | ${who}`);
        check("B2: and the balance (the approved total less the advance)", bal === `Balance ${aed(car.balance)}`, bal);
        await dialog(accounts).screenshot({ path: shot("B-window-search-rows.png") });
        check("B2: the row opens the job card too", (await dialog(accounts).locator(`[data-payer-job-card][href="/jobs/${car.jobId}"]`).count()) === 1);
      }
      await dialog(accounts).locator("[data-record-payment-close]").click();
      await go(accounts, `${base}/customers/${car.c}`);
      check("B3: accounts have Record payment on the customer page", (await accounts.locator("[data-record-payment-open]").count()) >= 1);
      await go(accounts, `${base}/vehicles/${car.v}`);
      check("B3: and on the car page", (await accounts.locator("[data-record-payment-open]").count()) >= 1);
      await fetch(`${STORAGE}/vehicle-photos/${photoPath}`, { method: "DELETE", headers: { authorization: `Bearer ${KEY}` } }).catch(() => null);
      await sql("update public.vehicles set photo_path = null where id = $1", [car.v]);
    }

    /* ---------------- C. 3.3 The advisor's report ---------------- */
    let reportId = null;
    if (want("C") || want("D") || want("E") || want("F")) {
      await go(advisor, `${base}/jobs/${car.jobId}`);
      check("C1: the advisor has no Record payment (advisors never record money)", (await advisor.locator("[data-record-payment-open]").count()) === 0);
      const btn = advisor.locator('[data-money-tile] [data-payment-report-open="new"]');
      check("C1: the money tile has 'Payment received – send to accounts'", (await btn.count()) === 1 && /Payment received – send to accounts/.test(await text(btn)), await text(btn));
      await btn.click();
      const d = advisor.locator("[data-payment-report-dialog]");
      await d.waitFor();
      check("C1: the amount is pre-filled with the balance", (await d.locator("[data-report-amount]").inputValue()) === car.balance.toFixed(2), await d.locator("[data-report-amount]").inputValue());
      await d.locator('[data-report-method="card"]').click();
      check("C2: Send waits for the photo (required)", (await d.locator("[data-report-send]").isDisabled()) && (await d.locator("[data-report-photo-missing]").count()) === 1);
      // The server refuses without a photo, whatever the screen says.
      await d.locator("[data-report-send]").evaluate((b) => b.removeAttribute("disabled"));
      await d.locator("[data-report-send]").click();
      const refused = await until(async () => (await d.locator("[data-report-error]").count()) ? await text(d.locator("[data-report-error]")) : null, 30, 400);
      check("C2: the server refuses a report without the photo", /Attach the photo of the slip/.test(refused ?? ""), refused ?? "");
      check("C2: nothing was saved", (await sql("select count(*)::int as n from public.payment_reports where job_id = $1", [car.jobId]))[0].n === 0);
      await sleep(5200); // the form guard's five seconds after a tap
      await d.locator("[data-report-note]").fill("Paid by the driver at the counter");
      await d.locator('[data-job-file-upload] input[type="file"]').first().setInputFiles({ name: "slip.png", mimeType: "image/png", buffer: png });
      await until(async () => (await d.locator("[data-report-photo-missing]").count()) === 0, 60, 500);
      reportId = await d.locator('input[name="report_id"]').inputValue();
      await d.screenshot({ path: shot("C-advisor-dialog.png") });
      await d.locator("[data-report-send]").click();
      const sent = await until(async () => (await d.locator("[data-report-sent]").count()) ? await text(d.locator("[data-report-sent]")) : null, 40, 400);
      check("C3: Sent to accounts ✓ in the window", /Sent to accounts ✓/.test(sent ?? ""), sent ?? "");
      const rep = (await sql("select status, amount_aed::float8 as a, method, auth_code, proof_path, reported_by::text as by, note from public.payment_reports where id = $1", [reportId]))[0];
      check("C3: the report is saved: waiting, the balance, card, no auth code yet, the slip, the advisor", rep?.status === "waiting" && rep.a === car.balance && rep.method === "card" && !rep.auth_code && !!rep.proof_path && rep.by === ADV.id, JSON.stringify(rep ?? {}));
      const files = (await sql("select count(*)::int as n from public.job_files where kind = 'payment_report' and ref_id = $1 and removed_at is null", [reportId]))[0].n;
      check("C3: the photo is a job file of kind payment_report tied to the report", files === 1);
      const bells = await sql("select n.staff_id::text as s, n.title, n.href from public.notifications n where n.type = 'payment_reported' and n.job_id = $1", [car.jobId]);
      check(`C4: accounts AND the owner are told (${moneyPeople} people)`, bells.length === moneyPeople && bells.some((b) => b.s === OWNER.id) && bells.some((b) => b.s === ACC.id), bells.length);
      check("C4: the bell names the job, plate, amount, method and the advisor, and opens the window", bells[0] && bells[0].title.startsWith(`Payment reported · ${car.job_number} · `) && bells[0].title.includes(aed(car.balance)) && bells[0].title.endsWith(`Card · from ${first(ADV.display_name)}`) && bells[0].href === `/jobs/${car.jobId}?pay-report=${reportId}#invoice`, bells[0]?.title);
      await d.locator("[data-report-done]").click();
      await go(advisor, `${base}/jobs/${car.jobId}`);
      const amber = await text(advisor.locator(`[data-payment-reported="${reportId}"]`));
      check("C5: the job card shows the amber line 'Payment reported by … · waiting for accounts'", amber.includes(`Payment reported by ${first(ADV.display_name)} · ${aed(car.balance)} · Card · waiting for accounts`), amber);
      await advisor.locator("[data-money-tile]").screenshot({ path: shot("C-job-card-amber-line.png") });
      // The owner's exact words on Waiting on you, with the slip.
      const plate = `${car.plate_emirate} ${car.plate_code} ${car.plate_number}`.toUpperCase();
      const words = [car.job_number, plate, car.make ? String(car.make).toUpperCase() : null, car.customer, aed(car.balance), "Card", `from ${first(ADV.display_name)}`].filter(Boolean).join(" · ");
      for (const [who, page] of [["accounts", accounts], ["owner", owner]]) {
        await go(page, `${base}/dashboard`);
        const line = page.locator(`[data-waiting-row][data-waiting-job="payrep:${reportId}"]`);
        const t = await text(line);
        check(`C6: ${who}'s Waiting on you line in the owner's words`, t.includes(words), `${t.slice(0, 200)} | want ${words}`);
        check(`C6: ${who}'s line carries the slip, Record and Query`, (await line.locator(`[data-report-photo="${reportId}"]`).count()) === 1 && (await line.locator(`[data-report-record="${reportId}"]`).count()) === 1 && (await line.locator(`[data-report-query-open="${reportId}"]`).count()) === 1);
        if (who === "accounts") {
          await line.screenshot({ path: shot("C-accounts-waiting-line.png") });
          check("C6: accounts also see it on the dashboard card 'Payments reported by advisors'", (await page.locator(`[data-payment-reports] [data-payment-report-row="${reportId}"]`).count()) === 1);
        }
      }
      // A second report on the same car asks once; it can be withdrawn.
      const second = await advisorReports(car, { method: "cash", note: "Second payment by mistake" });
      await second.d.locator("[data-report-send]").click();
      const ask = await until(async () => (await second.d.locator("[data-report-second]").count()) ? await text(second.d.locator("[data-report-second]")) : null, 30, 400);
      check("C7: a second report on the same car asks once ('already reported … Send this one as well?')", /already reported .*Send this one as well\?/.test(ask ?? ""), ask ?? "");
      await second.d.locator("[data-report-send-anyway]").click();
      const two = await until(async () => (await second.d.locator("[data-report-sent]").count()) > 0, 30, 400);
      check("C7: Send it as well makes the second report", !!two && (await sql("select status from public.payment_reports where id = $1", [second.key]))[0]?.status === "waiting");
      await second.d.locator("[data-report-done]").click();
      await go(advisor, `${base}/jobs/${car.jobId}`);
      await advisor.locator(`[data-report-withdraw="${second.key}"]`).click();
      await advisor.locator("[data-report-withdraw-form] [data-report-withdraw-yes]").click();
      const withdrawn = await until(async () => (await sql("select status from public.payment_reports where id = $1", [second.key]))[0]?.status === "withdrawn", 30, 500);
      check("C7: the advisor withdraws it; it leaves every list", !!withdrawn);
    }

    /* ---------------- D. Accounts record it from Waiting on you ---------------- */
    if ((want("D") || want("E") || want("F")) && reportId) {
      await go(accounts, `${base}/dashboard`);
      await accounts.locator(`[data-waiting-row][data-waiting-job="payrep:${reportId}"] [data-report-record="${reportId}"]`).click();
      const d = dialog(accounts);
      await d.waitFor();
      await until(async () => (await d.locator("[data-report-banner], [data-record-payment-error]").count()) > 0, 40, 300);
      const banner = await text(d.locator(`[data-report-banner="${reportId}"]`));
      check("D1: one tap opens the window on the report (who, when, amount, method, the slip)", banner.includes(`Reported by ${first(ADV.display_name)}`) && banner.includes(aed(car.balance)) && (await d.locator(`[data-report-banner] [data-report-photo="${reportId}"]`).count()) === 1, banner);
      const target = await d.locator('[data-pay-target][aria-pressed="true"]').getAttribute("data-pay-target");
      check("D1: pre-filled: this car's job, Card, the full amount, the slip as the proof", target === `job:${car.jobId}` && (await d.locator('[data-method="card"][aria-pressed="true"]').count()) === 1 && (await d.locator('[data-amount-full][aria-pressed="true"]').count()) === 1 && (await d.locator("[data-proof-missing]").count()) === 0, String(target));
      check("D1: the report's key is the receipt's key (one report, one receipt)", (await d.locator('input[name="report_id"]').inputValue()) === reportId && (await d.locator('input[name="client_key"]').inputValue()) === reportId);
      const auth = code("R");
      await d.locator("[data-auth-code]").fill(auth);
      await until(async () => d.locator(`[data-report-banner] [data-report-photo="${reportId}"] img`).evaluate((img) => img.complete && img.naturalWidth > 0).catch(() => false), 20, 300);
      await d.screenshot({ path: shot("D-prefilled-window.png") });
      await d.locator("[data-record-payment]").click();
      const confirm = await text(accounts.locator("[data-confirm-full] [data-confirm-text]"));
      check("D2: the confirm question says what is recorded", confirm.includes(`Record payment of ${aed(car.balance)}`) && /Card/.test(confirm) && /proof attached ✓/.test(confirm), confirm);
      await accounts.locator("[data-confirm-yes]").click();
      const number = await until(async () => (await d.locator("[data-record-payment-done]").count()) ? await d.locator("[data-record-payment-done]").getAttribute("data-record-payment-done") : null, 50, 500);
      const told = await text(d.locator("[data-report-told]"));
      check("D2: recorded, and the window says the advisor is told", !!number && told === `${first(ADV.display_name)} is told: Recorded ✓ ${number}.`, `${number} ${told}`);
      const pay = (await sql("select id::text as id, client_key, proof_path, auth_code, amount_aed::float8 as a from public.payments where number = $1", [number ?? "-"]))[0];
      const rep = (await sql("select status, payment_id::text as p, proof_path, recorded_by::text as by from public.payment_reports where id = $1", [reportId]))[0];
      check("D3: the receipt: key = the report, the advisor's slip as its proof, the auth code", pay?.client_key === reportId && pay.proof_path === rep?.proof_path && pay.auth_code === auth && pay.a === car.balance, JSON.stringify(pay ?? {}));
      check("D3: the report is recorded with that receipt, by accounts", rep?.status === "recorded" && rep.p === pay?.id && rep.by === ACC.id, JSON.stringify(rep ?? {}));
      const advBell = (await sql("select title, body from public.notifications where type = 'payment_report_recorded' and staff_id = $1 and job_id = $2 order by created_at desc limit 1", [ADV.id, car.jobId]))[0];
      check("D3: the advisor's bell: Recorded ✓ RCT-…", advBell?.title?.startsWith(`Recorded ✓ ${number} · ${car.job_number} · ${aed(car.balance)}`) && advBell.body === `by ${first(ACC.display_name)}`, JSON.stringify(advBell ?? {}));
      // Undo inside the window: the report waits again (the advisor told) and can be recorded again.
      await d.locator("[data-undo-money]").click();
      const back = await until(async () => (await sql("select status, payment_id from public.payment_reports where id = $1", [reportId]))[0]?.status === "waiting", 30, 500);
      // The bell is the last step of the undo: wait for it, not for the first row.
      const undoneBell = (await until(async () => { const n = (await sql("select count(*)::int as n from public.notifications where type = 'payment_report_undone' and staff_id = $1 and job_id = $2", [ADV.id, car.jobId]))[0].n; return n ? n : null; }, 20, 500)) ?? 0;
      const freed = (await sql("select client_key from public.payments where number = $1", [number]))[0]?.client_key;
      check("D4: Undo puts the report back to waiting and tells the advisor; the voided receipt gives up the key", !!back && undoneBell === 1 && freed === `undone:${pay?.id}`, JSON.stringify({ back, undoneBell, freed }));
      await d.locator("[data-record-payment-finish]").click().catch(() => null);
      await go(accounts, `${base}/jobs/${car.jobId}`);
      await accounts.locator(`[data-payment-reported="${reportId}"] [data-report-record="${reportId}"]`).click();
      await dialog(accounts).waitFor();
      await until(async () => (await dialog(accounts).locator("[data-report-banner]").count()) > 0, 40, 300);
      await dialog(accounts).locator("[data-auth-code]").fill(code("S"));
      await pressRecord(dialog(accounts));
      const again = await until(async () => (await dialog(accounts).locator("[data-record-payment-done]").count()) ? await dialog(accounts).locator("[data-record-payment-done]").getAttribute("data-record-payment-done") : null, 50, 500);
      check("D4: recorded again from the job card's line (a new receipt, the same report)", !!again && again !== number && (await sql("select status from public.payment_reports where id = $1", [reportId]))[0]?.status === "recorded");
      await dialog(accounts).locator("[data-record-payment-finish]").click();
      // A second Record on the same report: the window says it is already recorded.
      await go(accounts, `${base}/jobs/${car.jobId}?pay-report=${reportId}`);
      await dialog(accounts).waitFor();
      const closed = await until(async () => (await dialog(accounts).locator("[data-report-closed]").count()) ? await text(dialog(accounts).locator("[data-report-closed]")) : null, 40, 400);
      check("D5: a second Record on the same report: 'Already recorded as RCT-…'", (closed ?? "").includes(`Already recorded as ${again}`), closed ?? "");
      check("D5: and the address lost ?pay-report (a reload never opens it twice)", !accounts.url().includes("pay-report"), accounts.url());
      await dialog(accounts).locator("[data-record-payment-close]").click();
      await go(advisor, `${base}/jobs/${car.jobId}`);
      check("D6: the advisor's job card: green 'Recorded ✓ RCT-…', no amber line", (await advisor.locator(`[data-payment-report-recorded="${again}"]`).count()) === 1 && (await advisor.locator("[data-payment-reported]").count()) === 0);
    }

    /* ---------------- E. Query from the bell's address, the advisor's red line, Send again ---------------- */
    let queriedId = null;
    if (want("E") || want("F")) {
      // D paid the car in full (no button once nothing is owed): a fresh copy of the car for the query.
      if (want("D")) Object.assign(car, await freshCar(300));
      const r = await advisorReports(car, { method: "transfer", reference: "TT-E2E-55", note: "Bank transfer screenshot" });
      await r.d.locator("[data-report-send]").click();
      await until(async () => (await r.d.locator("[data-report-sent]").count()) > 0, 40, 400);
      queriedId = r.key;
      await go(accounts, `${base}/jobs/${car.jobId}?pay-report=${queriedId}`);
      const d = dialog(accounts);
      await d.waitFor();
      await until(async () => (await d.locator(`[data-report-banner="${queriedId}"]`).count()) > 0, 40, 300);
      check("E1: the bell's address opens the window on the report, pre-filled with Bank transfer", (await d.locator('[data-method="transfer"][aria-pressed="true"]').count()) === 1 && (await d.locator("[data-reference]").inputValue()) === "TT-E2E-55");
      await d.locator(`[data-report-query-open="${queriedId}"]`).click();
      const q = accounts.locator("[data-report-query-dialog]");
      await q.waitFor();
      await q.getByRole("button", { name: "Photo unclear", exact: true }).click();
      await q.screenshot({ path: shot("E-query-dialog.png") });
      await q.locator("[data-report-query-send]").click();
      const qd = await until(async () => (await d.locator("[data-report-closed]").count()) ? await text(d.locator("[data-report-closed]")) : null, 30, 400);
      check("E1: Query sends it back: 'Queried – … is told'", (qd ?? "").includes(`Queried – ${first(ADV.display_name)} is told`), qd ?? "");
      const st = (await sql("select status, query_note, queried_by::text as by from public.payment_reports where id = $1", [queriedId]))[0];
      const qBell = (await sql("select title, body from public.notifications where type = 'payment_report_queried' and staff_id = $1 and job_id = $2 order by created_at desc limit 1", [ADV.id, car.jobId]))[0];
      check("E2: the report is queried with the comment; the advisor's bell carries it", st?.status === "queried" && /Photo unclear/.test(st.query_note ?? "") && st.by === ACC.id && (qBell?.body ?? "").startsWith("Photo unclear") && (qBell?.title ?? "").startsWith(`Query on your payment · ${car.job_number}`), JSON.stringify({ st, qBell }));
      await d.locator("[data-record-payment-close]").click();
      await go(advisor, `${base}/jobs/${car.jobId}`);
      const red = await text(advisor.locator(`[data-payment-queried="${queriedId}"]`));
      check("E3: the advisor's job card shows the query in red, with Send again", red.includes(`Query from ${first(ACC.display_name)}: Photo unclear`) && (await advisor.locator(`[data-payment-queried="${queriedId}"] [data-payment-report-open="again"]`).count()) === 1, red);
      await advisor.locator("[data-money-tile]").screenshot({ path: shot("E-advisor-query-line.png") });
      await go(advisor, `${base}/dashboard`);
      check("E3: and a 'Query on your payment' line on his Waiting on you", /Photo unclear/.test(await text(advisor.locator(`[data-waiting-job="payrep:${queriedId}"]`))));
      await go(advisor, `${base}/jobs/${car.jobId}`);
      await advisor.locator(`[data-payment-queried="${queriedId}"] [data-payment-report-open="again"]`).click();
      const again = advisor.locator("[data-payment-report-dialog]");
      await again.waitFor();
      check("E4: Send again keeps the details and carries the first photo", (await again.locator("[data-report-query-shown]").count()) === 1 && (await again.locator("[data-report-photo-carried]").count()) === 1 && (await again.locator("[data-report-reference]").inputValue()) === "TT-E2E-55");
      const newKey = await again.locator('input[name="report_id"]').inputValue();
      await again.locator("[data-report-note]").fill("Clearer screenshot attached by the bank");
      await again.locator("[data-report-send]").click();
      const resent = await until(async () => (await again.locator("[data-report-sent]").count()) > 0, 40, 400);
      await until(async () => (await sql("select status from public.payment_reports where id = $1", [queriedId]))[0]?.status === "withdrawn", 20, 500);
      const rows = await sql("select id::text as id, status, replaces_id::text as r, proof_path from public.payment_reports where id in ($1, $2)", [queriedId, newKey]);
      const neu = rows.find((x) => x.id === newKey);
      const old = rows.find((x) => x.id === queriedId);
      check("E4: the new report replaces the queried one (which is withdrawn) and keeps its photo", !!resent && neu?.status === "waiting" && neu.r === queriedId && old?.status === "withdrawn" && neu.proof_path === old?.proof_path, JSON.stringify(rows));
      queriedId = newKey;
    }

    /* ---------------- F. 3.4 The reminder after 4 working hours ---------------- */
    if (want("F") && queriedId) {
      const cron = async () => (await fetch(`${base}/api/cron/housekeeping`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } })).json();
      // Reported a week ago: well past four working hours.
      await sql("update public.payment_reports set reported_at = now() - interval '7 days', reminded_at = null where id = $1", [queriedId]);
      const r1 = await cron();
      const late = await sql("select staff_id::text as s, title from public.notifications where type = 'payment_report_late' and job_id = $1", [car.jobId]);
      check(`F1: one reminder to each of accounts and the owner (${moneyPeople})`, late.length === moneyPeople && (late[0]?.title ?? "").startsWith("Not recorded after 4 working hours · ") && r1.paymentReportsLate >= 1, `${late.length} ${JSON.stringify(r1).slice(0, 120)}`);
      const r2 = await cron();
      const late2 = (await sql("select count(*)::int as n from public.notifications where type = 'payment_report_late' and job_id = $1", [car.jobId]))[0].n;
      check("F2: never twice (a second run rings nothing)", late2 === moneyPeople && !(r2.paymentReportsLate > 0), `${late2}`);
      await go(accounts, `${base}/dashboard`);
      check("F3: the Waiting line turns red", (await accounts.locator(`[data-waiting-job="payrep:${queriedId}"]`).getAttribute("data-urgency")) === "red");
      await go(accounts, `${base}/jobs/${car.jobId}`);
      check("F3: and the job card line says it was not recorded in time", (await accounts.locator(`[data-payment-reported="${queriedId}"][data-report-late="1"]`).count()) === 1);
    }
    void accountsCount;
  }

  /* ---------------- G. Settings > Money: the reminder hours ---------------- */
  if (want("G")) {
    await go(owner, `${base}/settings#money-limits`);
    const box = owner.locator("[data-report-reminder-hours]");
    check("G: Settings > Money shows 'Remind about a reported payment after 4 working hours'", (await box.count()) === 1 && (await box.inputValue()) === "4", await box.inputValue().catch(() => ""));
  }

  /* ---------------- H. The review fixes of 3 November 2026, on a car whose proforma is sent ---------------- */
  if (want("H")) {
    cleanupDb();
    const seed = (await api("/api/e2e/stage", { stage: "ready" })).json;
    const jobId = seed.jobId;
    const proId = seed.invoice?.id;
    await sql("update public.invoices set sent_at = now(), expected_payment_method = 'card' where id = $1", [proId]);
    await sql("update public.jobs set ready_sent_at = now() where id = $1", [jobId]);
    const hc = { jobId, ...(await sql("select j.job_number, j.customer_id::text as c, coalesce(c.company_name, c.full_name) as customer, v.plate_code, v.plate_number from public.jobs j join public.customers c on c.id = j.customer_id join public.vehicles v on v.id = j.vehicle_id where j.id = $1", [jobId]))[0] };
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

    // H0 (finding 4): the owner in View as accounts, money page, proforma sent and unpaid: the greyed button, never "Waiting for accounts".
    await ownerB.context.request.post(`${base}/api/view-as/set`, { data: { kind: "view", id: ACC.id } });
    await go(owner, `${base}/jobs/${jobId}/invoice`);
    check("H0: money page in View as accounts shows Record payment greyed, not 'Waiting for accounts'", (await owner.locator("[data-what-now] [data-record-payment-readonly]").count()) === 1 && (await owner.locator("[data-waiting-accounts]").count()) === 0);
    await ownerB.context.request.post(`${base}/api/view-as/set`, { data: { kind: "none" } });

    // H1 (findings 1, 6, 12): the money tile's big button opens the advisor's report itself, on its own car only.
    const authR1 = code("H");
    const r1 = await advisorReports(hc, { method: "card", amount: "100.00", auth: authR1, note: "First card payment" });
    await r1.d.locator("[data-report-send]").click();
    await until(async () => (await r1.d.locator("[data-report-sent]").count()) > 0, 40, 400);
    await go(accounts, `${base}/jobs/${jobId}`);
    const main = accounts.locator("[data-money-tile] [data-money-action] [data-record-payment-open]");
    check("H1: with the proforma sent and a report waiting, the tile's main button reads 'Record the reported payment'", (await main.count()) === 1 && /Record the reported payment/.test(await text(main)), await text(main));
    await main.click();
    const d = dialog(accounts);
    await d.waitFor();
    await until(async () => (await d.locator("[data-report-banner], [data-record-payment-error]").count()) > 0, 40, 300);
    check("H1: it opens the window on that report (banner, slip, the auth code pre-filled)", (await d.locator(`[data-report-banner="${r1.key}"]`).count()) === 1 && (await d.locator("[data-auth-code]").inputValue()) === authR1 && (await d.locator("[data-proof-missing]").count()) === 0);
    const targets = await d.locator("[data-pay-target]").evaluateAll((els) => els.map((e) => e.getAttribute("data-pay-target")));
    check("H1 (finding 9): only the report's own car is offered while the report is open", targets.length === 1 && targets[0] === `inv:${proId}`, JSON.stringify(targets));
    check("H1: 'Record a different payment instead' keeps the always-rule", (await d.locator("[data-record-other-payment]").count()) === 1);

    // H2 (finding 7): a different card payment of the same amount (another auth code) never closes the report.
    await d.locator("[data-record-other-payment]").click();
    await until(async () => (await d.locator("[data-report-banner]").count()) === 0 && (await d.locator("[data-pay-targets]").count()) > 0, 40, 300);
    const p1 = await payInWindow(accounts, { method: "card", amount: 100, auth: code("K") });
    const r1After = (await sql("select status from public.payment_reports where id = $1", [r1.key]))[0]?.status;
    check("H2: 'Record a different payment instead' records without the report; the report keeps waiting (its auth code differs)", !!p1 && r1After === "waiting", `${p1} ${r1After}`);
    await d.locator("[data-record-payment-finish]").click();

    // H3 (finding 11): the report recorded, then its receipt voided by the owner: the report waits again, the advisor told.
    // (recordPaymentCore refuses the same amount and method on one invoice within a minute: wait that minute out.)
    await sleep(61000);
    await go(accounts, `${base}/jobs/${jobId}`);
    await accounts.locator(`[data-payment-reported="${r1.key}"] [data-report-record="${r1.key}"]`).click();
    await dialog(accounts).waitFor();
    await until(async () => (await dialog(accounts).locator(`[data-report-banner="${r1.key}"]`).count()) > 0, 40, 300);
    await pressRecord(dialog(accounts));
    const p2 = await until(async () => (await dialog(accounts).locator("[data-record-payment-done]").count()) ? await dialog(accounts).locator("[data-record-payment-done]").getAttribute("data-record-payment-done") : null, 50, 500);
    if (!p2) console.log("   window says:", (await text(dialog(accounts))).slice(-500));
    await dialog(accounts).locator("[data-record-payment-finish]").click().catch(() => null);
    check("H3: the report is recorded by its own receipt", !!p2 && (await sql("select status from public.payment_reports where id = $1", [r1.key]))[0]?.status === "recorded", String(p2));
    await go(owner, `${base}/invoices/${proId}`);
    const row = owner.locator("li").filter({ hasText: String(p2) }).first();
    await row.locator("summary", { hasText: "Void this receipt" }).click();
    await row.locator('[name="reason"]').first().pressSequentially("Recorded against the wrong amount");
    await row.getByRole("button", { name: "Void", exact: true }).click();
    const reopened = await until(async () => (await sql("select status from public.payment_reports where id = $1", [r1.key]))[0]?.status === "waiting", 30, 500);
    const vBell = await until(async () => (await sql("select title from public.notifications where type = 'payment_report_undone' and staff_id = $1 and job_id = $2 order by created_at desc limit 1", [ADV.id, jobId]))[0]?.title ?? null, 20, 500);
    const freedKey = (await sql("select client_key, status from public.payments where number = $1", [p2]))[0];
    check("H3: voiding the receipt puts the report back to waiting, frees its key and tells the advisor 'Receipt voided'", !!reopened && /^Receipt voided · /.test(vBell ?? "") && freedKey?.status === "voided" && String(freedKey?.client_key ?? "").startsWith("voided:"), JSON.stringify({ reopened, vBell, freedKey }));
    await go(advisor, `${base}/jobs/${jobId}`);
    check("H3: the advisor's job card shows it amber again, never a green 'Recorded ✓' on a voided receipt", (await advisor.locator(`[data-payment-reported="${r1.key}"]`).count()) === 1 && (await advisor.locator(`[data-payment-report-recorded="${p2}"]`).count()) === 0);

    // H4 (finding 3): a bank transfer confirmation sent as a PDF shows as a PDF tile that opens, never a broken picture.
    const r2 = await advisorReports(hc, { method: "transfer", amount: "50.00", reference: "TT-H-77", note: "Transfer PDF", file: { name: "transfer.pdf", mimeType: "application/pdf", buffer: pdf } });
    await r2.d.locator("[data-report-send]").click();
    await until(async () => (await r2.d.locator("[data-report-second], [data-report-sent]").count()) > 0, 40, 400);
    if (await r2.d.locator("[data-report-send-anyway]").count()) await r2.d.locator("[data-report-send-anyway]").click();
    await until(async () => (await r2.d.locator("[data-report-sent]").count()) > 0, 40, 400);
    await go(accounts, `${base}/dashboard`);
    const tile = accounts.locator(`[data-waiting-job="payrep:${r2.key}"] [data-report-photo="${r2.key}"]`);
    const tileInfo = (await tile.count()) ? await tile.evaluate((el) => ({ tag: el.tagName, kind: el.getAttribute("data-slip-kind"), href: el.getAttribute("href") ?? "", img: el.querySelectorAll("img").length })) : null;
    check("H4: the Waiting line shows the PDF slip as a PDF tile opening the file (no picture)", tileInfo?.tag === "A" && tileInfo.kind === "pdf" && /\.pdf/.test(tileInfo.href) && tileInfo.img === 0, JSON.stringify(tileInfo));
    await go(accounts, `${base}/jobs/${jobId}`);
    check("H4: and on the job card's line", (await accounts.locator(`[data-payment-reported="${r2.key}"] a[data-slip-kind="pdf"]`).count()) === 1);

    // H5 (finding 8): both queried; the transfer arrives and is recorded another way: the queried report is closed by it.
    const queryOne = async (id, reason) => {
      await go(accounts, `${base}/jobs/${jobId}`);
      await accounts.locator(`[data-payment-reported="${id}"] [data-report-query-open="${id}"]`).click();
      const q = accounts.locator("[data-report-query-dialog]");
      await q.waitFor();
      await q.getByRole("button", { name: reason, exact: true }).click();
      await q.locator("[data-report-query-send]").click();
      await until(async () => (await sql("select status from public.payment_reports where id = $1", [id]))[0]?.status === "queried", 30, 500);
    };
    await queryOne(r1.key, "Amount differs");
    await sleep(5200);
    await queryOne(r2.key, "Not in the bank yet");
    await go(accounts, `${base}/jobs/${jobId}`);
    await accounts.locator("[data-money-tile] [data-money-action] [data-record-payment-open]").click();
    await dialog(accounts).waitFor();
    await until(async () => (await dialog(accounts).locator("[data-pay-targets]").count()) > 0, 40, 300);
    const p3 = await payInWindow(accounts, { method: "transfer", amount: 50, reference: "TT-H-77" });
    await dialog(accounts).locator("[data-record-payment-finish]").click().catch(() => null);
    const closedQ = await until(async () => (await sql("select status, payment_id::text as p from public.payment_reports where id = $1", [r2.key]))[0]?.status === "recorded", 30, 500);
    const qBell = await until(async () => (await sql("select body from public.notifications where type = 'payment_report_recorded' and staff_id = $1 and job_id = $2 order by created_at desc limit 1", [ADV.id, jobId]))[0]?.body ?? null, 20, 500);
    check("H5: the transfer recorded after the query closes the queried report and the advisor hears 'the query is settled'", !!p3 && !!closedQ && /query is settled/.test(qBell ?? ""), `${p3} ${qBell}`);
    check("H5: the card report (another method) stays queried", (await sql("select status from public.payment_reports where id = $1", [r1.key]))[0]?.status === "queried");

    // H6 (finding 8): Send again after money was recorded on the car since the query asks first.
    await go(advisor, `${base}/jobs/${jobId}`);
    check("H6: the closed query left the advisor's job card (no Send again on it)", (await advisor.locator(`[data-payment-queried="${r2.key}"]`).count()) === 0);
    await advisor.locator(`[data-payment-queried="${r1.key}"] [data-payment-report-open="again"]`).click();
    const ag = advisor.locator("[data-payment-report-dialog]");
    await ag.waitFor();
    await ag.locator("[data-report-send]").click();
    const askAgain = await until(async () => (await ag.locator("[data-report-second]").count()) ? await text(ag.locator("[data-report-second]")) : null, 30, 400);
    check("H6: 'RCT-… was recorded on this car after the query … Send it as well?'", (askAgain ?? "").includes(`${p3} · AED 50.00 · Bank transfer was recorded on this car after the query`), askAgain ?? "");
    await ag.locator("[data-payment-report-close]").click();

    // H7 (finding 13): the same window key used for ANOTHER payment (a copied tab) is refused and renewed; nothing is sent.
    await go(advisor, `${base}/jobs/${jobId}`);
    await advisor.locator('[data-money-tile] [data-payment-report-open="new"]').click();
    const k = advisor.locator("[data-payment-report-dialog]");
    await k.waitFor();
    const usedKey = await k.locator('input[name="report_id"]').inputValue();
    await sql("insert into public.payment_reports (id, job_id, customer_id, vehicle_id, amount_aed, method, proof_path, status, reported_by, reported_at, created_by, updated_by) select $1::uuid, j.id, j.customer_id, j.vehicle_id, 999, 'cash', 'e2e/copied-tab.png', 'waiting', $2::uuid, now() - interval '1 minute', $2::uuid, $2::uuid from public.jobs j where j.id = $3::uuid", [usedKey, ADV.id, jobId]);
    await k.locator('[data-report-method="card"]').click();
    await k.locator('[data-job-file-upload] input[type="file"]').first().setInputFiles({ name: "slip.png", mimeType: "image/png", buffer: png });
    await until(async () => (await k.locator("[data-report-photo-missing]").count()) === 0, 60, 500);
    await k.locator("[data-report-send]").click();
    const used = await until(async () => (await k.locator("[data-report-error]").count()) ? await text(k.locator("[data-report-error]")) : null, 30, 400);
    const newKey = await until(async () => { const v = await k.locator('input[name="report_id"]').inputValue(); return v && v !== usedKey ? v : null; }, 20, 300);
    const stray = (await sql("select count(*)::int as n from public.job_files where kind = 'payment_report' and ref_id = $1 and removed_at is null and created_at > now() - interval '50 seconds'", [usedKey]))[0].n;
    const takenOff = (await sql("select count(*)::int as n from public.job_files where kind = 'payment_report' and ref_id = $1 and removed_at is not null", [usedKey]))[0].n;
    const rowK = (await sql("select amount_aed::float8 as a, method from public.payment_reports where id = $1", [usedKey]))[0];
    check("H7: refused in words ('already used to send AED 999.00 · Cash'), a new key, the first report untouched, its stray slip taken off", /already used to send AED 999\.00 · Cash/.test(used ?? "") && !!newKey && rowK?.a === 999 && rowK.method === "cash" && stray === 0 && takenOff === 1, JSON.stringify({ used, newKey: !!newKey, rowK, stray, takenOff }));
    await k.locator("[data-payment-report-close]").click();
    await sql("update public.payment_reports set status = 'withdrawn', withdrawn_reason = 'e2e', withdrawn_at = now() where id = $1", [usedKey]);

    // H8 (finding 5): a car that left still owing: the advisor's button on the job card AND the money page (one rule).
    await sql("update public.jobs set is_open = false where id = $1", [jobId]);
    await go(advisor, `${base}/jobs/${jobId}`);
    const onCard = await advisor.locator('[data-money-tile] [data-payment-report-open="new"]').count();
    await go(advisor, `${base}/jobs/${jobId}/invoice`);
    const onMoney = await advisor.locator('[data-says-paid-section] [data-payment-report-open="new"]').count();
    check("H8: the car left owing: the advisor's button shows on the job card and on the money page alike", onCard === 1 && onMoney === 1, `${onCard} ${onMoney}`);

    // H9 (findings 2, 10): accounts search by the customer's name: the car that left owing shows with its job and balance.
    await go(accounts, `${base}/invoices`);
    await accounts.locator("[data-record-payment-open]").first().click();
    await dialog(accounts).waitFor();
    await dialog(accounts).locator("[data-payer-search-input]").fill(String(hc.customer));
    const byName = dialog(accounts).locator(`[data-payer-hit][data-payer-job="${hc.job_number}"]`);
    const foundByName = await until(async () => (await byName.count()) > 0, 40, 400);
    const carWords = foundByName ? await text(byName.locator("[data-payer-car]")) : "";
    const balWords = foundByName ? await text(byName.locator("[data-payer-balance]")) : "";
    check("H9: found by the customer's name, the gone car shows its plate, job and what it still owes", !!foundByName && carWords.includes(`${hc.plate_code} ${hc.plate_number}`.toUpperCase()) && !/No car on record/.test(carWords) && /^Balance AED [\d,]+\.\d{2} · the car has left$/.test(balWords), `${carWords} | ${balWords}`);
    await dialog(accounts).screenshot({ path: shot("H-search-by-name-gone-owing.png") });
    await dialog(accounts).locator("[data-record-payment-close]").click();
  }
} finally {
  await ownerB.context.request.post(`${base}/api/view-as/set`, { data: { kind: "none" } }).catch(() => null);
  await ownerB.browser.close();
  await accountsB.browser.close();
  await advisorB.browser.close();
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
