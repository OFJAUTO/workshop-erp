// Section 5 of 2 November 2026 (built 3 November): the auth code is OPTIONAL, made-up codes are flagged, and the bank's
// settlement report fills a missing code in. RCT-00040 (J-00969, AED 30,000 by payment link) was saved with "111111"
// because the box refused an empty code. On the TEST database with test payments only (never a real code):
//   D. the advisor's hand-over window: the hint; "123456" is kept as NO code and never fills accounts' box;
//   A. the Record payment window: "Auth code (optional)" + "Optional – helps match the bank report"; a link payment with no
//      code is SAVED, the question says "auth code missing (flagged)", the job's history says so;
//   B. "111111" is saved as missing (the amber note beside the box, the question, the history); five characters refused;
//   C. the amber flag on the money page (owner/accounts "Add auth code", advisors see it only), the receipt PDF prints no
//      code, the "Auth code missing" chip on Invoices and payments (its count = its list); Add auth code: made up refused,
//      a duplicate refused, a real one saved (change log + job history), the flag gone;
//   E. a bank report whose line carries a new code, the same amount and day as a missing-code payment: "Suggested match",
//      one tap Confirm saves the bank's code (logged with the file and line), Matched ✓, Record; the same report again:
//      "Already settled in STL-…", Record says nothing new;
//   G. (review) a line two missing-code payments fit, one settled by hand: the settled one is offered as "already settled",
//      picked it fills the bank's code on it and counts as handled; the mixed report's recorded view keeps "already
//      settled" (never "Not ours"), also after a reload;
//   H. (review) an Excel report with REAL date cells (printed "10/24/26") reviews without a crash, on the right day, and one
//      missing-code payment that fits two lines is suggested for neither;
//   I. (review) money not allocated carries the flag; Add auth code there shows the code in the same place, and on the
//      Invoices "Auth code missing" list (where the save takes the row away) the answer opens the centre window;
//   F. a code stored by the old rule ("111111" in the column, like RCT-00040) is flagged by the rule itself on the invoice
//      page, never printed on the receipt, and Add auth code replaces it.
//   npm run test:s5-authcode     (TEST server: E2E_BASE=http://localhost:3101 for the dev server)
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { api, base, browserFor, cleanupDb, cookieHeader, go, here, makeChecks, pressRecord, pressYes, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const SHOTS = path.join(here, "shots", "s5-authcode");
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (name) => path.join(SHOTS, name);
const FIX = path.join(here, "..", "fixtures");
const TMP = path.join(SHOTS, "tmp");
fs.mkdirSync(TMP, { recursive: true });
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 25 * 60 * 1000).unref();
const ONLY = (process.env.ONLY ?? "").split(",").filter(Boolean);
const want = (s) => !ONLY.length || ONLY.includes(s);
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGklEQVR4nGP4z8BAEmIY1TCqYVTDqIbhqgEAOK8f8Rf2cHcAAAAASUVORK5CYII=", "base64");
const text = async (loc) => ((await loc.first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
const dialog = (page) => page.locator("[data-record-payment-dialog]");
const HINT = "Optional – helps match the bank report";
// A fresh test code: "S5" + four letters or digits (never a real payment's code, never a made-up pattern).
const fresh = (p = "S5") => (p + crypto.randomUUID().replace(/-/g, "").toUpperCase()).slice(0, 6);
const mupdf = await import("mupdf");
const pdfText = (buf) => {
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  let t = "";
  for (let i = 0; i < doc.countPages(); i++) t += doc.loadPage(i).toStructuredText("preserve-whitespace").asText() + "\n";
  return t.replace(/\s+/g, " ");
};
const storedFiles = new Set();

const accountsB = await browserFor("accounts", { viewport: { width: 1440, height: 950 } });
const advisorB = await browserFor("service_advisor", { viewport: { width: 800, height: 1280 } });
const accounts = accountsB.page;
const advisor = advisorB.page;
const staffOf = async (role) => (await sql("select id::text as id, display_name from public.staff where role_id = $1 and is_active order by display_name limit 1", [role]))[0];
const OWNER = await staffOf("owner");

/** Opens the Record payment window from the job card's money tile and fills method + a part amount (+ code, proof). */
async function openWindow(jobId, { method, amount, auth = null, proof = false }) {
  await go(accounts, `${base}/jobs/${jobId}`);
  await accounts.locator("[data-money-tile] [data-record-payment-open]").first().click();
  const d = dialog(accounts);
  await d.waitFor();
  await until(async () => (await d.locator("[data-pay-targets], [data-record-payment-error]").count()) > 0, 40, 300);
  await d.locator(`[data-method="${method}"]`).click();
  if (await d.locator("[data-amount-partial]").count()) await d.locator("[data-amount-partial]").click();
  await d.locator("[data-amount-input]").fill("");
  await d.locator("[data-amount-input]").pressSequentially(String(amount));
  if (auth !== null) await d.locator("[data-auth-code]").fill(auth);
  if (proof) {
    await d.locator('[data-payment-form] [data-job-file-upload] input[type="file"]').first().setInputFiles({ name: `${method}-proof.png`, mimeType: "image/png", buffer: png });
    await until(async () => (await d.locator("[data-proof-missing]").count()) === 0, 60, 500);
  }
  return d;
}
const doneNumber = (d) => until(async () => (await d.locator("[data-record-payment-done]").count()) ? await d.locator("[data-record-payment-done]").getAttribute("data-record-payment-done") : null, 50, 500);
const payOf = async (number) => (await sql("select id::text as id, auth_code, method, amount_aed::float8 as a, job_id::text as job from public.payments where number = $1", [number ?? "-"]))[0];
const receiptText = async (id) => {
  const res = await fetch(`${base}/api/pdf/receipt/${id}`, { headers: { cookie: await cookieHeader("accounts") } });
  return res.status === 200 ? pdfText(Buffer.from(await res.arrayBuffer())) : `HTTP ${res.status}`;
};
const upload = async (file) => {
  await go(accounts, `${base}/card-settlements`);
  await accounts.locator("[data-report-file]").setInputFiles(file);
  await accounts.locator("[data-report-upload-button]").click();
  await accounts.waitForURL(/report=/, { timeout: 30000 }).catch(() => null);
  await accounts.waitForSelector("[data-report-review]", { timeout: 30000 }).catch(() => null);
};

try {
  cleanupDb();
  const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const jobId = seed.jobId;
  const job = (await sql("select job_number, customer_id::text as c from public.jobs where id = $1", [jobId]))[0];

  /* ---------------- D. The advisor's hand-over window: the hint, and a made-up code kept as NO code ---------------- */
  if (want("D")) {
    await go(advisor, `${base}/jobs/${jobId}`);
    await advisor.locator('[data-money-tile] [data-payment-report-open="new"]').click();
    const d = advisor.locator("[data-payment-report-dialog]");
    await d.waitFor();
    await d.locator('[data-report-method="link"]').click();
    check("D1: the advisor's box reads 'Auth code (optional)' with the hint 'Optional – helps match the bank report'", /Auth code \(optional\)/.test(await text(d)) && (await text(d.locator("[data-auth-optional-hint]"))) === HINT && (await d.locator("[data-auth-code]").getAttribute("required")) === null);
    await d.locator("[data-auth-code]").fill("123456");
    const note = await text(d.locator("[data-auth-code-note]"));
    check("D2: '123456' is named in amber: not a real code, saved as 'Auth code missing'", /123456 is not a real code: the payment is saved as "Auth code missing"/.test(note), note);
    await d.locator("[data-report-note]").fill("E2E S5 paid by link");
    await d.locator('[data-job-file-upload] input[type="file"]').first().setInputFiles({ name: "slip.png", mimeType: "image/png", buffer: png });
    await until(async () => (await d.locator("[data-report-photo-missing]").count()) === 0, 60, 500);
    await d.screenshot({ path: shot("D-advisor-made-up-code.png") });
    const reportId = await d.locator('input[name="report_id"]').inputValue();
    await d.locator("[data-report-send]").click();
    const sent = await until(async () => (await d.locator("[data-report-sent]").count()) > 0, 40, 400);
    const rep = (await sql("select status, method, auth_code from public.payment_reports where id = $1", [reportId]))[0];
    check("D3: the report is sent and its made-up code is stored as NO code", !!sent && rep?.status === "waiting" && rep.method === "link" && rep.auth_code === null, JSON.stringify(rep ?? {}));
    // Accounts open the window on it: the box is empty (a made-up code never fills it).
    await go(accounts, `${base}/jobs/${jobId}?pay-report=${reportId}`);
    const w = dialog(accounts);
    await w.waitFor({ timeout: 20000 }).catch(() => null);
    await until(async () => (await w.locator("[data-report-banner], [data-record-payment-error]").count()) > 0, 40, 300);
    check("D4: accounts' window on the report: Payment link chosen, the auth code box EMPTY", (await w.locator('[data-method="link"][aria-pressed="true"]').count()) === 1 && (await w.locator("[data-auth-code]").inputValue()) === "");
    await w.locator("[data-record-payment-close]").first().click().catch(() => null);
    // Out of the way of the next sections (the job card's button would open on it).
    await sql("update public.payment_reports set status = 'withdrawn' where id = $1", [reportId]);
  }

  /* ---------------- A. The Record payment window: optional, the hint, saved without a code ---------------- */
  let nA = null;
  let nB = null;
  if (want("A") || want("B") || want("C")) {
    const d = await openWindow(jobId, { method: "link", amount: 150 });
    const box = d.locator("label:has([data-auth-code])");
    check("A1: the box reads 'Auth code (optional)' with the hint, and is not required", /Auth code \(optional\)/.test(await text(box)) && (await text(d.locator("[data-auth-optional-hint]"))) === HINT && (await d.locator("[data-auth-code]").getAttribute("required")) === null, await text(box));
    await d.locator("[data-payment-form]").screenshot({ path: shot("A1-auth-box-hint.png") });
    await d.locator("[data-record-payment]").first().click();
    const q = accounts.locator("[data-confirm-full]");
    await q.waitFor({ timeout: 10000 });
    const words = await text(q.locator("[data-confirm-text]"));
    check("A2: the question says 'auth code missing (flagged)'", /Record payment of AED 150\.00 · as an advance on the job · Payment link · auth code missing \(flagged\)/.test(words), words);
    await q.locator("[data-confirm-yes]").click();
    nA = await doneNumber(d);
    const pA = await payOf(nA);
    check("A3: a payment-link payment with NO code is saved (before: refused, so '111111' was typed)", !!nA && pA?.auth_code === null && pA.method === "link" && pA.a === 150, JSON.stringify(pA ?? {}));
    const evA = (await sql("select note from public.job_events where job_id = $1 and note like $2", [jobId, `${nA}:%`]))[0]?.note ?? "";
    check("A4: the job's history says 'auth code missing'", /auth code missing$/.test(evA), evA);
  }

  /* ---------------- B. "111111" saved as missing; five characters refused ---------------- */
  if (want("B") || want("C")) {
    const d = await openWindow(jobId, { method: "card", amount: 160, auth: "111111", proof: true });
    const note = await text(d.locator("[data-auth-code-note]"));
    check("B1: '111111' is named in amber beside the box (saved as missing, not refused)", /111111 is not a real code/.test(note), note);
    await d.locator("label:has([data-auth-code])").screenshot({ path: shot("B1-made-up-note.png") });
    await d.locator("[data-record-payment]").first().click();
    const q = accounts.locator("[data-confirm-full]");
    await q.waitFor({ timeout: 10000 });
    const words = await text(q.locator("[data-confirm-text]"));
    check("B2: the question says 'auth code missing (flagged)', never 'auth 111111'", /Card · auth code missing \(flagged\) · proof attached ✓/.test(words) && !/111111/.test(words), words);
    await q.locator("[data-confirm-yes]").click();
    nB = await doneNumber(d);
    const pB = await payOf(nB);
    check("B3: saved with NO code in the column (the made-up one is never stored)", !!nB && pB?.auth_code === null && pB.method === "card", JSON.stringify(pB ?? {}));
    const evB = (await sql("select note from public.job_events where job_id = $1 and note like $2", [jobId, `${nB}:%`]))[0]?.note ?? "";
    check("B4: the history keeps what was typed: 'auth code missing (111111 typed, not a real code)'", /auth code missing \(111111 typed, not a real code\)/.test(evB), evB);
    // Five characters: the browser stops the form at the box, nothing is asked or saved.
    const d5 = await openWindow(jobId, { method: "link", amount: 170, auth: "21976" });
    await d5.locator("[data-record-payment]").first().click();
    await sleep(1500);
    const asked = await accounts.locator("[data-confirm-full]").count();
    const saved = (await sql("select count(*)::int as n from public.payments where job_id = $1 and amount_aed = 170", [jobId]))[0].n;
    check("B5: five characters are still refused (no question, nothing saved)", asked === 0 && saved === 0, `asked ${asked}, saved ${saved}`);
  }

  /* ---------------- C. The flag, the receipt, the Invoices chip and Add auth code ---------------- */
  if (want("C") && nA && nB) {
    await go(accounts, `${base}/jobs/${jobId}/invoice`);
    check("C1: the money page flags both payments in amber, with 'Add auth code' for accounts", (await accounts.locator(`[data-auth-missing="${nA}"]`).count()) === 1 && (await accounts.locator(`[data-auth-missing="${nB}"]`).count()) === 1 && (await accounts.locator(`[data-auth-add="${nA}"]`).count()) === 1 && /Auth code missing/.test(await text(accounts.locator(`[data-auth-missing="${nA}"]`))));
    await accounts.locator("[data-payments-card]").screenshot({ path: shot("C1-money-page-flag.png") });
    await go(advisor, `${base}/jobs/${jobId}/invoice`);
    check("C2: an advisor sees the flag but cannot add the code", (await advisor.locator(`[data-auth-missing="${nA}"]`).count()) === 1 && (await advisor.locator("[data-auth-add]").count()) === 0);
    const pA = await payOf(nA);
    const pB = await payOf(nB);
    const rA = await receiptText(pA.id);
    const rB = await receiptText(pB.id);
    check("C3: the receipts print no auth code row (nothing missing or made up ever reaches the customer)", /Receipt/i.test(rA) && !/Auth code/i.test(rA) && !/Auth code/i.test(rB) && !/111111/.test(rB), `${rA.slice(0, 120)} | ${rB.slice(0, 120)}`);
    // Invoices and payments: the chip and its list.
    await go(accounts, `${base}/invoices?show=auth_missing`);
    const chip = Number(((await text(accounts.locator('[data-money-filters] [data-filter="auth_missing"]'))).match(/·\s*(\d+)/) ?? [])[1] ?? -1);
    const rows = await accounts.locator("[data-money-list] [data-money-row]").count();
    const flagged = (await accounts.locator(`[data-money-row="${jobId}"] [data-money-auth-missing]`).getAttribute("data-money-auth-missing")) ?? "";
    check("C4: the 'Auth code missing' chip counts its list, and the car's row names both receipts", chip === rows && rows >= 1 && flagged.split(",").includes(nA) && flagged.split(",").includes(nB), `chip ${chip}, rows ${rows}, ${flagged}`);
    check("C4: the list's heading counts the payments without a code", /payments? without an auth code/.test(await text(accounts.locator("[data-money-list-sum]"))));
    await accounts.locator("[data-money-list]").screenshot({ path: shot("C4-invoices-filter.png") });
    // Add auth code on the money page: made up refused, a duplicate refused, a real one saved.
    await go(accounts, `${base}/jobs/${jobId}/invoice`);
    await accounts.locator(`[data-auth-add="${nA}"]`).click();
    const form = accounts.locator(`[data-auth-add-form="${nA}"]`);
    await form.locator("[data-auth-code]").fill("111111");
    // Review: the box names it in red in the server's own words (never "saved as missing" / "leave it empty"), Save waits.
    const e1 = await text(form.locator("[data-auth-code-refused]"));
    check("C5: a made-up code is refused beside the box ('111111 is not a real code: type the code from the payment confirmation.'), no amber 'saved as missing', Save off", e1 === "111111 is not a real code: type the code from the payment confirmation." && (await form.locator("[data-auth-code-note]").count()) === 0 && (await form.locator("[data-auth-add-save]").isDisabled()) && (await payOf(nA)).auth_code === null, e1);
    const dup = fresh("S5");
    const twin = (await sql("insert into public.payments (job_id, customer_id, method, amount_aed, auth_code, is_deposit, status, received_by, created_by, updated_by, received_at, verified_at, verified_by) values ($1, $2, 'link', 175, $3, true, 'recorded', $4, $4, $4, now(), now(), $4) returning number", [jobId, job.c, dup, OWNER.id]))[0]?.number;
    await sleep(5200);
    await form.locator("[data-auth-code]").fill(dup);
    await form.locator("[data-auth-add-save]").click();
    const e2 = await until(async () => { const t = await text(form.locator("[data-auth-add-error]")); return t.includes(dup) ? t : null; }, 30, 400);
    check(`C6: a code already on another receipt is refused ('Auth code ${dup} is already on ${twin}')`, new RegExp(`Auth code ${dup} is already on ${twin}`).test(e2 ?? "") && (await payOf(nA)).auth_code === null, e2 ?? "");
    const real = fresh("S5");
    await sleep(5200);
    await form.locator("[data-auth-code]").fill(real);
    await form.screenshot({ path: shot("C7-add-auth-code.png") });
    await form.locator("[data-auth-add-save]").click();
    const ok = await until(async () => (await accounts.locator(`[data-auth-added="${nA}"]`).count()) ? await text(accounts.locator(`[data-auth-added="${nA}"]`)) : null, 30, 400);
    check(`C7: a real code is saved on ${nA} (the answer beside the button)`, ok === `✓ Auth ${real} saved on ${nA}.` && (await payOf(nA)).auth_code === real, ok ?? "");
    const log = (await sql("select new_data, changed_by::text as by from public.audit_log where table_name = 'payments' and record_id = $1 and new_data ? 'auth_code_added' order by id desc limit 1", [pA.id]))[0];
    const ev = (await sql("select note from public.job_events where job_id = $1 and note like $2 order by created_at desc limit 1", [jobId, `${nA}: auth code%`]))[0]?.note ?? "";
    check("C8: logged: the change log (who, the code, by hand) and the job's history", log?.new_data?.auth_code_added === real && log?.new_data?.source?.kind === "hand" && !!log.by && new RegExp(`auth code ${real} added by hand by .+ \\(was missing\\)`).test(ev), `${JSON.stringify(log ?? {})} | ${ev}`);
    await go(accounts, `${base}/jobs/${jobId}/invoice`);
    check("C9: the flag is gone, the money page reads 'Auth <code>'", (await accounts.locator(`[data-auth-missing="${nA}"]`).count()) === 0 && (await text(accounts.locator(`[data-payment-row="${nA}"] [data-auth-shown]`))) === `Auth ${real}`);
    const rA2 = await receiptText(pA.id);
    check("C9: and the receipt now prints it", new RegExp(`Auth code\\s*${real}`).test(rA2), rA2.slice(0, 200));
    await sql("update public.payments set status = 'voided', void_reason = 'E2E S5 twin' where number = $1", [twin]);
  }

  /* ---------------- E. The bank report fills a missing code in: Suggested match → Confirm → Matched ✓ → Record ---------------- */
  if (want("E")) {
    const pE = (await sql("insert into public.payments (job_id, customer_id, method, amount_aed, bank_charge_aed, fee_msf_aed, fee_txn_aed, fee_vat_aed, auth_code, is_deposit, status, received_by, created_by, updated_by, received_at, verified_at, verified_by) values ($1, $2, 'link', 10000, 176, 175, 1, 8.8, null, true, 'recorded', $3, $3, $3, '2026-10-24T10:00:00+04:00', now(), $3) returning id::text as id, number", [jobId, job.c, OWNER.id]))[0];
    const rc = fresh("S5");
    const csv = fs.readFileSync(path.join(FIX, "ni-mtr-link-24oct.csv"), "utf8").split("756117").join(rc);
    const file = path.join(TMP, "e2e-s5-link.csv");
    fs.writeFileSync(file, csv);
    await upload(file);
    const sug = accounts.locator('[data-report-suggested="1"]');
    const sugText = await text(sug);
    check(`E1: the line's new code ${rc} is on no payment: 'Suggested match: ${pE.number} · AED 10,000.00 · payment link · the same day · its auth code is missing'`, sugText.includes(`Suggested match: ${pE.number} · AED 10,000.00 · payment link · the same day · its auth code is missing`), sugText);
    check("E1: Record waits until it is confirmed (or picked)", (await accounts.locator("[data-report-record]").isDisabled()) && (await accounts.locator('[data-report-line-match="1"] [data-report-status="suggested"]').count()) === 1);
    await accounts.locator("[data-report-review]").screenshot({ path: shot("E1-suggested-match.png") });
    await accounts.locator('[data-report-confirm-suggested="1"]').click();
    const saved = await until(async () => (await payOf(pE.number))?.auth_code === rc, 30, 500);
    const matched = await until(async () => (await accounts.locator('[data-report-line-match="1"] [data-report-matched]').count()) ? await text(accounts.locator('[data-report-line-match="1"] [data-report-matched]')) : null, 30, 400);
    check(`E2: one tap saves the bank's ${rc} on ${pE.number}; the line reads Matched ✓`, !!saved && (matched ?? "").includes(`Matched ✓ ${pE.number}`), matched ?? "");
    const logE = (await sql("select new_data from public.audit_log where table_name = 'payments' and record_id = $1 and new_data ? 'auth_code_added' order by id desc limit 1", [pE.id]))[0];
    const evE = (await sql("select note from public.job_events where job_id = $1 and note like $2 order by created_at desc limit 1", [jobId, `${pE.number}: auth code%`]))[0]?.note ?? "";
    check("E3: logged with the report's file and line", logE?.new_data?.source?.kind === "report" && logE.new_data.source.file === "e2e-s5-link.csv" && logE.new_data.source.line === 1 && new RegExp(`auth code ${rc} added from the bank report e2e-s5-link\\.csv, line 1 by`).test(evE), `${JSON.stringify(logE ?? {})} | ${evE}`);
    await accounts.locator("[data-report-review]").screenshot({ path: shot("E2-confirmed-matched.png") });
    await accounts.locator("[data-report-ref]").fill("E2E S5 link");
    await accounts.locator("[data-report-date]").fill("2026-10-25");
    await accounts.locator("[data-report-record]").click();
    await pressYes(accounts);
    const done = await until(async () => ((await accounts.locator("[data-report-done]").count()) ? await text(accounts.locator("[data-report-done]")) : null), 40, 500);
    const st = (await sql("select s.number, s.source from public.payments p join public.card_settlements s on s.id = p.settlement_id where p.id = $1", [pE.id]))[0];
    check("E4: Record makes the settlement from the report", !!done && /STL-\d{5} recorded from the bank's report/.test(done) && st?.source === "report", `${done} | ${JSON.stringify(st ?? {})}`);
    await sql("delete from public.zoho_outbox where kind = 'settlement' and record_id in (select settlement_id from public.payments where id = $1)", [pE.id]);
    // The same report again: the payment is settled already - handled, nothing new.
    await upload(file);
    const settled = await text(accounts.locator('[data-report-settled="1"]'));
    check(`E5: the same line again reads 'Already settled in ${st?.number} ✓ ${pE.number}' (never settled twice)`, settled.includes(`Already settled in ${st?.number} ✓ ${pE.number}`), settled);
    await accounts.locator("[data-report-review]").screenshot({ path: shot("E5-already-settled.png") });
    check("E5: Record is open (the settled line counts as handled)", !(await accounts.locator("[data-report-record]").isDisabled()));
    await accounts.locator("[data-report-ref]").fill("E2E S5 again");
    await accounts.locator("[data-report-record]").click();
    await pressYes(accounts);
    const again = await until(async () => ((await accounts.locator("[data-report-done]").count()) ? await text(accounts.locator("[data-report-done]")) : null), 40, 500);
    const count = (await sql("select count(*)::int as n from public.card_settlements where is_active and id in (select settlement_id from public.payments where id = $1)", [pE.id]))[0].n;
    check("E6: Record says nothing new to record; the payment keeps its one settlement", /Nothing new to record/.test(again ?? "") && /Already settled before: /.test(again ?? "") && count === 1, again ?? "");
    for (const r of await sql("select storage_path p from public.settlement_reports where file_name ilike 'e2e-s5%'")) storedFiles.add(r.p);
  }

  /* ---------------- G. A settled payment that fits is picked as "already settled"; the recorded view keeps it ---------------- */
  if (want("G")) {
    const stl = (await sql("insert into public.card_settlements (number, method, settled_on, payment_count, gross_aed, received_aed, fee_aed, msf_aed, txn_fee_aed, vat_aed, statement_ref, created_by, updated_by) values ($1, 'link', '2026-10-25', 1, 10000.00, 9815.20, 184.80, 175.00, 1.00, 8.80, 'E2E S5 hand', $2, $2) returning id::text as id, number", [`E2E-STL-${fresh("").slice(0, 4)}`, OWNER.id]))[0];
    // (Never an "STL-…" number: the next real settlement number is read from the highest STL- one.)
    const ins = (amount, code, day, settlementId = null) => sql("insert into public.payments (job_id, customer_id, method, amount_aed, bank_charge_aed, auth_code, is_deposit, status, received_by, created_by, updated_by, received_at, verified_at, verified_by, settlement_id) values ($1, $2, 'link', $3, 0, $4, true, 'recorded', $5, $5, $5, $6, now(), $5, $7) returning id::text as id, number", [jobId, job.c, amount, code, OWNER.id, day, settlementId]).then((r) => r[0]);
    const pS = await ins(10000, null, "2026-10-24T11:00:00+04:00", stl.id);
    const pN = await ins(10000, null, "2026-10-25T11:00:00+04:00");
    const rcM = fresh("S5");
    const pM = await ins(750, rcM, "2026-10-24T12:00:00+04:00");
    const rcS = fresh("S5");
    const rows = fs.readFileSync(path.join(FIX, "ni-mtr-link-24oct.csv"), "utf8").split("756117").join(rcS).split(/\r?\n/);
    const at = rows.findIndex((r) => r.includes(rcS));
    rows.splice(at + 1, 0, `24/10/2026,XXXX7701,4XXXXXXXXXXX0002,SALES,XXXXXXXXXXXXXXXXXXX0002,${rcM},750.00,-13.13,-1.00,-0.71,735.16,M/D/C/CN`);
    const csv = rows.join("\n").replace('POS TRANSACTIONS,1,"10,000.00"', 'POS TRANSACTIONS,2,"10,750.00"').replace("COMMISSION,,-175.00", "COMMISSION,,-188.13").replace("FEE TRANSACTIONS,,-1.00", "FEE TRANSACTIONS,,-2.00").replace("VAT,,-8.80", "VAT,,-9.51").replace('NET PAYABLE / RECEIVABLE,,"9,815.20"', 'NET PAYABLE / RECEIVABLE,,"10,550.36"');
    const file = path.join(TMP, "e2e-s5-mixed.csv");
    fs.writeFileSync(file, csv);
    await upload(file);
    const reportUrl = accounts.url();
    const why1 = await text(accounts.locator('[data-report-line-match="1"]'));
    const opts = await accounts.locator('[data-report-pick="1"] option').evaluateAll((os) => os.map((o) => ({ v: o.value, t: o.textContent })));
    const settledOpt = opts.find((o) => o.v === `settled:${pS.id}`);
    check(`G1: two missing-code payments fit line 1, one settled by hand: no one-tap Confirm, the words name '${pS.number} (already settled in ${stl.number})' and ${pN.number}`, (await accounts.locator('[data-report-confirm-suggested="1"]').count()) === 0 && why1.includes(`${pS.number} (already settled in ${stl.number})`) && why1.includes(pN.number), why1);
    check("G1: the settled payment can be picked, labelled 'already settled in STL-…'", !!settledOpt && (settledOpt.t ?? "").includes(`already settled in ${stl.number}`) && opts.some((o) => o.v === pN.id), JSON.stringify(opts.slice(0, 4)));
    check(`G1: line 2 (auth ${rcM}) is matched to ${pM.number}`, (await text(accounts.locator('[data-report-line-match="2"] [data-report-matched]'))).includes(`Matched ✓ ${pM.number}`));
    await accounts.locator('[data-report-pick="1"]').selectOption(`settled:${pS.id}`);
    const pickWords = await text(accounts.locator('[data-report-settled-pick="1"]'));
    const fillWords = await text(accounts.locator('[data-report-will-fill="1"]'));
    check(`G2: picked, the line reads 'Already settled in ${stl.number} ✓ ${pS.number}' and 'Auth ${rcS} will be saved on ${pS.number}'`, pickWords.includes(`Already settled in ${stl.number} ✓ ${pS.number}`) && fillWords.includes(`Auth ${rcS} will be saved on ${pS.number}`), `${pickWords} | ${fillWords}`);
    await accounts.locator("[data-report-review]").screenshot({ path: shot("G2-settled-candidate-picked.png") });
    await accounts.locator("[data-report-ref]").fill("E2E S5 mixed");
    await accounts.locator("[data-report-record]").click();
    await pressYes(accounts);
    const done = await until(async () => ((await accounts.locator("[data-report-done]").count()) ? await text(accounts.locator("[data-report-done]")) : null), 40, 500);
    const box = done ? "" : await text(accounts.locator("[data-report-record-box]"));
    const after = await sql("select number, auth_code, settlement_id::text as s from public.payments where id = any($1::uuid[]) order by number", [[pS.id, pN.id, pM.id]]);
    const by = Object.fromEntries(after.map((r) => [r.number, r]));
    check(`G3: Record settles ${pM.number} only; ${pS.number} keeps its settlement and gets the bank's ${rcS}; ${pN.number} is untouched`, /STL-\d{5} recorded from the bank's report/.test(done ?? "") && (done ?? "").includes(`Already settled before: ${pS.number} (${stl.number})`) && (done ?? "").includes(`${pS.number} auth ${rcS}`) && by[pS.number]?.s === stl.id && by[pS.number]?.auth_code === rcS && by[pN.number]?.s === null && by[pN.number]?.auth_code === null && !!by[pM.number]?.s && by[pM.number].s !== stl.id, `${done ?? box} | ${JSON.stringify(after)}`);
    const l1 = (await until(async () => { const t = await text(accounts.locator('[data-report-line-match="1"]')); return t.includes(pS.number) ? t : null; }, 20, 400)) ?? (await text(accounts.locator('[data-report-line-match="1"]')));
    const l2 = await text(accounts.locator('[data-report-line-match="2"]'));
    check(`G4: right after Record line 1 reads '${pS.number} · … · already settled in ${stl.number}' (never 'Not ours'), line 2 '${pM.number}'`, l1.includes(pS.number) && l1.includes(`already settled in ${stl.number}`) && !/Not ours/.test(l1) && l2.includes(pM.number), `${l1} | ${l2}`);
    await go(accounts, reportUrl);
    await accounts.waitForSelector("[data-report-review]", { timeout: 30000 }).catch(() => null);
    const r1 = await text(accounts.locator('[data-report-line-match="1"]'));
    const r2 = await text(accounts.locator('[data-report-line-match="2"]'));
    check("G5: opened again, the recorded report still reads 'already settled' on line 1 and the payment on line 2", r1.includes(pS.number) && r1.includes(`already settled in ${stl.number}`) && !/Not ours/.test(r1) && r2.includes(pM.number) && !/Not ours/.test(r2), `${r1} | ${r2}`);
    await accounts.locator("[data-report-review]").screenshot({ path: shot("G5-recorded-reopened.png") });
    await sql("delete from public.zoho_outbox where kind = 'settlement' and record_id in (select settlement_id from public.payments where id = $1)", [pM.id]);
  }

  /* ---------------- H. An Excel report with real date cells; one payment fitting two lines is suggested for neither ---------------- */
  if (want("H")) {
    const pH = (await sql("insert into public.payments (job_id, customer_id, method, amount_aed, bank_charge_aed, auth_code, is_deposit, status, received_by, created_by, updated_by, received_at, verified_at, verified_by) values ($1, $2, 'link', 760, 0, null, true, 'recorded', $3, $3, $3, '2026-10-24T09:00:00+04:00', now(), $3) returning id::text as id, number", [jobId, job.c, OWNER.id]))[0];
    const [cA, cB] = [fresh("S5"), fresh("S5")];
    const lines = fs.readFileSync(path.join(FIX, "ni-mtr-link-24oct.csv"), "utf8").split(/\r?\n/).filter((l) => l !== "");
    const aoa = lines.map((l) => l.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((c) => c.replace(/^"|"$/g, "")));
    const ti = aoa.findIndex((r) => r[5] === "756117");
    const day = new Date(Date.UTC(2026, 9, 24, 8, 30));
    const lineRow = (code, n) => [day, "XXXX7701", `4XXXXXXXXXXX000${n}`, "SALES", `XXXXXXXXXXXXXXXXXXX000${n}`, code, "760.00", "-13.30", "-1.00", "-0.72", "744.98", "M/D/C/CN"];
    aoa.splice(ti, 1, lineRow(cA, 1), lineRow(cB, 2));
    const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "MTR");
    const file = path.join(TMP, "e2e-s5-dates.xlsx");
    fs.writeFileSync(file, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
    await upload(file);
    const review = await accounts.locator("[data-report-review]").count();
    const dates = await accounts.locator("[data-report-line] td:first-child").allTextContents();
    check("H1: an Excel report with real date cells opens for review (before: 'Invalid time value', the error page), each line on 24 Oct 2026", review === 1 && dates.length === 2 && dates.every((d) => d.trim() === "24 Oct 2026"), JSON.stringify(dates));
    const w1 = await text(accounts.locator('[data-report-line-match="1"]'));
    check(`H2: ${pH.number} fits both lines (codes on no payment): neither is suggested, both name the other line`, (await accounts.locator("[data-report-confirm-suggested]").count()) === 0 && w1.includes(`${pH.number} has its auth code missing and fits this line and line 2 alike`) && (await text(accounts.locator('[data-report-line-match="2"]'))).includes("and line 1 alike"), w1);
    await accounts.locator("[data-report-review]").screenshot({ path: shot("H2-two-lines-one-payment.png") });
    await sql("update public.payments set status = 'voided', void_reason = 'E2E S5 H' where id = $1", [pH.id]);
  }

  /* ---------------- I. Money not allocated carries the flag; the list's answer stays in the centre window ---------------- */
  if (want("I")) {
    const veh = (await sql("select vehicle_id::text as v from public.jobs where id = $1", [jobId]))[0].v;
    const ins = (amount) => sql("insert into public.payments (job_id, invoice_id, customer_id, vehicle_id, method, amount_aed, bank_charge_aed, auth_code, is_deposit, status, received_by, created_by, updated_by, received_at, verified_at, verified_by, notes) values (null, null, $1, $2, 'link', $3, 0, null, false, 'recorded', $4, $4, $4, now(), now(), $4, 'E2E S5 credit') returning id::text as id, number", [job.c, veh, amount, OWNER.id]).then((r) => r[0]);
    const u1 = await ins(310);
    const u2 = await ins(320);
    await go(accounts, `${base}/invoices`);
    const row1 = accounts.locator(`[data-unallocated-row="${u1.number}"]`);
    check(`I1: money not allocated (${u1.number}, ${u2.number}) carries the amber 'Auth code missing' with Add auth code`, (await row1.locator(`[data-auth-missing="${u1.number}"]`).count()) === 1 && (await row1.locator(`[data-auth-add="${u1.number}"]`).count()) === 1 && (await accounts.locator(`[data-unallocated-row="${u2.number}"] [data-auth-missing="${u2.number}"]`).count()) === 1);
    await go(accounts, `${base}/customers/${job.c}`);
    check("I1: the customer page's 'Not allocated' list flags it too", (await accounts.locator(`[data-unallocated-row="${u1.number}"] [data-auth-missing="${u1.number}"]`).count()) === 1);
    await go(accounts, `${base}/invoices`);
    const c1 = fresh("S5");
    await row1.locator(`[data-auth-add="${u1.number}"]`).click();
    await row1.locator("[data-auth-code]").fill(c1);
    await row1.locator("[data-auth-add-save]").click();
    const shown = await until(async () => { const t = await text(accounts.locator(`[data-unallocated-row="${u1.number}"] [data-auth-shown]`)); return t === `Auth ${c1}` ? t : null; }, 40, 400);
    check(`I2: saved there, the row reads 'Auth ${c1}' in the same place`, !!shown && (await payOf(u1.number)).auth_code === c1, shown ?? "");
    await sleep(5200);
    await go(accounts, `${base}/invoices?show=auth_missing`);
    const credit = accounts.locator(`[data-money-row="credit:${job.c}"]`);
    const c2 = fresh("S5");
    await credit.locator(`[data-auth-add="${u2.number}"]`).click();
    await credit.locator(`[data-auth-add-form="${u2.number}"] [data-auth-code]`).fill(c2);
    await credit.locator(`[data-auth-add-form="${u2.number}"] [data-auth-add-save]`).click();
    const win = accounts.locator(`[data-auth-added-window="${u2.number}"]`);
    await win.waitFor({ timeout: 20000 }).catch(() => null);
    const gone = await until(async () => (await accounts.locator(`[data-money-row="credit:${job.c}"]`).count()) === 0, 40, 400);
    await sleep(1500);
    const msg = await text(win.locator("[data-auth-added-message]"));
    check(`I3: under the 'Auth code missing' chip the save takes the row away, and the answer stays in the centre window: 'Auth ${c2} saved on ${u2.number}.'`, !!gone && (await win.isVisible()) && msg === `Auth ${c2} saved on ${u2.number}.` && (await payOf(u2.number)).auth_code === c2, `gone ${gone} · ${msg}`);
    await accounts.screenshot({ path: shot("I3-answer-window.png") });
    await win.locator("[data-auth-added-ok]").click();
    check("I3: OK closes the window", (await accounts.locator("[data-auth-added-window]").count()) === 0);
  }

  /* ---------------- F. A code stored by the old rule ("111111", like RCT-00040) on the invoice page ---------------- */
  if (want("F")) {
    cleanupDb();
    const s2 = (await api("/api/e2e/stage", { stage: "ready" })).json;
    const c2 = (await sql("select customer_id::text as c from public.jobs where id = $1", [s2.jobId]))[0].c;
    const pF = (await sql("insert into public.payments (job_id, invoice_id, customer_id, method, amount_aed, auth_code, is_deposit, status, received_by, created_by, updated_by, received_at, verified_at, verified_by) values ($1, $2, $3, 'link', 200, '111111', false, 'recorded', $4, $4, $4, now(), now(), $4) returning id::text as id, number", [s2.jobId, s2.invoice.id, c2, OWNER.id]))[0];
    await go(accounts, `${base}/invoices/${s2.invoice.id}`);
    check(`F1: '111111' stored by the old rule is flagged by the rule itself on the invoice page (${pF.number})`, (await accounts.locator(`[data-auth-missing="${pF.number}"]`).count()) === 1 && !/Auth 111111/.test(await text(accounts.locator("body"))));
    await accounts.locator(`[data-auth-missing="${pF.number}"]`).screenshot({ path: shot("F1-invoice-page-flag.png") });
    const rF = await receiptText(pF.id);
    check("F2: its receipt never prints 111111", !/111111/.test(rF) && !/Auth code/i.test(rF), rF.slice(0, 160));
    await accounts.locator(`[data-auth-add="${pF.number}"]`).click();
    const real = fresh("S5");
    await accounts.locator(`[data-auth-add-form="${pF.number}"] [data-auth-code]`).fill(real);
    await accounts.locator(`[data-auth-add-form="${pF.number}"] [data-auth-add-save]`).click();
    const ok = await until(async () => (await payOf(pF.number))?.auth_code === real, 30, 500);
    const log = (await sql("select new_data from public.audit_log where table_name = 'payments' and record_id = $1 and new_data ? 'auth_code_added' order by id desc limit 1", [pF.id]))[0];
    check("F3: Add auth code replaces the made-up 111111 (the change log keeps what it was)", !!ok && log?.new_data?.was === "111111" && log.new_data.auth_code_added === real, JSON.stringify(log ?? {}));
  }
} finally {
  await accountsB.browser.close();
  await advisorB.browser.close();
  for (const r of await sql("select storage_path p from public.settlement_reports where file_name ilike 'e2e-s5%'").catch(() => [])) storedFiles.add(r.p);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (storedFiles.size && key) {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/settlement-reports`, { method: "DELETE", headers: { apikey: key, Authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ prefixes: [...storedFiles] }) });
    console.log(`storage: ${storedFiles.size} test report files removed (${res.status})`);
  }
  fs.rmSync(TMP, { recursive: true, force: true });
}
cleanupDb();
process.exit(summary() ? 1 : 0);
