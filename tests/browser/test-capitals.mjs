// CAPITALS saved, not just shown (1 November 2026, B1; Q-00039). A line typed in small letters is SAVED in capitals;
// the quotation PDF prints every line exactly as saved (capitals included); a part with a side prints its name once
// ("HEADLIGHT – FRONT LEFT · GENUINE"), never the name and the side twice; the one legal name "O F J AUTOMOTIVE WORKS
// L.L.C" sits on one line, the bank line included; the migration left no line in small letters except issued tax
// invoices.
// Run: node --env-file=.env.test.local tests/browser/test-capitals.mjs   (test server on 3102)
import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { api, base, browserForId, cleanupDb, go, here, makeChecks, sql } from "./pw-lib.mjs";

const mupdf = await import("mupdf");
const { check, summary } = makeChecks();
const dir = path.join(here, "shots", "capitals");
mkdirSync(dir, { recursive: true });

/** The text lines of every page of a PDF. */
function pdfLines(buf) {
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  const out = [];
  for (let i = 0; i < doc.countPages(); i++) {
    const json = JSON.parse(doc.loadPage(i).toStructuredText("preserve-whitespace").asJSON());
    for (const b of json.blocks ?? []) for (const l of b.lines ?? []) out.push(String(l.text ?? "").replace(/\s+/g, " ").trim());
  }
  return out.filter(Boolean);
}

