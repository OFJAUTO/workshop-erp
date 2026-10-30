// Evening section 11 proof: the tint specification per window ("X% darkness").
// The box on the quotation (rows, coverage, darkness chips, double layer, presets, roof only if fitted), the
// automatic shade on the tint items of the PDF, the customer's tick for a window darker than the legal limit,
// changes after approval logged old → new with the prepared WhatsApp, locked once the tint stage starts (owner
// excepted), the job card / bodyshop page / PPF tablet (with the photo after fitting), the proforma, the
// package cost (double layer = double film + hours), Settings (legal limit) and "Same as last time".
// Run: node --env-file=.env.test.local tests/browser/test-tint11.mjs   (dev server on :3100)
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { api, base, browserFor, cleanupDb, cookieHeader, go, here, makeChecks, projectRoot, sleep, sql } from "./pw-lib.mjs";

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
const SNAP = { key: "ofj_full_protection", name: "OFJ Full Protection Package - Invisible Clear/GLOSSY Bespoke", time_in_workshop: "3-5 working days", pickup_dropoff: true, aftercare_check: true, items: [{ label: "Full body PPF", warranty: "10-year warranty" }, { label: "OFJ ceramic heat-rejection tint – side & rear windows", warranty: "5-year warranty" }, { label: "Panoramic roof film", warranty: "5-year warranty" }, { label: "Windshield heat-rejection film", warranty: "5-year warranty" }] };
const specOf = async (id) => (await sql("select tint_spec from public.quotations where id = $1", [id]))[0]?.tint_spec ?? null;
const limitBefore = (await sql("select value from public.settings where key = 'tint_legal_max_darkness'"))[0]?.value ?? 50;

cleanupDb();
const seed = await api("/api/e2e/stage", { stage: "quote" });
const jobId = seed.json?.jobId;
const qid = seed.json?.quotationId;
if (!jobId || !qid) { console.error("seed failed", seed.status, JSON.stringify(seed.json)); process.exit(1); }
const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active limit 1"))[0].id;
await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, unit_price, package_key, package_items, created_by, updated_by) values ($1, 0, 'package', 'OFJ Full Protection Package', 'manual', 1, 18000, 'ofj_full_protection', $2::jsonb, $3, $3)", [qid, JSON.stringify(SNAP), owner]);

