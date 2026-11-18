// 19 November 2026, Section 4: PURCHASE RETURNS AND SUPPLIER CREDIT NOTES - the Sparein case on TEST.
//   Invoice 17098 (11 Nov): CLIP W TYPE ×10 @10, FRONT BUMPER 520, SIDE MARKER LAMP LH 85, REINFORCEMENT, BUMPER 330
//     = 1,035.00 + VAT 51.75 = 1,086.75.
//   Credit note 1857 (12 Nov): FRONT BUMPER 520 + REINFORCEMENT 330 = 850.00 + VAT 42.50 = 892.50.
//   Invoice 17174 (12 Nov): the replacement FRONT BUMPER 985.00 + VAT 49.25 = 1,034.25.  Net owed: 1,228.50.
//  A. The parts desk: "Return to supplier" on the LPO - bumper and reinforcement back (wrong part), ONE replacement
//     line on the same LPO at 985 (+135.00 against the 850 that went back: the "cost went up" approval).
//  B. A part with the technician cannot go back until he hands it back.
//  C. Accounts: "Enter the supplier's credit note" 1857 with both parts, VAT 42.50 = 892.50.
//  D. The replacement invoice 17174 on the same LPO; the LPO shows invoiced, credited, re-invoiced and the net 1,228.50.
//  E. What we owe Sparein follows (the pay box) and the job's cost has the replacement, not the returned parts.
// TEST only.  node --env-file=.env.test.local tests/browser/test-s19-4-returns.mjs
import fs from "node:fs";
import path from "node:path";
import { api, base, browserFor, cleanupDb, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-19-purchase-returns";
fs.mkdirSync(OUT, { recursive: true });
const until = async (fn, tries = 60, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const text = async (loc) => (((await loc.first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim());
const shots = async (page, el, name) => {
  for (const [w, h] of [[1440, 1000], [800, 1280]]) {
    await page.setViewportSize({ width: w, height: h });
    await sleep(300);
    await (el ?? page).screenshot({ path: path.join(OUT, `${name}-${w}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
};

const PARTS = [
  { name: "CLIP W TYPE", qty: 10, unit: 10 },
  { name: "FRONT BUMPER", qty: 1, unit: 520, pn: "SIN6BU44RXFAB" },
  { name: "SIDE MARKER LAMP LH", qty: 1, unit: 85 },
  { name: "REINFORCEMENT, BUMPER", qty: 1, unit: 330, pn: "68293705AC" },
];

try {
  cleanupDb();
  const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const JOB = seed.jobId;
  const sup = (await sql("insert into public.suppliers (name, trn, vat_registered) values ('E2E SPAREIN AUTOMOTIVE L.L.C', '100457186300003', true) returning id"))[0]?.id ?? (await sql("select id from public.suppliers where name = 'E2E SPAREIN AUTOMOTIVE L.L.C' limit 1"))[0].id;
  const po = (await sql("insert into public.purchase_orders (number, kind, job_id, supplier_id, supplier_name, status, total_cost_aed, supplier_invoice_status, supplier_invoice_number, supplier_invoice_date, supplier_invoice_amount, supplier_invoice_vat_aed) values ('LPO-E2E-SP1-1', 'supplier', $1, $2, 'E2E SPAREIN AUTOMOTIVE L.L.C', 'received', 1035, 'received', 'E2E-17098', '2026-11-11', 1035, 51.75) returning id", [JOB, sup]))[0].id;
  await sql("update public.purchase_orders set supplier_invoice_path = 'e2e/sparein-17098.pdf' where id = $1", [po]);
  const ids = {};
  let pos = 1;
  for (const p of PARTS) {
    const id = (await sql("insert into public.part_items (job_id, description, part_number, supplier, quantity, confirmed_quantity, received_qty, cost_aed, order_status, po_id, priced_at, is_active) values ($1, $2, $3, 'E2E SPAREIN AUTOMOTIVE L.L.C', $4, $4, $4, $5, 'received', $6, now(), true) returning id", [JOB, p.name, p.pn ?? null, p.qty, p.unit, po]))[0].id;
    const line = (await sql("insert into public.purchase_order_lines (po_id, part_item_id, position, description, part_number, quantity, received_qty, unit_cost) values ($1, $2, $3, $4, $5, $6, $6, $7) returning id", [po, id, pos++, p.name, p.pn ?? null, p.qty, p.unit]))[0].id;
    await sql("update public.part_items set po_line_id = $1 where id = $2", [line, id]);
    ids[p.name] = id;
  }
  // B setup: the lamp is with the technician.
  await sql("update public.part_items set issue_status = 'confirmed' where id = $1", [ids["SIDE MARKER LAMP LH"]]);

  // A. The parts desk.
  const parts = await browserFor("parts", { viewport: { width: 1440, height: 1000 } });
  await go(parts.page, `${base}/parts/orders/${po}`);
  await parts.page.locator("[data-return-open]").click();
  const win = parts.page.locator("[data-return-window]");
  await win.waitFor({ timeout: 30000 });
  const lamp = win.locator('[data-return-part="SIDE MARKER LAMP LH"]');
  check("B1: a part with the technician cannot be ticked, and says why", (await lamp.locator("[data-return-tick]").isDisabled()) && /hands it back first/.test(await text(lamp.locator("[data-return-with-tech]"))));
  check("A0: nothing is pre-selected (no reason, no replacement choice)", (await win.locator("[data-return-reason]:checked").count()) === 0 && (await win.locator("[data-return-replacement]:checked").count()) === 0);
  await win.locator('[data-return-tick="FRONT BUMPER"]').check();
  await win.locator('[data-return-tick="REINFORCEMENT, BUMPER"]').check();
  await win.locator('label:has([data-return-reason="wrong_part"])').click();
  await win.locator('label:has([data-return-replacement="yes"])').click();
  await win.locator("[data-return-replacement-name]").fill("FRONT BUMPER");
  await win.locator("[data-return-replacement-price]").fill("985");
  await until(async () => /\+135/.test(await text(win.locator("[data-return-replacement-words]"))), 20, 200);
  check("A1: the window says what goes back and that the replacement costs more", /Going back: AED 850\.00\. The replacement costs AED \+135\.00 more: it goes for approval/.test(await text(win.locator("[data-return-replacement-words]"))), await text(win.locator("[data-return-replacement-words]")));
  await shots(parts.page, win.locator("div").first(), "a-return-to-supplier");
  await win.locator("[data-return-save]").click();
  await win.locator("[data-return-done], [data-return-error]").first().waitFor({ timeout: 60000 });
  if (await win.locator("[data-return-error]").count()) throw new Error("return refused: " + (await text(win.locator("[data-return-error]"))));
  const done = await text(win.locator("[data-return-done]"));
  check("A2: 2 parts going back (AED 850.00, credit awaited) with their PR numbers", /^2 parts going back to E2E SPAREIN AUTOMOTIVE L\.L\.C \(AED 850\.00, credit awaited\)/.test(done), done.slice(0, 200));
  check("A3: the replacement line is on the SAME LPO and goes for approval (+135.00)", /replacement line was added to LPO-E2E-SP1-1: FRONT BUMPER – Replaces returned FRONT BUMPER \+ REINFORCEMENT, BUMPER/.test(done) && /\+135\.00/.test(done), done.slice(150, 420));
  const ret = await sql("select description, disposition, is_active from public.part_items where id = any($1::uuid[])", [[ids["FRONT BUMPER"], ids["REINFORCEMENT, BUMPER"]]]);
  check("A4: the returned parts leave the job (credit awaited)", ret.length === 2 && ret.every((r) => r.disposition === "return_pending" && r.is_active === false));
  const rep = (await sql("select id, cost_aed::float as cost, po_id from public.part_items where replaced_part_id = $1", [ids["FRONT BUMPER"]]))[0];
  check("A5: the replacement part is on the job at the returned cost (850) until approved", !!rep && rep.cost === 850 && rep.po_id === po, JSON.stringify(rep ?? {}));
  const change = rep ? (await sql("select status, after from public.part_changes where part_item_id = $1", [rep.id]))[0] : null;
  check("A6: the \"cost went up\" approval is waiting (985.00)", change?.status === "pending" && Number(change?.after?.cost) === 985, JSON.stringify(change ?? {}).slice(0, 200));
  await parts.page.locator("[data-return-ok]").click();
  await parts.browser.close();

  // C. Accounts enter the credit note.
  const acc = await browserFor("accounts", { viewport: { width: 1440, height: 1000 } });
  await go(acc.page, `${base}/parts/orders/${po}`);
  await acc.page.locator("[data-credit-note-open]").click();
  const cw = acc.page.locator("[data-credit-note-window]");
  await cw.waitFor({ timeout: 30000 });
  await cw.locator('[data-credit-note-tick="FRONT BUMPER"]').check();
  await cw.locator('[data-credit-note-tick="REINFORCEMENT, BUMPER"]').check();
  await cw.locator("[data-credit-note-number]").fill("E2E-1857");
  await cw.locator("[data-credit-note-date]").fill("");
  await cw.locator("[data-credit-note-date]").pressSequentially("12/11/2026");
  check("C1: the credit note adds up: 850.00 + VAT 42.50 = 892.50", (await text(cw.locator("[data-credit-note-total]"))) === "Before VAT AED 850.00 + VAT 42.50 = AED 892.50", await text(cw.locator("[data-credit-note-total]")));
  await shots(acc.page, cw.locator("div").first(), "c-credit-note");
  await cw.locator("[data-credit-note-save]").click();
  await cw.locator("[data-credit-note-done]").waitFor({ timeout: 60000 });
  check("C2: saved: 892.50 off what we owe the supplier", /Credit note E2E-1857 saved: AED 850\.00 \+ VAT 42\.50 = AED 892\.50 off what we owe/.test(await text(cw.locator("[data-credit-note-done]"))), await text(cw.locator("[data-credit-note-done]")));
  const prs = await sql("select status, credit_number, (credit_net_aed + credit_vat_aed)::float as total from public.purchase_returns where po_id = $1 and is_active", [po]);
  check("C3: both returns credited with 1857 (850 + 42.50 split by part)", prs.length === 2 && prs.every((r) => r.status === "credited" && r.credit_number === "E2E-1857") && Math.abs(prs.reduce((a, r) => a + r.total, 0) - 892.5) < 0.01, JSON.stringify(prs));
  const vc = await sql("select count(*)::int as n from public.zoho_outbox where kind = 'vendorcredit' and record_id = any($1::uuid[])", [[ids["FRONT BUMPER"], ids["REINFORCEMENT, BUMPER"]]]);
  check("C4: Zoho gets the supplier credit for each part (against the bill)", vc[0].n === 2, String(vc[0].n));
  await acc.page.locator("[data-credit-note-ok]").click();

  // D. The replacement invoice 17174 on the same LPO.
  const repLine = (await sql("select id from public.purchase_order_lines where part_item_id = $1", [rep.id]))[0].id;
  await sql("insert into public.lpo_invoices (po_id, supplier_id, supplier_name, number, invoice_date, amount_aed, vat_aed, lines, origin) values ($1, $2, 'E2E SPAREIN AUTOMOTIVE L.L.C', 'E2E-17174', '2026-11-12', 985, 49.25, $3::jsonb, 'added')", [po, sup, JSON.stringify([{ line_id: repLine, qty: 1 }])]);
  await go(acc.page, `${base}/parts/orders/${po}?v=2`);
  const net = acc.page.locator("[data-lpo-net]");
  await net.waitFor({ timeout: 30000 });
  const words = await text(net);
  check("D1: the LPO shows invoiced 1,086.75, credited 892.50, re-invoiced 1,034.25", /Invoiced\s*AED 1,086\.75/.test(words) && /Credited\s*− AED 892\.50/.test(words) && /Re-invoiced \(replacements\)\s*AED 1,034\.25/.test(words), words);
  check("D2: and the net owed on the LPO: AED 1,228.50", (await text(net.locator("[data-lpo-net-total]"))) === "AED 1,228.50", await text(net.locator("[data-lpo-net-total]")));
  await shots(acc.page, net, "d-lpo-net");
  // E. What we owe the supplier and the job's cost.
  const box = await text(acc.page.locator("[data-supplier-pay-box]"));
  check("E1: the supplier pay box owes 194.25 on 17098 (after the credit) + 1,034.25 on 17174 = 1,228.50", /194\.25/.test(box) && /1,034\.25/.test(box) && /less credit AED 892\.50/.test(box), box.slice(0, 300));
  await shots(acc.page, acc.page.locator("[data-supplier-pay-box]"), "e-supplier-owed");
  const cost = (await sql("select coalesce(sum(cost_aed * coalesce(confirmed_quantity, quantity)), 0)::float as c from public.part_items where po_id = $1 and is_active", [po]))[0].c;
  check("E2: the job's cost for these parts: clips 100 + lamp 85 + replacement 850 (985 once approved); the returned 850 has left", Math.abs(cost - 1035) < 0.01, String(cost));
  await acc.browser.close();
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  await sql("update public.lpo_invoices set is_active = false where number = 'E2E-17174'").catch(() => null);
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
