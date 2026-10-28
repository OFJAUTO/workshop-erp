// Evening section 12 proof: the invoice is the warranty card.
// Team leaders write the warranty details at the end of their stage (PPF roll + areas pre-ticked, tint roll, ceramic
// product + batch); QC ticks "Warranty details complete" before Ready; the tax invoice carries the WARRANTY table
// and the framed YOUR OFJ WARRANTY panel with its QR (and the link page the same panel); mechanical invoices say
// "Workmanship warranty: 6 months, valid until …"; the QR's page shows Pending activation → Active ✓ after the
// 10-day check (with its photos), Not activated after 30 days with the reminder dates, the owner's manual activation;
// reminders day 8 / 12 / 20; the warranty card WhatsApp after gate-out; Settings > Warranty terms; the warranty list.
// Run: node --env-file=.env.local tests/browser/test-warranty12.mjs   (dev server on :3100)
import path from "node:path";
import fs from "node:fs";
import { api, base, browserFor, browserForId, cleanupDb, cookieHeader, go, here, makeChecks, projectRoot, sleep, sql, submitted } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shot = (name) => path.join(here, "shots", name);
const until = async (fn, tries = 30, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const pdfOf = async (url, cookie) => {
  const r = await fetch(`${base}${url}`, cookie ? { headers: { cookie } } : undefined);
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(Buffer.from(await r.arrayBuffer()), "application/pdf");
  let text = "";
  for (let i = 0; i < doc.countPages(); i++) text += doc.loadPage(i).toStructuredText("preserve-whitespace").asText();
  return { status: r.status, text: text.replace(/\s+/g, " "), doc, mupdf };
};
const renderPage = (pdf, i, file) => {
  const pix = pdf.doc.loadPage(i).toPixmap(pdf.mupdf.Matrix.scale(1.4, 1.4), pdf.mupdf.ColorSpace.DeviceRGB, false, true);
  fs.writeFileSync(shot(file), Buffer.from(pix.asPNG()));
};
const termsBefore = (await sql("select value from public.settings where key = 'warranty_terms'"))[0]?.value ?? null;
const SPEC = { rows: { windshield: { on: true, coverage: "clear", shade: "clear", double: false }, front_sides: { on: true, shade: 50, double: false }, rear_sides: { on: true, shade: 50, double: false }, rear_window: { on: true, shade: 50, double: false }, roof: { on: false, shade: null, double: false } }, roofFitted: false };
const uploaded = [];
// THE stage hand-over (28 Oct, B2): a team stage is signed off with a photo and the leader's PIN (E2e leaders: 1234).
const HANDOVER_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGklEQVR4nGP4z8BAEmIY1TCqYVTDqIbhqgEAOK8f8Rf2cHcAAAAASUVORK5CYII=", "base64");
async function handOver(page, key, pin) {
  await page.locator(`[data-stage-handover-open='${key}']`).first().click();
  const dlg = page.locator(`[data-stage-handover='${key}']`);
  if (!(await dlg.locator("[data-job-file-upload] a, [data-job-file-upload] img").count())) {
    await dlg.locator('[data-job-file-upload] input[type="file"]').first().setInputFiles({ name: `${key}.png`, mimeType: "image/png", buffer: HANDOVER_PNG });
  }
  for (let i = 0; i < 40 && (await dlg.locator("[data-stage-handover-send]").isDisabled()); i++) await sleep(300);
  if (pin) await dlg.locator("[data-handover-pin]").fill(pin);
  const before = page.url();
  await dlg.locator("[data-stage-handover-send]").click();
  await page.waitForURL((u) => u.toString() !== before && /message=|error=/.test(u.toString()), { timeout: 25000 }).catch(() => null);
  await sleep(1500);
}

cleanupDb();
const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active limit 1"))[0].id;
const bs = await api("/api/e2e/stage", { stage: "bodyshop", at: "in_work" });
const jobId = bs.json?.jobId;
const bq = bs.json?.quotationId;
const people = bs.json?.people ?? {};
if (!jobId || !bq) { console.error("seed failed", bs.status, JSON.stringify(bs.json)); process.exit(1); }
// A ceramic coating joins the approved quotation (opened for a moment), and the tint choice per window.
await sql("update public.quotations set status = 'sent' where id = $1", [bq]);
await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, unit_price, created_by, updated_by) values ($1, 5, 'package', 'Ceramic coating for PPF', 'manual', 1, 2500, $2, $2)", [bq, owner]);
await sql("update public.quotations set status = 'approved', tint_spec = $2::jsonb where id = $1", [bq, JSON.stringify(SPEC)]);
const stageList = await sql("select id, key, position from public.bodyshop_stages where job_id = $1 and is_active order by position", [jobId]);
const posOf = (k) => stageList.find((s) => s.key === k)?.position;
const activate = async (key) => {
  await sql("update public.bodyshop_stages set status = 'done', done_at = now() where job_id = $1 and is_active and position < $2 and status <> 'done'", [jobId, posOf(key)]);
  await sql("update public.bodyshop_stages set status = 'active', started_at = now() where job_id = $1 and is_active and key = $2", [jobId, key]);
};

