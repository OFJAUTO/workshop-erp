// 17 November 2026, Section 1: SUPPLIER ADVANCE - THE PROOF BELONGS TO THE PAYMENT (the ARABIAN GULF MECHANICAL CENTRE
// case: "This LPO no longer exists" when attaching the proof of an advance on Supplier payments). Signed in as accounts.
//  A. An advance to a supplier with NO LPO, its proof picked before Record: the proof sits on the SPAY payment.
//  B. A payment recorded with no proof takes one later, straight onto the payment (history "Proof of payment added").
//  C. Correct this payment on an advance (no LPO) offers the proof box.
//  D. An advance MAY name an LPO; the link follows the LPO when its parts moved to a new LPO of the same supplier,
//     and when the LPO is cancelled with nothing to follow it stays with the supplier, unlinked, and says so.
//  E. Only accounts and the owner send a payment proof (the parts desk is refused).
// TEST only.  node --env-file=.env.test.local tests/browser/test-s17-1-advance-proof.mjs
import fs from "node:fs";
import path from "node:path";
import { base, browserFor, cleanupDb, cookieHeader, doorUpload, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-17-advance-proof";
fs.mkdirSync(OUT, { recursive: true });
const until = async (fn, tries = 60, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const text = async (page, sel) => (((await page.locator(sel).first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim());
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
const shots = async (page, el, name) => {
  for (const [w, h] of [[1440, 1000], [800, 1280]]) {
    await page.setViewportSize({ width: w, height: h });
    await sleep(250);
    await (el ?? page).screenshot({ path: path.join(OUT, `${name}-${w}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
};

async function payAdvance(page, supId, amount, { proof = false, forPo = null } = {}) {
  await go(page, `${base}/supplier-payments?supplier=${supId}&v=${Date.now()}#pay`);
  const box = page.locator("[data-supplier-pay-box]").first();
  await box.waitFor({ timeout: 30000 });
  if (proof) {
    await box.locator("[data-pay-proof]").setInputFiles({ name: "slip.pdf", mimeType: "application/pdf", buffer: PDF });
    await until(async () => (await box.locator("[data-queued-proof]").textContent())?.includes("Proof ready"), 60, 500);
  }
  await box.locator("[data-supplier-pay-amount]").fill(String(amount));
  await box.locator("[data-pay-method] label").filter({ hasText: /Bank transfer/ }).first().click();
  await box.locator("[data-supplier-pay-excess] label").filter({ hasText: /Advance with/ }).first().click();
  if (forPo) await box.locator("[data-advance-for-po]").selectOption(forPo);
  await box.locator("[data-supplier-pay-save]").click();
  await page.locator("[data-confirm-yes-money]").click();
  await box.locator("[data-supplier-pay-done], [data-supplier-pay-error]").first().waitFor({ timeout: 30000 });
  return { box, words: await text(page, "[data-supplier-pay-done], [data-supplier-pay-error]") };
}

let restorePart = null;
try {
  cleanupDb();
  const sup = (await sql("insert into public.suppliers (name, vat_registered, trn) values ('E2E Gulf Mechanical Centre', false, null) returning id"))[0].id;
  const acc = await browserFor("accounts", { viewport: { width: 1440, height: 1000 } });

  // A. An advance, no LPO, the proof picked BEFORE Record.
  const a = await payAdvance(acc.page, sup, "5030.55", { proof: true });
  const payA = await until(async () => (await sql("select id, number, proof_path, excess_kind, advance_for_po_id from public.supplier_payments where supplier_id = $1 and status = 'recorded' order by created_at desc limit 1", [sup]))[0]);
  check("A1: the advance of AED 5,030.55 is recorded with no LPO", !!payA && payA.excess_kind === "advance" && !payA.advance_for_po_id, `${a.words} ${JSON.stringify(payA)}`);
  check("A2: its proof sits on THE PAYMENT (supplier-payments/pay/<SPAY id>/…)", !!payA?.proof_path && payA.proof_path.startsWith(`supplier-payments/pay/${payA.id}/`), payA?.proof_path ?? "none");
  check("A3: no \"This LPO no longer exists\" and no file left unsent", !(await acc.page.locator("[data-queued-state='stopped']").count()) && !/no longer exists/i.test(await acc.page.locator("body").textContent()));
  await shots(acc.page, acc.page.locator("[data-sp-pay-card]").first(), "a-advance-recorded-with-proof");

  // B. A payment with no proof takes one later, straight onto the payment.
  await payAdvance(acc.page, sup, "100");
  const payB = await until(async () => (await sql("select id, number, proof_path from public.supplier_payments where supplier_id = $1 and status = 'recorded' and amount_aed = 100", [sup]))[0]);
  check("B1: recorded without a proof", !!payB && !payB.proof_path);
  const up = await doorUpload({ target: "supplier_pay_proof", scopeId: payB.id, contentType: "application/pdf", bytes: PDF, cookie: await cookieHeader("accounts") });
  const afterB = await until(async () => { const r = (await sql("select proof_path, edit_history from public.supplier_payments where id = $1", [payB.id]))[0]; return r?.proof_path ? r : null; });
  check("B2: the late proof joins the payment by itself", up.ok && !!afterB?.proof_path?.startsWith(`supplier-payments/pay/${payB.id}/`), JSON.stringify(up.json));
  check("B3: its history says \"Proof of payment added\"", (afterB?.edit_history ?? []).some((e) => /Proof of payment added/.test(e.remark ?? "")));

  // C. Correct this payment on an advance offers the proof box (it had none: advances paid no LPO).
  await go(acc.page, `${base}/supplier-payments?supplier=${sup}`);
  const cp = acc.page.locator(`[data-correct-payment="${payA.number}"]`).first();
  await cp.locator("[data-correct-open]").click();
  check("C1: Correct this payment on an advance has the proof box, tied to the payment", (await cp.locator(`[data-pay-proof-for="${payA.id}"]`).count()) === 1);
  await shots(acc.page, cp, "c-correct-advance-proof");

  // D. An advance for an LPO follows it; a cancelled one stays with the supplier.
  const lpoA = (await sql("insert into public.purchase_orders (number, kind, supplier_id, supplier_name, status, total_cost_aed, supplier_invoice_status) values ('LPO-E2E-ADV-1', 'supplier', $1, 'E2E Gulf Mechanical Centre', 'ordered', 400, 'none') returning id", [sup]))[0].id;
  const d1 = await payAdvance(acc.page, sup, "420", { forPo: lpoA });
  const payD = await until(async () => (await sql("select id, number, advance_for_po_id from public.supplier_payments where supplier_id = $1 and status = 'recorded' and amount_aed = 420", [sup]))[0]);
  check("D1: the advance names LPO-E2E-ADV-1 (chosen, optional)", payD?.advance_for_po_id === lpoA, `${d1.words} ${JSON.stringify(payD)}`);
  // The parts move to a new LPO of the same supplier, the first is cancelled.
  const lpoB = (await sql("insert into public.purchase_orders (number, kind, supplier_id, supplier_name, status, total_cost_aed, supplier_invoice_status) values ('LPO-E2E-ADV-2', 'supplier', $1, 'E2E Gulf Mechanical Centre', 'ordered', 400, 'none') returning id", [sup]))[0].id;
  const borrowed = (await sql("select id, po_id from public.part_items where is_active order by created_at desc limit 1"))[0];
  const part = borrowed?.id;
  restorePart = borrowed ?? null;
  if (part) {
    await sql("insert into public.purchase_order_lines (po_id, part_item_id, position, description, quantity, unit_cost) values ($1, $2, 1, 'E2E LINK PART', 1, 400)", [lpoA, part]);
    await sql("update public.part_items set po_id = $1 where id = $2", [lpoB, part]);
  }
  await sql("update public.purchase_orders set status = 'cancelled' where id = $1", [lpoA]);
  await go(acc.page, `${base}/supplier-payments?supplier=${sup}`);
  const moved = await until(async () => (await sql("select advance_for_po_id, edit_history from public.supplier_payments where id = $1", [payD.id]))[0]?.advance_for_po_id === lpoB);
  check("D2: the link followed to LPO-E2E-ADV-2 (where its parts now are)", !!moved);
  check("D3: the payment history says LPO-E2E-ADV-1 → LPO-E2E-ADV-2", /LPO-E2E-ADV-1 → LPO-E2E-ADV-2/.test(await text(acc.page, `[data-sp-history-row="${payD.number}"]`)) || /For LPO-E2E-ADV-2/.test(await text(acc.page, `[data-sp-history-row="${payD.number}"]`)));
  await sql("update public.purchase_orders set status = 'cancelled' where id = $1", [lpoB]);
  await go(acc.page, `${base}/supplier-payments?supplier=${sup}`);
  const un = await until(async () => { const r = (await sql("select advance_for_po_id, edit_history from public.supplier_payments where id = $1", [payD.id]))[0]; return r && !r.advance_for_po_id ? r : null; });
  check("D4: its LPO cancelled with nothing to follow: the advance stays with the supplier, unlinked", !!un && (un.edit_history ?? []).some((e) => /cancelled: the advance stays with/.test(e.remark ?? "")));
  await go(acc.page, `${base}/supplier-payments?supplier=${sup}`);
  const row = await text(acc.page, `[data-sp-history-row="${payD.number}"]`);
  check("D5: the screen says so (\"Kept with the supplier (no LPO)\" and the cancelled LPO)", /Kept with the supplier \(no LPO\)/.test(row) && /LPO-E2E-ADV-2/.test(row), row.slice(0, 300));
  await shots(acc.page, acc.page.locator(`[data-sp-history-row="${payD.number}"]`).first(), "d-advance-unlinked-after-cancel");
  await acc.browser.close();

  // E. The parts desk cannot send a payment proof.
  const refused = await doorUpload({ target: "supplier_pay_proof", scopeId: payB.id, contentType: "application/pdf", bytes: PDF, cookie: await cookieHeader("parts") });
  check("E1: the parts desk is refused (accounts and the owner only)", !refused.ok && refused.status === 403, `${refused.stage} ${refused.status}`);
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  if (restorePart) await sql("update public.part_items set po_id = $1 where id = $2", [restorePart.po_id, restorePart.id]).catch(() => null);
  await sql("delete from public.purchase_order_lines where description = $1", ["E2E LINK PART"]).catch(() => null);
  await sql("delete from public.zoho_outbox where kind = 'supplierpay' and record_id in (select id from public.supplier_payments where supplier_name like 'E2E%')").catch(() => null);
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
