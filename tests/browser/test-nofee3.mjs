// Section 3 proof (23 October 2026, afternoon): the inspection report (customer link and PDF) no longer carries the
// line "If no work is approved after the inspection, an inspection fee of AED … will apply."; it stays on the gate-in
// approval page only (test-fee checks that page still shows it with the car's own amount).
//   node --env-file=.env.local tests/browser/test-nofee3.mjs   (dev server; E2E_BASE for another port)
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { api, base, browserFor, cleanupDb, go, here, makeChecks, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shot = (name) => path.join(here, "shots", name);
cleanupDb();
const seed = await api("/api/e2e/stage", { stage: "quote" });
const jobId = seed.json.jobId;
const insp = (await sql("select id from public.inspections where job_id = $1 and is_active limit 1", [jobId]))[0];
const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active limit 1"))[0].id;
await sql("update public.inspections set status = 'approved', approved_at = coalesce(approved_at, now()), approved_by = coalesce(approved_by, $2), submitted_at = coalesce(submitted_at, now()) where id = $1", [insp.id, owner]);
const token = randomBytes(18).toString("base64url");
await sql("insert into public.report_links (job_id, inspection_id, token, created_by, updated_by) values ($1, $2, $3, $4, $4)", [jobId, insp.id, token, owner]);
const { browser, page } = await browserFor("owner", { viewport: { width: 430, height: 932 } });
try {
  const r = await fetch(`${base}/api/pdf/report/${token}`);
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(Buffer.from(await r.arrayBuffer()), "application/pdf");
  let text = "";
  for (let i = 0; i < doc.countPages(); i++) text += doc.loadPage(i).toStructuredText("preserve-whitespace").asText();
  text = text.replace(/\s+/g, " ");
  check("1: the report PDF is made", r.status === 200 && /INSPECTION REPORT/i.test(text), String(r.status));
  check("1: the report PDF has no inspection fee line", !/inspection fee/i.test(text) && !/will apply/i.test(text), (text.match(/.{0,60}inspection fee.{0,40}/i) ?? [""])[0]);
  const last = doc.loadPage(doc.countPages() - 1);
  fs.writeFileSync(shot("nofee3-1-report-pdf.png"), last.toPixmap(mupdf.Matrix.scale(1.4, 1.4), mupdf.ColorSpace.DeviceRGB, false, true).asPNG());
  await go(page, `${base}/report/${token}`);
  const body = ((await page.textContent("body")) ?? "").replace(/\s+/g, " ");
  check("2: the customer's report link has no inspection fee line", /Inspection report/i.test(body) && !/inspection fee/i.test(body), body.slice(0, 120));
  await page.screenshot({ path: shot("nofee3-2-report-link.png"), fullPage: true });
} catch (e) {
  check("walked without a crash", false, (e?.message ?? String(e)).slice(0, 300));
} finally {
  await browser.close();
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
