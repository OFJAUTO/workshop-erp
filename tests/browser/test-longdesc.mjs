// Section 3 of 27 October (afternoon): long descriptions are never cut. A 1,500-character labour description is kept
// whole, shows whole in the editor with a live counter, prints whole on the quotation PDF and the invoice PDF; above
// the 3,000 limit the editor saves NOTHING (no half text) and the server refuses; a complimentary labour line with
// no hours prints nothing in the quantity column (never "0.0 h").
//   node --env-file=.env.local tests/browser/test-longdesc.mjs   (dev server)
import { api, base, browserFor, cleanupDb, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 12 * 60 * 1000).unref();
cleanupDb();

const seed = await api("/api/e2e/stage", { stage: "quote" });
const jobId = seed.json?.jobId;
const qid = seed.json?.quotationId;
if (!jobId || !qid) { console.error("seed failed"); process.exit(1); }
const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active limit 1"))[0].id;
const words = "CYLINDER BLOCK BORING / ENGINE BLOCK DECK RESURFACING / CYLINDER HEAD RESURFACING AND PRESSURE TESTING / THREAD REPAIR AND MACHINING OF DAMAGED THREADS / VALVE GUIDE REPLACEMENT AND REAMING / ";
let LONG = "LATHE CHARGES - ";
for (let i = 0; LONG.length < 1500; i++) LONG += `${words.trim()} STEP ${i + 1} / `;
LONG = `${LONG.slice(0, 1480).trim()} FINAL CHECK END`;
const [longLine] = await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, hours, labour_rate, created_by, updated_by) values ($1, 40, 'labour', $2, 'manual', 1, 2, 350, $3, $3) returning id", [qid, LONG, owner]);
await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, hours, labour_rate, price_display, created_by, updated_by) values ($1, 41, 'labour', 'E2E LATHE COMPLIMENTARY', 'manual', 1, 0, 0, 'complimentary', $2, $2)", [qid, owner]);
const [shortLine] = await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, hours, labour_rate, created_by, updated_by) values ($1, 42, 'labour', 'E2E SHORT JOB', 'manual', 1, 1, 350, $2, $2) returning id", [qid, owner]);
check("0: the 1,500-character description is stored whole", (await sql("select length(title)::int as n from public.quotation_lines where id = $1", [longLine.id]))[0].n === LONG.length);

const norm = (t) => t.replace(/[\s­-]+/g, "").toUpperCase();
const pdfText = async (url) => {
  const r = await fetch(url);
  const buf = Buffer.from(await r.arrayBuffer());
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  let text = "";
  for (let i = 0; i < doc.countPages(); i++) text += doc.loadPage(i).toStructuredText().asText() + "\n";
  return text;
};

