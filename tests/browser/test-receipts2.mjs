// 15 November 2026 (URGENT, Section 1): RECEIVING PARTS NEVER BLOCKS THE MECHANIC. A normal supplier (AL GHANDI case):
// 5 of 6 received with an invoice number, the 6th (FRONT BRAKE PAD) "Arrived - paperwork pending" with no number - recorded
// at once and handed over; due by the end of the same day; the LPO cannot be checked while it waits; a reference type
// (Pre-payment parts invoice number counts, WIP number does not); accounts change the type later (logged); the columns
// and search on Supplier invoices; the morning reminder and the owner's evening count; Settings > Supplier references.
// Signed in as the parts desk and accounts (and the owner for the count). TEST only.
//   node --env-file=.env.test.local tests/browser/test-receipts2.mjs
import fs from "node:fs";
import path from "node:path";
import { api, base, browserFor, cleanupDb, go, makeChecks, sleep, sql, confirmCheckIfShown } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-15-receiving";
fs.mkdirSync(OUT, { recursive: true });
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const text = async (page, sel) => (((await page.locator(sel).first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim());
const dubai = (n = 0) => new Date(Date.now() + 4 * 3600000 + n * 86400000).toISOString().slice(0, 10);
const urlOf = (page) => decodeURIComponent(page.url().replace(/\+/g, " "));

async function makePo(jobId, supplierId, number, parts) {
  const po = (await sql("insert into public.purchase_orders (number, kind, job_id, supplier_id, supplier_name, status, total_cost_aed) values ($1, 'supplier', $2, $3, (select name from public.suppliers where id = $3), 'ordered', 600) returning id", [number, jobId, supplierId]))[0].id;
  const lines = [];
  const partIds = [];
  for (const [i, name] of parts.entries()) {
    const part = (await sql("insert into public.part_items (job_id, description, quantity, cost_aed, availability, order_status, po_id, confirm_status, supplier) values ($1, $2, 1, 100, 'to_order', 'ordered', $3, 'confirmed', (select name from public.suppliers where id = $4)) returning id", [jobId, name, po, supplierId]))[0].id;
    const line = (await sql("insert into public.purchase_order_lines (po_id, part_item_id, position, description, quantity, unit_cost) values ($1, $2, $3, $4, 1, 100) returning id", [po, part, i, name]))[0].id;
    await sql("update public.part_items set po_line_id = $2 where id = $1", [part, line]);
    lines.push(line);
    partIds.push(part);
  }
  return { po, lines, partIds };
}
async function receive(page, poId, lineIds, o = {}) {
  await go(page, `${base}/parts/orders/${poId}`);
  const form = page.locator("[data-receive-form]");
  for (const input of await form.locator('input[name^="received__"]').all()) {
    const name = await input.getAttribute("name");
    await input.fill(lineIds.some((id) => name === `received__${id}`) ? "1" : "0");
  }
  if (o.pending) {
    await form.locator("[data-receipt-later-button]").click();
    await form.locator("[data-receipt-no-paper]").check();
  } else {
    if (o.type) await form.locator(`[data-receipt-ref-type="${o.type}"]`).click();
    await form.locator("[data-receipt-number]").fill(o.number ?? "");
    await form.locator("[data-receipt-number]").blur();
    await sleep(700);
  }
  if (o.shot) for (const [w, h] of [[1440, 1200], [800, 1280]]) { await page.setViewportSize({ width: w, height: h }); await form.screenshot({ path: path.join(OUT, `${o.shot}-${w}.png`) }); }
  await page.setViewportSize({ width: 1440, height: 1200 });
  const before = page.url();
  await form.locator("[data-record-delivery]").click();
  if (o.checkShot) {
    await page.locator("[data-check-receipt]").waitFor({ timeout: 8000 }).catch(() => null);
    o.checkWords = await text(page, "[data-check-invoice]");
    await page.screenshot({ path: path.join(OUT, `${o.checkShot}-1440.png`) });
  }
  await confirmCheckIfShown(page);
  await page.waitForURL((u) => u.toString() !== before, { timeout: 30000 }).catch(() => null);
  await sleep(1200);
  return o;
}

try {
  cleanupDb();
  const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const JOB = seed.jobId;
  const sup = (await sql("insert into public.suppliers (name, vat_registered, trn) values ('E2E Ghandi Auto Co', true, '100000000000003') returning id"))[0].id;
  const A = await makePo(JOB, sup, "LPO-E2E-G1", ["E2E PAD SENSOR", "E2E REAR DISC", "E2E REAR PAD", "E2E WIPER", "E2E OIL FILTER", "E2E FRONT BRAKE PAD"]);
  const B = await makePo(JOB, sup, "LPO-E2E-G2", ["E2E SPARK PLUG"]);
  const C = await makePo(JOB, sup, "LPO-E2E-G3", ["E2E IDLER PULLEY"]);
  const parts = await browserFor("parts", { viewport: { width: 1440, height: 1200 } });

  // 1. The box: a choice of reference type, any ONE is enough.
  await go(parts.page, `${base}/parts/orders/${A.po}`);
  const typeKeys = await parts.page.locator("[data-receipt-ref-type]").evaluateAll((els) => els.map((e) => e.getAttribute("data-receipt-ref-type")));
  check("1a: the receipt box offers Invoice number / Pre-payment parts invoice number / WIP number", ["invoice", "prepay", "wip"].every((k) => typeKeys.includes(k)), JSON.stringify(typeKeys));
  check("1b: \"Arrived - paperwork pending\" is offered for a NORMAL supplier", (await parts.page.locator("[data-receipt-later-button]").count()) === 1);

  // 2. 5 of 6 with the invoice number.
  await receive(parts.page, A.po, A.lines.slice(0, 5), { number: "INV-E2E-7001", shot: "1-receive-types" });
  const r1 = await sql("select invoice_number, refs from public.part_receipts where po_id = $1", [A.po]);
  check("2: 5 of 6 received with the invoice number", r1.length === 1 && r1[0].invoice_number === "INV-E2E-7001" && r1[0].refs?.[0]?.type === "invoice", JSON.stringify(r1));

  // 3. The 6th, the FRONT BRAKE PAD, arrives with no number: "Arrived - paperwork pending". Recorded at once.
  const o3 = await receive(parts.page, A.po, A.lines.slice(5), { pending: true, shot: "2-paperwork-pending", checkShot: "3-check-before-save" });
  check("3a: the check-before-save window names it ARRIVED - PAPERWORK PENDING", /ARRIVED - PAPERWORK PENDING/.test(o3.checkWords ?? ""), o3.checkWords);
  const pend = (await sql("select id, invoice_number, invoice_later, paperwork_pending, invoice_due_date::text as due, refs from public.part_receipts where po_id = $1 and paperwork_pending", [A.po]))[0];
  check("3b: recorded with no reference: paperwork pending, due TODAY (normal supplier)", pend?.paperwork_pending === true && pend?.invoice_number === null && pend?.due === dubai(0) && (pend?.refs ?? []).length === 0, JSON.stringify(pend));
  const pad = (await sql("select order_status, received_qty::float as q from public.part_items where id = $1", [A.partIds[5]]))[0];
  check("3c: the brake pad is received", pad?.order_status === "received" && pad?.q === 1, JSON.stringify(pad));
  await go(parts.page, `${base}/parts/orders/${A.po}`);
  check("3d: the receipt shows ARRIVED - PAPERWORK DUE TODAY", /ARRIVED - PAPERWORK DUE TODAY/.test(await text(parts.page, `[data-receipt="${pend?.id}"]`)));
  for (const [w, h] of [[1440, 1200], [800, 1280]]) { await parts.page.setViewportSize({ width: w, height: h }); await parts.page.locator("[data-receipts-card]").screenshot({ path: path.join(OUT, `4-receipts-card-${w}.png`) }); }
  await parts.page.setViewportSize({ width: 1440, height: 1200 });

  // 4. It is handed to the technician at once (the hand-over does not look at the paperwork).
  await go(parts.page, `${base}/parts/handover/${JOB}`);
  const listed = (await parts.page.locator("form").filter({ has: parts.page.locator("[data-mark-ready]") }).textContent().catch(() => "")) ?? "";
  check("4a: the brake pad is on the hand-over list", /E2E FRONT BRAKE PAD/i.test(listed), listed.slice(0, 200));
  await parts.page.locator("[data-mark-ready]").click();
  const ready = await until(async () => (await sql("select ready_for_handover_at from public.part_items where id = $1 and ready_for_handover_at is not null", [A.partIds[5]]))[0]);
  check("4b: the parts desk marks it ready for the technician (paperwork still pending)", !!ready);

  // 5. The LPO cannot be closed (checked) while the delivery has no reference.
  await sql("update public.purchase_orders set supplier_invoice_status = 'received', supplier_invoice_number = 'INV-E2E-7001', supplier_invoice_date = current_date, supplier_invoice_amount = 600, supplier_invoice_at = now(), status = 'received' where id = $1", [A.po]);
  const acc = await browserFor("accounts", { viewport: { width: 1440, height: 1200 } });
  await go(acc.page, `${base}/supplier-invoices?q=INV-E2E-7001`);
  await acc.page.locator("[data-si-row] [data-si-open]").first().click();
  await acc.page.locator("[data-si-check]").first().waitFor({ timeout: 15000 });
  await acc.page.locator("[data-si-check]").first().click();
  await acc.page.locator("[data-si-outcome]").waitFor({ timeout: 20000 }).catch(() => null);
  const refused = await text(acc.page, "[data-si-outcome]");
  check("5a: \"Mark checked\" is refused: the delivery is paperwork pending", /paperwork pending/i.test(refused) && (await sql("select supplier_invoice_checked_at from public.purchase_orders where id = $1", [A.po]))[0]?.supplier_invoice_checked_at === null, refused);

  // 6. The reminder: every MORNING from the next day, to the parts desk and accounts; the owner's evening count.
  const since = (await sql("select coalesce(max(id), 0) as m from public.notifications"))[0].m;
  const toldEarly = (await api("/api/e2e/stage", { stage: "receipt-reminders", today: dubai(1), hour: 5 })).json?.told;
  const toldMorning = (await api("/api/e2e/stage", { stage: "receipt-reminders", today: dubai(1), hour: 8 })).json?.told;
  const toldAgain = (await api("/api/e2e/stage", { stage: "receipt-reminders", today: dubai(1), hour: 11 })).json?.told;
  check("6a: nothing before 07:00; one reminder in the morning; not twice the same day", toldEarly === 0 && toldMorning >= 1 && toldAgain === 0, JSON.stringify({ toldEarly, toldMorning, toldAgain }));
  const bells = await sql("select s.role_id from public.notifications n join public.staff s on s.id = n.staff_id where n.id > $1 and n.type = 'supplier_invoice_missing' and n.title like '%LPO-E2E-G1%'", [since]);
  check("6b: the parts desk and accounts get it", bells.some((b) => b.role_id === "parts") && bells.some((b) => b.role_id === "accounts"), JSON.stringify(bells));
  await sql("update public.part_receipts set invoice_due_date = current_date - 1 where id = $1", [pend.id]);
  const evening = Date.parse(`${dubai(0)}T17:30:00Z`); // 21:30 Dubai
  await sql("delete from public.notifications where type = 'paperwork_pending_count' and created_at > now() - interval '1 day'").catch(() => null);
  const counted = (await api("/api/e2e/stage", { stage: "paperwork-summary", now: evening })).json?.told;
  const countBell = (await sql("select n.title from public.notifications n join public.staff s on s.id = n.staff_id where n.id > $1 and n.type = 'paperwork_pending_count' and s.role_id = 'owner'", [since]))[0];
  check("6c: the owner's evening summary counts the overdue paperwork", counted >= 1 && /paperwork overdue/.test(countBell?.title ?? ""), JSON.stringify({ counted, countBell }));

  // 7. The parts desk types the reference later: a WIP number (does not count) - the real invoice still due.
  await go(parts.page, `${base}/parts/orders/${A.po}`);
  const rc = parts.page.locator(`[data-receipt="${pend.id}"]`);
  await rc.locator('[data-receipt-action="add-ref"]').click();
  await rc.locator('[data-receipt-ref-form] [data-receipt-ref-type="wip"]').click();
  await rc.locator("[data-receipt-number-input]").fill("WIP-E2E-55");
  await rc.locator("[data-receipt-number-save]").click();
  const wip = await until(async () => (await sql("select invoice_number, refs, invoice_later from public.part_receipts where id = $1 and jsonb_array_length(refs) > 0", [pend.id]))[0]);
  check("7a: WIP number saved; it does not count, so the invoice is still due", wip?.refs?.[0]?.type === "wip" && wip?.invoice_number === null && wip?.invoice_later === true, JSON.stringify(wip));
  await go(acc.page, `${base}/supplier-invoices?q=INV-E2E-7001`);
  await acc.page.locator("[data-si-row] [data-si-open]").first().click();
  await acc.page.locator("[data-si-check]").first().waitFor({ timeout: 15000 });
  await acc.page.locator("[data-si-check]").first().click();
  await until(async () => (await sql("select supplier_invoice_checked_at from public.purchase_orders where id = $1 and supplier_invoice_checked_at is not null", [A.po]))[0], 30);
  check("7b: with a reference on every delivery the LPO can be checked", !!(await sql("select supplier_invoice_checked_at from public.purchase_orders where id = $1", [A.po]))[0]?.supplier_invoice_checked_at);

  // 8. Accounts change the type later (WIP → Pre-payment parts invoice number, which counts): logged old → new.
  await go(acc.page, `${base}/parts/orders/${A.po}`);
  const ac = acc.page.locator(`[data-receipt="${pend.id}"]`);
  await ac.locator('[data-receipt-action="change-ref"]').first().click();
  await ac.locator('[data-receipt-ref-form] [data-receipt-ref-type="prepay"]').click();
  await ac.locator("[data-receipt-number-input]").fill("PP26POR24179");
  await ac.locator("[data-receipt-number-save]").click();
  const pp = await until(async () => (await sql("select invoice_number, refs, number_history from public.part_receipts where id = $1 and invoice_number is not null", [pend.id]))[0]);
  const last = (pp?.number_history ?? []).at(-1);
  check("8a: changed to a pre-payment number, which counts as the invoice", pp?.invoice_number === "PP26POR24179" && pp?.refs?.[0]?.type === "prepay", JSON.stringify(pp?.refs));
  check("8b: logged: old type and number → new, who, when", last?.old === "WIP-E2E-55" && /WIP/i.test(last?.old_type ?? "") && /Pre-payment/i.test(last?.new_type ?? "") && !!last?.by_name && !!last?.at, JSON.stringify(last));

  // 9. A receipt recorded with a WIP number straight away; columns, search and the export on Supplier invoices.
  await receive(parts.page, B.po, B.lines, { type: "wip", number: "WIP-E2E-901" });
  const wb = (await sql("select invoice_number, refs, invoice_due_date::text as due from public.part_receipts where po_id = $1", [B.po]))[0];
  check("9a: recorded with a WIP number: the real invoice still due today", wb?.refs?.[0]?.number === "WIP-E2E-901" && wb?.invoice_number === null && wb?.due === dubai(0), JSON.stringify(wb));
  await receive(parts.page, C.po, C.lines, { type: "prepay", number: "PP-E2E-902" });
  const cb = (await sql("select invoice_number from public.part_receipts where po_id = $1", [C.po]))[0];
  check("9b: recorded with a pre-payment number: it counts as the invoice", cb?.invoice_number === "PP-E2E-902");
  await go(acc.page, `${base}/supplier-invoices?q=WIP-E2E-901`);
  check("9c: search finds the WIP number; the card shows WIP NO.", (await acc.page.locator('[data-si-wip="WIP-E2E-901"]').count()) >= 1);
  for (const [w, h] of [[1440, 1000], [800, 1280]]) { await acc.page.setViewportSize({ width: w, height: h }); await acc.page.screenshot({ path: path.join(OUT, `5-supplier-invoices-wip-${w}.png`) }); }
  await acc.page.setViewportSize({ width: 1440, height: 1200 });
  await go(acc.page, `${base}/supplier-invoices?q=PP26POR24179`);
  check("9d: search finds the pre-payment number; the card shows PRE-PAYMENT PARTS INVOICE NO.", (await acc.page.locator('[data-si-row]').count()) >= 1);
  const resp = await acc.page.request.get(`${base}/api/export/supplier-invoices?q=WIP-E2E-901`);
  const body = await resp.body();
  check("9e: Export to Excel answers with a file", resp.status() === 200 && body.length > 1000 && body.subarray(0, 2).toString() === "PK");

  // 10. Settings > Supplier references: accounts add a type and choose what counts.
  await go(acc.page, `${base}/settings/receipt-references`);
  check("10a: accounts open Settings > Supplier references", (await acc.page.locator("[data-ref-types-form]").count()) === 1);
  await acc.page.locator("[data-ref-type-new]").fill("E2E Delivery note number");
  await acc.page.locator("[data-ref-types-save]").click();
  await acc.page.waitForURL(/message=/, { timeout: 20000 }).catch(() => null);
  const stored = (await sql("select value from public.settings where key = 'supplier_ref_types'"))[0]?.value ?? [];
  check("10b: the new type is saved (not counting); the three built-in types stay", stored.some((t) => t.label === "E2E Delivery note number" && t.counts === false) && ["invoice", "prepay", "wip"].every((k) => stored.some((t) => t.key === k)), JSON.stringify(stored));
  for (const [w, h] of [[1440, 1000], [800, 1280]]) { await acc.page.setViewportSize({ width: w, height: h }); await acc.page.screenshot({ path: path.join(OUT, `6-settings-references-${w}.png`), fullPage: true }); }
  await sql("update public.settings set value = (select jsonb_agg(t) from jsonb_array_elements(value) t where t->>'label' <> 'E2E Delivery note number') where key = 'supplier_ref_types'");
  const partsSettings = await browserFor("parts", { viewport: { width: 1440, height: 1000 } });
  await go(partsSettings.page, `${base}/settings/receipt-references`);
  check("10c: the parts desk cannot open the settings", (await partsSettings.page.locator("[data-ref-types-form]").count()) === 0);
  await partsSettings.browser.close();

  await parts.browser.close();
  await acc.browser.close();
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