/* ---------------- 1. The box on a draft quotation: presets, chips, double layer, roof ---------------- */
const { browser, page } = await browserFor("owner", { viewport: { width: 1440, height: 1100 } });
await go(page, `${base}/jobs/${jobId}/quote/${qid}`);
const boxEl = page.locator("[data-tint-box]");
check("1: a quotation with tint work shows the Tint specification box (draft: saves as tapped)", (await boxEl.count()) === 1 && (await boxEl.getAttribute("data-tint-mode")) === "draft");
check("1: every row offers Clear · 5 · 10 · 15 · 20 · 30 · 35 · 40 · 50 · 60 · 70 and the double-layer tick", (await page.locator('[data-tint-row="rear_sides"] [data-tint-chip]').count()) === 12 && (await page.locator('[data-tint-double="rear_sides"]').count()) === 1);
check("1: the windshield offers None / Clear heat-rejection / Top strip / Full", (await page.locator('[data-tint-row="windshield"] [data-tint-chip]').allTextContents()).join("|") === "None|Clear heat-rejection|Top strip|Full");
await page.locator('[data-tint-preset="Standard"]').click();
const std = await until(async () => { const s = await specOf(qid); return s?.rows?.front_sides?.shade === 50 && s?.rows?.windshield?.coverage === "clear" ? s : null; });
check("1: the Standard preset fills the box and saves by itself", !!std);
check("1: the words read 'windshield clear heat-rejection · sides & rear 50% darkness · roof 50% darkness'", (await page.locator("[data-tint-box] [data-tint-summary]").textContent()) === "windshield clear heat-rejection · sides & rear 50% darkness · roof 50% darkness");
await page.locator('[data-tint-chip="rear_sides:70"]').click();
await page.locator('[data-tint-chip="rear_window:70"]').click();
await page.locator('[data-tint-chip="roof:70"]').click();
await page.locator('[data-tint-double="roof"]').check();
const s2 = await until(async () => { const s = await specOf(qid); return s?.rows?.rear_window?.shade === 70 && s?.rows?.roof?.double === true ? s : null; });
check("1: rear sides & rear screen 70, roof 70 double layer saved", !!s2);
check("1: the split words: 'front sides 50% darkness · rear sides & rear screen 70% darkness'", /front sides 50% darkness · rear sides & rear screen 70% darkness \(above the legal limit – customer's request\) · roof 70% darkness, double layer/.test((await page.locator("[data-tint-box] [data-tint-summary]").textContent()) ?? ""), await page.locator("[data-tint-box] [data-tint-summary]").textContent());
check("1: darker than the legal limit (50) says so: customer's request", /Rear side windows 70% darkness, Rear screen 70% darkness, Sunroof \/ panoramic roof 70% darkness/.test((await page.locator("[data-tint-above-limit]").textContent()) ?? ""));
check("1: the double layer says double film and the extra hour", /1 window double layer: double film and 1 h more fitting/.test((await page.locator("[data-tint-double-note]").textContent()) ?? ""));
await page.locator("[data-tint-box]").scrollIntoViewIfNeeded();
await page.screenshot({ path: shot("tint11-1-box.png"), clip: (await page.locator("[data-tint-box]").boundingBox()) ?? undefined });
// The package cost follows: tint × the windows (2 × a car with the doubled roof) and the double-layer hour.
const costWords = await until(async () => { await go(page, `${base}/jobs/${jobId}/quote/${qid}`); const t = (await page.locator("[data-package-cost]").textContent().catch(() => "")) ?? ""; return /2 × a car/.test(t) ? t : null; }, 6, 1500);
check("1: the package cost counts the windows and the double layer (double film, +1 h)", !!costWords && /incl\. 1 h double layer/.test(costWords), costWords ?? "");
// Roof only if fitted: "Car has none" drops it from the words.
await page.locator('[data-tint-chip="roof:not-fitted"]').click();
check("1: 'Car has none' takes the roof off", !!(await until(async () => ((await specOf(qid))?.roofFitted === false ? 1 : null))) && !/roof/.test((await page.locator("[data-tint-box] [data-tint-summary]").textContent()) ?? ""));
await page.locator('[data-tint-chip="roof:fitted"]').click();
await page.locator('[data-tint-chip="roof:70"]').click();
await page.locator('[data-tint-double="roof"]').check();
await until(async () => ((await specOf(qid))?.rows?.roof?.double ? 1 : null));
// The owner's own preset from the box.
await page.locator("[data-tint-preset-add]").click();
await page.locator("[data-tint-preset-name]").pressSequentially("E2e Dark rear");
await page.locator("[data-tint-preset-save]").click();
check("1: the owner saves the box as a one-tap preset", !!(await until(async () => ((await sql("select value from public.settings where key = 'tint_presets'"))[0]?.value ?? []).some((p) => p.name === "E2e Dark rear"))) && (await page.locator('[data-tint-preset="E2e Dark rear"]').count()) === 1);

/* ---------------- 2. The shade on the tint items of the documents (never in the package itself) ---------------- */
const pdf = await pdfText(`/api/pdf/quotation/${qid}`, await cookieHeader("owner"));
check("2: the quotation PDF adds the shades to the tint items", /heat-rejection tint – front side windows 50% darkness · rear side windows & rear screen 70% darkness \(above the legal limit – customer's request\)/i.test(pdf.text) && /Panoramic roof film · 70% darkness, double layer \(above the legal limit/i.test(pdf.text) && /Windshield heat-rejection film · clear/i.test(pdf.text), pdf.text.match(/OFJ ceramic.{0,200}/i)?.[0] ?? String(pdf.status));
check("2: the package itself stores no shade", !JSON.stringify((await sql("select package_items from public.quotation_lines where quotation_id = $1 and package_key is not null", [qid]))[0]?.package_items ?? {}).includes("darkness"));
await go(page, `${base}/jobs/${jobId}`);
check("2: the job card shows the tint choice", /Tint: windshield clear heat-rejection · front sides 50% darkness/.test((await page.locator("[data-tint-summary]").first().textContent()) ?? ""));
await page.screenshot({ path: shot("tint11-2-jobcard.png"), clip: { x: 240, y: 0, width: 1200, height: 200 } });

/* ---------------- 3. The customer: the shade on the link, the legal-limit tick ---------------- */
const bs = await api("/api/e2e/stage", { stage: "bodyshop", at: "sent" });
const bsJob = bs.json?.jobId;
const bq = bs.json?.quotationId;
const bToken = bs.json?.token;
const SPEC_B = { rows: { windshield: { on: true, coverage: "clear", shade: "clear", double: false }, front_sides: { on: true, shade: 50, double: false }, rear_sides: { on: true, shade: 70, double: false }, rear_window: { on: true, shade: 70, double: false }, roof: { on: false, shade: null, double: false } }, roofFitted: false };
await sql("update public.quotations set tint_spec = $2::jsonb where id = $1", [bq, JSON.stringify(SPEC_B)]);
const { browser: cb, page: cp } = await browserFor("owner", { viewport: { width: 480, height: 1300 } });
await go(cp, `${base}/quote/${bToken}`);
check("3: the link shows the window tint card with the shades", /front sides 50% darkness · rear sides & rear screen 70% darkness \(above the legal limit – customer's request\)/.test((await cp.locator("[data-tint-card]").textContent()) ?? ""), (await cp.locator("[data-tint-card]").textContent().catch(() => "")) ?? "none");
await cp.getByText("Approved", { exact: true }).click();
check("3: approving asks the customer to tick 'Above the legal limit – my request'", (await cp.locator("[data-tint-ack]").count()) === 1 && /Rear side windows 70% darkness, Rear screen 70% darkness is darker than the legal limit of 50% darkness/.test((await cp.locator("[data-tint-ack]").textContent()) ?? ""));
await cp.screenshot({ path: shot("tint11-3-ack.png") });
const noAck = await fetch(`${base}/api/quote/${bToken}`, { method: "POST", redirect: "manual", body: new URLSearchParams({ action: "approve", approver_name: "Stage Customer", agree: "on", removal_ack: "on" }) });
check("3: without the tick the server refuses the approval", noAck.status === 303 && /tint/i.test(decodeURIComponent(noAck.headers.get("location") ?? "")) && (await sql("select status from public.quotations where id = $1", [bq]))[0].status !== "approved", noAck.headers.get("location") ?? String(noAck.status));
await cp.locator('input[name="agree"]').check();
await cp.locator('input[name="removal_ack"]').check().catch(() => null);
await cp.locator('input[name="tint_ack"]').check();
await cp.locator('button[name="action"][value="approve"]').click();
const acked = await until(async () => (await sql("select status, tint_ack_at, tint_ack_name from public.quotations where id = $1", [bq]))[0], 30, 500).then(async () => until(async () => { const r = (await sql("select status, tint_ack_at, tint_ack_name from public.quotations where id = $1", [bq]))[0]; return r.status === "approved" && r.tint_ack_at ? r : null; }));
check("3: with the tick the quotation is approved and the tick kept (who and when)", !!acked && acked.tint_ack_name === "Stage Customer", JSON.stringify(acked ?? {}));

/* ---------------- 4. Changes after approval: logged old → new, the WhatsApp prepared ---------------- */
const { browser: ab, page: ap } = await browserFor("service_advisor", { viewport: { width: 1440, height: 1100 } });
await go(ap, `${base}/jobs/${bsJob}/quote/${bq}`);
check("4: after approval the box stays changeable until the tint stage starts", (await ap.locator('[data-tint-box][data-tint-mode="sent"]').count()) === 1 && (await ap.locator("[data-tint-locked]").count()) === 0 && (await ap.locator("[data-quote-locked]").count()) === 1);
await ap.locator('[data-tint-chip="rear_window:50"]').click();
await ap.locator("[data-tint-save]").click();
const ev = await until(async () => (await sql("select note from public.quotation_events where quotation_id = $1 and event_type = 'tint_changed' order by created_at desc limit 1", [bq]))[0]);
check("4: the change is written down old → new", !!ev && /rear sides & rear screen 70% darkness → .*front sides & rear screen 50% darkness · rear sides 70% darkness/.test(ev.note), ev?.note ?? "none");
await ap.locator("[data-tint-whatsapp]").waitFor({ timeout: 15000 }).catch(() => null);
check("4: the prepared 'updated tint choice' WhatsApp appears next to it", (await ap.locator("[data-tint-whatsapp]").count()) === 1 && /updated tint choice/.test((await ap.locator("[data-tint-message]").textContent().catch(() => "")) ?? ""), (await ap.locator("[data-tint-box]").textContent().catch(() => ""))?.slice(-300));
await ap.locator("[data-tint-box]").scrollIntoViewIfNeeded();
await ap.screenshot({ path: shot("tint11-4-after-approval.png"), clip: (await ap.locator("[data-tint-box]").boundingBox()) ?? undefined });

/* ---------------- 5. Locked once the tint stage starts (the owner can still correct it) ---------------- */
await sql("insert into public.bodyshop_stages (job_id, position, key, label, section, status, started_at) values ($1, 0, 'tint', 'Tint', 'ppf', 'active', now())", [bsJob]);
await go(ap, `${base}/jobs/${bsJob}/quote/${bq}`);
check("5: once the tint stage starts the advisor sees it read only", (await ap.locator("[data-tint-locked]").count()) === 1 && (await ap.locator('[data-tint-chip="rear_window:70"]').isDisabled()));
await go(page, `${base}/jobs/${bsJob}/quote/${bq}`);
check("5: the owner can still correct it", (await page.locator("[data-tint-locked]").count()) === 0 && !(await page.locator('[data-tint-chip="rear_window:70"]').isDisabled()));
await sql("update public.bodyshop_stages set is_active = false where job_id = $1 and key = 'tint'", [bsJob]);

/* ---------------- 6. The bodyshop car: the tablet (photo after fitting), the bodyshop page, the proforma ---------------- */
const bs2 = await api("/api/e2e/stage", { stage: "bodyshop", at: "in_work" });
const installer = bs2.json?.people?.installer;
const devToken = randomBytes(16).toString("hex");
await sql("insert into public.devices (name, location, kind, section, token_hash) values ('E2e PPF tablet', 'bodyshop', 'shared', 'ppf', $1)", [createHash("sha256").update(devToken).digest("hex")]);
await page.context().addCookies([{ name: "erp_device", value: devToken, domain: "localhost", path: "/" }]);
await go(page, `${base}/tablet/bodyshop`);
const carBtn = page.locator(`[data-tablet-car="${bsJob}"]`);
check("6: the PPF tablet shows the tint choice on the car", /Tint: windshield clear heat-rejection/.test((await carBtn.textContent()) ?? ""), (await carBtn.textContent().catch(() => "")) ?? "no car");
await page.screenshot({ path: shot("tint11-5-tablet.png") });
await carBtn.click();
await page.locator(`[data-tablet-person="${installer}"]`).click();
await page.locator("[data-tablet-mode-tint]").click();
await page.locator("[data-tablet-tint-file]").setInputFiles(path.join(projectRoot, "public", "preview.jpg"));
await page.locator("[data-tablet-tint-preview]").waitFor({ timeout: 10000 });
for (const d of ["1", "2", "3", "4"]) await page.locator("[data-pin-pad] button", { hasText: d }).first().click();
const photo = await until(async () => (await sql("select id, storage_path from public.job_files where job_id = $1 and caption = 'Tint fitted' and removed_at is null", [bsJob]))[0]);
check("6: the installer's photo after fitting is saved with his PIN", !!photo && /tint photo saved/.test((await page.locator("[data-tablet-note]").textContent().catch(() => "")) ?? ""));
await page.context().clearCookies({ name: "erp_device" });
await go(page, `${base}/bodyshop/${bsJob}`);
check("6: the bodyshop page shows the tint choice big, with the photo", /front sides & rear screen 50% darkness · rear sides 70% darkness/.test((await page.locator("[data-tint-card-staff] [data-tint-summary]").textContent()) ?? "") && (await page.locator('[data-tint-photos="1"]').count()) === 1);
await page.locator("[data-tint-card-staff]").scrollIntoViewIfNeeded();
await page.screenshot({ path: shot("tint11-6-bodyshop.png"), clip: (await page.locator("[data-tint-card-staff]").boundingBox()) ?? undefined });
await api("/api/e2e/stage", { stage: "bodyshop", at: "ready" });
const pf = (await sql("select token from public.invoices where job_id = $1 and kind = 'proforma' and is_active order by created_at desc limit 1", [bsJob]))[0];
if (pf?.token) {
  const inv = await pdfText(`/api/pdf/invoice/${pf.token}`);
  check("6: the proforma puts the shades under the tint lines", /front sides & rear screen 50% darkness · rear sides 70% darkness/i.test(inv.text), inv.text.match(/tint.{0,160}/i)?.[0] ?? String(inv.status));
} else check("6: the proforma puts the shades under the tint lines", false, "no proforma on the ready seed");

/* ---------------- 7. Settings: the legal limit (owner) ---------------- */
await go(page, `${base}/settings/packages#tint`);
await page.locator('[data-tint-settings] label:has([data-tint-limit="35"])').click();
await page.locator("[data-save-tint]").click();
check("7: the owner sets the legal limit in Settings", !!(await until(async () => (Number((await sql("select value from public.settings where key = 'tint_legal_max_darkness'"))[0]?.value) === 35 ? 1 : null))));
await go(page, `${base}/settings/packages#tint`);
await page.locator("[data-tint-settings]").scrollIntoViewIfNeeded();
await page.screenshot({ path: shot("tint11-7-settings.png"), clip: (await page.locator("[data-tint-settings]").boundingBox()) ?? undefined });
await sql("update public.settings set value = $1::jsonb where key = 'tint_legal_max_darkness'", [JSON.stringify(limitBefore)]);

/* ---------------- 8. "Same as last time" for a returning customer ---------------- */
const car = (await sql("select vehicle_id, customer_id from public.jobs where id = $1", [bsJob]))[0];
const est = (await sql("insert into public.quotations (kind, number, version, customer_id, vehicle_id, status, vat_percent, created_by, updated_by) values ('estimate', 'E-E2E-TINT', 1, $1, $2, 'draft', 5, $3, $3) returning id", [car.customer_id, car.vehicle_id, owner]))[0];
await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, unit_price, created_by, updated_by) values ($1, 0, 'package', 'Window tint', 'manual', 1, 2500, $2, $2)", [est.id, owner]);
await go(page, `${base}/estimates/${est.id}`);
check("8: a returning car offers 'Same as last time'", /Same as last time/.test((await page.locator("[data-tint-last-time]").textContent().catch(() => "")) ?? "") && /Q-STAGE-B/.test((await page.locator("[data-tint-last-time]").textContent().catch(() => "")) ?? ""));
await page.locator("[data-tint-last-time]").click();
check("8: one tap copies the earlier choice", !!(await until(async () => { const s = await specOf(est.id); return s?.rows?.rear_sides?.shade === 70 && s?.rows?.rear_window?.shade === 50 ? 1 : null; })));

// The photo the tablet uploaded leaves the bucket too.
if (photo?.storage_path) await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/job-files`, { method: "DELETE", headers: { authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, apikey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "", "content-type": "application/json" }, body: JSON.stringify({ prefixes: [photo.storage_path] }) }).catch(() => null);
await browser.close(); await cb.close(); await ab.close();
cleanupDb();
process.exit(summary() ? 1 : 0);