/* ---------------- 1. The PPF stage: roll / batch number and areas (pre-ticked), the tint roll ---------------- */
await activate("ppf");
const { browser: lb, page: lp } = await browserForId(people.ppfLeader, { viewport: { width: 1366, height: 1000 } });
await go(lp, `${base}/bodyshop/${jobId}#stages`);
const form = lp.locator('[data-stage-warranty-form="ppf"]');
check("1: the PPF stage asks for the warranty details (PPF, and the tint merged into it)", (await form.count()) === 1 && (await form.locator('[data-warranty-roll="ppf:"]').count()) === 1 && (await form.locator('[data-warranty-roll="tint:"]').count()) === 1);
check("1: the areas covered come pre-ticked from the quotation (Full body)", (await form.locator('[data-warranty-area="Full body"]').getAttribute("aria-pressed")) === "true");
await handOver(lp, "ppf", "1234");
check("1: signing off without the numbers is refused, saying what is missing", /roll or batch number/.test(decodeURIComponent(lp.url())) && (await sql("select status from public.bodyshop_stages where job_id = $1 and key = 'ppf' and is_active", [jobId]))[0]?.status === "active", decodeURIComponent(lp.url()).slice(-160));
await lp.locator('[data-stage-warranty-form="ppf"] [data-warranty-roll="ppf:"]').pressSequentially("E2E-PPF-0042");
await lp.locator('[data-stage-warranty-form="ppf"] [data-warranty-roll="tint:"]').pressSequentially("E2E-TINT-007");
await lp.locator('[data-stage-warranty-form="ppf"]').scrollIntoViewIfNeeded();
await lp.screenshot({ path: shot("warranty12-1-ppf-stage.png"), clip: (await lp.locator('[data-stage-warranty-form="ppf"]').boundingBox()) ?? undefined });
await lp.locator('[data-stage-warranty-form="ppf"] [data-stage-warranty-save="ppf"]').click();
await submitted(lp);
await handOver(lp, "ppf", "1234");
const ppfEntry = (await sql("select roll_batch, areas from public.warranty_entries where job_id = $1 and product = 'ppf' and is_active", [jobId]))[0];
const tintEntry = (await sql("select roll_batch from public.warranty_entries where job_id = $1 and product = 'tint' and is_active", [jobId]))[0];
check("1: with the numbers the stage is done and the details kept (roll, areas, tint roll)", ppfEntry?.roll_batch === "E2E-PPF-0042" && JSON.stringify(ppfEntry?.areas) === JSON.stringify(["Full body"]) && tintEntry?.roll_batch === "E2E-TINT-007" && (await sql("select status from public.bodyshop_stages where job_id = $1 and key = 'ppf' and is_active", [jobId]))[0]?.status === "done", JSON.stringify({ ppfEntry, tintEntry }));
await lb.close();

