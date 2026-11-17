// 17 November 2026, Section 5: SHARE A DRAFT LPO WITH THE SUPPLIER BEFORE APPROVAL. Signed in as the parts desk.
//  A. A waiting LPO: "Share draft with <supplier>" - the draft PDF carries "DRAFT - FOR PRICE AND AVAILABILITY ONLY. NOT AN
//     ORDER UNTIL APPROVED." (and the DRAFT mark); sharing on WhatsApp is recorded: "Draft shared with … <date, who>".
//  B. The real LPO is never shared before approval (its PDF refuses a waiting LPO).
//  C. After approval: the draft is refused; the one Share button shares the clean LPO and records "LPO sent".
//  D. An approved LPO not sent after 2 working hours: the parts desk is nudged once (the hourly clean-up).
// TEST only.  node --env-file=.env.test.local tests/browser/test-s17-5-draft-lpo.mjs
import fs from "node:fs";
import path from "node:path";
import { api, base, browserFor, cleanupDb, cookieHeader, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-17-draft-lpo";
fs.mkdirSync(OUT, { recursive: true });
const until = async (fn, tries = 60, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const text = async (page, sel) => (((await page.locator(sel).first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim());
const pdfText = async (buf) => {
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  let out = "";
  for (let i = 0; i < doc.countPages(); i++) out += doc.loadPage(i).toStructuredText("preserve-whitespace").asText();
  return out.replace(/\s+/g, " ");
};
const shots = async (page, el, name) => {
  for (const [w, h] of [[1440, 1000], [800, 1280]]) {
    await page.setViewportSize({ width: w, height: h });
    await sleep(300);
    await (el ?? page).screenshot({ path: path.join(OUT, `${name}-${w}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
};

try {
  cleanupDb();
  const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const JOB = seed.jobId;
  await sql("insert into public.suppliers (name, vat_registered, phone, email) values ('E2E Draft Supplier', false, '+971500000777', 'e2e-draft@example.invalid') on conflict do nothing");
  const part = (await sql("select id from public.part_items where job_id = $1 and description ilike '%brake pads%' limit 1", [JOB]))[0];
  await sql("update public.part_items set supplier = 'E2E Draft Supplier', order_status = 'to_order' where id = $1", [part.id]);
  const po = (await sql("insert into public.purchase_orders (number, kind, job_id, supplier_name, status, total_cost_aed, supplier_invoice_status) values ('LPO-E2E-DR-1', 'main', $1, 'E2E Draft Supplier', 'pending_approval', 200, 'none') returning id", [JOB]))[0].id;
  const line = (await sql("insert into public.purchase_order_lines (po_id, part_item_id, position, description, quantity, unit_cost) values ($1, $2, 1, 'FRONT BRAKE PADS', 1, 200) returning id", [po, part.id]))[0].id;
  await sql("update public.part_items set po_id = $1, po_line_id = $2 where id = $3", [po, line, part.id]);

  const parts = await browserFor("parts", { viewport: { width: 1440, height: 1000 } });
  // A. The draft.
  await go(parts.page, `${base}/parts/orders/${po}`);
  const card = parts.page.locator("[data-lpo-draft-share]");
  await card.waitFor({ timeout: 30000 });
  check("A1: a waiting LPO offers \"Share draft with E2E Draft Supplier\"", (await card.locator('[data-lpo-share="draft"][data-lpo-share-supplier="E2E Draft Supplier"]').count()) === 1);
  await card.locator('[data-lpo-share="draft"]').click();
  const win = parts.page.locator('[data-lpo-share-window="draft"]');
  await win.waitFor({ timeout: 10000 });
  check("A2: the window says it is a draft, not an order", /DRAFT - FOR PRICE AND AVAILABILITY ONLY\. NOT AN ORDER UNTIL APPROVED\./.test(await text(parts.page, "[data-lpo-draft-words]")));
  await shots(parts.page, win, "a-share-draft-window");
  const draftRes = await parts.page.request.get(`${base}/api/pdf/lpo-draft/${po}?supplier=${encodeURIComponent("E2E Draft Supplier")}`);
  const draftText = draftRes.ok() ? await pdfText(Buffer.from(await draftRes.body())) : "";
  check("A3: the draft PDF carries the draft words, the DRAFT mark and the supplier's lines", draftRes.ok() && /DRAFT - FOR PRICE AND AVAILABILITY ONLY\. NOT AN ORDER UNTIL APPROVED\./.test(draftText) && /DRAFT/.test(draftText) && /FRONT BRAKE PADS/i.test(draftText) && !/Approved electronically/.test(draftText), `${draftRes.status()} ${draftText.slice(0, 200)}`);
  fs.writeFileSync(path.join(OUT, "draft-lpo.pdf"), Buffer.from(await draftRes.body()));
  const [popup] = await Promise.all([parts.page.context().waitForEvent("page", { timeout: 10000 }).catch(() => null), win.locator("[data-lpo-share-whatsapp]").click()]);
  if (popup) await popup.close().catch(() => null);
  await win.locator("[data-lpo-share-done]").waitFor({ timeout: 20000 });
  const logged = await until(async () => (await sql("select new_data from public.audit_log where table_name = 'purchase_orders' and record_id = $1 and new_data ? 'draft_shared'", [po]))[0]);
  check("A4: sharing on WhatsApp is recorded (supplier, how, who, when)", logged?.new_data?.draft_shared?.supplier === "E2E Draft Supplier" && logged.new_data.draft_shared.method === "whatsapp" && !!logged.new_data.draft_shared.by);
  await go(parts.page, `${base}/parts/orders/${po}?v=2`);
  check("A5: the LPO page shows \"Draft shared with E2E Draft Supplier · <date, time> · <who> (WhatsApp)\"", /Draft shared with E2E Draft Supplier · .+ \(WhatsApp\)/.test(await text(parts.page, '[data-lpo-share-stamp="draft"]')));
  await shots(parts.page, null, "a-lpo-page-draft-shared");

  // B. The real LPO is never shared before approval.
  const real = await parts.page.request.get(`${base}/api/pdf/po/${po}`);
  check("B1: the real LPO's PDF is refused while it waits for approval", real.status() === 423, String(real.status()));

  // C. After approval: draft refused; Share = the clean LPO, recorded as sent.
  const sup = (await sql("insert into public.purchase_orders (number, kind, job_id, parent_id, supplier_name, status, total_cost_aed, supplier_invoice_status, approved_at, verify_token) values ('LPO-E2E-DR-1-1', 'supplier', $1, $2, 'E2E Draft Supplier', 'approved', 200, 'none', now(), 'e2e-dr-token-1') returning id", [JOB, po]))[0].id;
  await sql("update public.purchase_orders set status = 'approved', approved_at = now() where id = $1", [po]);
  const draftAfter = await parts.page.request.get(`${base}/api/pdf/lpo-draft/${po}`);
  check("C1: after approval the draft is refused (share the LPO itself)", draftAfter.status() === 409, String(draftAfter.status()));
  await go(parts.page, `${base}/parts/orders/${sup}`);
  const share = parts.page.locator('[data-lpo-share="final"]').first();
  await share.waitFor({ timeout: 30000 });
  await share.click();
  const win2 = parts.page.locator('[data-lpo-share-window="final"]');
  check("C2: the clean LPO's window has no draft words", (await win2.locator("[data-lpo-draft-words]").count()) === 0);
  const [popup2] = await Promise.all([parts.page.context().waitForEvent("page", { timeout: 10000 }).catch(() => null), win2.locator("[data-lpo-share-whatsapp]").click()]);
  if (popup2) await popup2.close().catch(() => null);
  const sent = await until(async () => (await sql("select sent_at, sent_method from public.purchase_orders where id = $1 and sent_at is not null", [sup]))[0]);
  check("C3: shared on WhatsApp = recorded as sent", sent?.sent_method === "whatsapp", JSON.stringify(sent ?? {}));
  await go(parts.page, `${base}/parts/orders/${sup}?v=2`);
  check("C4: the page shows \"LPO sent to … · <date, time> · <who>\"", /LPO sent to E2E Draft Supplier · /.test(await text(parts.page, '[data-lpo-share-stamp="sent"]')));
  await parts.browser.close();

  // D. Approved, not sent after 2 working hours: the parts desk is told once.
  const late = (await sql("insert into public.purchase_orders (number, kind, job_id, supplier_name, status, total_cost_aed, supplier_invoice_status, approved_at) values ('LPO-E2E-DR-2', 'supplier', $1, 'E2E Draft Supplier', 'approved', 50, 'none', now() - interval '3 days') returning id", [JOB]))[0].id;
  const secret = process.env.CRON_SECRET ?? "";
  const run = async () => fetch(`${base}/api/cron/housekeeping`, { headers: { authorization: `Bearer ${secret}` } }).then((r) => r.status).catch(() => 0);
  await run();
  const bells = async () => (await sql("select count(*)::int as n from public.notifications where type = 'lpo_not_sent' and href = $1", [`/parts/orders/${late}`]))[0].n;
  const first = await until(async () => (await bells()) > 0, 60, 1000);
  const afterFirst = await bells();
  await run();
  check("D1: the parts desk is nudged about LPO-E2E-DR-2, and only once", !!first && afterFirst > 0 && (await bells()) === afterFirst, `bells ${afterFirst} then ${await bells()}`);
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  await sql("delete from public.notifications where type = 'lpo_not_sent' and href like '/parts/orders/%' and title like '%LPO-E2E-%'").catch(() => null);
  await sql("delete from public.audit_log where table_name = 'purchase_orders' and new_data ? 'draft_shared' and new_data->'draft_shared'->>'supplier' like 'E2E%'").catch(() => null);
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
