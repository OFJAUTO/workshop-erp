// 13 November 2026, Section 7: an estimate accepted (no deposit asked) tells the parts desk ORDER PARTS at once; with a
// deposit asked it waits for the money; the parts desk orders from its estimate page; "Proformas waiting for payment".
// TEST only.   node --env-file=.env.test.local tests/browser/test-s13-7-estimate-order.mjs
import fs from "node:fs";
import { api, base, browserFor, cleanupDb, makeChecks, pageReady, sleep } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-13-estimate-order";
fs.mkdirSync(OUT, { recursive: true });
async function q(text, params = []) {
  const r = await api("/api/e2e/sql", { sql: text, params });
  if (r.status !== 200) throw new Error(`SQL failed: ${JSON.stringify(r.json ?? r.text).slice(0, 300)}\n${text.slice(0, 200)}`);
  return r.json.rows ?? [];
}
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const txt = async (loc) => ((await loc.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
const tok = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
const made = [];

async function newEstimate(label) {
  const cust = "22222222-0000-4000-8000-00000000e301";
  const car = "22222222-0000-4000-8000-00000000e302";
  const adv = (await q("select id from public.staff where role_id = 'service_advisor' and is_active order by created_at limit 1"))[0].id;
  const token = tok();
  const est = (await q("insert into public.quotations (kind, customer_id, vehicle_id, status, validity_days, vat_percent, total_aed, token, created_by, updated_by) values ('estimate', $1, $2, 'draft', 7, 5, 1050, $3, $4, $4) returning id, number", [cust, car, token, adv]))[0];
  made.push(est.id);
  await q("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, unit_cost, markup_percent, unit_price, line_total, priced_at, supplier_text, availability, delivery_days) values ($1, 1, 'part', $2, 'manual', 1, 700, 50, 1000, 1000, now(), 'E2E SUPPLIER', 'to_order', 2)", [est.id, `${label} BRAKE DISC`]);
  await q("update public.quotations set status = 'sent', sent_at = now() where id = $1", [est.id]);
  return { ...est, token };
}
async function accept(token) {
  const fd = new FormData();
  fd.set("action", "approve"); fd.set("approver_name", "E2E Customer"); fd.set("agree", "on");
  return fetch(`${base}/api/quote/${token}`, { method: "POST", body: fd, redirect: "manual" });
}

try {
  cleanupDb();
  const st = await api("/api/e2e/stage", { stage: "approved" });
  if (st.status !== 200) throw new Error(`stage: ${st.status}`);

  // 1. No deposit asked: accepted = ORDER PARTS at once (parts desk and the advisor).
  const e1 = await newEstimate("E2E S7A");
  await accept(e1.token);
  const status1 = await until(async () => (await q("select status from public.quotations where id = $1", [e1.id]))[0]?.status === "approved", 30);
  check("the customer accepted the estimate", !!status1);
  const bell = await until(async () => (await q("select title, href from public.notifications n join public.staff s on s.id = n.staff_id where s.role_id = 'parts' and n.title like $1 limit 1", [`ORDER PARTS: ${e1.number}%`]))[0], 30);
  check("the parts desk gets ORDER PARTS: E-… · car · 1 part · no deposit asked", !!bell && /1 part · no deposit asked/.test(bell.title), bell?.title);
  check("it opens the estimate's parts with the order button", /\/parts\/estimate\/.+#order-parts/.test(bell?.href ?? ""), bell?.href);

  // The parts desk's dashboard and the estimate page.
  const p = await browserFor("parts", { viewport: { width: 1366, height: 900 } });
  await p.page.goto(`${base}/dashboard`, { waitUntil: "domcontentloaded" });
  await pageReady(p.page);
  check("the parts dashboard shows Ready to order", /Ready to order/.test(await txt(p.page.locator("[data-ready-to-order]"))));
  await p.page.screenshot({ path: `${OUT}/s7-ready-to-order-1366.png` });
  await p.page.goto(`${base}/parts/estimate/${e1.id}#order-parts`, { waitUntil: "domcontentloaded" });
  await pageReady(p.page);
  check("the parts desk sees Order parts now", (await p.page.locator("[data-desk-order-state='ready'] [data-order-parts-now]").count()) === 1);
  await p.page.locator("[data-order-parts-now]").click();
  const lpo = await until(async () => (await q("select po.number, po.status from public.purchase_orders po join public.jobs j on j.id = po.job_id where j.estimate_id = $1", [e1.id]))[0], 40);
  check("the parts desk ordered: a held job with an LPO for approval", !!lpo, JSON.stringify(lpo) + " " + (await txt(p.page.locator("[data-desk-order-state]"))));

  // 2. A deposit asked: waits for the money ("Approved: waiting for deposit"), no ORDER PARTS yet.
  const e2 = await newEstimate("E2E S7B");
  const by = (await q("select created_by from public.quotations where id = $1", [e2.id]))[0].created_by;
  await q("insert into public.invoices (kind, number, customer_id, vehicle_id, status, issued_at, subtotal_aed, taxable_aed, vat_aed, total_aed, estimate_id, deposit_for_quotation_id, token, created_by, updated_by) values ('proforma', $1, $2, $3, 'issued', now(), 476.19, 476.19, 23.81, 500, $4, $4, $5, $6, $6)", [`E2E-PRO-S7-${Date.now() % 100000}`, "22222222-0000-4000-8000-00000000e301", "22222222-0000-4000-8000-00000000e302", e2.id, tok(), by]);
  await accept(e2.token);
  await until(async () => (await q("select status from public.quotations where id = $1", [e2.id]))[0]?.status === "approved", 30);
  await sleep(1500);
  const early = (await q("select count(*)::int n from public.notifications where title like $1", [`ORDER PARTS: ${e2.number}%`]))[0]?.n;
  check("deposit asked: no ORDER PARTS before the money", early === 0, String(early));
  await p.page.goto(`${base}/parts/estimate/${e2.id}`, { waitUntil: "domcontentloaded" });
  await pageReady(p.page);
  check("the parts desk sees 'Approved: waiting for deposit'", /waiting for deposit/.test(await txt(p.page.locator("[data-desk-order-state='waiting_deposit']"))));
  await p.page.screenshot({ path: `${OUT}/s7-waiting-for-deposit-1366.png` });
  await p.browser.close();

  // 3. Accounts: the proforma is on "Proformas waiting for payment".
  const a = await browserFor("accounts", { viewport: { width: 800, height: 1280 } });
  await a.page.goto(`${base}/invoices?show=proforma_waiting`, { waitUntil: "domcontentloaded" });
  await pageReady(a.page);
  check("Invoices and payments has 'Proformas waiting for payment'", /Proformas waiting for payment/.test(await txt(a.page.locator("main"))));
  await a.page.screenshot({ path: `${OUT}/s7-proformas-waiting-800.png` });
  await a.browser.close();
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  for (const id of made) {
    await api("/api/e2e/sql", { sql: "update public.invoices set status = 'void', is_active = false where estimate_id = $1", params: [id] }).catch(() => null);
    await api("/api/e2e/sql", { sql: "update public.quotations set is_active = false, deleted_at = now() where id = $1", params: [id] }).catch(() => null);
  }
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