/* ---------------- 2. The final detail: the ceramic product and batch ---------------- */
await activate("detail");
const { browser: db, page: dp } = await browserForId(people.detailingLeader, { viewport: { width: 1366, height: 1000 } });
await go(dp, `${base}/bodyshop/${jobId}#stages`);
const cform = dp.locator('[data-stage-warranty-form="detail"]');
check("2: the final detail asks for the ceramic product and batch", (await cform.count()) === 1 && (await cform.locator("[data-warranty-product]").count()) === 1);
await cform.locator("[data-warranty-product]").pressSequentially("E2e Ceramic Pro 9H");
await cform.locator("[data-warranty-roll]").pressSequentially("CB-2219");
await cform.locator('[data-stage-warranty-save="detail"]').click();
await submitted(dp);
await handOver(dp, "detail", "1234");
const cer = (await sql("select product_name, roll_batch from public.warranty_entries where job_id = $1 and product = 'ceramic' and is_active", [jobId]))[0];
check("2: the ceramic product and batch are kept, the product becomes a one-tap chip", cer?.product_name === "E2e Ceramic Pro 9H" && cer?.roll_batch === "CB-2219" && JSON.stringify((await sql("select value from public.settings where key = 'ceramic_products_used'"))[0]?.value ?? []).includes("E2e Ceramic Pro 9H"), JSON.stringify(cer ?? {}));
await db.close();

/* ---------------- 3. QC: "Warranty details complete" before Ready ---------------- */
await activate("qc");
const { browser: ob, page: op } = await browserFor("owner", { viewport: { width: 1366, height: 1000 } });
await go(op, `${base}/bodyshop/${jobId}#stages`);
const qform = op.locator("[data-qc-warranty-form]");
check("3: QC sees every product's details and the tick 'Warranty details complete'", (await qform.count()) === 1 && (await qform.locator("li").count()) === 3 && (await qform.locator("[data-warranty-complete]").count()) === 1, (await qform.textContent().catch(() => ""))?.slice(0, 200));
await qform.scrollIntoViewIfNeeded();
await op.screenshot({ path: shot("warranty12-2-qc.png"), clip: (await qform.boundingBox()) ?? undefined });
await qform.locator("[data-warranty-complete]").check();
await qform.locator('[data-stage-done="qc"]').click();
await submitted(op);
const afterQc = (await sql("select status, warranty_confirmed_at is not null as confirmed from public.jobs where id = $1", [jobId]))[0];
check("3: QC done with the tick: details confirmed and the car Ready", afterQc?.confirmed === true && afterQc?.status === "ready", JSON.stringify(afterQc));

/* ---------------- 4. The tax invoice: WARRANTY table + YOUR OFJ WARRANTY panel (before and after the handover) ---------------- */
const pf = (await sql("select id, token from public.invoices where job_id = $1 and kind = 'proforma' and is_active order by created_at desc limit 1", [jobId]))[0];
if (!pf?.token) { console.error("no proforma"); process.exit(1); }
await sql("update public.invoices set kind = 'tax_invoice', number = 'INV-E2E-' || left(id::text, 8) where id = $1", [pf.id]);
const before = await pdfOf(`/api/pdf/invoice/${pf.token}`);
check("4: the tax invoice has the WARRANTY table per product (product, coverage, roll/batch, cutting, darkness, period)", /WARRANTY/.test(before.text) && /OFJ Bespoke PPF – Gloss/i.test(before.text) && /E2E-PPF-0042/.test(before.text) && /Hand-cut/i.test(before.text) && !/Bespoke hand-cut/i.test(before.text) && /E2E-TINT-007/.test(before.text) && /sides & rear 50% darkness/i.test(before.text) && /E2e Ceramic Pro 9H/i.test(before.text) && /CB-2219/.test(before.text), before.text.match(/WARRANTY.{0,300}/)?.[0] ?? String(before.status));
check("4: before the handover the dates start on the handover day", /Starts on the handover day/i.test(before.text) && /From handover/i.test(before.text));
check("4: the framed panel: YOUR OFJ WARRANTY, 'Scan to view and verify your warranty', VIN and plate", /YOUR OFJ WARRANTY/.test(before.text) && /Scan to view and verify your warranty/.test(before.text) && /VIN WDC/i.test(before.text));
const wToken = (await sql("select warranty_token from public.jobs where id = $1", [jobId]))[0]?.warranty_token;
check("4: the panel's QR has the job's own warranty address", !!wToken);
// The handover: five days ago (the stamp is set once); a 10-day check is waiting.
await sql("update public.jobs set gated_out_at = now() - interval '5 days' where id = $1", [jobId]);
await sql("insert into public.aftercare_checks (job_id, due_date, created_by, updated_by) values ($1, ((now() at time zone 'Asia/Dubai')::date + 5), $2, $2)", [jobId, owner]);
const after = await pdfOf(`/api/pdf/invoice/${pf.token}`);
check("4: after the handover every row runs from the handover day, with its valid-until date", /From the handover on/i.test(after.text) && /10 years/i.test(after.text) && /Pending activation/i.test(after.text), after.text.match(/From the handover on.{0,120}/i)?.[0] ?? "");
for (let i = 0; i < after.doc.countPages(); i++) renderPage(after, i, `warranty12-3-invoice-p${i + 1}.png`);

