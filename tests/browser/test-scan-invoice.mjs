// Document scan + supplier invoices by accounts only (4 November 2026).
//   A. On a TABLET (touch, camera): "Scan document" opens the camera, finds the paper's edges on a fake camera
//      feed showing an angled invoice, straightens and cleans two pages into ONE PDF, which lands on the LPO.
//   B. The parts desk receives parts with NO invoice step: the panel says the invoice goes to accounts, the LPO
//      goes "Waiting for invoice", accounts are notified "collect the supplier's invoice from Parts and scan it",
//      and the received line reads "Received · invoice with accounts".
//   C. Accounts' WAITING ON YOU carries the collect-and-scan line.
//   D. Accounts open the waiting row, attach the invoice (a text PDF), press "Read the scan": the number, date
//      and before-VAT figure pre-fill; they save with a remark; Mark checked still works.
//   E. Enforced on the server: a parts login's supplier-invoice upload is refused at the door; accounts' is not;
//      the parts LPO page shows "with accounts" and no invoice form.
// Run: node --env-file=.env.test.local tests/browser/test-scan-invoice.mjs   (test server on 3102)
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { api, base, browserFor, browserForId, cleanupDb, go, here, loginCookies, makeChecks, sleep, sql, typeReceiptNumber, confirmCheckIfShown } from "./pw-lib.mjs";

const mupdf = await import("mupdf");
const { check, summary } = makeChecks();
const dir = path.join(here, "shots", "scan-invoice");
fs.mkdirSync(dir, { recursive: true });
const until = async (fn, tries = 60, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const EDGE = process.env.E2E_BROWSER ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

/* ---------------- the fake camera feed: an angled white invoice on a dark desk, as y4m ---------------- */
function docFrameRgb(W, H) {
  const rgb = new Uint8Array(W * H * 3).fill(50);
  const TRUE = [{ x: W * 0.19, y: H * 0.12 }, { x: W * 0.84, y: H * 0.2 }, { x: W * 0.78, y: H * 0.88 }, { x: W * 0.12, y: H * 0.77 }];
  const inQuad = (x, y) => {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = TRUE[i], b = TRUE[(i + 1) % 4];
      const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
      if (cross === 0) continue;
      if (!sign) sign = Math.sign(cross);
      else if (Math.sign(cross) !== sign) return false;
    }
    return true;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inQuad(x, y)) { const p = (y * W + x) * 3; rgb[p] = rgb[p + 1] = rgb[p + 2] = 240; }
  // "Text" bars and a dark keyboard block.
  for (let row = 0; row < 7; row++) for (let y = Math.round(H * (0.25 + row * 0.08)); y < Math.round(H * (0.25 + row * 0.08)) + 4; y++) for (let x = Math.round(W * 0.3); x < Math.round(W * 0.68); x++) if (inQuad(x, y)) { const p = (y * W + x) * 3; rgb[p] = rgb[p + 1] = rgb[p + 2] = 25; }
  for (let y = Math.round(H * 0.92); y < H; y++) for (let x = 0; x < W; x++) { const p = (y * W + x) * 3; rgb[p] = rgb[p + 1] = rgb[p + 2] = 90; }
  return rgb;
}
function writeY4m(file, W, H, frames) {
  const ySize = W * H;
  const cSize = (W / 2) * (H / 2);
  const rgb = docFrameRgb(W, H);
  const y = new Uint8Array(ySize);
  const u = new Uint8Array(cSize).fill(128);
  const v = new Uint8Array(cSize).fill(128);
  for (let i = 0, p = 0; i < ySize; i++, p += 3) y[i] = Math.max(16, Math.min(235, Math.round(0.257 * rgb[p] + 0.504 * rgb[p + 1] + 0.098 * rgb[p + 2] + 16)));
  const parts = [Buffer.from(`YUV4MPEG2 W${W} H${H} F15:1 Ip A1:1 C420\n`)];
  for (let f = 0; f < frames; f++) parts.push(Buffer.from("FRAME\n"), Buffer.from(y), Buffer.from(u), Buffer.from(v));
  fs.writeFileSync(file, Buffer.concat(parts));
}

