// Queue 4 of 4 November 2026: the parts desk opens every inspection report READ-ONLY - from the job
// (the parts job page), the Parts page ("View inspection" on each car row) and the inspection list
// (/parts/inspections) - prints it internal, and never sees customer names, phones, prices or a
// button that changes the inspection. The print itself is proven by test-fix5; this suite proves the
// WAYS IN and the read-only screen as a real parts login.
//   node --env-file=.env.test.local tests/browser/test-partsinspect.mjs   (test server on 3102)
import fs from "node:fs";
import path from "node:path";
import { api, base, browserFor, cookieHeader, cleanupDb, go, here, makeChecks, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const dir = path.join(here, "shots", "parts-inspect");
fs.mkdirSync(dir, { recursive: true });

cleanupDb();
const seed = await api("/api/e2e/stage", { stage: "quote" });
const jobId = seed.json?.jobId;
if (!jobId) { console.error("seed failed"); process.exit(1); }
const [cust] = await sql("select c.full_name, c.phone from public.customers c join public.jobs j on j.customer_id = c.id where j.id = $1", [jobId]);
const custName = cust?.full_name ?? "";
const custDigits = String(cust?.phone ?? "").replace(/[^\d]/g, "").slice(-9);

const { browser, page } = await browserFor("parts", { viewport: { width: 1366, height: 900 } });
try {
  /* ---------- A. From the Parts page ---------- */
  await go(page, `${base}/parts`);
  await page.locator("[data-all-cars-fold] summary").click();
  const rowLink = page.locator(`[data-all-car="${jobId}"] [data-view-inspection]`);
  check("A1: the car row on the Parts page carries View inspection", (await rowLink.count()) === 1);
  check("A2: the Parts page links the inspection list", (await page.locator("[data-inspection-list-link]").count()) === 1);
  await page.screenshot({ path: path.join(dir, "a1-parts-page-link.png") });
  await rowLink.click();
  await page.waitForURL(`**/jobs/${jobId}/inspection`);
  await page.locator("[data-report-preview]").waitFor();
  check("A3: it opens the inspection report page", true);
  const html = await page.content();
  const phoneRe = new RegExp(custDigits.split("").join("[\\s-]?"));
  check("A4: no customer name on the page", !!custName && !html.toLowerCase().includes(custName.toLowerCase()), custName);
  check("A5: no customer phone on the page", !!custDigits && !phoneRe.test(html));
  check("A6: nothing that changes the inspection", (await page.getByRole("button", { name: /approve|send back|save|submit/i }).count()) === 0);
  check("A7: the Print (internal) menu is there for the parts desk", (await page.locator("[data-print-internal]").count()) === 1);
  await page.locator("[data-report-preview] button").first().click();
  await page.locator("[data-report-attention], [data-report-section]").first().waitFor();
  await page.screenshot({ path: path.join(dir, "a3-report-as-parts.png") });

  /* ---------- B. From the job (the parts job page) ---------- */
  await go(page, `${base}/parts/${jobId}`);
  check("B1: the parts job page carries View inspection", (await page.locator(`[data-view-inspection="${jobId}"]`).count()) === 1);

  /* ---------- C. The inspection list ---------- */
  await go(page, `${base}/parts/inspections`);
  const listRow = page.locator(`[data-inspection-row="${jobId}"]`);
  const [vplate] = await sql("select v.plate_code, v.plate_number from public.vehicles v join public.jobs j on j.vehicle_id = v.id where j.id = $1", [jobId]);
  const rowText = (await listRow.textContent()) ?? "";
  check("C1: the list shows the car's inspection as Approved, with the car's plate (the vehicle read works)", (await listRow.count()) === 1 && (await listRow.getAttribute("data-inspection-status")) === "approved" && rowText.includes(vplate.plate_number), rowText.slice(0, 80));
  const listHtml = await page.content();
  check("C2: no customer name on the list", !!custName && !listHtml.toLowerCase().includes(custName.toLowerCase()));
  await page.screenshot({ path: path.join(dir, "c1-inspection-list.png") });
  // The search narrows by plate; nonsense finds nothing.
  const [plate] = await sql("select v.plate_number from public.vehicles v join public.jobs j on j.vehicle_id = v.id where j.id = $1", [jobId]);
  await go(page, `${base}/parts/inspections?q=${encodeURIComponent(plate.plate_number)}`);
  check("C3: searching the plate finds it", (await page.locator(`[data-inspection-row="${jobId}"]`).count()) === 1);
  await go(page, `${base}/parts/inspections?q=ZZNOSUCH99`);
  check("C4: a nonsense search finds nothing", (await page.locator("[data-inspection-row]").count()) === 0);
  await go(page, `${base}/parts/inspections?q=${encodeURIComponent(plate.plate_number)}`);
  await page.locator(`[data-inspection-row="${jobId}"]`).click();
  await page.waitForURL(`**/jobs/${jobId}/inspection`);
  check("C5: the list row opens the report", true);

  /* ---------- D. The print itself, as the parts login ---------- */
  const r = await fetch(`${base}/api/pdf/inspection-internal/${jobId}?mode=findings`, { headers: { cookie: await cookieHeader("parts") } });
  const buf = Buffer.from(await r.arrayBuffer());
  check("D1: the parts login prints the internal findings PDF", r.ok && buf.slice(0, 4).toString() === "%PDF", `status ${r.status}`);

  /* ---------- E. Server enforcement ---------- */
  const [insp] = await sql("select id from public.inspections where job_id = $1", [jobId]);
  const probe = await fetch(`${base}/api/inspection/body`, { method: "POST", headers: { cookie: await cookieHeader("parts"), "content-type": "application/json" }, body: JSON.stringify({ inspectionId: insp.id, op: "save", finding: { panel: "bonnet" } }) });
  check("E1: a parts login cannot change the inspection (body findings refused)", probe.status === 401 || probe.status === 403, `status ${probe.status}`);
  const techList = await fetch(`${base}/parts/inspections`, { headers: { cookie: await cookieHeader("technician") }, redirect: "manual" });
  check("E2: a technician is turned away from the inspection list", techList.status >= 300 && techList.status < 400, `status ${techList.status}`);
} finally {
  await browser.close().catch(() => {});
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