/* ---------------- 5. The customer's invoice page and the warranty page: Pending → Active ✓ ---------------- */
const { browser: cb, page: cp } = await browserFor("owner", { viewport: { width: 430, height: 1500 } });
await go(cp, `${base}/invoice/${pf.token}`);
check("5: the customer's tax invoice page carries the same framed panel", (await cp.locator("[data-warranty-panel]").count()) === 1 && /YOUR OFJ WARRANTY/.test((await cp.locator("[data-warranty-panel]").textContent()) ?? ""));
await cp.locator("[data-warranty-panel]").scrollIntoViewIfNeeded();
await cp.screenshot({ path: shot("warranty12-4-invoice-link.png"), clip: (await cp.locator("[data-warranty-panel]").boundingBox()) ?? undefined });
await go(cp, `${base}/warranty/${wToken}`);
const pageText = (await cp.locator("main").textContent()) ?? "";
check("5: the warranty page: car, VIN, products with coverage, roll/batch and dates - and no prices", /VIN WDC/i.test(pageText) && /E2E-PPF-0042/.test(pageText) && /Full body/.test(pageText) && /sides & rear 50% darkness/.test(pageText) && !/AED|23,100/.test(pageText));
check("5: status Pending activation with Book your check", (await cp.locator('[data-warranty-status="pending"]').count()) === 1 && (await cp.locator("[data-book-check]").count()) === 1);
await cp.screenshot({ path: shot("warranty12-5-page-pending.png"), fullPage: true });
// The job card after gate-out: the short warranty card WhatsApp.
await go(op, `${base}/jobs/${jobId}#warranty-card`);
check("5: after gate-out the job card has the 'Your OFJ warranty card' WhatsApp with the short link", /warranty card/i.test((await op.locator("[data-warranty-message]").textContent().catch(() => "")) ?? "") && /\/m\//.test((await op.locator("[data-warranty-message]").textContent().catch(() => "")) ?? ""));
const [popup] = await Promise.all([op.context().waitForEvent("page", { timeout: 10000 }).catch(() => null), op.locator("[data-warranty-whatsapp]").click()]);
if (popup) await popup.close().catch(() => null);
check("5: sending it is written down", !!(await until(async () => (await sql("select warranty_card_sent_at from public.jobs where id = $1", [jobId]))[0]?.warranty_card_sent_at)));
await op.locator("[data-warranty-job-card]").scrollIntoViewIfNeeded();
await op.screenshot({ path: shot("warranty12-6-jobcard.png"), clip: (await op.locator("[data-warranty-job-card]").boundingBox()) ?? undefined });
// The team leader signs the 10-day check off, with a photo: the warranty becomes Active ✓.
await go(op, `${base}/jobs/${jobId}`);
await op.locator("[data-aftercare-open]").click();
await op.locator('[data-aftercare-form] input[type="file"]').first().setInputFiles(path.join(projectRoot, "public", "preview.jpg"));
await until(async () => ((await op.locator('[data-aftercare-photos="1"]').count()) ? 1 : null), 40, 500);
await op.locator("[data-aftercare-sign]").click();
await submitted(op);
const photoRow = (await sql("select storage_path from public.job_files where job_id = $1 and caption = '10-day check'", [jobId]))[0];
if (photoRow) uploaded.push(photoRow.storage_path);
check("5: the 10-day check is signed off with its photo", !!(await sql("select done_at from public.aftercare_checks where job_id = $1", [jobId]))[0]?.done_at && !!photoRow);
await go(cp, `${base}/warranty/${wToken}`);
check("5: the warranty page now says Active ✓ with the check date and the team leader's photo", (await cp.locator('[data-warranty-status="active"]').count()) === 1 && /10-day after-care check completed on/.test((await cp.locator('[data-warranty-status="active"]').textContent()) ?? "") && (await cp.locator("[data-warranty-check-photos] img").count()) >= 1);
await cp.screenshot({ path: shot("warranty12-7-page-active.png"), fullPage: true });

/* ---------------- 6. Mechanical invoices: workmanship 6 months; Not activated after 30 days; the owner's manual activation ---------------- */
const mech = await api("/api/e2e/stage", { stage: "ready" });
const mJob = mech.json?.jobId;
const mpf = mJob ? (await sql("select id, token from public.invoices where job_id = $1 and kind = 'proforma' and is_active order by created_at desc limit 1", [mJob]))[0] : null;
if (mpf?.token) {
  await sql("update public.invoices set kind = 'tax_invoice', number = 'INV-E2E-' || left(id::text, 8) where id = $1", [mpf.id]);
  const m = await pdfOf(`/api/pdf/invoice/${mpf.token}`);
  check("6: a mechanical tax invoice says 'Workmanship warranty: 6 months, valid until …'", /Workmanship warranty: 6 months, valid until \d{1,2} \w{3} \d{4}/.test(m.text), m.text.match(/Workmanship.{0,80}/)?.[0] ?? String(m.status));
} else check("6: a mechanical tax invoice says 'Workmanship warranty: 6 months, valid until …'", false, `no proforma on the ready seed (${mech.status})`);
if (mJob) {
  // The same car also had PPF, handed over 31 days ago; three reminders went out, no check.
  const mq = (await sql("select id from public.quotations where job_id = $1 and status = 'approved' and is_active order by created_at desc limit 1", [mJob]))[0];
  const ppfSvc = (await sql("select id from public.services where bodyshop_kind = 'ppf' and is_active order by name limit 1"))[0];
  await sql("update public.quotations set status = 'sent' where id = $1", [mq.id]);
  await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, service_id, source_type, quantity, unit_price, created_by, updated_by) values ($1, 9, 'package', 'Full PPF', $2, 'manual', 1, 18000, $3, $3)", [mq.id, ppfSvc?.id ?? null, owner]);
  await sql("update public.quotations set status = 'approved' where id = $1", [mq.id]);
  await sql("update public.jobs set department = 'both', gated_out_at = now() - interval '31 days', warranty_token = 'e2e-w12-not-activated-token' where id = $1", [mJob]);
  await sql("insert into public.aftercare_checks (job_id, due_date, reminded_at, reminded_12_at, reminded_20_at, created_by, updated_by) values ($1, ((now() at time zone 'Asia/Dubai')::date - 21), now() - interval '23 days', now() - interval '19 days', now() - interval '11 days', $2, $2)", [mJob, owner]);
  await go(cp, `${base}/warranty/e2e-w12-not-activated-token`);
  check("6: 30 days without the check: 'Not activated – 10-day after-care check not completed' with the reminder dates", (await cp.locator('[data-warranty-status="not_activated"]').count()) === 1 && /Not activated – 10-day after-care check not completed/.test((await cp.locator('[data-warranty-status="not_activated"]').textContent()) ?? "") && ((await cp.locator("[data-warranty-reminders]").textContent()) ?? "").split(",").length === 3);
  check("6: a job with mechanical work shows the workmanship warranty on the page too", (await cp.locator('[data-warranty-product="mechanical"]').count()) === 1);
  await cp.screenshot({ path: shot("warranty12-8-page-not-activated.png"), fullPage: true });
  await go(op, `${base}/jobs/${mJob}#warranty-card`);
  await op.locator("[data-warranty-activate] summary").click();
  await op.locator("[data-warranty-activate-note]").pressSequentially("Checked by phone with photos from the customer");
  await op.locator("[data-warranty-activate-confirm]").click();
  await submitted(op);
  await go(cp, `${base}/warranty/e2e-w12-not-activated-token`);
  check("6: the owner activates by hand with a note: Active ✓", (await cp.locator('[data-warranty-status="active"]').count()) === 1 && /Activated by OFJ Automotive on .*Checked by phone/.test((await cp.locator('[data-warranty-status="active"]').textContent()) ?? ""));
}

