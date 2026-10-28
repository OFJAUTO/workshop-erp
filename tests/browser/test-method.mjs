// Section 12 proof: a payment shows ONLY the method it was really paid by. A cash advance at the counter
// says "Cash · deposit · by <who>", never a provider's name; an online payment says "paid online (Pay now)";
// the receipt PDF names the method only; and no payment in the whole book carries a bank charge that
// disagrees with its actual method (cash and transfer 0, card and link at the Settings rates).
// Run: node --env-file=.env.local tests/browser/test-method.mjs   (dev server on :3100)
import path from "node:path";
import { api, base, browserFor, cleanupDb, cookieHeader, go, here, makeChecks, settle, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shot = (name) => path.join(here, "shots", name);
const until = async (fn, tries = 40, gap = 400) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const pdfText = async (buf) => {
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  let out = "";
  for (let i = 0; i < doc.countPages(); i++) out += doc.loadPage(i).toStructuredText("preserve-whitespace").asText();
  return out.replace(/\s+/g, " ").toUpperCase();
};

cleanupDb();
const seed = await api("/api/e2e/stage", { stage: "approved" });
const jobId = seed.json?.jobId;
if (!jobId) { console.error("seed failed:", JSON.stringify(seed).slice(0, 300)); process.exit(1); }

/* ---------------- 1. A cash advance at the counter ---------------- */
const { browser, page } = await browserFor("owner", { viewport: { width: 1366, height: 950 } });
await go(page, `${base}/jobs/${jobId}/invoice`);
check("1: the advance fold says what it does", (await page.locator("[data-advance-fold]").count()) === 1 && /Record an advance payment \(customer paying at the counter/.test(((await page.textContent("[data-advance-fold]")) ?? "")));
await page.locator("[data-advance-fold] summary").click();
await sleep(400);
await page.locator('[data-method="cash"]').click();
await page.locator("[data-amount-partial]").click();
await page.locator("[data-amount-input]").pressSequentially("500");
await page.locator("[data-record-payment]").click();
await page.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 25000 }).catch(() => null);
await settle(page);
const pay = (await sql("select id, number, method, is_deposit, bank_charge_aed, received_by, client_key from public.payments where job_id = $1 and invoice_id is null order by created_at desc limit 1", [jobId]))[0];
check("2: recorded as a cash deposit with zero bank charge", !!pay && pay.method === "cash" && pay.is_deposit && Number(pay.bank_charge_aed) === 0, JSON.stringify(pay ?? {}));

const cardText = ((await page.textContent("[data-payments-card]")) ?? "").replace(/\s+/g, " ");
check("3: the row says Cash · deposit, by the person who took it", /Cash\s*·\s*deposit/.test(cardText) && /by Omar/i.test(cardText), cardText.slice(0, 200));
check("3: no provider name anywhere near the payments", !/Network International/i.test(cardText));
await page.locator("[data-payments-card]").scrollIntoViewIfNeeded();
await page.screenshot({ path: shot("method-1-payments-card.png"), clip: (await page.locator("[data-payments-card]").boundingBox()) ?? undefined });

/* ---------------- 2. The receipt PDF names the method only ---------------- */
const cookie = await cookieHeader("owner");
const rec = await fetch(`${base}/api/pdf/receipt/${pay.id}`, { headers: { cookie } });
const recText = await pdfText(Buffer.from(await rec.arrayBuffer()));
check("4: the receipt downloads and says Cash", rec.status === 200 && /RECEIPT/.test(recText) && /CASH/.test(recText), `${rec.status}`);
check("4: the receipt never names a provider or the expected method", !/NETWORK|N-GENIUS|NGENIUS|EXPECTED/.test(recText));

/* ---------------- 3. An online payment says "paid online (Pay now)" ---------------- */
const cust = (await sql("select customer_id from public.jobs where id = $1", [jobId]))[0].customer_id;
await sql("insert into public.payments (job_id, invoice_id, customer_id, method, amount_aed, is_deposit, received_by, reference, status, client_key, bank_charge_aed) values ($1, null, $2, 'link', 100, true, null, 'Paid online · card ****4242', 'recorded', 'ngenius:e2e-row', 1.75)", [jobId, cust]);
await go(page, `${base}/jobs/${jobId}/invoice`);
const cardText2 = ((await page.textContent("[data-payments-card]")) ?? "").replace(/\s+/g, " ");
check("5: the Pay-now row says paid online, not the provider", /paid online \(Pay now\)/.test(cardText2) && !/Network International/i.test(cardText2), cardText2.slice(0, 260));

/* ---------------- 4. Every payment's bank charge agrees with its actual method ---------------- */
const rates = Object.fromEntries((await sql("select key, value from public.settings where key like 'bank_charge_%_percent'")).map((r) => [r.key, Number(r.value)]));
// 29 October 2026: MSF % before VAT (card machine 2.15%, payment link 1.75%) plus the link's AED 1.00 per transaction.
check("6: the rates are the agreed ones", rates.bank_charge_cash_percent === 0 && rates.bank_charge_transfer_percent === 0 && rates.bank_charge_card_percent === 2.15 && rates.bank_charge_link_percent === 1.75, JSON.stringify(rates));
const linkFee = Number((await sql("select value #>> '{}' as v from public.settings where key = 'bank_fee_link_txn_aed'"))[0]?.v) || 0;
// A payment carrying the split estimate (recorded or recalculated since the change) agrees with its method.
const bad = await sql("select p.number, p.method, p.amount_aed, p.bank_charge_aed from public.payments p where p.is_active and p.fee_msf_aed is not null and round(p.bank_charge_aed::numeric, 2) <> round(round((p.amount_aed * (case p.method when 'card' then $1 when 'link' then $2 else 0 end)::numeric / 100), 2) + (case p.method when 'link' then $3 else 0 end)::numeric, 2)", [rates.bank_charge_card_percent, rates.bank_charge_link_percent, linkFee]);
check("6: no payment in the book disagrees with its method (RCT-00091 included)", bad.length === 0, JSON.stringify(bad).slice(0, 200));
const rct = (await sql("select bank_charge_aed, method from public.payments where number = 'RCT-00091'"))[0];
check("6: RCT-00091 is cash with zero charge", !rct || (rct.method === "cash" && Number(rct.bank_charge_aed) === 0), JSON.stringify(rct ?? {}));

await browser.close();
cleanupDb();
process.exit(summary() ? 1 : 0);
