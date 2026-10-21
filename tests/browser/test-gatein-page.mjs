// Section 9 proof: the gate-in details page. One staff page with everything from the gate-in, reached
// from the Job card approval box at every stage; "View as customer" shows the exact approval link without
// marking it opened; "Download PDF" is the internal record; the three fold-outs left the job card.
// Run: node --env-file=.env.local tests/browser/test-gatein-page.mjs   (dev server on :3100)
import path from "node:path";
import { api, base, browserFor, cleanupDb, cookieHeader, go, here, makeChecks, settle, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shot = (name) => path.join(here, "shots", name);
const pdfText = async (buf) => {
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  const pages = [];
  for (let i = 0; i < doc.countPages(); i++) pages.push(doc.loadPage(i).toStructuredText("preserve-whitespace").asText());
  return pages.join("\n");
};

cleanupDb();
const seed = await api("/api/e2e/stage", { stage: "assign" });
const jobId = seed.json?.jobId;
if (!jobId) { console.error("seed failed:", JSON.stringify(seed).slice(0, 300)); process.exit(1); }
const advisor = (await sql("select id from public.staff where role_id = 'service_advisor' and is_active limit 1"))[0].id;
// The seed stamps the approval on the job but makes no link rows; the page reads the rows, so two are made:
// an approved one (the state line and View as customer) and a fresh unopened one (the preview proof).
await sql("insert into public.approval_requests (job_id, kind, token, sent_to_name, sent_to_phone, sent_by, sent_at, opened_at, approved_at, approver_name, status, terms_text) values ($1, 'job_card', 'e2e-gatein-tok-1', 'E2e Customer', '+971500000091', $2, now() - interval '2 hours', now() - interval '1 hour', now() - interval '55 minutes', 'E2e Customer', 'approved', 'Terms')", [jobId, advisor]);
await sql("insert into public.approval_requests (job_id, kind, token, sent_to_name, sent_to_phone, sent_by, status, terms_text) values ($1, 'job_card', 'e2e-gatein-tok-2', 'E2e Customer Two', '+971500000092', $2, 'created', 'Terms')", [jobId, advisor]);

/* ---------------- 1. The job card: button in the approval box, fold-outs gone ---------------- */
const { browser, page } = await browserFor("service_advisor", { viewport: { width: 1366, height: 950 } });
await go(page, `${base}/jobs/${jobId}`);
const inBox = await page.locator('[data-stage-card="approval"] [data-gate-in-details]').count();
check("1: the Gate-in details button sits in the Job card approval box", inBox === 1);
const bodyText = ((await page.textContent("body")) ?? "").replace(/\s+/g, " ");
check("1: the three fold-outs left the job card", !/Vehicle and customer details/.test(bodyText) && !/Gate-in photos and videos/.test(bodyText) && (await page.locator("[data-old-parts-history]").count()) === 0);
check("1: the History fold-out stays", /History/.test(bodyText));
await page.locator('[data-stage-card="approval"]').scrollIntoViewIfNeeded();
await page.screenshot({ path: shot("gatein-1-approval-box.png"), clip: (await page.locator('[data-stage-card="approval"]').boundingBox()) ?? undefined });

/* ---------------- 2. The details page itself ---------------- */
await page.locator('[data-stage-card="approval"] [data-gate-in-details]').click();
await page.waitForURL((u) => /\/gate-in$/.test(u.toString()), { timeout: 30000 }).catch(() => null);
await settle(page);
check("2: the button opens /jobs/<id>/gate-in", new RegExp(`/jobs/${jobId}/gate-in$`).test(page.url()), page.url());
const t = ((await page.textContent("body")) ?? "").replace(/\s+/g, " ");
check("2: the approval card names who approved and when", (await page.locator("[data-gate-in-approval]").count()) === 1 && /E2e Customer approved the job card on/.test(t));
check("2: the inspection fee line is there", /Inspection fee if no work is approved: AED/.test(t));
check("2: vehicle and customer, gate-in details and media cards all render", (await page.locator("[data-gate-in-car]").count()) === 1 && (await page.locator("[data-gate-in-details]").count()) === 1 && (await page.locator("[data-gate-in-media]").count()) === 1);
check("2: the gate-in answers are on the page", /Arrived by/.test(t) && /Cleanliness/.test(t) && /Keys/.test(t) && /Mileage/.test(t));
const viewHref = (await page.locator("[data-view-as-customer]").getAttribute("href")) ?? "";
check("2: View as customer points at the newest approval link with preview", /\/approve\/e2e-gatein-tok-2\?preview=1$/.test(viewHref), viewHref);
const pdfHref = (await page.locator("[data-gate-in-pdf]").getAttribute("href")) ?? "";
check("2: Download PDF points at the internal PDF", pdfHref === `/api/pdf/gate-in/${jobId}`, pdfHref);
await page.screenshot({ path: shot("gatein-2-details-page.png"), fullPage: true });

/* ---------------- 3. View as customer: the exact page, never marked as opened ---------------- */
await go(page, `${base}/approve/e2e-gatein-tok-2?preview=1`);
const custText = ((await page.textContent("body")) ?? "").replace(/\s+/g, " ");
check("3: the staff preview is the customer's approval page", /Your approval/i.test(custText) && /Job card/.test(custText));
const afterPreview = (await sql("select opened_at from public.approval_requests where token = 'e2e-gatein-tok-2'"))[0];
check("3: a preview never marks the link opened", afterPreview.opened_at === null, JSON.stringify(afterPreview));
const previewNote = await sql("select count(*)::int as n from public.notifications where type = 'approval_opened' and job_id = $1", [jobId]);
check("3: a preview rings nobody", (previewNote[0]?.n ?? 0) === 0);
await go(page, `${base}/approve/e2e-gatein-tok-2`);
const afterReal = (await sql("select opened_at from public.approval_requests where token = 'e2e-gatein-tok-2'"))[0];
check("3: the customer's own visit still marks it opened", afterReal.opened_at !== null);

/* ---------------- 4. The internal PDF ---------------- */
const cookie = await cookieHeader("service_advisor");
const res = await fetch(`${base}/api/pdf/gate-in/${jobId}`, { headers: { cookie } });
const buf = Buffer.from(await res.arrayBuffer());
check("4: the PDF downloads", res.status === 200 && /pdf/.test(res.headers.get("content-type") ?? "") && buf.length > 5000, `${res.status} ${buf.length}b`);
const text = (await pdfText(buf)).replace(/\s+/g, " ").toUpperCase();
check("4: it is the internal gate-in record", /GATE-IN RECORD/.test(text) && /INTERNAL – NOT FOR THE CUSTOMER|INTERNAL - NOT FOR THE CUSTOMER/.test(text));
check("4: the details and the approval are in it", /ARRIVED BY/.test(text) && /APPROVED BY E2E CUSTOMER/.test(text) && /INSPECTION FEE/.test(text));
const anon = await fetch(`${base}/api/pdf/gate-in/${jobId}`);
check("4: without a login the PDF is refused", anon.status === 401, `${anon.status}`);

await browser.close();
cleanupDb();
process.exit(summary() ? 1 : 0);