const advisor = (await sql("select id from public.staff where role_id = 'service_advisor' and is_active order by created_at limit 1"))[0];
const browsers = [];
cleanupDb();
try {
  const q = (await api("/api/e2e/stage", { stage: "quote" })).json;
  const adv = await browserForId(advisor.id, { viewport: { width: 1440, height: 900 } });
  browsers.push(adv);
  await go(adv.page, `${base}/jobs/${q.jobId}/quote/${q.quotationId}`);
  // The advisor types a line in small letters (the Q-00039 words) and a note on it.
  const add = async (body) => adv.page.evaluate(async ([qid, b]) => { const r = await fetch("/api/quote/save", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quotationId: qid, opId: crypto.randomUUID(), ...b }) }); return { status: r.status, json: await r.json().catch(() => null) }; }, [q.quotationId, body]);
  const r1 = await add({ addLine: { line_type: "labour", title: "programming & coding for light and radar" } });
  const line1 = (await sql("select id, title from public.quotation_lines where quotation_id = $1 and title ilike 'programming & coding%' order by created_at desc limit 1", [q.quotationId]))[0];
  check(`A: a line typed in small letters is saved in capitals ("${line1?.title}", ${r1.status})`, line1?.title === "PROGRAMMING & CODING FOR LIGHT AND RADAR");
  await add({ patchLine: { id: line1.id, hours: 2, labour_rate: 350, details: "front and rear radar" } });
  const n1 = (await sql("select details from public.quotation_lines where id = $1", [line1.id]))[0];
  check(`A: its note too ("${n1?.details}")`, n1?.details === "FRONT AND REAR RADAR");
  await add({ patchLine: { id: line1.id, title: "night sky edition - painting of relative chrome parts" } });
  const t2 = (await sql("select title from public.quotation_lines where id = $1", [line1.id]))[0];
  check(`A: a renamed line is saved in capitals ("${t2?.title}")`, t2?.title === "NIGHT SKY EDITION - PAINTING OF RELATIVE CHROME PARTS");

  // A headlight with its side and type: one name on the document.
  const part = (await sql("insert into public.part_items (job_id, description, quantity, confirmed_quantity, cost_aed, supplier, availability, confirm_status, part_type, positions, priced_at, created_by, updated_by) values ($1, 'Headlight', 1, 1, 1000, 'E2E SUPPLIER', 'to_order', 'confirmed', 'genuine', array['Front left'], now(), $2, $2) returning id", [q.jobId, advisor.id]))[0];
  await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, unit_cost, markup_percent, part_item_id, part_type, positions, created_by, updated_by) values ($1, 50, 'part', 'Headlight', 'manual', 1, 1000, 20, $2, 'genuine', array['Front left'], $3, $3)", [q.quotationId, part.id, advisor.id]);
  // A part whose name already says its side never gets the side twice.
  const part2 = (await sql("insert into public.part_items (job_id, description, quantity, confirmed_quantity, cost_aed, supplier, availability, confirm_status, part_type, positions, priced_at, created_by, updated_by) values ($1, 'Front LH light', 1, 1, 900, 'E2E SUPPLIER', 'to_order', 'confirmed', 'genuine', array['Front left'], now(), $2, $2) returning id", [q.jobId, advisor.id]))[0];
  await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, unit_cost, markup_percent, part_item_id, part_type, positions, created_by, updated_by) values ($1, 51, 'part', 'Front LH light', 'manual', 1, 900, 20, $2, 'genuine', array['Front left'], $3, $3)", [q.quotationId, part2.id, advisor.id]);
  const stored = await sql("select title from public.quotation_lines where quotation_id = $1 and is_active and line_type <> 'fee' order by position", [q.quotationId]);
  check(`A: every stored line is in capitals (${stored.map((s) => s.title).join(" | ")})`, stored.every((s) => s.title === s.title.toUpperCase()));

  /* ---------- B. The PDF prints the lines exactly as saved ---------- */
  const token = (await sql("select token from public.quotations where id = $1", [q.quotationId]))[0]?.token;
  const res = await fetch(`${base}/api/pdf/quote/${token}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(path.join(dir, "quotation.pdf"), buf);
  const lines = pdfLines(buf);
  const all = lines.join("\n");
  check("B: the PDF prints the typed line in capitals, exactly as saved", all.includes("NIGHT SKY EDITION - PAINTING OF RELATIVE CHROME PARTS"));
  check("B: the small-letter words never appear", !/night sky edition|programming & coding/.test(all));
  check(`B: the headlight prints once with its side and type ("HEADLIGHT – FRONT LEFT · GENUINE")`, lines.some((l) => l.includes("HEADLIGHT – FRONT LEFT · GENUINE")));
  check("B: no separate side line repeats it", !lines.some((l) => l === "FRONT LEFT"));
  check(`B: "FRONT LH LIGHT" does not get the side twice`, lines.some((l) => l.includes("FRONT LH LIGHT · GENUINE")) && !all.includes("FRONT LH LIGHT – FRONT LEFT"));
  const legal = lines.filter((l) => l.includes("O F J AUTOMOTIVE WORKS L.L.C"));
  check(`B: the legal name is whole on one line (${legal.length} times)`, legal.length >= 1 && !lines.some((l) => /^L\.L\.C$/.test(l) || /AUTOMOTIVE$/.test(l)));
  const bankAt = lines.findIndex((l) => l === "BANK DETAILS");
  check("B: the bank details carry the same legal name, whole on its line", bankAt >= 0 && lines.slice(bankAt, bankAt + 5).some((l) => l === "O F J AUTOMOTIVE WORKS L.L.C"));

  /* ---------- C. The conversion (test database) ---------- */
  const left = (await sql("select count(*)::int as n from public.quotation_lines where is_active and (title is distinct from upper(title) or details is distinct from upper(details))"))[0];
  check(`C: no quotation or estimate line left in small letters (${left?.n})`, left?.n === 0);
  const proformas = (await sql("select count(*)::int as n from public.invoice_lines il join public.invoices i on i.id = il.invoice_id where i.kind = 'proforma' and il.description is distinct from upper(il.description)"))[0];
  check(`C: no proforma line left in small letters (${proformas?.n})`, proformas?.n === 0);
  const svc = (await sql("select count(*)::int as n from public.services where name is distinct from upper(name)"))[0];
  check(`C: the services list is in capitals (${svc?.n} left)`, svc?.n === 0);
  const tax = (await sql("select count(*)::int as n from public.invoice_lines il join public.invoices i on i.id = il.invoice_id where i.kind in ('tax_invoice', 'credit_note') and il.description is distinct from upper(il.description)"))[0];
  check(`C: issued tax invoices keep their words exactly (${tax?.n} lines in small letters untouched)`, typeof tax?.n === "number");
} finally {
  for (const b of browsers) await b.browser.close().catch(() => {});
  cleanupDb();
}
summary();