/* ---------------- 7. Reminders on day 8, 12 and 20 after the handover ---------------- */
const car = (await sql("select vehicle_id, customer_id, gated_in_by from public.jobs where id = $1", [jobId]))[0];
const mk = async (days) => (await sql("insert into public.jobs (vehicle_id, customer_id, gated_in_by, department, status, stage, is_open, gated_in_at, gated_out_at, created_by, updated_by) values ($1, $2, $3, 'bodyshop', 'closed', 'ready', false, now() - make_interval(days => $4 + 3), now() - make_interval(days => $4), $3, $3) returning id", [car.vehicle_id, car.customer_id, car.gated_in_by, days]))[0].id;
const day9 = await mk(9);
const day13 = await mk(13);
const day21 = await mk(21);
for (const id of [day9, day13, day21]) await sql("insert into public.aftercare_checks (job_id, due_date, created_by, updated_by) values ($1, (now() at time zone 'Asia/Dubai')::date, $2, $2)", [id, owner]);
const run = await api("/api/e2e/aftercare", { jobIds: [day9, day13, day21] });
const rem = await sql("select job_id, reminded_at is not null as d8, reminded_12_at is not null as d12, reminded_20_at is not null as d20 from public.aftercare_checks where job_id = any($1::uuid[])", [[day9, day13, day21]]);
const r = (id) => rem.find((x) => x.job_id === id) ?? {};
check("7: day 9 sends the day-8 reminder, day 13 the second, day 21 the third (each written down)", r(day9).d8 && !r(day9).d12 && r(day13).d12 && r(day21).d20, JSON.stringify({ run: run.json, rem }));
check("7: the advisors are told", ((await sql("select count(*)::int as n from public.notifications where job_id = any($1::uuid[]) and type = 'aftercare_due'", [[day9, day13, day21]]))[0]?.n ?? 0) >= 3);
const again = await api("/api/e2e/aftercare", { jobIds: [day9, day13, day21] });
check("7: a second run sends nothing twice", again.json?.reminded === 0 && again.json?.overdue === 0, JSON.stringify(again.json));

