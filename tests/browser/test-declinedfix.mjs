// DECLINED-WORK INVOICE FIX (5 November 2026, J-00970): the Lines box shows the INVOICE'S OWN lines
// and total; the declined list leaves the note for its own grouped page-2 section (Replace now →
// Replace → Advisory, two columns, repeats removed, labour/consumables/Other/service packages never
// on it); a 40+ item invoice passes the PDF overlap check that the old layout failed.
//   node --env-file=.env.test.local tests/browser/test-declinedfix.mjs   (test server on 3102)
import fs from "node:fs";
import path from "node:path";
import { api, base, browserFor, cleanupDb, go, here, makeChecks, sql } from "./pw-lib.mjs";

const mupdf = await import("mupdf");
const { checkPdf, moneyProblems } = await import("../unit/pdf-check-lib.mjs");
const { check, summary } = makeChecks();
const dir = path.join(here, "shots", "declined-fix");
fs.mkdirSync(dir, { recursive: true });

cleanupDb();
const seed = await api("/api/e2e/stage", { stage: "quote" });
const jobId = seed.json?.jobId;
if (!jobId) { console.error("seed failed"); process.exit(1); }
// A 1,500 fee, charged with the current wording (+ VAT 75 = 1,575.00), inspection clocked.
await sql("update public.inspections set started_at = now() - interval '2 hours', submitted_at = now() - interval '1 hour', elapsed_minutes = 60 where job_id = $1", [jobId]);
await sql("update public.jobs set inspection_fee_aed = 1500 where id = $1", [jobId]); // fee_choice is locked after approval: never bundle it
// 40+ real findings, plus the four kinds that must NEVER reach the document, plus a duplicate pair.
const vals = [];
for (let i = 1; i <= 42; i++) vals.push(`('${jobId}', (select vehicle_id from public.jobs where id = '${jobId}'), (select customer_id from public.jobs where id = '${jobId}'), 'TEST FINDING ${String(i).padStart(2, "0")} – COMPONENT WORN', '${i <= 6 ? "Replace now" : i <= 24 ? "Replace" : "Advisory"}', now(), now() + interval '14 days')`);
for (const [t, s] of [["LABOUR CHARGES – TURBOCHARGER ASSEMBLY REPLACEMENT", "Replace"], ["CONSUMABLES", "Advisory"], ["Other", "Replace"], ["MINOR SERVICE", "Advisory"], ["Rear brake pads", "Advisory"], ["REAR BRAKE PADS", "Replace now"]]) {
  vals.push(`('${jobId}', (select vehicle_id from public.jobs where id = '${jobId}'), (select customer_id from public.jobs where id = '${jobId}'), '${t}', '${s}', now(), now() + interval '14 days')`);
}
await sql(`insert into public.declined_work (job_id, vehicle_id, customer_id, title, severity, declined_at, follow_up_due_at) values ${vals.join(", ")}`);
const [{ n: seeded }] = await sql("select count(*)::int as n from public.declined_work where job_id = $1", [jobId]);
if (seeded < 48) { console.error(`declined_work seeds missing: ${seeded}`); process.exit(1); }

