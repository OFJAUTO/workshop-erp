// Record a payment any time (1 November 2026, batch "payments anytime", section 1). Standing rule: there must ALWAYS be a
// way to record a payment for any car or customer at any time. This proves it through the screens, for the owner AND
// accounts: a car at every job stage (before the check-in approval, to assign, in inspection, quotation being made,
// approved with no deposit asked - the J-00969 case -, ready with its proforma, after gate-out), a car with no job and a
// customer with no job at all (unallocated advances with a note), the unallocated list with its age, one-step allocation,
// the advances coming off the proforma, the over-payment note, the advisor's payment link for a custom amount, and the
// Pay button on the search results. Advisors never record money.
//   npm run test:payanytime   (test server on :3102, E2E_BASE for another port)
import fs from "node:fs";
import path from "node:path";
import { api, base, browserFor, cleanupDb, cookieHeader, go, here, makeChecks, settle, sleep, sql, pressRecord } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const SHOTS = path.join(here, "shots", "payanytime");
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (name) => path.join(SHOTS, name);
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 25 * 60 * 1000).unref();
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGklEQVR4nGP4z8BAEmIY1TCqYVTDqIbhqgEAOK8f8Rf2cHcAAAAASUVORK5CYII=", "base64");
const code = (p) => `${p}${String(Date.now()).slice(-5)}`.slice(0, 6).toUpperCase();
const NEW_CAR = "22222222-0000-4000-8000-00000000e901";
const NEW_CUST = "22222222-0000-4000-8000-00000000e902";
const pdfText = async (buf) => {
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  let out = "";
  for (let i = 0; i < doc.countPages(); i++) out += doc.loadPage(i).toStructuredText("preserve-whitespace").asText();
  return out.replace(/\s+/g, " ").toUpperCase();
};
const dialog = (page) => page.locator("[data-record-payment-dialog]");
const text = async (loc) => ((await loc.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ");

async function openFrom(page, url) {
  await go(page, url);
  const btn = page.locator("[data-record-payment-open]").first();
  if (!(await btn.count())) return false;
  await btn.click();
  await dialog(page).waitFor({ timeout: 15000 });
  await until(async () => (await dialog(page).locator("[data-pay-targets], [data-record-payment-error]").count()) > 0, 40, 300);
  return true;
}

/** In the open window: method, amount (partial), optional auth code / proof / note, Record; returns the receipt number. */
async function pay(page, { method = "cash", amount, auth = null, proof = false, note = null, over = null, target = null }) {
  const d = dialog(page);
  if (target) await d.locator(`[data-pay-target="${target}"]`).click();
  if (note) await d.locator("[data-pay-for]").fill(note);
  await d.locator(`[data-method="${method}"]`).click();
  if (await d.locator("[data-amount-partial]").count()) await d.locator("[data-amount-partial]").click();
  await d.locator("[data-amount-input]").fill("");
  await d.locator("[data-amount-input]").pressSequentially(String(amount));
  if (auth) await d.locator("[data-auth-code]").fill(auth);
  if (method === "cheque") {
    await d.locator("[data-cheque-number]").fill("554433");
    await d.locator("[data-cheque-bank]").fill("Emirates NBD");
    await d.locator("[data-cheque-date]").fill("2026-11-05");
  }
  if (proof) {
    const queued = d.locator('[data-job-file-upload] input[type="file"]');
    if (await queued.count()) {
      await queued.first().setInputFiles({ name: `${method}-proof.png`, mimeType: "image/png", buffer: png });
      await until(async () => (await d.locator("[data-proof-missing]").count()) === 0, 60, 500);
    } else await d.locator("[data-proof-input]").setInputFiles({ name: `${method}-proof.png`, mimeType: "image/png", buffer: png });
  }
  if (over) await d.locator("[data-over-note]").fill(over);
  await pressRecord(d);
  const done = await until(async () => (await d.locator("[data-record-payment-done]").count()) ? await d.locator("[data-record-payment-done]").getAttribute("data-record-payment-done") : null, 50, 500);
  if (!done) console.log("   window says:", (await text(d)).slice(-400));
  return done;
}

const owner = await browserFor("owner", { viewport: { width: 1366, height: 950 } });
const accounts = await browserFor("accounts", { viewport: { width: 1366, height: 950 } });
const advisor = await browserFor("service_advisor", { viewport: { width: 1366, height: 950 } });
const who = { owner: owner.page, accounts: accounts.page };

try {
  /* ---------------- A. Every job stage, owner and accounts ---------------- */
  const STAGES = [
    { name: "before the check-in approval", seed: "assign", after: "update public.jobs set status = 'pending_approval', stage = 'gate_in' where id = $1" },
    { name: "to assign", seed: "assign" },
    { name: "in inspection", seed: "inspection" },
    { name: "quotation being made", seed: "quote" },
    { name: "approved, no deposit asked (J-00969)", seed: "approved" },
    { name: "ready, proforma out", seed: "ready" },
    { name: "after gate-out", seed: "ready", after: "update public.jobs set is_open = false, status = 'closed' where id = $1" },
  ];
  // ONLY=B..H skips the stage round (it takes about four minutes).
  for (const st of process.env.ONLY ? [] : STAGES) {
    cleanupDb();
    const seed = (await api("/api/e2e/stage", { stage: st.seed })).json;
    const jobId = seed?.jobId;
    if (!jobId) { check(`A ${st.name}: seed`, false, JSON.stringify(seed).slice(0, 200)); continue; }
    if (st.after) await sql(st.after, [jobId]);
    const state = (await sql("select status, is_open from public.jobs where id = $1", [jobId]))[0];
    for (const role of ["owner", "accounts"]) {
      const page = who[role];
      const opened = await openFrom(page, `${base}/jobs/${jobId}`);
      check(`A ${st.name} (${state?.status}${state?.is_open ? "" : ", gone"}): ${role} has Record payment on the job card`, opened);
      if (!opened) continue;
      const suggested = await dialog(page).locator('[data-pay-target][aria-pressed="true"]').getAttribute("data-pay-target").catch(() => null);
      check(`A ${st.name}: ${role} – the window suggests this job`, !!suggested && suggested !== "credit", String(suggested));
      const number = await pay(page, { method: "cash", amount: role === "owner" ? 100 : 50 });
      const row = (await sql("select number, job_id::text as j, method, amount_aed::float8 as a, received_by::text as by from public.payments where number = $1", [number ?? "-"]))[0];
      check(`A ${st.name}: ${role} recorded ${row?.number ?? "nothing"} on the job`, !!row && row.j === jobId && row.method === "cash" && row.a === (role === "owner" ? 100 : 50), JSON.stringify(row ?? {}));
      if (st.seed === "assign" && st.after && role === "owner") await dialog(page).screenshot({ path: shot("A-before-approval-done.png") });
      if (st.after?.includes("is_open = false") && role === "accounts") await dialog(page).screenshot({ path: shot("A-after-gate-out-done.png") });
      await dialog(page).locator("[data-record-payment-finish]").click();
    }
  }

  /* ---------------- B. The J-00969 case: card with auth code as the owner, link as accounts, then the proforma ---------------- */
  cleanupDb();
  const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const jobId = seed.jobId;
  const cust = (await sql("select customer_id::text as c, vehicle_id::text as v from public.jobs where id = $1", [jobId]))[0];
  const deposit = (await sql("select count(*)::int as n from public.quotations where job_id = $1 and coalesce(deposit_aed, 0) > 0", [jobId]))[0].n;
  check("B: the copy of J-00969 has no deposit asked", deposit === 0);
  await openFrom(owner.page, `${base}/jobs/${jobId}`);
  await owner.page.screenshot({ path: shot("B-owner-window.png") });
  const cardNo = await pay(owner.page, { method: "card", amount: 400, auth: code("C"), proof: true });
  const card = (await sql("select number, method, auth_code, proof_path, job_id::text as j, invoice_id from public.payments where number = $1", [cardNo ?? "-"]))[0];
  check("B: owner – card payment with auth code and the slip, as an advance on the job", !!card && card.method === "card" && /^[A-Z0-9]{6}$/.test(card.auth_code ?? "") && !!card.proof_path && card.j === jobId && !card.invoice_id, JSON.stringify(card ?? {}));
  await dialog(owner.page).screenshot({ path: shot("B-owner-card-done.png") });
  const receiptHref = await dialog(owner.page).locator("[data-receipt-link]").getAttribute("href");
  const rec = await fetch(`${base}${receiptHref}`, { headers: { cookie: await cookieHeader("owner") } });
  const recText = rec.status === 200 ? await pdfText(Buffer.from(await rec.arrayBuffer())) : "";
  check("B: the receipt opens and names the payment", rec.status === 200 && recText.includes(String(cardNo)), `${rec.status}`);
  const shortReceipt = await dialog(owner.page).locator("[data-send-receipt]").count();
  check("B: Send the receipt is offered in the window", shortReceipt === 1);
  await dialog(owner.page).locator("[data-record-payment-finish]").click();
  await openFrom(accounts.page, `${base}/jobs/${jobId}`);
  const linkNo = await pay(accounts.page, { method: "link", amount: 200, auth: code("L") });
  check("B: accounts – payment-link payment with auth code", !!linkNo);
  await dialog(accounts.page).locator("[data-record-payment-finish]").click();
  await go(accounts.page, `${base}/jobs/${jobId}`);
  const tile = await text(accounts.page.locator("[data-paid-so-far]"));
  const total = (await sql("select total_aed::float8 as t from public.quotations where job_id = $1 and status = 'approved' order by version desc limit 1", [jobId]))[0]?.t ?? 0;
  const left = Math.round((total - 600) * 100) / 100;
  check("B: the job card says Paid so far AED 600.00 · Balance", /Paid so far AED 600.00/.test(tile) && tile.includes(`Balance AED ${left.toLocaleString("en-GB", { minimumFractionDigits: 2 })}`), tile);
  await accounts.page.locator("[data-money-tile]").screenshot({ path: shot("B-job-card-paid-so-far.png") });

  /* ---------------- C. A car with no job: an unallocated advance with its note ---------------- */
  const make = (await sql("select make_id::text as m from public.vehicles where id = $1", [cust.v]))[0].m;
  await sql("insert into public.vehicles (id, customer_id, plate_country, plate_emirate, plate_code, plate_number, has_plate, make_id, model_year) values ($1, $2, 'UAE', 'Dubai', 'P', '90901', true, $3, 2019)", [NEW_CAR, cust.c, make]);
  const carOpened = await openFrom(accounts.page, `${base}/vehicles/${NEW_CAR}`);
  check("C: a car with no job has Record payment on its page", carOpened);
  const credNo = await pay(accounts.page, { target: "credit", method: "cash", amount: 150, note: "Advance for the PPF booked next week" });
  const cred = (await sql("select number, job_id, invoice_id, vehicle_id::text as v, notes from public.payments where number = $1", [credNo ?? "-"]))[0];
  check("C: saved on the customer's account, for that car, with the note", !!cred && !cred.job_id && !cred.invoice_id && cred.v === NEW_CAR && /PPF booked next week/.test(cred.notes ?? ""), JSON.stringify(cred ?? {}));
  await dialog(accounts.page).screenshot({ path: shot("C-car-no-job-done.png") });
  await dialog(accounts.page).locator("[data-record-payment-finish]").click();
  await go(accounts.page, `${base}/vehicles/${NEW_CAR}`);
  check("C: the car page lists it as not allocated", (await accounts.page.locator(`[data-car-credit] [data-unallocated-row="${credNo}"]`).count()) === 1);
  await go(accounts.page, `${base}/invoices`);
  const listRow = accounts.page.locator(`[data-unallocated-section] [data-unallocated-row="${credNo}"]`);
  check("C: Invoices and payments lists it with its age", (await listRow.count()) === 1 && /unallocated today/.test(await text(listRow)), await text(listRow));
  await accounts.page.locator("[data-unallocated-section]").screenshot({ path: shot("C-unallocated-list.png") });
  await go(accounts.page, `${base}/dashboard`);
  check("C: accounts' Waiting on you says it is not allocated", (await accounts.page.locator("[data-waiting-row]", { hasText: `${credNo} not allocated` }).count()) >= 1);
  const panelCredit = await (await fetch(`${base}/api/customer-panel?customer=${cust.c}`, { headers: { cookie: await cookieHeader("accounts") } })).json();
  check("C: the customer panel shows Credit AED 150.00 (not allocated)", panelCredit.credit === 150, JSON.stringify({ credit: panelCredit.credit }));

  /* ---------------- D. A customer with no job and no car at all (owner; transfer with its proof) ---------------- */
  await sql("insert into public.customers (id, customer_type, full_name, phone) values ($1, 'individual', 'E2E NO JOB PAYER', '+971500000099')", [NEW_CUST]);
  const custOpened = await openFrom(owner.page, `${base}/customers/${NEW_CUST}`);
  const onlyCredit = (await dialog(owner.page).locator("[data-pay-target]").count()) === 1 && (await dialog(owner.page).locator('[data-pay-target="credit"]').count()) === 1;
  check("D: a customer with no job has Record payment; the only place is the customer's account", custOpened && onlyCredit);
  const noJobNo = await pay(owner.page, { method: "transfer", amount: 300, proof: true, note: "Deposit to hold a booking" });
  const noJob = (await sql("select number, job_id, customer_id::text as c, proof_path, notes from public.payments where number = $1", [noJobNo ?? "-"]))[0];
  check("D: recorded with the transfer proof, no job", !!noJob && !noJob.job_id && noJob.c === NEW_CUST && !!noJob.proof_path, JSON.stringify(noJob ?? {}));
  const noJobRec = await dialog(owner.page).locator("[data-receipt-link]").getAttribute("href");
  const anon = await fetch(`${base}${noJobRec}`);
  check("D: the customer's receipt link works without a login (its own token)", anon.status === 200 && /\?p=/.test(noJobRec ?? ""), `${anon.status} ${noJobRec}`);
  await dialog(owner.page).locator("[data-record-payment-finish]").click();

  /* ---------------- E. Allocating the car's advance to the job, then the proforma takes every advance ---------------- */
  await go(accounts.page, `${base}/invoices`);
  await accounts.page.locator(`[data-allocate-open="${credNo}"]`).click();
  await accounts.page.locator("[data-allocate-dialog]").waitFor();
  await until(async () => (await accounts.page.locator("[data-allocate-target]").count()) > 0, 30, 300);
  await accounts.page.locator(`[data-allocate-target="job:${jobId}"]`).click();
  await accounts.page.locator("[data-allocate-dialog]").screenshot({ path: shot("E-allocate-window.png") });
  await accounts.page.locator("[data-allocate-confirm]").click();
  const allocated = await until(async () => (await sql("select job_id::text as j, allocated_by from public.payments where number = $1", [credNo]))[0]?.j === jobId, 30, 500);
  check("E: one step allocates it to the job (who and when kept)", !!allocated && !!(await sql("select allocated_by from public.payments where number = $1", [credNo]))[0]?.allocated_by);
  await sql("update public.jobs set status = 'ready', stage = 'ready' where id = $1", [jobId]);
  await go(owner.page, `${base}/jobs/${jobId}/invoice`);
  await owner.page.getByRole("button", { name: "Prepare the proforma" }).click();
  await owner.page.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 30000 }).catch(() => null);
  await settle(owner.page);
  const pro = (await sql("select id, number, token, total_aed::float8 as t from public.invoices where job_id = $1 and kind = 'proforma' and status = 'issued' order by issued_at desc limit 1", [jobId]))[0];
  const onPro = (await sql("select number from public.payments where invoice_id = $1 and status = 'recorded' order by number", [pro?.id ?? "00000000-0000-0000-0000-000000000000"])).map((r) => r.number);
  check("E: the proforma takes every advance (card, link and the allocated one)", !!pro && [cardNo, linkNo, credNo].every((n) => onPro.includes(n)), JSON.stringify(onPro));
  const proPdf = pro?.token ? await pdfText(Buffer.from(await (await fetch(`${base}/api/pdf/invoice/${pro.token}`)).arrayBuffer())) : "";
  const due = Math.round(((pro?.t ?? 0) - 750) * 100) / 100;
  check("E: the proforma PDF lists the receipts and the balance due", [cardNo, linkNo, credNo].every((n) => proPdf.includes(String(n))) && proPdf.includes("BALANCE DUE") && proPdf.includes(due.toLocaleString("en-GB", { minimumFractionDigits: 2 })), proPdf.slice(proPdf.indexOf("PAID"), proPdf.indexOf("PAID") + 260));
  await go(owner.page, `${base}/jobs/${jobId}/invoice`);
  await owner.page.locator("[data-money-summary]").screenshot({ path: shot("E-money-page-after-proforma.png") });

  /* ---------------- F. More than what is left: a warning, a note, logged, the owner told ---------------- */
  cleanupDb();
  const seedF = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const totalF = (await sql("select total_aed::float8 as t from public.quotations where job_id = $1 and status = 'approved' order by version desc limit 1", [seedF.jobId]))[0]?.t ?? 0;
  await openFrom(accounts.page, `${base}/jobs/${seedF.jobId}`);
  const d = dialog(accounts.page);
  await d.locator('[data-method="cash"]').click();
  await d.locator("[data-amount-partial]").click();
  await d.locator("[data-amount-input]").pressSequentially(String(totalF + 500));
  check("F: paying more than the approved total shows the warning", !!(await until(async () => (await d.locator("[data-over-warning]").count()) === 1, 20, 250)), await text(d.locator("[data-over-warning]")));
  await d.locator("[data-over-warning]").screenshot({ path: shot("F-over-warning.png") });
  await pressRecord(d);
  await sleep(1500);
  check("F: without a note nothing is recorded", (await sql("select count(*)::int as n from public.payments where job_id = $1", [seedF.jobId]))[0].n === 0);
  await d.locator("[data-over-note]").fill("Customer paid extra, refund AED 500 by transfer");
  await pressRecord(d);
  const overNo = await until(async () => (await d.locator("[data-record-payment-done]").count()) ? await d.locator("[data-record-payment-done]").getAttribute("data-record-payment-done") : null, 40, 500);
  const ev = (await sql("select note from public.job_events where job_id = $1 and note like '%above the balance%' limit 1", [seedF.jobId]))[0];
  const told = (await sql("select count(*)::int as n from public.notifications where job_id = $1 and title like 'Payment above the balance recorded%'", [seedF.jobId]))[0].n;
  check("F: with the note it is recorded, logged on the job and the owner is told", !!overNo && !!ev && /refund AED 500/.test(ev.note) && told >= 1, JSON.stringify({ overNo, ev, told }));
  await d.locator("[data-record-payment-finish]").click();

  /* ---------------- G. The advisor: no Record payment, but a payment link for a custom amount ---------------- */
  cleanupDb();
  const seedG = (await api("/api/e2e/stage", { stage: "approved" })).json;
  await go(advisor.page, `${base}/jobs/${seedG.jobId}`);
  check("G: the advisor sees no Record payment", (await advisor.page.locator("[data-record-payment-open]").count()) === 0);
  await advisor.page.locator("[data-send-payment-link]").click();
  await advisor.page.locator("[data-link-custom]").click();
  await advisor.page.locator("[data-link-amount]").fill("1234");
  await advisor.page.locator("[data-link-make]").click();
  const msg = await until(async () => (await advisor.page.locator("[data-send-message]").count()) ? await advisor.page.locator("[data-send-message]").inputValue() : null, 30, 400);
  check("G: the message asks for AED 1,234.00 with our payment page link", !!msg && /AED 1,234\.00/.test(msg) && /https:\/\/\S+/.test(msg), (msg ?? "").slice(0, 220));
  await advisor.page.locator("[role=dialog]").last().screenshot({ path: shot("G-advisor-payment-link.png") });
  await advisor.page.getByRole("button", { name: /Copy message and link/ }).click();
  const req = (await sql("select amount_aed::float8 as a from public.payment_requests where job_id = $1 and kind = 'advance' and is_active", [seedG.jobId]))[0];
  const logged = await until(async () => (await sql("select count(*)::int as n from public.job_events where job_id = $1 and note like 'Payment link for AED 1,234.00 sent by%'", [seedG.jobId]))[0].n >= 1, 20, 500);
  check("G: the payment page is for AED 1,234.00 and the send is logged", req?.a === 1234 && !!logged, JSON.stringify({ req, logged }));
  // The short link points at the live address: follow it by hand on the TEST server only (tests never reach live).
  const toTest = (u) => (u ?? "").replace(/^https:\/\/erp\.ofjauto\.com/, base);
  const hop = await fetch(toTest(msg?.match(/https:\/\/\S+/)?.[0]) || `${base}/x`, { redirect: "manual" });
  // A short link answers with its preview page (200) for WhatsApp; the payment page itself is /p/<token>.
  const tok = (await sql("select token from public.payment_requests where job_id = $1 and kind = 'advance' and is_active", [seedG.jobId]))[0]?.token;
  const pPage = await fetch(`${base}/p/${tok}`, { redirect: "manual" });
  const pHtml = (await pPage.text()).replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  check("G: the short link answers, and the payment page shows the amount", hop.status < 500 && pPage.status === 200 && /1,234\.00/.test(pHtml), `${hop.status} ${pPage.status} ${pHtml.slice(pHtml.indexOf("AED"), pHtml.indexOf("AED") + 60)}`);

  /* ---------------- H. Search results: Pay on a car ---------------- */
  await go(owner.page, `${base}/dashboard`);
  await owner.page.locator("[data-search-input]:visible").first().fill("30303");
  const payHit = await until(async () => (await owner.page.locator("[data-search-pay]").count()) > 0, 30, 400);
  check("H: search results carry Pay for the owner", !!payHit);
  if (payHit) {
    await owner.page.locator("[data-search-pay]").first().click();
    const ok = await until(async () => (await dialog(owner.page).locator('[data-pay-target][aria-pressed="true"]').count()) === 1, 30, 400);
    check("H: Pay opens the Record payment window on that car's job", !!ok);
    await owner.page.screenshot({ path: shot("H-search-pay-window.png") });
  }
} finally {
  await owner.browser.close();
  await accounts.browser.close();
  await advisor.browser.close();
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