const { browser, page } = await browserFor("service_advisor", { viewport: { width: 1366, height: 1300 } });
try {
  await go(page, `${base}/jobs/${jobId}/quote/${qid}`);
  await page.waitForSelector(`#name-${longLine.id}`, { timeout: 30000 });
  const shown = await page.locator(`#name-${longLine.id}`).inputValue();
  check("1: the editor shows the whole description (nothing cut)", shown.length === LONG.length && shown.endsWith("FINAL CHECK END"), String(shown.length));
  const counter = await page.locator(`#name-${longLine.id} >> xpath=ancestor::div[contains(@class,'relative')][1]`).locator("[data-text-counter]").first().textContent().catch(() => "");
  check("1: a live counter shows how long it is", /1,4\d\d \/ 3,000 characters|1,5\d\d \/ 3,000 characters/.test(counter ?? ""), counter ?? "");
  const box = await page.locator(`#name-${longLine.id}`).boundingBox();
  check("1: the box grows to show all of it (no hidden overflow)", !!box && box.height > 150, JSON.stringify(box));
  await page.screenshot({ path: "tests/browser/shots/longdesc-editor.png" });

  // Above the limit: nothing saved, red counter.
  const tooLong = `E2E OVER ${"X".repeat(3100)}`;
  const name = page.locator(`#name-${shortLine.id}`);
  await name.click();
  await name.fill(tooLong);
  await sleep(1800);
  const red = page.locator(`[data-text-counter][data-over="1"]`).first();
  check("2: above 3,000 the counter turns red and says by how much", (await red.count()) === 1 && /shorten by 1\d\d; nothing is saved until it fits/.test((await red.textContent()) ?? ""));
  const stored = (await sql("select title from public.quotation_lines where id = $1", [shortLine.id]))[0].title;
  check("2: nothing is saved while it is too long (no half text)", stored === "E2E SHORT JOB", String(stored).slice(0, 40));
  // Back under the limit: the whole text saves.
  const ok = `E2E FITS ${"Y".repeat(1990)}`;
  await name.fill(ok);
  await sleep(2500);
  const stored2 = (await sql("select length(title)::int as n from public.quotation_lines where id = $1", [shortLine.id]))[0].n;
  check("2: under the limit the whole text saves (2,000 characters)", stored2 === ok.length, String(stored2));
  // The server refuses over-long text sent directly (never cuts it).
  const res = await page.evaluate(async ([q, id, t]) => {
    const r = await fetch("/api/quote/save", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quotationId: q, patchLine: { id, title: t } }) });
    return { status: r.status, body: await r.text() };
  }, [qid, shortLine.id, tooLong]);
  const stored3 = (await sql("select length(title)::int as n from public.quotation_lines where id = $1", [shortLine.id]))[0].n;
  check("3: the server refuses text above the limit and keeps the saved one", /Too long/.test(res.body) && stored3 === ok.length, `${res.status} ${res.body.slice(0, 120)} · ${stored3}`);
} finally {
  await browser.close();
}

// 4. The quotation PDF prints the whole description and no "0.0 h".
await sql("delete from public.quotation_lines where id = $1", [shortLine.id]).catch(() => null);
await sql("update public.quotation_lines set is_active = false where id = $1", [shortLine.id]);
const [tok] = await sql("select token from public.quotations where id = $1", [qid]);
const qText = await pdfText(`${base}/api/pdf/quote/${tok.token}`);
check("4: the quote PDF carries the whole 1,500-character description", norm(qText).includes(norm(LONG)), `${norm(qText).length}`);
check("4: the complimentary lathe line prints no 0.0 h", /E2E LATHE COMPLIMENTARY/i.test(qText) && !/0\.0 h/.test(qText));

// 5. An invoice with the same lines prints them whole too.
const [job] = await sql("select customer_id from public.jobs where id = $1", [jobId]);
const [inv] = await sql("insert into public.invoices (number, kind, job_id, customer_id, status, issued_at, subtotal_aed, taxable_aed, vat_aed, total_aed, token, created_by, updated_by) values ($1, 'tax_invoice', $2, $3, 'issued', now(), 700, 700, 35, 735, $4, $5, $5) returning id, token", [`INV-E2ELD-${Date.now().toString().slice(-6)}`, jobId, job.customer_id, `e2eld${Date.now()}`, owner]);
await sql("insert into public.invoice_lines (invoice_id, position, section, description, details, quantity, unit_price, amount_aed, vat_aed, total_aed, cost_aed) values ($1, 1, 'services', $2, '2.0 h', 2, 350, 700, 35, 735, 0), ($1, 2, 'services', 'E2E LATHE COMPLIMENTARY', null, 0, 0, 0, 0, 0, 0)", [inv.id, LONG]);
const iText = await pdfText(`${base}/api/pdf/invoice/${inv.token}`);
check("5: the invoice PDF carries the whole description", norm(iText).includes(norm(LONG)));
check("5: the invoice prints 2.0 h for the labour and nothing for the complimentary line", /2\.0 h/.test(iText) && !/0\.0 h/.test(iText));

cleanupDb();
process.exit(summary() ? 1 : 0);
