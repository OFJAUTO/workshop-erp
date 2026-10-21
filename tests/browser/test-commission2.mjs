// Evening section 2 proof: commission payments need PROOF. Ready/Waiting buckets split; one payment
// pays several ready commissions of one person; cash prints a numbered voucher (signature lines,
// amount in words); a transfer wants its reference; without the uploaded proof the payment reads
// "Paid - proof missing" (amber) and sits on accounts' Waiting on you; the export carries the columns.
// Run: node --env-file=.env.local tests/browser/test-commission2.mjs   (dev server on :3100)
import path from "node:path";
import { api, base, browserFor, cleanupDb, cookieHeader, go, here, makeChecks, settle, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shot = (name) => path.join(here, "shots", name);
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const pdfText = async (buf) => {
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  let out = "";
  for (let i = 0; i < doc.countPages(); i++) out += doc.loadPage(i).toStructuredText("preserve-whitespace").asText();
  return out.replace(/\s+/g, " ").toUpperCase();
};

cleanupDb();
const advisor = (await sql("select id from public.staff where role_id = 'service_advisor' and is_active limit 1"))[0].id;

/** A job whose commission is READY: approved commission + a tax invoice paid in full. */
async function readyJob(n, recipient, amount) {
  const seed = n === 1 ? await api("/api/e2e/stage", { stage: "approved" }) : await api("/api/e2e/car", {});
  const jobId = n === 1 ? seed.json.jobId : seed.json.job_id;
  const job = (await sql("select customer_id, vehicle_id from public.jobs where id = $1", [jobId]))[0];
  const q = (await sql("insert into public.quotations (kind, number, version, job_id, customer_id, vehicle_id, status, token, vat_percent, commission_to, commission_kind, commission_value, commission_aed, commission_status, commission_set_by, commission_set_at, commission_decided_by, commission_decided_at, created_by, updated_by) values ('quotation', $5, 1, $1, $2, $3, 'draft', $6, 5, $4, 'aed', $7, $7, 'approved', $8, now(), $8, now(), $8, $8) returning id", [jobId, job.customer_id, job.vehicle_id, recipient, `Q-E2EC-${n}`, `e2e-c2-tok-${n}`, amount, advisor]))[0];
  const inv = (await sql("insert into public.invoices (number, kind, job_id, customer_id, vehicle_id, status, issued_at, subtotal_aed, discount_aed, taxable_aed, vat_aed, total_aed, token, created_by, updated_by) values ($4, 'tax_invoice', $1, $2, $3, 'issued', now(), 1000, 0, 1000, 50, 1050, $5, $6, $6) returning id", [jobId, job.customer_id, job.vehicle_id, `INV-E2EC-${n}`, `e2e-c2-inv-${n}`, advisor]))[0];
  await sql("insert into public.payments (job_id, invoice_id, customer_id, method, amount_aed, is_deposit, received_by, status, verified_at, verified_by, bank_charge_aed, client_key) values ($1, $2, $3, 'cash', 1050, false, $4, 'recorded', now(), $4, 0, $5)", [jobId, inv.id, job.customer_id, advisor, `e2e-c2-pay-${n}`]);
  return { jobId, quotationId: q.id };
}
const a = await readyJob(1, "E2e Payee One", 600);
const b = await readyJob(2, "E2e Payee Two", 250);
const c = await readyJob(3, "E2e Payee Two", 350);
// And one APPROVED commission whose customer has NOT paid: it must sit in Waiting with no pay tick.
const waitingSeed = await api("/api/e2e/car", {});
const wJob = (await sql("select id, customer_id, vehicle_id from public.jobs where id = $1", [waitingSeed.json.job_id]))[0];
await sql("insert into public.quotations (kind, number, version, job_id, customer_id, vehicle_id, status, token, vat_percent, commission_to, commission_kind, commission_value, commission_aed, commission_status, commission_set_by, commission_set_at, created_by, updated_by) values ('quotation', 'Q-E2EC-W', 1, $1, $2, $3, 'draft', 'e2e-c2-tok-w', 5, 'E2e Payee One', 'aed', 999, 999, 'approved', $4, now(), $4, $4)", [wJob.id, wJob.customer_id, wJob.vehicle_id, advisor]);

/* ---------------- 1. Buckets: Ready vs Waiting, advisor locked out ---------------- */
const { browser: xb, page: xp } = await browserFor("service_advisor");
await go(xp, `${base}/commissions`);
check("1: an advisor cannot open the commissions page", !/\/commissions/.test(xp.url()), xp.url());
await xb.close();
const { browser, page } = await browserFor("accounts", { viewport: { width: 1440, height: 950 } });
await go(page, `${base}/commissions`);
check("1: the ready bucket holds the three payable commissions with ticks", (await page.locator("[data-commissions-ready] [data-pay-tick]").count()) === 3);
check("1: the unpaid customer's commission sits in Waiting, with no tick and no pay button", (await page.locator('[data-commissions-waiting] [data-commission-row="Q-E2EC-W"]').count()) === 1 && (await page.locator('[data-commissions-waiting] [data-pay-tick]').count()) === 0);

/* ---------------- 2. Cash: one commission, voucher, sign, upload ---------------- */
const qa = (await sql("select id from public.quotations where number = 'Q-E2EC-1'"))[0].id;
await page.locator(`[data-pay-tick="${qa}"]`).click();
await sleep(300);
check("2: the pay box opens with the amount pre-filled", (await page.locator("[data-pay-box]").count()) === 1 && (await page.locator("[data-pay-amount]").inputValue()) === "600");
check("2: ticking one person greys the other out", (await page.locator("[data-commissions-ready] li.opacity-40").count()) === 2);
await page.locator("[data-pay-save]").click();
await page.waitForURL((u) => /voucher=/.test(u.toString()), { timeout: 30000 }).catch(() => null);
await settle(page);
const payA = (await sql("select cp.id, cp.number, cp.method, cp.amount_aed::text as amount, cp.proof_path from public.commission_payments cp join public.quotations q on q.commission_payment_id = cp.id where q.id = $1", [qa]))[0];
check("2: one cash payment with a voucher number was recorded", !!payA && payA.method === "cash" && Number(payA.amount) === 600 && /^CPV-\d{5}$/.test(payA.number), JSON.stringify(payA ?? {}));
check("2: the fresh-voucher card offers Print and Upload", (await page.locator("[data-fresh-voucher]").count()) === 1 && (await page.locator("[data-print-voucher-fresh]").count()) === 1 && (await page.locator(`[data-proof-upload="${payA.id}"]`).count()) >= 1);
check("2: the paid row reads Paid – proof missing (amber)", (await page.locator("[data-proof-missing]").count()) >= 1);
await page.screenshot({ path: shot("com2-1-voucher-created.png"), fullPage: false });

const cookie = await cookieHeader("accounts");
const pdfRes = await fetch(`${base}/api/pdf/commission-voucher/${payA.id}`, { headers: { cookie } });
const text = await pdfText(Buffer.from(await pdfRes.arrayBuffer()));
check("3: the voucher PDF carries the number, recipient, words and the jobs covered", pdfRes.status === 200 && text.includes("COMMISSION PAYMENT VOUCHER") && text.includes(payA.number) && text.includes("E2E PAYEE ONE") && /SIX HUNDRED/.test(text) && text.includes("Q-E2EC-1"), `${pdfRes.status}`);
check("3: it has the three signature lines", text.includes("RECEIVED BY") && text.includes("PAID BY (ACCOUNTS)") && text.includes("APPROVED BY (OWNER)"));
{
  const mupdf = await import("mupdf");
  const r2 = await fetch(`${base}/api/pdf/commission-voucher/${payA.id}`, { headers: { cookie } });
  const doc = mupdf.Document.openDocument(Buffer.from(await r2.arrayBuffer()), "application/pdf");
  const pix = doc.loadPage(0).toPixmap(mupdf.Matrix.scale(1.4, 1.4), mupdf.ColorSpace.DeviceRGB);
  (await import("node:fs")).writeFileSync(shot("com2-2-voucher-pdf.png"), Buffer.from(pix.asPNG()));
}
const techCookie = await cookieHeader("technician");
const refused = await fetch(`${base}/api/pdf/commission-voucher/${payA.id}`, { headers: { cookie: techCookie } });
check("3: a technician is refused the voucher", refused.status === 403, `${refused.status}`);

// Upload the signed proof (a tiny PNG) and watch the amber go.
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const fd = new FormData();
fd.set("payment_id", payA.id);
fd.set("file", new File([png], "signed-voucher.png", { type: "image/png" }));
const up = await fetch(`${base}/api/commissions/proof`, { method: "POST", headers: { cookie }, body: fd });
check("4: the signed voucher uploads", up.status === 200, `${up.status} ${await up.text().then((t) => t.slice(0, 80))}`);
const fdT = new FormData();
fdT.set("payment_id", payA.id);
fdT.set("file", new File([png], "x.png", { type: "image/png" }));
const upTech = await fetch(`${base}/api/commissions/proof`, { method: "POST", headers: { cookie: techCookie }, body: fdT });
check("4: a technician cannot upload proof", upTech.status === 403, `${upTech.status}`);
await go(page, `${base}/commissions`);
check("4: after the upload the row shows Proof ✓ and the amber is gone for it", (await page.locator("[data-proof-link]").count()) >= 1 && (await page.locator(`[data-proof-upload="${payA.id}"]`).count()) === 0);

/* ---------------- 3. Transfer: TWO commissions of one person in ONE payment ---------------- */
const qb = (await sql("select id from public.quotations where number = 'Q-E2EC-2'"))[0].id;
const qc = (await sql("select id from public.quotations where number = 'Q-E2EC-3'"))[0].id;
await page.locator(`[data-pay-tick="${qb}"]`).click();
await page.locator(`[data-pay-tick="${qc}"]`).click();
await sleep(300);
check("5: two ticks of one person pre-fill the summed amount", (await page.locator("[data-pay-amount]").inputValue()) === "600");
await page.locator('[data-pay-method="transfer"]').click();
check("5: a transfer demands its reference", (await page.locator("[data-pay-reference][required]").count()) === 1);
await page.locator("[data-pay-reference]").fill("FT-E2E-778899");
await page.locator("[data-pay-save]").click();
await page.waitForURL((u) => /voucher=/.test(u.toString()), { timeout: 30000 }).catch(() => null);
await settle(page);
const payB = (await sql("select cp.id, cp.number, cp.method, cp.reference, cp.amount_aed::text as amount, (select count(*)::int from public.quotations q where q.commission_payment_id = cp.id) as covers from public.commission_payments cp where cp.recipient = 'E2e Payee Two' order by cp.created_at desc limit 1"))[0];
check("5: ONE transfer payment covers both commissions with its reference", !!payB && payB.method === "transfer" && payB.reference === "FT-E2E-778899" && Number(payB.amount) === 600 && payB.covers === 2, JSON.stringify(payB ?? {}));

/* ---------------- 4. Waiting on you + export columns ---------------- */
await go(page, `${base}/dashboard`);
const dash = ((await page.textContent("body")) ?? "").replace(/\s+/g, " ");
check("6: accounts' Waiting on you names the proof-missing payment", /Commission paid – proof missing/.test(dash) && dash.includes(payB.number));
const month = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 7);
const xl = await fetch(`${base}/api/export/commissions?month=${month}`, { headers: { cookie } });
check("6: the export downloads with the new columns", xl.status === 200 && Number(xl.headers.get("content-length") ?? (await xl.arrayBuffer()).byteLength) > 4000, `${xl.status}`);

await browser.close();
cleanupDb();
process.exit(summary() ? 1 : 0);
