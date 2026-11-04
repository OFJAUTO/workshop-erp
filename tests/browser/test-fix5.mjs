// Fix 5 of 4 November 2026: PRINT (INTERNAL) on the inspection - the workshop's own A4 copy.
//   A. Full list: INTERNAL header, car facts, WORK NEEDED first (grade + empty "Part ordered" box + a notes line),
//      the measured parts, then the FULL CHECKLIST - and NO customer name, NO phone, NO prices.
//   B. Findings only: no full checklist. C. With photos renders too. D. Blank checklist: header filled, empty boxes.
//   E. Who: the workshop manager and the gate-in person can print it; a technician cannot; the button is on the page.
// Run: node --env-file=.env.test.local tests/browser/test-fix5.mjs   (test server on 3102: npm run test:server)
import fs from "node:fs";
import path from "node:path";
import { MANAGER_MECH, api, base, browserFor, browserForId, cookieHeader, cleanupDb, go, here, makeChecks, sql } from "./pw-lib.mjs";

const mupdf = await import("mupdf");
const { pagePng } = await import("../unit/pdf-check-lib.mjs");
const { check, summary } = makeChecks();
const dir = path.join(here, "shots", "fix5");
fs.mkdirSync(dir, { recursive: true });

cleanupDb();
const seed = await api("/api/e2e/stage", { stage: "quote" });
const jobId = seed.json?.jobId;
if (!jobId) { console.error("seed failed"); process.exit(1); }
const [{ full_name: custName }] = await sql("select c.full_name from public.customers c join public.jobs j on j.customer_id = c.id where j.id = $1", [jobId]);

const textOf = (buf) => {
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  return Array.from({ length: doc.countPages() }, (_, i) => doc.loadPage(i).toStructuredText().asText()).join("\n").replace(/\s+/g, " ");
};
async function fetchPdf(role, qs) {
  const r = await fetch(`${base}/api/pdf/inspection-internal/${jobId}${qs}`, { headers: { cookie: await cookieHeader(role) } });
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, ok: r.ok && buf.slice(0, 4).toString() === "%PDF", buf };
}

/* ---------------- A. The full internal print ---------------- */
const full = await fetchPdf("workshop_manager", "?mode=full");
check("A1: the full internal PDF renders", full.ok, `status ${full.status}`);
const fullText = full.ok ? textOf(full.buf) : "";
check("A2: every page says INTERNAL – NOT FOR THE CUSTOMER", /INTERNAL – NOT FOR THE CUSTOMER/.test(fullText));
check("A3: the findings come first with their grade and the Part ordered column", /WORK NEEDED/.test(fullText) && /Part ordered/i.test(fullText) && /REPLACE/.test(fullText));
check("A4: the full checklist follows", /FULL CHECKLIST/.test(fullText));
check("A5: no customer name, no phone, no prices", !!custName && !fullText.includes(custName) && !/\+971/.test(fullText) && !/AED/.test(fullText), custName);
check("A6: the car facts and the technician are in the header", /Dubai S 30303/i.test(fullText) && /Technician/i.test(fullText));
if (full.ok) fs.writeFileSync(path.join(dir, "full-p1.png"), pagePng(full.buf, 0, 1.3));

/* ---------------- B + C. Findings only; with photos ---------------- */
const findings = await fetchPdf("workshop_manager", "?mode=findings");
const findingsText = findings.ok ? textOf(findings.buf) : "";
check("B1: findings-only leaves the full checklist out", findings.ok && /WORK NEEDED/.test(findingsText) && !/FULL CHECKLIST/.test(findingsText));
if (findings.ok) fs.writeFileSync(path.join(dir, "findings-p1.png"), pagePng(findings.buf, 0, 1.3));
const withPhotos = await fetchPdf("workshop_manager", "?mode=full&photos=1");
check("C1: the with-photos print renders", withPhotos.ok, `status ${withPhotos.status}`);

/* ---------------- D. The blank checklist ---------------- */
const blank = await fetchPdf("workshop_manager", "?mode=blank");
const blankText = blank.ok ? textOf(blank.buf) : "";
check("D1: the blank checklist prints with the header filled and empty boxes", blank.ok && /BLANK CHECKLIST/.test(blankText) && /Technician: ____/.test(blankText) && /CHECKLIST \(fill by hand\)/.test(blankText));
check("D2: it carries the car facts, nothing of the customer", /Dubai S 30303/i.test(blankText) && !!custName && !blankText.includes(custName));
if (blank.ok) fs.writeFileSync(path.join(dir, "blank-p1.png"), pagePng(blank.buf, 0, 1.3));

/* ---------------- E. Who may print; the button on the page ---------------- */
const gate = await fetchPdf("gate_in", "?mode=findings");
check("E1: the gate-in person can print it (read-only help for the parts desk)", gate.ok, `status ${gate.status}`);
const tech = await fetchPdf("technician", "?mode=full");
check("E2: a technician cannot", tech.status === 403, `status ${tech.status}`);

const { browser, page } = await browserForId(MANAGER_MECH, { viewport: { width: 1366, height: 900 } });
await go(page, `${base}/jobs/${jobId}/inspection`);
check("E3: the Print (internal) menu is on the inspection page with its four choices", (await page.locator("[data-print-internal]").count()) === 1 && (await page.locator("[data-print-internal-link]").count()) === 4);
await page.locator("[data-print-internal] summary").click();
await page.screenshot({ path: path.join(dir, "e3-print-menu.png"), clip: { x: 0, y: 0, width: 1366, height: 360 } });
await browser.close();

const { browser: gb, page: gp } = await browserFor("gate_in", { viewport: { width: 1280, height: 900 } });
await go(gp, `${base}/jobs/${jobId}/inspection`);
check("E4: the gate-in person sees the print button too (and nothing that changes the report)", (await gp.locator("[data-print-internal]").count()) === 1 && (await gp.getByRole("button", { name: /approve|send back/i }).count()) === 0);
await gb.close();

cleanupDb();
process.exit(summary() ? 1 : 0);
