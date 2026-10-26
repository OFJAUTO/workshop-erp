// The receipt redesign (26 October 2026, the owner's mock): the shared header; three boxes RECEIVED FROM /
// VEHICLE / PAID BY; one FOR line; ONE framed Amount received box (the amount large + in words); the three-part
// summary (total · paid to date · balance remaining, or Paid in full with the green check); the qty/rate/VAT table
// and every repeated total gone; the footer note from Settings; the same template for deposits and payments.
//   node --env-file=.env.local tests/browser/test-receipt.mjs   (dev server; E2E_BASE for another port)
import fs from "node:fs";
import path from "node:path";
import { api, base, cleanupDb, cookieHeader, here, makeChecks, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shot = (name) => path.join(here, "shots", name);
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 8 * 60 * 1000).unref();
const mupdf = await import("mupdf");
const owner = await cookieHeader("owner");
const fetchPdf = async (url) => {
  const r = await fetch(`${base}${url}`, { headers: { cookie: owner } });
  if (r.status !== 200) return { status: r.status, text: "", doc: null };
  const doc = mupdf.Document.openDocument(Buffer.from(await r.arrayBuffer()), "application/pdf");
  let text = "";
  for (let i = 0; i < doc.countPages(); i++) text += doc.loadPage(i).toStructuredText("preserve-whitespace").asText();
  return { status: r.status, text: text.replace(/\s+/g, " "), doc };
};
const save = (doc, name) => fs.writeFileSync(shot(name), doc.loadPage(0).toPixmap(mupdf.Matrix.scale(1.5, 1.5), mupdf.ColorSpace.DeviceRGB, false, true).asPNG());
const money = (n) => n.toLocaleString("en-GB", { minimumFractionDigits: 2 });

cleanupDb();
try {
  /* 1. A deposit receipt (cash, quotation approved with a deposit of 10,000). */
  const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const jobId = seed.jobId;
  await sql("update public.quotations set deposit_aed = 500 where job_id = $1 and status = 'approved'", [jobId]);
  const q = (await sql("select number, total_aed::float8 as total, token from public.quotations where job_id = $1 and status = 'approved'", [jobId]))[0];
  const dep = (await sql("insert into public.payments (job_id, customer_id, method, amount_aed, is_deposit, status, reference) select id, customer_id, 'cash', 500, true, 'recorded', 'E2E-REF-1' from public.jobs where id = $1 returning id, number", [jobId]))[0];
  check("1: the receipt number comes from the trigger", /^RCT-\d{5}$/.test(dep.number), dep.number);
  const d = await fetchPdf(`/api/pdf/receipt/${dep.id}`);
  check("1: the deposit receipt renders", d.status === 200 && /RECEIPT/.test(d.text), String(d.status));
  check("1: the three boxes: received from, vehicle, paid by", /RECEIVED FROM/i.test(d.text) && /VEHICLE/i.test(d.text) && /PAID BY/i.test(d.text) && /Plate Dubai S 30303/i.test(d.text) && /VIN WBA1234567STAGE01/i.test(d.text));
  check("1: the FOR line names the quotation", new RegExp(`FOR Advance payment \\(deposit\\) against quotation ${q.number}`, "i").test(d.text), (d.text.match(/FOR .{0,80}/i) ?? [""])[0]);
  check("1: ONE Amount received box with the amount in words", (d.text.match(/Amount received/gi) ?? []).length === 1 && /Five hundred dirhams only/i.test(d.text));
  check("1: the summary strip: quotation total, paid to date, balance remaining", /Quotation total/i.test(d.text) && /Paid to date/i.test(d.text) && /Balance remaining/i.test(d.text) && d.text.includes(money(q.total)) && d.text.includes(money(q.total - 500)));
  check("1: the amount appears twice only (the box and paid to date)", (d.text.match(/500\.00/g) ?? []).filter((x) => x === "500.00").length === 2, String((d.text.match(/500\.00/g) ?? []).length));
  check("1: the table and the repeats are gone", !/\bQty\b/i.test(d.text) && !/\bRate\b/i.test(d.text) && !/\bVAT\b/i.test(d.text) && !/Received with thanks/i.test(d.text) && !/Amount in words/i.test(d.text));
  check("1: the footer note from Settings", /This is a payment receipt, not a tax invoice/.test(d.text));
  check("1: no staff names", !/E2e |by Omar|Received by/i.test(d.text));
  save(d.doc, "receipt-1-deposit.png");
  const pub = await fetch(`${base}/api/pdf/receipt/${dep.id}?q=${q.token}`);
  check("1: the customer's token still opens it", pub.status === 200);

  /* 2. A full payment on the proforma: Paid in full with the green check, no balance cell. */
  cleanupDb();
  const s2 = (await api("/api/e2e/stage", { stage: "ready" })).json;
  const inv = (await sql("select id, number, total_aed::float8 as total, token from public.invoices where id = $1", [s2.invoice.id]))[0];
  const pay = (await sql("insert into public.payments (job_id, invoice_id, customer_id, method, amount_aed, status, reference) select id, $2, customer_id, 'card', $3, 'recorded', 'SLIP-9' from public.jobs where id = $1 returning id, number", [s2.jobId, inv.id, inv.total]))[0];
  const f = await fetchPdf(`/api/pdf/receipt/${pay.id}`);
  check("2: the payment receipt names the invoice", new RegExp(`Payment against proforma invoice ${inv.number}`, "i").test(f.text), (f.text.match(/FOR .{0,80}/i) ?? [""])[0]);
  check("2: PAID BY Card with the reference", /PAID BY/i.test(f.text) && /CARD/.test(f.text) && /Reference SLIP-9/i.test(f.text));
  check("2: the balance cell says Paid in full with nothing remaining", /BALANCE Paid in full/i.test(f.text) && !/Balance remaining/i.test(f.text));
  save(f.doc, "receipt-2-paidfull.png");

  /* 3. A pending cheque: the note on the box and under the balance. */
  cleanupDb();
  const s3 = (await api("/api/e2e/stage", { stage: "approved" })).json;
  await sql("update public.quotations set deposit_aed = 500 where job_id = $1 and status = 'approved'", [s3.jobId]);
  const chq = (await sql("insert into public.payments (job_id, customer_id, method, amount_aed, is_deposit, status, cheque_number, cheque_bank, cheque_date, cheque_status) select id, customer_id, 'cheque', 500, true, 'recorded', '100234', 'Enbd', current_date, 'pending' from public.jobs where id = $1 returning id", [s3.jobId]))[0];
  const c = await fetchPdf(`/api/pdf/receipt/${chq.id}`);
  check("3: the cheque receipt carries the cheque details and the pending note", /CHEQUE/.test(c.text) && /Cheque no\. 100234/i.test(c.text) && /Cheque pending clearance/i.test(c.text) && /has not cleared yet/i.test(c.text));
  check("3: never Paid in full while the cheque is pending", !/BALANCE Paid in full/i.test(c.text) && /Balance remaining/i.test(c.text) && /counted once cleared/i.test(c.text));
  save(c.doc, "receipt-3-cheque.png");
} catch (e) {
  check("walked without a crash", false, (e?.message ?? String(e)).slice(0, 300));
} finally {
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
