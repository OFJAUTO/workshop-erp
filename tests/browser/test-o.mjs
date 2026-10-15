// Proof for PART B of the night batch: Share PDF in the send windows (B1), the PDF viewed inside the customer link
// with Back and Download (B2), and the supplier LPO's Share PDF and Email to supplier with its "not set up yet" and
// "no email on the supplier" notes (B3).
//   node --env-file=.env.local tests/browser/test-o.mjs
import { api, base, browserFor, cleanupDb, cookieHeader, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 12 * 60 * 1000).unref();
cleanupDb();

const until = async (fn, tries = 60, ms = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } return null; };
const plainText = (html) => html.replace(/<!--.*?-->/g, "").replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
async function fetchAs(pathname, role) {
  const res = await fetch(`${base}${pathname}`, { headers: { cookie: await cookieHeader(role) }, redirect: "manual" });
  return { status: res.status, text: await res.text() };
}
async function section(name, fn) {
  console.log(`\n== ${name}`);
  try { await fn(); } catch (e) { check(`${name}: no crash`, false, String(e?.message ?? e).slice(0, 300)); }
}

let jobId = null;
let quoteToken = null;

/* ---------------- 1. The PDF inside the customer link ---------------- */
await section("1 pdf viewer on the quotation link", async () => {
  const seed = await api("/api/e2e/stage", { stage: "quote" });
  jobId = seed.json.jobId;
  quoteToken = seed.json.token;
  await sql("update public.quotations set status = 'sent', sent_at = now(), completed_at = now() where id = $1", [seed.json.quotationId]);
  const info = await fetch(`${base}/api/pdf-pages?src=${encodeURIComponent(`/api/pdf/quote/${quoteToken}`)}&info=1`);
  const ij = await info.json().catch(() => ({}));
  check("1: the page service counts the pages of our quotation PDF", info.status === 200 && ij.pages >= 1, JSON.stringify(ij));
  const png = await fetch(`${base}/api/pdf-pages?src=${encodeURIComponent(`/api/pdf/quote/${quoteToken}`)}&page=1`);
  check("1: a page comes back as a picture", png.status === 200 && (png.headers.get("content-type") ?? "").includes("image/png") && (await png.arrayBuffer()).byteLength > 2000);
  const bad = await fetch(`${base}/api/pdf-pages?src=${encodeURIComponent("/api/export/accounts")}&info=1`);
  check("1: anything but our own PDFs is refused", bad.status === 400);
  const { browser, page } = await browserFor("owner", { viewport: { width: 420, height: 860 }, touch: true, mobile: true });
  await go(page, `${base}/quote/${quoteToken}`);
  check("1: the link has a View button that opens the viewer, not a new tab", (await page.locator("[data-doc-viewer-open]").count()) === 1 && (await page.locator('a[target="_blank"][href*="/api/pdf/quote"]').count()) === 0);
  await page.locator("[data-doc-viewer-open]").click();
  await page.locator("[data-doc-viewer]").waitFor({ timeout: 10000 });
  const loaded = await until(async () => page.locator('img[data-doc-page="1"]').evaluate((img) => img.complete && img.naturalWidth > 100).catch(() => false), 40, 500);
  check("1: the first page shows inside the viewer", !!loaded);
  const dl = page.locator("[data-doc-download]");
  check("1: Download PDF sits at the bottom with a clean file name", (await dl.count()) === 1 && /^OFJ Quotation Q-STAGE-1\.pdf$/.test((await dl.getAttribute("download")) ?? ""), (await dl.getAttribute("download")) ?? "");
  check("1: zoom buttons are there", (await page.getByRole("button", { name: "Zoom in" }).count()) === 1);
  await page.locator("[data-doc-back]").click();
  check("1: Back returns to the link page", (await page.locator("[data-doc-viewer]").count()) === 0 && (await page.locator("[data-doc-viewer-open]").count()) === 1);
  await browser.close();
});

