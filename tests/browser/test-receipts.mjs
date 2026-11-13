// 13 November 2026 (URGENT): the supplier's invoice number at receiving. Part by part on an LPO with a compulsory
// invoice number; "Invoice comes later" only for a supplier marked so (owner/accounts, at most 5 days) with the delivery
// paper or "No paper came"; reminders on day 3, day 5 and every day while overdue; the lists on the dashboards; accounts
// replace an unclear photo, ask the parts desk to retake, correct a number; "Same invoice as LPO-…?". TEST only.
//   node --env-file=.env.test.local tests/browser/test-receipts.mjs
import fs from "node:fs";
import path from "node:path";
import { api, base, browserFor, cleanupDb, go, makeChecks, sleep, sql, confirmCheckIfShown } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-13-receipts";
fs.mkdirSync(OUT, { recursive: true });
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQCJ9dvEAAAAAElFTkSuQmCC", "base64");
const text = async (page, sel) => (((await page.locator(sel).first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim());
const dubai = (n = 0) => new Date(Date.now() + 4 * 3600000 + n * 86400000).toISOString().slice(0, 10);
const urlOf = (page) => decodeURIComponent(page.url().replace(/\+/g, " "));

async function makeSupplier(name) {
  return (await sql("insert into public.suppliers (name, vat_registered, trn) values ($1, true, '100000000000003') returning id", [name]))[0].id;
}
async function makePo(jobId, supplierId, number, parts) {
  const po = (await sql("insert into public.purchase_orders (number, kind, job_id, supplier_id, supplier_name, status, total_cost_aed) values ($1, 'supplier', $2, $3, (select name from public.suppliers where id = $3), 'ordered', 500) returning id", [number, jobId, supplierId]))[0].id;
  const lines = [];
  for (const [i, name] of parts.entries()) {
    const part = (await sql("insert into public.part_items (job_id, description, quantity, cost_aed, availability, order_status, po_id, confirm_status, supplier) values ($1, $2, 1, 100, 'to_order', 'ordered', $3, 'confirmed', (select name from public.suppliers where id = $4)) returning id", [jobId, name, po, supplierId]))[0].id;
    const line = (await sql("insert into public.purchase_order_lines (po_id, part_item_id, position, description, quantity, unit_cost) values ($1, $2, $3, $4, 1, 100) returning id", [po, part, i, name]))[0].id;
    await sql("update public.part_items set po_line_id = $2 where id = $1", [part, line]);
    lines.push(line);
  }
  return { po, lines };
}
async function receive(page, poId, lineIds, number, opts = {}) {
  await go(page, `${base}/parts/orders/${poId}`);
  const form = page.locator("[data-receive-form]");
  for (const input of await form.locator('input[name^="received__"]').all()) {
    const name = await input.getAttribute("name");
    await input.fill(lineIds.some((id) => name === `received__${id}`) ? "1" : "0");
  }
  if (opts.later) {
    await form.locator("[data-receipt-later-button]").click();
    if (opts.noPaper) await form.locator("[data-receipt-no-paper]").check();
    else await form.locator("[data-receipt-paper]").setInputFiles({ name: "paper.png", mimeType: "image/png", buffer: PNG });
  } else {
    if (opts.dropRequired) await form.locator("[data-receipt-number]").evaluate((el) => el.removeAttribute("required"));
    await form.locator("[data-receipt-number]").fill(number ?? "");
    await form.locator("[data-receipt-number]").blur();
    await sleep(900);
    if (opts.same) await form.locator('[data-receipt-same] input').check();
  }
  if (opts.shot) await form.screenshot({ path: path.join(OUT, opts.shot) });
  const before = page.url();
  await form.locator("[data-record-delivery]").click(); await confirmCheckIfShown(page);
  await page.waitForURL((u) => u.toString() !== before, { timeout: 30000 }).catch(() => null);
  await sleep(1200);
}

try {
  cleanupDb();
  const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const JOB = seed.jobId;
  const sNormal = await makeSupplier("E2E Receipts Normal Co");
  const sLater = await makeSupplier("E2E Receipts Later Co");
  const A = await makePo(JOB, sNormal, "LPO-E2E-R1", ["E2E PART ONE", "E2E PART TWO", "E2E PART THREE", "E2E PART FOUR", "E2E PART FIVE"]);
  const B = await makePo(JOB, sNormal, "LPO-E2E-R2", ["E2E PART SIX"]);
  const C = await makePo(JOB, sLater, "LPO-E2E-R3", ["E2E PART SEVEN"]);
  const parts = await browserFor("parts", { viewport: { width: 1440, height: 1200 } });

  // 1. Receive 2 of 5 with an invoice number; the other 3 the next day with a different number.
  await receive(parts.page, A.po, A.lines.slice(0, 2), "INV-E2E-1001", { shot: "1-receive-with-number-1440.png" });
  const r1 = await sql("select id, invoice_number, jsonb_array_length(lines) as n, received_by from public.part_receipts where po_id = $1", [A.po]);
  check("1a: 2 of 5 received: one receipt with the number and who/when", r1.length === 1 && r1[0].invoice_number === "INV-E2E-1001" && r1[0].n === 2 && !!r1[0].received_by, JSON.stringify(r1));
  await go(parts.page, `${base}/parts/orders/${A.po}`);
  check("1b: the LPO shows \"2 of 5 received\"", /2 of 5 received/.test(await text(parts.page, "[data-received-count]")));
  await sql("update public.part_receipts set received_at = received_at - interval '1 day' where po_id = $1", [A.po]);
  await receive(parts.page, A.po, A.lines.slice(2), "INV-E2E-1002");
  const r2 = await sql("select invoice_number from public.part_receipts where po_id = $1 order by received_at", [A.po]);
  check("1c: the other 3 next day with another number: two receipts", r2.length === 2 && r2[1].invoice_number === "INV-E2E-1002", JSON.stringify(r2));
  check("1d: the LPO is now received in full", (await sql("select status from public.purchase_orders where id = $1", [A.po]))[0]?.status === "received");

  // 2. No number for a normal supplier: refused (the server refuses even when the box's own check is bypassed).
  await receive(parts.page, B.po, B.lines, "", { dropRequired: true });
  check("2a: no invoice number: refused in plain words", /invoice number/i.test(urlOf(parts.page)) && /error=/.test(parts.page.url()), urlOf(parts.page).slice(-160));
  check("2b: nothing was received", (await sql("select count(*)::int as n from public.part_receipts where po_id = $1", [B.po]))[0].n === 0 && (await sql("select status from public.purchase_orders where id = $1", [B.po]))[0].status === "ordered");
  check("2c: no \"Invoice comes later\" button for a normal supplier", (await parts.page.locator("[data-receipt-later-button]").count()) === 0);

  // 3. "Same invoice as LPO-…?": the number already used for this supplier asks instead of refusing.
  await receive(parts.page, B.po, B.lines, "INV-E2E-1002");
  const asked = await text(parts.page, "[data-receipt-same]");
  check("3a: the same number without the tick: asked \"Same invoice as LPO-E2E-R1?\" and not saved", /Same invoice as LPO-E2E-R1\?/.test(asked) && (await sql("select count(*)::int as n from public.part_receipts where po_id = $1", [B.po]))[0].n === 0, asked);
  await parts.page.locator("[data-receive-form]").screenshot({ path: path.join(OUT, "3-same-invoice-ask-1440.png") });
  await receive(parts.page, B.po, B.lines, "INV-E2E-1002", { same: true });
  const sameRow = (await sql("select invoice_number, same_invoice_po_id from public.part_receipts where po_id = $1", [B.po]))[0];
  check("3b: ticked: saved as the same invoice as LPO-E2E-R1", sameRow?.invoice_number === "INV-E2E-1002" && sameRow?.same_invoice_po_id === A.po, JSON.stringify(sameRow));

  // 4. Accounts mark a supplier "Invoice later allowed" (5 days); the parts desk uses the exception with the paper photo.
  const acc = await browserFor("accounts", { viewport: { width: 1440, height: 1200 } });
  await go(acc.page, `${base}/parts/suppliers`);
  const card = acc.page.locator(`[data-supplier-row="${sLater}"]`);
  await card.locator("summary").click();
  await card.locator("[data-invoice-later-allowed]").check();
  await card.locator("[data-invoice-later-days]").fill("9");
  const nine = await card.locator("[data-invoice-later-days]").evaluate((el) => el.checkValidity());
  check("4a0: more than 5 days is refused by the box", nine === false);
  await card.locator("[data-invoice-later-days]").fill("5");
  await card.locator("[data-invoice-later-save]").click();
  const marked = await until(async () => (await sql("select invoice_later_allowed, invoice_later_days from public.suppliers where id = $1 and invoice_later_allowed", [sLater]))[0]);
  check("4a: accounts mark the supplier \"Invoice later allowed\" (5 days)", marked?.invoice_later_days === 5, JSON.stringify(marked));
  await receive(parts.page, C.po, C.lines, null, { later: true, shot: "4-invoice-later-1440.png" });
  const later = (await sql("select id, invoice_number, invoice_later, invoice_due_date::text as due, no_paper from public.part_receipts where po_id = $1", [C.po]))[0];
  const paperFile = (await sql("select count(*)::int as n from public.receipt_files where receipt_id = $1 and kind = 'paper'", [later?.id]))[0]?.n;
  check("4b: saved with the exception: due in 5 days, the delivery paper's photo kept", later?.invoice_later === true && later?.due === dubai(5) && paperFile === 1, JSON.stringify(later));
  await go(parts.page, `${base}/parts/orders/${C.po}`);
  check("4c: the receipt is tagged \"INVOICE DUE BY <date>\"", /^INVOICE DUE BY \d{2} [A-Z]{3} \d{4}/.test(await text(parts.page, "[data-receipt-due]")));
  await parts.page.locator("[data-receipts-card]").screenshot({ path: path.join(OUT, "4-due-tag-1440.png") });

  // 5. Reminders: day 3, day 5, then every day while overdue - to the parts desk and accounts (the date moved forward).
  const since = (await sql("select coalesce(max(id), 0) as m from public.notifications"))[0].m;
  const told = async (day) => (await api("/api/e2e/stage", { stage: "receipt-reminders", today: dubai(day) })).json?.told;
  const t2 = await told(2), t3 = await told(3), t3b = await told(3), t4 = await told(4), t5 = await told(5), t6 = await told(6), t7 = await told(7);
  check("5a: nothing before day 3; day 3; not twice the same day; nothing on day 4", t2 === 0 && t3 === 1 && t3b === 0 && t4 === 0, JSON.stringify({ t2, t3, t3b, t4 }));
  check("5b: day 5, then every day while overdue (day 6, day 7)", t5 === 1 && t6 === 1 && t7 === 1, JSON.stringify({ t5, t6, t7 }));
  const bells = await sql("select n.title, s.role_id from public.notifications n join public.staff s on s.id = n.staff_id where n.id > $1 and n.type = 'supplier_invoice_missing' and n.title like '%LPO-E2E-R3%'", [since]);
  check("5c: the parts desk and accounts both get them (day 3, day 5, OVERDUE)", bells.some((b) => b.role_id === "parts" && /day 3/.test(b.title)) && bells.some((b) => b.role_id === "accounts" && /day 5/.test(b.title)) && bells.some((b) => /OVERDUE/.test(b.title)), JSON.stringify(bells.map((b) => `${b.role_id}:${b.title}`).slice(0, 6)));
  check("5d: the owner gets no bell", (await sql("select count(*)::int as n from public.notifications n join public.staff s on s.id = n.staff_id where n.id > $1 and s.role_id = 'owner' and n.title like '%LPO-E2E-R3%'", [since]))[0].n === 0);
  await sql("update public.part_receipts set invoice_due_date = current_date - 2 where id = $1", [later.id]);
  for (const [role, b] of [["parts", parts], ["accounts", acc]]) {
    await go(b.page, `${base}/dashboard`);
    const row = b.page.locator(`[data-not-received-row="${later.id}"]`);
    check(`5e: "Invoices not received" on the ${role} dashboard, overdue in red`, (await row.count()) === 1 && (await row.getAttribute("data-overdue")) === "1");
    if (role === "accounts") await b.page.locator("[data-invoices-not-received]").screenshot({ path: path.join(OUT, "5-not-received-accounts-1440.png") });
  }
  const own = await browserFor("owner", { viewport: { width: 1440, height: 1000 } });
  await go(own.page, `${base}/dashboard`);
  check("5f: the owner sees only the count", /Supplier invoices not received: \d+/.test(await text(own.page, "[data-invoices-not-received-count]")) && (await own.page.locator("[data-invoices-not-received]").count()) === 0);
  await own.browser.close();

  // 6. The parts desk types the number later: the reminder stops.
  await go(parts.page, `${base}/parts/orders/${C.po}`);
  const rc = parts.page.locator(`[data-receipt="${later.id}"]`);
  await rc.locator('[data-receipt-action="number"]').click();
  await rc.locator("[data-receipt-number-input]").fill("INV-E2E-3001");
  await rc.locator("[data-receipt-number-save]").click();
  const typed = await until(async () => (await sql("select invoice_number from public.part_receipts where id = $1 and invoice_number is not null", [later.id]))[0]);
  check("6a: the number typed later is saved", typed?.invoice_number === "INV-E2E-3001");
  check("6b: the reminders stop", (await told(9)) === 0);

  // 7. Accounts: "Photo unclear - ask Parts to retake", then replace a photo themselves and correct a number.
  await go(acc.page, `${base}/parts/orders/${C.po}`);
  const ar = acc.page.locator(`[data-receipt="${later.id}"]`);
  await ar.locator('[data-receipt-action="ask-retake"]').click();
  await ar.locator("[data-receipt-ask-note]").fill("The total is cut off");
  await ar.locator("[data-receipt-ask-send]").click();
  await until(async () => (await sql("select id from public.part_receipts where id = $1 and retake_asked_at is not null", [later.id]))[0]);
  await go(parts.page, `${base}/dashboard`);
  check("7a: the parts desk sees \"Photos to retake\" on their dashboard", (await parts.page.locator(`[data-retake-row="${later.id}"]`).count()) === 1);
  await go(parts.page, `${base}/parts/orders/${C.po}`);
  const pr = parts.page.locator(`[data-receipt="${later.id}"]`);
  await pr.locator('[data-receipt-action="retake-paper"]').click();
  await pr.locator("[data-receipt-file-input]").setInputFiles({ name: "paper2.png", mimeType: "image/png", buffer: PNG });
  await pr.locator("[data-receipt-file-save]").click();
  const done = await until(async () => (await sql("select retake_done_at from public.part_receipts where id = $1 and retake_done_at is not null", [later.id]))[0]);
  check("7b: the parts desk retakes it: the request is done", !!done);
  await go(acc.page, `${base}/parts/orders/${C.po}`);
  const ar2 = acc.page.locator(`[data-receipt="${later.id}"]`);
  await ar2.locator('[data-receipt-action="scan-invoice"]').click();
  await ar2.locator("[data-receipt-file-input]").setInputFiles({ name: "invoice.png", mimeType: "image/png", buffer: PNG });
  await ar2.locator("[data-receipt-file-save]").click();
  await until(async () => (await sql("select id from public.receipt_files where receipt_id = $1 and kind = 'invoice'", [later.id]))[0]);
  await go(acc.page, `${base}/parts/orders/${C.po}`);
  const ar3 = acc.page.locator(`[data-receipt="${later.id}"]`);
  await ar3.locator('[data-receipt-action="retake-paper"]').click();
  await ar3.locator("[data-receipt-file-input]").setInputFiles({ name: "paper3.png", mimeType: "image/png", buffer: PNG });
  await ar3.locator("[data-receipt-file-save]").click();
  const files = await until(async () => { const r = await sql("select kind, replaced_at is not null as old, is_active from public.receipt_files where receipt_id = $1", [later.id]); return r.filter((f) => f.kind === "paper").length >= 3 ? r : null; });
  check("7c: accounts replace the photo: the old files stay (nothing deleted), each marked replaced", (files ?? []).filter((f) => f.kind === "paper").length === 3 && (files ?? []).filter((f) => f.kind === "paper" && f.old).length === 2 && (files ?? []).every((f) => f.is_active), JSON.stringify(files));
  await go(acc.page, `${base}/parts/orders/${C.po}`);
  const ar4 = acc.page.locator(`[data-receipt="${later.id}"]`);
  await ar4.locator('[data-receipt-action="correct"]').click();
  await ar4.locator("[data-receipt-number-input]").fill("INV-E2E-3001B");
  await ar4.locator("[data-receipt-number-save]").click();
  const fixed = await until(async () => (await sql("select invoice_number, number_history from public.part_receipts where id = $1 and invoice_number = 'INV-E2E-3001B'", [later.id]))[0]);
  const last = (fixed?.number_history ?? []).at(-1);
  check("7d: accounts correct the number: logged old → new, who, when", last?.old === "INV-E2E-3001" && last?.new === "INV-E2E-3001B" && !!last?.by_name && !!last?.at, JSON.stringify(last));
  await go(acc.page, `${base}/parts/orders/${C.po}`);
  await acc.page.locator(`[data-receipt="${later.id}"] [data-receipt-history] summary`).click();
  await acc.page.locator("[data-receipts-card]").screenshot({ path: path.join(OUT, "7-accounts-history-1440.png") });

  // 8. The parts desk cannot replace the photo once accounts checked the invoice.
  await sql("update public.purchase_orders set supplier_invoice_checked_at = now() where id = $1", [C.po]);
  await go(parts.page, `${base}/parts/orders/${C.po}`);
  check("8: after the accounts check, the parts desk has no Retake button", (await parts.page.locator(`[data-receipt="${later.id}"] [data-receipt-action="retake-paper"]`).count()) === 0);

  // 9. The number typed at receiving pre-fills the Supplier invoices card (accounts still scan and check).
  await go(acc.page, `${base}/supplier-invoices?open=${encodeURIComponent(`follow:${A.po}`)}`);
  const pre = await acc.page.locator("[data-si-enter] [data-invoice-number]").inputValue().catch(() => "");
  check("9: the Supplier invoices card is pre-filled with the number typed at receiving", /INV-E2E-100[12]/.test(pre), pre);

  await parts.browser.close();
  await acc.browser.close();
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