/* ---------- A. The owner declines all work through the screen (the real path) ---------- */
const { browser, page } = await browserFor("owner", { viewport: { width: 1440, height: 1000 } });
try {
  await go(page, `${base}/jobs/${jobId}`);
  await page.locator("[data-declined-all]").first().click();
  await page.locator("[data-declined-charge]").click();
  await page.locator("[data-declined-result]").waitFor({ timeout: 30000 });
  const inv = (await sql("select id, number, token, notes, total_aed, taxable_aed, vat_aed from public.invoices where job_id = $1 and kind = 'tax_invoice' and is_active order by created_at desc limit 1", [jobId]))[0];
  check("A1: the tax invoice lands at AED 1,575.00 (1,500.00 + VAT 75.00)", Number(inv.total_aed) === 1575 && Number(inv.taxable_aed) === 1500 && Number(inv.vat_aed) === 75, JSON.stringify({ total: inv.total_aed, taxable: inv.taxable_aed, vat: inv.vat_aed }));
  check("A2: the note carries NO declined list", !/Recommended work declined/.test(inv.notes ?? ""), inv.notes ?? "(empty)");

  /* ---------- B. The money page's Lines box = the invoice's own lines ---------- */
  await go(page, `${base}/jobs/${jobId}/invoice`);
  const src = await page.locator("[data-lines-source]").getAttribute("data-lines-source");
  const boxText = (await page.locator("[data-lines-source]").textContent()) ?? "";
  check("B1: the Lines box shows the INVOICE's own lines", src === "invoice" && /INSPECTION CHARGES/i.test(boxText) && /own lines/.test(boxText), `${src} · ${boxText.slice(0, 120)}`);
  check("B2: its totals ARE the invoice's (1,500.00 · 75.00 · 1,575.00)", /1,500\.00/.test(boxText) && /75\.00/.test(boxText) && (await page.locator("[data-lines-total]").getAttribute("data-lines-total")) === "1,575.00");
  await page.locator("[data-lines-source]").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(dir, "b1-lines-box.png") });

  /* ---------- C. The job card's own grouped section ---------- */
  await go(page, `${base}/jobs/${jobId}`);
  check("C1: the job card shows the grouped declined section", (await page.locator("[data-declined-section]").count()) === 1 && (await page.locator("[data-declined-group]").count()) === 3);

  /* ---------- D. The customer's page: summary line + grouped section, filtered and de-duplicated ---------- */
  // The action also adds its own derived items (the report's findings, the quoted lines), so the
  // expected figures come from THE rules over what the database now holds - never a guessed number.
  const { cleanDeclined, groupDeclined } = await import("../../src/lib/declined-doc.ts");
  const dwRows = await sql("select title, severity from public.declined_work where job_id = $1 and is_active", [jobId]);
  const expected = cleanDeclined(dwRows);
  const expGroups = groupDeclined(dwRows);
  check("D0: the rules keep at least the 43 seeded real items and drop the four sold kinds", expected.length >= 43 && expected.length < dwRows.length, `${expected.length} of ${dwRows.length}`);
  const cp = await (await fetch(`${base}/invoice/${inv.token}`)).text();
  check("D1: the summary line and the section are on the customer's page", new RegExp(`${expected.length} recommended items declined by the customer – listed below`).test(cp) && /data-declined-section/.test(cp));
  check("D2: labour, consumables, Other and service packages are NOT in the section", !/LABOUR CHARGES/i.test(cp) && !/MINOR SERVICE/i.test(cp));
  // The page's text appears once in the HTML and once in Next's inline payload, so the count is
  // taken inside the section's own markup only.
  const sectionHtml = cp.slice(cp.indexOf("data-declined-section"), cp.indexOf("</section>", cp.indexOf("data-declined-section")));
  check("D3: the duplicate appears once, under its worst group", (sectionHtml.match(/Rear brake pads/gi) ?? []).length === 1, String((sectionHtml.match(/Rear brake pads/gi) ?? []).length));
  const count = Number(cp.match(/data-declined-count="(\d+)"/)?.[1] ?? 0);
  check("D4: the section's count is exactly the rules' count", count === expected.length, `${count} vs ${expected.length}`);

  /* ---------- E. The PDF: clean page 1, the section from page 2, and the overlap check PASSES ---------- */
  const pdf = Buffer.from(await (await fetch(`${base}/api/pdf/invoice/${inv.token}`)).arrayBuffer());
  fs.writeFileSync(path.join(dir, "e-invoice.pdf"), pdf);
  const doc = mupdf.Document.openDocument(pdf, "application/pdf");
  const pageText = (i) => doc.loadPage(i).toStructuredText().asText();
  check("E1: at least two pages, the list never on page 1", doc.countPages() >= 2 && !/RECOMMENDED WORK DECLINED BY THE CUSTOMER/.test(pageText(0)));
  check("E2: page 1 carries the one summary line and the totals", new RegExp(`${expected.length} recommended items declined by the customer – listed on page 2`).test(pageText(0)) && /1,500\.00/.test(pageText(0)));
  check("E3: the section heads page 2, grouped with the rules' group counts", new RegExp(`RECOMMENDED WORK DECLINED BY THE CUSTOMER · ${expected.length}`).test(pageText(1)) && new RegExp(`${expGroups[0].label} · ${expGroups[0].items.length}`, "i").test(pageText(1)));
  let all = ""; for (let i = 0; i < doc.countPages(); i++) all += pageText(i);
  check("E4: nothing filtered leaks into the PDF", !/LABOUR CHARGES/i.test(all) && !/MINOR SERVICE/i.test(all));
  const problems = [...checkPdf(pdf, inv.number), ...moneyProblems(pdf, inv.number, { taxDocument: true })];
  check("E5: THE PDF CHECK PASSES - no overlap, no cut-off, money printed once", problems.length === 0, problems.slice(0, 3).join(" | "));

  /* ---------- F. An OLD invoice (the list still inside its note) renders the same way ---------- */
  await sql("update public.declined_work set is_active = false where job_id = $1", [jobId]);
  await sql(`update public.invoices set notes = 'Recommended work declined by the customer:' || E'\\n' || '• Front shock absorbers – Replace now' || E'\\n' || '• Cabin filter – Advisory' where id = $1`, [inv.id]);
  const cp2 = await (await fetch(`${base}/invoice/${inv.token}`)).text();
  check("F1: an old-style note is read into the section and never shown raw", /data-declined-section/.test(cp2) && /Front shock absorbers/.test(cp2) && !/data-invoice-note/.test(cp2));
  const pdf2 = Buffer.from(await (await fetch(`${base}/api/pdf/invoice/${inv.token}`)).arrayBuffer());
  const doc2 = mupdf.Document.openDocument(pdf2, "application/pdf");
  let all2 = ""; for (let i = 0; i < doc2.countPages(); i++) all2 += doc2.loadPage(i).toStructuredText().asText();
  check("F2: the old invoice's PDF shows the section and passes the check", /RECOMMENDED WORK DECLINED BY THE CUSTOMER · 2/.test(all2) && checkPdf(pdf2, "old").length === 0);
} finally {
  await browser.close().catch(() => {});
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