/* ---------------- 2. The viewer on the proforma link, and Share PDF in the send window ---------------- */
await section("2 proforma link and share", async () => {
  cleanupDb();
  const seed = await api("/api/e2e/stage", { stage: "ready" });
  jobId = seed.json.jobId;
  const token = seed.json.invoice?.token;
  const cust = await fetch(`${base}/proforma/${token}`);
  const t = await cust.text();
  check("2: the proforma link opens its PDF inside the page", cust.status === 200 && /data-doc-viewer-open/.test(t));
  const { browser, page } = await browserFor("service_advisor", { viewport: { width: 1366, height: 1100 } });
  await go(page, `${base}/jobs/${jobId}/invoice`);
  await page.locator('[data-ready-send="proforma"] button').first().click();
  await page.locator("[data-pay-how]").waitFor({ timeout: 10000 });
  await page.locator('[data-expected="cash"]').click();
  await page.locator("[data-pay-continue]").click();
  await page.locator("textarea").first().waitFor({ timeout: 15000 });
  check("2: Share PDF sits under Open WhatsApp in the send window", (await page.locator("[data-share-pdf] button").count()) === 1 && /Share PDF/.test(await page.locator("[data-share-pdf]").textContent()));
  // On a PC the share sheet does not exist: the PDF downloads and a hint says where to attach it.
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }).catch(() => null), page.locator("[data-share-pdf] button").click()]);
  check("2: on a PC Share PDF downloads the file with a clean name", !!download && /^OFJ Proforma PRO-\d{5}\.pdf$/.test(download.suggestedFilename()), download?.suggestedFilename());
  const hint = await until(async () => ((await page.locator("[data-share-hint]").count()) ? 1 : null), 20, 300);
  check("2: the hint says where to attach it", !!hint && /paper clip/.test(await page.locator("[data-share-hint]").textContent()));
  const logged = await until(async () => (await sql("select note from public.job_events where job_id = $1 and event_type = 'pdf_shared' limit 1", [jobId]))[0], 20, 500);
  check("2: the share is written on the job", !!logged && /PDF downloaded to share: OFJ Proforma/.test(logged.note), logged?.note);
  await browser.close();
});

/* ---------------- 3. The supplier LPO: Share PDF, Email to supplier ---------------- */
await section("3 supplier lpo email", async () => {
  const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0]?.id;
  const supplier = (await sql("insert into public.suppliers (name, created_by, updated_by) values ('E2E Supplier', $1, $1) returning id", [owner]))[0];
  const po = (await sql("insert into public.purchase_orders (number, job_id, supplier_id, supplier_name, status, kind, total_cost_aed, approved_by, approved_at, created_by, updated_by) values ('LPO-E2E-1', $1, $2, 'E2E Supplier', 'approved', 'supplier', 200, $3, now(), $3, $3) returning id, verify_token", [jobId, supplier?.id, owner]))[0];
  await sql("insert into public.purchase_order_lines (po_id, part_item_id, position, description, part_number, quantity, unit_cost, created_by, updated_by) values ($1, '22222222-0000-4000-8000-00000000e306', 1, 'front brake pads', 'PAD-STAGE-1', 1, 200, $2, $2)", [po?.id, owner]);
  check("3: a supplier LPO is in place for the test", !!po?.id && !!po?.verify_token);
  const { browser, page } = await browserFor("parts", { viewport: { width: 1366, height: 1100 } });
  await go(page, `${base}/parts/orders/${po.id}`);
  const card = page.locator('[data-supplier-lpo="LPO-E2E-1"]');
  check("3: the card carries Share PDF and Email to supplier", (await card.locator("[data-share-pdf]").count()) === 1 && (await card.locator("[data-lpo-email]").count()) === 1);
  check("3: until the mailbox is connected the card says so", /Email not set up yet/.test((await card.locator("[data-lpo-email-note]").textContent().catch(() => "")) ?? ""));
  await card.locator("[data-lpo-email]").click();
  const result = await until(async () => (await card.locator("[data-lpo-email-result]").count()) ? await card.locator("[data-lpo-email-result]").textContent() : null, 30, 500);
  check("3: pressing Email answers next to the button with the reason", !!result && /Email not set up yet/.test(result), result ?? "");
  check("3: nothing is marked sent", !(await sql("select emailed_at from public.purchase_orders where id = $1", [po.id]))[0]?.emailed_at);
  const pdf = await fetch(`${base}/api/pdf/lpo/${po.verify_token}`);
  const pdfText = await (async () => { const mupdf = await import("mupdf"); const doc = mupdf.Document.openDocument(Buffer.from(await pdf.arrayBuffer()), "application/pdf"); let s = ""; for (let i = 0; i < doc.countPages(); i++) s += doc.loadPage(i).toStructuredText("preserve-whitespace").asText(); return s; })();
  check("3: the supplier copy names no customer and no selling price", pdf.status === 200 && !/stage test customer/i.test(pdfText) && !/300\.00/.test(pdfText) && /PAD-STAGE-1/i.test(pdfText));
  await browser.close();
});

cleanupDb();
await sql("delete from public.purchase_order_lines where po_id in (select id from public.purchase_orders where number = 'LPO-E2E-1')").catch(() => null);
process.exit(summary() ? 1 : 0);
