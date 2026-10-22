// Evening section 10 proof: the PPF cutting method. Chips on the PPF line (Hand-cut recommended,
// Pre-cut, Mixed + note), the optional hand-cut surcharge line, the method under the PPF item with the
// ⓘ sentence on the PDF and the link, locked once approved, the big badge on the job card / bodyshop
// page / PPF tablet, "OFJ Bespoke PPF – Gloss · Hand-cut · Full body" on the warranty card, and the month's
// hand-cut against pre-cut table.
// Run: node --env-file=.env.local tests/browser/test-ppfcut10.mjs   (dev server on :3100)
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { api, base, browserFor, cleanupDb, cookieHeader, go, here, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shot = (name) => path.join(here, "shots", name);
const until = async (fn, tries = 30, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const pdfText = async (url, cookie) => {
  const r = await fetch(`${base}${url}`, cookie ? { headers: { cookie } } : undefined);
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(Buffer.from(await r.arrayBuffer()), "application/pdf");
  let t = "";
  for (let i = 0; i < doc.countPages(); i++) t += doc.loadPage(i).toStructuredText("preserve-whitespace").asText();
  return { status: r.status, text: t.replace(/\s+/g, " ") };
};
const SNAP = { key: "ofj_full_protection", name: "OFJ Full Protection Package - Invisible Clear/GLOSSY Bespoke", time_in_workshop: "3-5 working days", pickup_dropoff: true, aftercare_check: true, items: [{ label: "Full body PPF", warranty: "10-year warranty" }, { label: "Ceramic coating for PPF", warranty: null }] };

cleanupDb();
const seed = await api("/api/e2e/stage", { stage: "quote" });
const jobId = seed.json?.jobId;
const qid = seed.json?.quotationId;
if (!jobId || !qid) { console.error("seed failed"); process.exit(1); }
const advisor = (await sql("select id from public.staff where role_id = 'service_advisor' and is_active limit 1"))[0].id;
const pl = (await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, unit_price, package_key, package_items, created_by, updated_by) values ($1, 0, 'package', 'OFJ Full Protection Package', 'manual', 1, 18000, 'ofj_full_protection', $2::jsonb, $3, $3) returning id", [qid, JSON.stringify(SNAP), advisor]))[0];
const lineOf = async () => (await sql("select cut_method, cut_note from public.quotation_lines where id = $1", [pl.id]))[0];

/* ---------------- 1. The chips on the PPF line ---------------- */
const { browser, page } = await browserFor("service_advisor", { viewport: { width: 1440, height: 1000 } });
await go(page, `${base}/jobs/${jobId}/quote/${qid}`);
const box = page.locator(`#item-line-${pl.id} [data-cut-method]`);
check("1: the PPF line shows the three chips, Hand-cut pressed and marked Recommended", (await box.count()) === 1 && (await box.getAttribute("data-cut-method")) === "hand" && /Hand-cut · Recommended/.test((await box.textContent()) ?? ""));
await page.locator(`#item-line-${pl.id} [data-cut-chip="machine"]`).click();
check("1: Pre-cut saves", !!(await until(async () => ((await lineOf()).cut_method === "machine" ? 1 : null))));
await page.locator(`#item-line-${pl.id} [data-cut-chip="mixed"]`).click();
await page.locator(`#item-line-${pl.id} [data-cut-note-box]`).pressSequentially("Bonnet and mirrors pre-cut");
check("1: Mixed opens its note and saves both", !!(await until(async () => { const l = await lineOf(); return l.cut_method === "mixed" && l.cut_note === "Bonnet and mirrors pre-cut" ? 1 : null; })));
await page.locator(`#item-line-${pl.id}`).scrollIntoViewIfNeeded();
await page.screenshot({ path: shot("cut10-1-chips.png"), clip: (await page.locator(`#item-line-${pl.id}`).boundingBox()) ?? undefined });
await page.locator(`#item-line-${pl.id} [data-cut-chip="hand"]`).click();
check("1: back to Hand-cut clears the Mixed note", !!(await until(async () => { const l = await lineOf(); return l.cut_method === "hand" && l.cut_note === null ? 1 : null; })));

/* ---------------- 2. The optional surcharge line ---------------- */
await sql("update public.settings set value = to_jsonb(250) where key = 'ppf_handcut_surcharge_aed'");
await go(page, `${base}/jobs/${jobId}/quote/${qid}`);
await page.locator(`#item-line-${pl.id} [data-cut-chip="machine"]`).click();
await sleep(800);
await page.locator(`#item-line-${pl.id} [data-cut-chip="hand"]`).click();
const sur = await until(async () => (await sql("select id, unit_price::text as p from public.quotation_lines where quotation_id = $1 and title = 'Hand-cut surcharge' and is_active", [qid]))[0]);
check("2: with a surcharge in Settings, Hand-cut adds the surcharge line (AED 250)", !!sur && Number(sur.p) === 250, JSON.stringify(sur ?? {}));
await page.locator(`#item-line-${pl.id} [data-cut-chip="machine"]`).click();
check("2: Pre-cut takes the surcharge line off", !!(await until(async () => ((await sql("select count(*)::int as n from public.quotation_lines where quotation_id = $1 and title = 'Hand-cut surcharge' and is_active", [qid]))[0].n === 0 ? 1 : null))));
await sql("update public.settings set value = to_jsonb(0) where key = 'ppf_handcut_surcharge_aed'");
await browser.close();

/* ---------------- 3. The documents, the job card, the lock ---------------- */
await sql("update public.quotation_lines set is_active = false where quotation_id = $1 and package_key is null", [qid]);
const cookie = await cookieHeader("service_advisor");
const q = await pdfText(`/api/pdf/quotation/${qid}`, cookie);
check("3: the PDF prints the method under the PPF item with the one-sentence explanation", /Full body PPF Machine pre-cut – computer-cut pattern/i.test(q.text) && /Hand-cut film is trimmed on your car/i.test(q.text), q.text.match(/Full body PPF.{0,160}/i)?.[0] ?? `${q.status}`);
await sql("update public.quotations set status = 'sent', sent_at = now(), token = coalesce(token, 'e2e-cut10-tok'), valid_until = now() + interval '7 days' where id = $1", [qid]);
const token = (await sql("select token from public.quotations where id = $1", [qid]))[0].token;
const { browser: cb, page: cp } = await browserFor("owner", { viewport: { width: 480, height: 1300 } });
await go(cp, `${base}/quote/${token}`);
check("3: the link card shows the method with its ⓘ", /Machine pre-cut – computer-cut pattern/.test((await cp.locator("[data-cut-note]").first().textContent()) ?? "") && (await cp.locator("[data-cut-info]").count()) >= 1);
check("3: only the film item carries the method - never the ceramic coating", (await cp.locator("[data-cut-note]").count()) === 1);
await cp.locator("[data-cut-info]").first().click();
check("3: tapping ⓘ opens the one sentence", /Hand-cut film is trimmed on your car/.test((await cp.locator("[data-cut-explain]").first().textContent()) ?? ""));
await cp.locator("[data-package-doc]").scrollIntoViewIfNeeded();
await cp.screenshot({ path: shot("cut10-2-link.png"), clip: (await cp.locator("[data-package-doc]").boundingBox()) ?? undefined });
const { browser: ob, page: op } = await browserFor("owner", { viewport: { width: 1440, height: 1000 } });
await go(op, `${base}/jobs/${jobId}`);
check("3: the job card carries the big PRE-CUT badge", (await op.locator('[data-cut-badge="PRE-CUT"]').count()) === 1);
await op.screenshot({ path: shot("cut10-3-jobcard.png"), clip: { x: 260, y: 0, width: 1180, height: 170 } });
await sql("update public.quotations set status = 'approved' where id = $1", [qid]);
const locked = await fetch(`${base}/api/quote/save`, { method: "POST", headers: { cookie: await cookieHeader("owner"), "content-type": "application/json" }, body: JSON.stringify({ quotationId: qid, patchLine: { id: pl.id, cut_method: "hand" } }) });
check("3: once approved the method is locked (approved with the quote)", locked.status === 423 && (await lineOf()).cut_method === "machine", `${locked.status}`);

/* ---------------- 4. The PPF tablet and the warranty card (bodyshop seed) ---------------- */
const bs = await api("/api/e2e/stage", { stage: "bodyshop", at: "in_work" });
const bsJob = bs.json?.jobId;
const devToken = randomBytes(16).toString("hex");
await sql("insert into public.devices (name, location, kind, section, token_hash) values ('E2e PPF tablet', 'bodyshop', 'shared', 'ppf', $1)", [createHash("sha256").update(devToken).digest("hex")]);
await op.context().addCookies([{ name: "erp_device", value: devToken, domain: "localhost", path: "/" }]);
await go(op, `${base}/tablet/bodyshop`);
check("4: the PPF tablet shows HAND-CUT big on the car (the default)", (await op.locator('[data-cut-badge="HAND-CUT"]').count()) >= 1, (await op.textContent("body"))?.replace(/\s+/g, " ").slice(0, 160));
await op.screenshot({ path: shot("cut10-4-tablet.png"), fullPage: false });
await op.context().clearCookies({ name: "erp_device" });
const hv = (await sql("select bodyshop_handover_token as t from public.jobs where id = $1", [bsJob]))[0]?.t;
if (hv) {
  const w = await pdfText(`/api/pdf/warranty/${hv}`);
  // Section 12: the certificate is the warranty card - finish, coverage and cutting method sit in their own columns.
  check("4: the warranty card names finish, cutting method and coverage", w.status === 200 && /OFJ Bespoke PPF – Gloss/i.test(w.text) && /Hand-cut/i.test(w.text) && !/Bespoke hand-cut/i.test(w.text) && /Full body/i.test(w.text), w.text.match(/OFJ Bespoke PPF – .{0,80}/i)?.[0] ?? `${w.status}`);
} else check("4: the warranty card names finish, cutting method and coverage", false, "no handover token on the seed");

/* ---------------- 5. The month's report: hand-cut against pre-cut ---------------- */
const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active limit 1"))[0].id;
const base1 = (await sql("select vehicle_id, customer_id from public.jobs where id = $1", [jobId]))[0];
const closed = (await sql("insert into public.jobs (vehicle_id, customer_id, gated_in_by, department, status, stage, is_open, gated_in_at, gated_out_at, created_by, updated_by) values ($1, $2, $3, 'bodyshop', 'closed', 'ready', false, now() - interval '3 days', now(), $3, $3) returning id", [base1.vehicle_id, base1.customer_id, owner]))[0];
const cq = (await sql("insert into public.quotations (kind, number, version, job_id, customer_id, vehicle_id, status, token, vat_percent, created_by, updated_by) values ('quotation', 'Q-E2E-CUT', 1, $1, $2, $3, 'draft', 'e2e-cut10-q2', 5, $4, $4) returning id", [closed.id, base1.customer_id, base1.vehicle_id, owner]))[0];
await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, unit_price, package_key, package_items, cut_method, created_by, updated_by) values ($1, 0, 'package', 'OFJ Full Protection Package', 'manual', 1, 18000, 'ofj_full_protection', $2::jsonb, 'machine', $3, $3)", [cq.id, JSON.stringify(SNAP), owner]);
await sql("update public.quotations set status = 'approved' where id = $1", [cq.id]);
const stg = (await sql("insert into public.bodyshop_stages (job_id, position, key, label, section, status) values ($1, 0, 'ppf', 'PPF install', 'ppf', 'done') returning id", [closed.id]))[0];
await sql("insert into public.bodyshop_clockings (job_id, stage_id, staff_id, started_at, ended_at, minutes) values ($1, $2, $3, now() - interval '9 hours', now() - interval '1 hour', 480)", [closed.id, stg.id, owner]);
const roll = (await sql("insert into public.film_rolls (kind, name, length_m, price_aed) values ('film', 'E2e roll', 15, 1429) returning id"))[0];
await sql("insert into public.film_usage (job_id, roll_id, metres) values ($1, $2, 12.5)", [closed.id, roll.id]);
await go(op, `${base}/reports/monthly`);
const rep = await op.locator("[data-ppf-by-cut]");
const repText = (await rep.locator("td").allTextContents().catch(() => [])).join(" ");
check("5: the monthly report splits PPF hours and film by cutting method", (await rep.count()) === 1 && /Machine pre-cut 1 8 12\.5/.test(repText), repText.slice(0, 200));
if (await rep.count()) {
  await rep.scrollIntoViewIfNeeded();
  await op.screenshot({ path: shot("cut10-5-report.png"), clip: (await rep.boundingBox()) ?? undefined });
}

await cb.close(); await ob.close();
cleanupDb();
process.exit(summary() ? 1 : 0);
