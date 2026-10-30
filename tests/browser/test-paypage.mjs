// Our payment page (21 October 2026, part 1 section 1.4): every pay-request message carries OUR short
// link only - never the gateway's address; the /p/ page greets by first name with the car, the amount
// large, Pay now (the pasted link), bank transfer with copy, pay at the workshop; a pasted link is
// validated against the allowed pay-page domains; replacing it keeps the same /p/ link; once recorded
// the page says Paid with the receipt.
//   node --env-file=.env.test.local tests/browser/test-paypage.mjs
import { api, base, browserFor, cleanupDb, makeChecks, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shots = "C:/Users/user/Desktop/workshop ERP/tests/browser/shots";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, tries = 40, ms = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } return null; };

await cleanupDb();
const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
const jobId = seed.jobId;
await sql("update public.quotations set deposit_aed = 20000 where job_id = $1 and status = 'approved'", [jobId]);

const adv = await browserFor("service_advisor", { viewport: { width: 1500, height: 1200 } });
const page = adv.page;
await page.goto(`${base}/jobs/${jobId}`, { waitUntil: "load" });
await page.waitForTimeout(1500);
await page.locator("[data-send-deposit-request]").click();
await page.waitForTimeout(1200);
const msg = (await page.locator("textarea[readonly]").inputValue().catch(() => "")) ?? "";
check("the message carries OUR short link only", /https:\/\/erp\.ofjauto\.com\//.test(msg) && !/ngenius|network\.ae|paypage/i.test(msg), msg.slice(0, 160));
check("the amount is in the message", /20,000\.00/.test(msg));

// A marketing page is refused; a real pay-page link is saved with its domain named.
await page.locator("[data-deposit-pay-link]").fill("https://www.network.ae/en/offers");
await page.locator("[data-save-gateway]").click();
const bad = await until(async () => ((await page.locator("[data-gateway-error]").count()) ? await page.locator("[data-gateway-error]").textContent() : null), 20, 400);
check("a non-payment link is refused", !!bad && /doesn't look like a payment link/i.test(bad), bad ?? "");
await page.locator("[data-deposit-pay-link]").fill("https://paypage.sandbox.ngenius-payments.com/?code=e2e-abc");
await page.locator("[data-save-gateway]").click();
const ok1 = await until(async () => ((await page.locator("[data-gateway-ok]").count()) ? await page.locator("[data-gateway-ok]").textContent() : null), 20, 400);
check("a real pay-page link is saved with its domain named", !!ok1 && /paypage\.sandbox\.ngenius-payments\.com/.test(ok1));
const req = (await sql("select token, gateway_url, amount_aed::numeric as a, kind from public.payment_requests where job_id = $1 and is_active", [jobId]))[0];
check("one payment request row with the link and amount", req?.kind === "deposit" && Number(req?.a) === 20000 && /e2e-abc/.test(req?.gateway_url ?? ""), JSON.stringify(req));
await adv.browser.close();

// The public page: greeting, car, amount large, Pay now to the gateway, bank transfer, the workshop.
const pub = await browserFor("owner", { viewport: { width: 420, height: 900 } });
const ctx = pub.context ?? pub.browser.contexts()[0];
await ctx.clearCookies();
const p2 = pub.page;
await p2.goto(`${base}/p/${req.token}`, { waitUntil: "load" });
await p2.waitForTimeout(800);
const body = ((await p2.textContent("body")) ?? "").replace(/\s+/g, " ");
check("the page greets by first name with the car and number", /Dear /.test(body) && /Dubai S 30303/.test(body) && /Q-STAGE-1/.test(body), body.slice(0, 140));
check("the amount is large on the page", /AED 20,000\.00/.test((await p2.locator("[data-pay-amount]").textContent()) ?? ""));
check("Pay now opens the pasted gateway link", ((await p2.locator("[data-pay-now]").getAttribute("href")) ?? "").includes("paypage.sandbox.ngenius-payments.com"));
await p2.locator("[data-pay-bank] summary").click();
check("bank transfer details with copy buttons", /IBAN/.test((await p2.locator("[data-pay-bank]").textContent()) ?? "") && (await p2.locator("[data-pay-bank] [data-copy-text]").count()) >= 3);
await p2.locator("[data-pay-workshop] summary").click();
check("pay at the workshop with the address and hours", /Al Quoz/i.test((await p2.locator("[data-pay-workshop]").textContent()) ?? "") && /Monday to Saturday/.test((await p2.locator("[data-pay-workshop]").textContent()) ?? ""));
const html = await p2.content();
check("the preview carries the OFJ square logo, not the gateway", /og:title[^>]*OFJ Automotive · Payment|OFJ Automotive · Payment/.test(html) && /preview-square\.jpg/.test(html));
await p2.screenshot({ path: `${shots}/pay-page.png`, fullPage: true });

// Replacing the link later keeps the SAME /p/ address.
await sql("update public.payment_requests set gateway_url = 'https://paypage.ngenius-payments.com/?code=e2e-replaced' where token = $1", [req.token]);
await p2.reload({ waitUntil: "load" });
check("the same /p/ link serves the replaced gateway link", ((await p2.locator("[data-pay-now]").getAttribute("href")) ?? "").includes("e2e-replaced"));

// Once the money is recorded the page says Paid with the receipt.
await sql("insert into public.payments (job_id, customer_id, number, method, amount_aed, status, received_at) select id, customer_id, 'RCT-E2EP', 'cash', 20000, 'recorded', now() from public.jobs where id = $1", [jobId]);
await p2.reload({ waitUntil: "load" });
await p2.waitForTimeout(600);
check("paid: thank-you and the receipt", (await p2.locator("[data-pay-paid]").count()) === 1 && /Paid ✓/.test((await p2.locator("[data-pay-paid]").textContent()) ?? "") && ((await p2.locator("[data-pay-paid] a").getAttribute("href")) ?? "").includes("/api/pdf/receipt/"));
await p2.screenshot({ path: `${shots}/pay-page-paid.png` });
await pub.browser.close();

// The invoice page's pasted link obeys the same rule.
await cleanupDb();
const s2 = (await api("/api/e2e/stage", { stage: "ready" })).json;
await sql("update public.invoices set sent_at = now() where job_id = $1 and kind = 'proforma'", [s2.jobId]);
const acc = await browserFor("accounts", { viewport: { width: 1500, height: 1300 } });
await acc.page.goto(`${base}/jobs/${s2.jobId}/invoice`, { waitUntil: "load" });
await acc.page.waitForTimeout(1500);
await acc.page.locator("[data-payment-link-box] summary").click();
await acc.page.locator('[data-payment-link-box] input[name="payment_link_url"]').fill("https://www.network.ae/en/offers");
await acc.page.locator("[data-payment-link-box] button[type=submit]").click();
await acc.page.waitForURL((u) => /error=|message=/.test(u.toString()), { timeout: 30000 });
check("the invoice page refuses a non-payment link too", /doesn%27t\+look\+like\+a\+payment\+link|doesn't look like a payment link/i.test(decodeURIComponent(acc.page.url())), decodeURIComponent(acc.page.url()).slice(-120));
await acc.browser.close();

await cleanupDb();
process.exit(summary() ? 1 : 0);