/* ---------------- 8. Settings > Warranty terms (owner) and the warranty list ---------------- */
await go(op, `${base}/settings/warranty`);
const months = op.locator('[data-terms-months="tint"]');
await months.click({ clickCount: 3 });
await months.pressSequentially("72");
await op.locator("[data-save-terms]").click();
await submitted(op);
check("8: the owner sets the period and wording per product", Number((await sql("select value->'tint'->>'months' as m from public.settings where key = 'warranty_terms'"))[0]?.m) === 72);
await go(op, `${base}/settings/warranty`);
await op.screenshot({ path: shot("warranty12-9-terms.png"), fullPage: false });
const plate = (await sql("select plate_number from public.vehicles where id = $1", [car.vehicle_id]))[0]?.plate_number;
const { browser: ab, page: ap } = await browserFor("service_advisor", { viewport: { width: 1366, height: 1000 } });
await go(ap, `${base}/warranties?q=${encodeURIComponent(plate)}`);
const item = ap.locator(`[data-warranty-item="${jobId}"]`);
check("8: the warranty list finds the car by plate: what is covered, rolls used, status, 10-day check", (await item.count()) === 1 && /E2E-PPF-0042/.test((await item.textContent()) ?? "") && /10-day check done/.test((await item.locator("[data-warranty-check]").textContent()) ?? "") && (await item.locator('[data-warranty-item-status="active"]').count()) === 1);
const vin = (await sql("select vin from public.vehicles where id = $1", [car.vehicle_id]))[0]?.vin;
await go(ap, `${base}/warranties?q=${encodeURIComponent(vin ?? "")}`);
check("8: and by VIN", (await ap.locator(`[data-warranty-item="${jobId}"]`).count()) === 1);
await ap.screenshot({ path: shot("warranty12-10-list.png"), fullPage: false });

// Put the owner's terms back, remove the uploaded photo from the bucket, and every test row.
await sql("update public.settings set value = $1::jsonb where key = 'warranty_terms'", [JSON.stringify(termsBefore)]);
for (const p of uploaded) await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/job-files`, { method: "DELETE", headers: { authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, apikey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "", "content-type": "application/json" }, body: JSON.stringify({ prefixes: [p] }) }).catch(() => null);
await ob.close(); await cb.close(); await ab.close();
void cookieHeader;
cleanupDb();
process.exit(summary() ? 1 : 0);
