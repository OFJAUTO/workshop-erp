// Section 3 of 27 October (afternoon): long descriptions are never cut. A 1,500-character labour description is kept
// whole, shows whole in the editor with a live counter, prints whole on the quotation PDF and the invoice PDF; above
// the 3,000 limit the editor saves NOTHING (no half text) and the server refuses; a complimentary labour line with
// no hours prints nothing in the quantity column (never "0.0 h").
//   node --env-file=.env.test.local tests/browser/test-longdesc.mjs   (dev server)
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
  // 28 Oct: the other paths keep long text whole too.
  const post = (body) => page.evaluate(async (b) => { const r = await fetch("/api/quote/save", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }); return { status: r.status, body: await r.text() }; }, body);
  const partWords = `E2E LONG PART ${"ENGINE MOUNT LEFT HAND WITH BRACKET AND HARDWARE ".repeat(9)}END`.trim();
  const rp = await post({ quotationId: qid, opId: `e2e-longpart-${Date.now()}`, requestPart: { description: partWords, quantity: 1 } });
  const reqLen = (await sql("select max(length(label))::int as n from public.part_requests where job_id = $1 and label ilike 'E2E LONG PART%'", [jobId]))[0]?.n ?? 0;
  check("3b: a part asked from the quotation keeps its whole name (was cut at 200)", reqLen === partWords.length, `${reqLen} of ${partWords.length} · ${rp.status} ${rp.body.slice(0, 160)}`);
  const note2500 = `E2E NOTE ${"Please note the car needs a follow-up visit. ".repeat(60)}`.slice(0, 2500);
  const n1 = await post({ quotationId: qid, header: { customer_note: note2500 } });
  const noteLen = (await sql("select length(customer_note)::int as n from public.quotations where id = $1", [qid]))[0]?.n ?? 0;
  check("3c: the note to the customer keeps 2,500 characters (was cut at 2,000)", noteLen === note2500.trim().length, `${n1.status} · ${noteLen}`);
  const n2 = await post({ quotationId: qid, header: { customer_note: "X".repeat(3200) } });
  const noteLen2 = (await sql("select length(customer_note)::int as n from public.quotations where id = $1", [qid]))[0]?.n ?? 0;
  check("3c: above 3,000 the note is refused and the saved one kept", n2.status === 400 && /Too long/.test(n2.body) && noteLen2 === noteLen, `${n2.status} · ${noteLen2}`);
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