/* ---------------- a REAL text PDF (hand-written, base-14 font) for the reader ---------------- */
function buildTextPdf(lines) {
  const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const content = `BT /F1 12 Tf 14 TL 50 780 Td ${lines.map((l) => `(${esc(l)}) Tj T*`).join(" ")} ET`;
  const objs = [
    "<</Type /Catalog /Pages 2 0 R>>",
    "<</Type /Pages /Kids [3 0 R] /Count 1>>",
    "<</Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources <</Font <</F1 4 0 R>>>> /Contents 5 0 R>>",
    "<</Type /Font /Subtype /Type1 /BaseFont /Helvetica>>",
    `<</Length ${content.length}>>\nstream\n${content}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<</Size ${objs.length + 1} /Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

cleanupDb();
const seed = await api("/api/e2e/stage", { stage: "approved" });
const jobId = seed.json?.jobId;
if (!jobId) { console.error("seed failed"); process.exit(1); }
const [{ job_number: jobNumber }] = await sql("select job_number from public.jobs where id = $1", [jobId]);
const partsUser = (await sql("select id from public.staff where role_id = 'parts' and is_active order by created_at limit 1"))[0];

// An ordered supplier LPO with one part on its way (SQL-primed, like the live flow leaves it).
const PART = "22222222-0000-4000-8000-00000000fa01";
await sql("insert into public.part_items (id, job_id, description, quantity, confirmed_quantity, part_type, cost_aed, supplier, availability, delivery_date, order_status, confirm_status, priced_at) values ($1, $2, 'E2E SCAN HUB ASSEMBLY', 2, 2, 'genuine', 520, 'E2E GARGASH', 'to_order', current_date, 'ordered', 'confirmed', now()) on conflict (id) do nothing", [PART, jobId]);
const [po] = await sql("insert into public.purchase_orders (number, kind, job_id, supplier_name, status, total_cost_aed, ordered_at) values ('LPO-E2E-SC1', 'supplier', $1, 'E2E GARGASH', 'ordered', 1040, now()) returning id", [jobId]);
const [line] = await sql("insert into public.purchase_order_lines (po_id, part_item_id, position, description, quantity, unit_cost) values ($1, $2, 1, 'E2E SCAN HUB ASSEMBLY', 2, 520) returning id", [po.id, PART]);
await sql("update public.part_items set po_id = $2, po_line_id = $3 where id = $1", [PART, po.id, line.id]);

/* ---------------- B. Parts receive with NO invoice step ---------------- */
const tB = new Date().toISOString();
{
  const { browser, page } = await browserForId(partsUser.id, { viewport: { width: 1440, height: 900 } });
  await go(page, `${base}/parts/${jobId}`);
  await page.locator("[data-mark-received]").click();
  await sleep(400);
  check("B1: the receiving panel has NO full invoice box, only the invoice number (13 Nov)", (await page.locator("[data-supplier-invoice-box]").count()) === 0 && (await page.locator("[data-receipt-number]").count()) === 1);
  await page.screenshot({ path: path.join(dir, "b1-receive-panel.png"), clip: (await page.locator("[data-receive-confirm]").boundingBox()) ?? undefined });
  await typeReceiptNumber(page);
  await page.locator("[data-no-stickers]").click(); await confirmCheckIfShown(page);
  const done = await until(async () => (/received/i.test((await page.locator("[data-receive-panel] [role=alert]").textContent().catch(() => "")) ?? "") ? 1 : null));
  check("B2: the save says the invoice goes to accounts", !!done && /invoice goes to accounts/i.test((await page.locator("[data-receive-panel] [role=alert]").textContent()) ?? ""));
  const [{ supplier_invoice_status: st }] = await sql("select supplier_invoice_status from public.purchase_orders where id = $1", [po.id]);
  check("B3: the LPO is Waiting for invoice", st === "to_follow");
  const bell = await until(() => sql("select title, body from public.notifications where created_at > $1 and title like 'Collect the supplier''s invoice%' limit 1", [tB]).then((r) => r[0] ?? null));
  check("B4: accounts are told to collect and scan it", !!bell && /collect the supplier's invoice from Parts and scan it/i.test(bell.body ?? ""), bell?.body?.slice(0, 140));
  await page.reload();
  const words = await until(async () => ((await page.locator('[data-received-words="invoice-with-accounts"]').count()) ? await page.locator('[data-received-words="invoice-with-accounts"]').first().textContent() : null), 20);
  check("B5: the received line reads \"Received · invoice with accounts\"", (words ?? "").trim() === "Received · invoice with accounts", words ?? "none");
  await page.screenshot({ path: path.join(dir, "b5-received-line.png"), fullPage: false });
  await browser.close();
}

/* ---------------- C. Accounts' Waiting on you ---------------- */
const { browser: ab, page: ap } = await browserFor("accounts", { viewport: { width: 1440, height: 900 } });
await go(ap, `${base}/dashboard`);
const waiting = (await ap.locator("[data-waiting-panel]").textContent().catch(() => "")) ?? "";
check("C1: WAITING ON YOU says collect the invoice from Parts and scan it", /collect the supplier's invoice from Parts and scan it/i.test(waiting) && /E2E GARGASH/i.test(waiting), waiting.slice(0, 160));

/* ---------------- D. Accounts scan & enter: the reader pre-fills ---------------- */
const pdfFile = path.join(dir, "e2e-invoice-2374.pdf");
fs.writeFileSync(pdfFile, buildTextPdf(["SPARE HUB AUTO SPARE PARTS TRADING L.L.C", "TRN 100123456700003", "TAX INVOICE", "Invoice No: 2374", "Date: 28/10/2026", "E2E SCAN HUB ASSEMBLY x 2", "Gross Amount 1,240.00", "Discount 200.00", "Total before VAT 1,040.00", "VAT 5% 52.00", "Net Total 1,092.00"]));
await go(ap, `${base}/supplier-invoices?open=${encodeURIComponent(`follow:${po.id}`)}`);
check("D1: the Scan & enter panel is on the waiting row", (await ap.locator("[data-si-enter]").count()) === 1);
await ap.locator("[data-si-enter] [data-job-file-upload] input[type=file]").setInputFiles(pdfFile);
const uploaded = await until(() => sql("select id from public.job_files where kind = 'supplier_invoice' and ref_id = $1 and removed_at is null limit 1", [po.id]).then((r) => r[0] ?? null), 40);
check("D2: the attached PDF reaches the server", !!uploaded);
await ap.locator("[data-si-read-scan]").click();
const facts = await until(async () => ((await ap.locator("[data-si-read-facts]").count()) ? await ap.locator("[data-si-read-facts]").textContent() : null), 40);
check("D3: the reader shows gross, discount, before VAT, VAT and net — and they add up", !!facts && /1,240\.00/.test(facts) && /1,040\.00/.test(facts) && /52\.00/.test(facts) && /1,092\.00/.test(facts) && /adds up ✓/.test(facts), (facts ?? "").slice(0, 200));
check("D4: the number, date and before-VAT amount pre-filled", (await ap.locator("[data-si-enter] [data-invoice-number]").inputValue()) === "2374" && (await ap.locator("[data-si-enter] [data-invoice-date]").inputValue()) === "2026-10-28" && (await ap.locator("[data-si-enter] [data-invoice-amount]").inputValue()) === "1040");
await ap.screenshot({ path: path.join(dir, "d4-prefilled.png"), clip: (await ap.locator("[data-si-enter]").boundingBox()) ?? undefined });
await ap.locator("[data-si-remark]").fill("Supplier shows 2; only this delivery on the LPO");
await ap.locator("[data-si-enter-save]").click();
await ap.waitForURL(/message=/, { timeout: 25000 });
const [poAfter] = await sql("select supplier_invoice_status, supplier_invoice_number, supplier_invoice_date::text as d, supplier_invoice_amount::text as amt, notes from public.purchase_orders where id = $1", [po.id]);
check("D5: the invoice is saved with the remark on record", poAfter.supplier_invoice_status === "received" && poAfter.supplier_invoice_number === "2374" && poAfter.d === "2026-10-28" && Number(poAfter.amt) === 1040 && /Invoice remark/.test(poAfter.notes ?? ""), JSON.stringify(poAfter).slice(0, 180));
// Mark checked still closes the loop (the URL already carries ?message= from the save: wait on the record, not the address).
await ap.locator("[data-si-check]").click();
const chk = await until(() => sql("select supplier_invoice_checked_at from public.purchase_orders where id = $1 and supplier_invoice_checked_at is not null", [po.id]).then((r) => r[0] ?? null), 40);
check("D6: Mark checked works on the entered invoice", !!chk);
await ab.close();

/* ---------------- E. Server enforcement ---------------- */
const grant = async (role) => {
  const r = await fetch(`${base}/api/uploads/grant`, { method: "POST", headers: { "content-type": "application/json", cookie: (await loginCookies(role)).map((c) => `${c.name}=${c.value}`).join("; ") }, body: JSON.stringify({ target: "job_file", scopeId: jobId, kind: "supplier_invoice", contentType: "application/pdf" }) });
  return { status: r.status, body: await r.text() };
};
const gParts = await grant("parts");
check("E1: a parts login's supplier-invoice upload is refused at the door", gParts.status >= 400, `${gParts.status} ${gParts.body.slice(0, 80)}`);
const gAcc = await grant("accounts");
check("E2: accounts' upload is allowed", gAcc.status === 200, `${gAcc.status}`);
{
  const { browser, page } = await browserForId(partsUser.id, { viewport: { width: 1366, height: 900 } });
  await go(page, `${base}/parts/orders/${po.id}`);
  check("E3: the parts LPO page has no invoice form", (await page.locator("[data-save-invoice]").count()) === 0);
  await browser.close();
}

/* ---------------- A. The tablet scan: camera → two straight, clean pages → ONE PDF ---------------- */
await sql("update public.purchase_orders set supplier_invoice_status = 'to_follow', supplier_invoice_checked_at = null, supplier_invoice_number = null, supplier_invoice_date = null, supplier_invoice_amount = null where id = $1", [po.id]);
await sql("update public.job_files set removed_at = now() where kind = 'supplier_invoice' and ref_id = $1", [po.id]);
const y4m = path.join(dir, "fake-doc.y4m");
writeY4m(y4m, 640, 480, 3);
const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${y4m}`] });
const context = await browser.newContext({ viewport: { width: 800, height: 1280 }, hasTouch: true });
await context.addCookies(await loginCookies("accounts"));
await context.addInitScript(() => { document.addEventListener("DOMContentLoaded", () => document.querySelectorAll("[data-waiting-panel] details:not([open])").forEach((d) => { d.open = true; })); });
const tp = await context.newPage();
await go(tp, `${base}/supplier-invoices?open=${encodeURIComponent(`follow:${po.id}`)}`);
await tp.locator("[data-si-enter] [data-scan-document]").click();
await tp.waitForSelector("[data-camera]", { timeout: 20000 });
await tp.locator("[data-camera] [aria-label='Take the photo']").click({ timeout: 20000 });
await tp.waitForSelector("[data-scan-crop]", { timeout: 30000 });
const cropWords = (await tp.locator("[data-scan-crop] p").first().textContent()) ?? "";
check("A1: the paper is found by itself on the camera photo", /Paper found/.test(cropWords), cropWords);
await tp.screenshot({ path: path.join(dir, "a1-crop-auto.png") });
await tp.locator("[data-scan-use]").click();
await tp.waitForSelector("[data-scan-page='1']", { timeout: 30000 });
await tp.locator("[data-scan-add-page]").click();
await tp.waitForSelector("[data-camera]", { timeout: 20000 });
await tp.locator("[data-camera] [aria-label='Take the photo']").click();
await tp.waitForSelector("[data-scan-crop]", { timeout: 30000 });
await tp.locator("[data-scan-use]").click();
await tp.waitForSelector("[data-scan-page='2']", { timeout: 30000 });
await tp.screenshot({ path: path.join(dir, "a2-two-pages.png") });
await tp.locator("[data-scan-done]").click();
const scanned = await until(() => sql("select storage_path from public.job_files where kind = 'supplier_invoice' and ref_id = $1 and removed_at is null limit 1", [po.id]).then((r) => r[0] ?? null), 60);
check("A2: the scanned PDF reaches the LPO", !!scanned, scanned?.storage_path);
if (scanned) {
  const { createClient } = await import("@supabase/supabase-js");
  const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: blob } = await svc.storage.from("job-files").download(scanned.storage_path);
  const buf = Buffer.from(await blob.arrayBuffer());
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  check("A3: ONE PDF with the two pages", /\.pdf$/.test(scanned.storage_path) && doc.countPages() === 2, `${doc.countPages()} pages, ${buf.length} bytes`);
  const { pagePng } = await import("../unit/pdf-check-lib.mjs");
  fs.writeFileSync(path.join(dir, "a3-scan-p1.png"), pagePng(buf, 0, 1));
  fs.writeFileSync(path.join(dir, "a3-scan-p2.png"), pagePng(buf, 1, 1));
}
await browser.close();

cleanupDb();
await sql("update public.job_files set removed_at = now() where kind = 'supplier_invoice' and ref_id = $1", [po.id]).catch(() => null);
process.exit(summary() ? 1 : 0);
