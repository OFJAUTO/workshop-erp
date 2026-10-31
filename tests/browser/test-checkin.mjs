// The customer's gate-in link is the VEHICLE CHECK-IN, never "job card" (31 October 2026). On the TEST database through
// the test server: (A) a test check-in for a company customer whose contact name is the company again, with two panels
// marked at gate-in and a photo of each - the title, the Arabic, "Reference J-…", "Download check-in (PDF)" and its file
// name, the company shown once, the empty name box, the diagram coloured with the written list, the WhatsApp message,
// a typed name required, and after approving "Approved by <typed name> for <COMPANY> on …" on the page and the PDF;
// (B) a test copy of J-00859's check-in (its own photos, no panels marked). Pictures: tests/browser/shots/check-in/.
//   node --env-file=.env.test.local tests/browser/test-checkin.mjs        (npm run test:checkin)
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { api, base, browserFor, cleanupDb, here, makeChecks, pageReady, projectRoot, sql, sleep } from "./pw-lib.mjs";

const { checkPdf, pagePng } = await import("../unit/pdf-check-lib.mjs");
const mupdf = await import("mupdf");
const { check, summary } = makeChecks();
const SHOTS = path.join(here, "shots", "check-in");
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (n) => path.join(SHOTS, n);
const ID = (n) => `22222222-0000-4000-8000-00000000${n}`;
const AR1 = ID("e3c1"), M1 = ID("e3c2"), M2 = ID("e3c3"), AR2 = ID("e3c4");
const COMPANY = "E2E Holiday Homes Rental LLC";
const SAME_NAME = "E2E HOLIDAY HOMES RENTAL L.L.C";
const TYPED = "Sara Testperson";
const storage = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }).storage.from("gate-in-media");
const one = async (q, p = []) => (await sql(q, p))[0] ?? null;
const textOf = (buf) => { const d = mupdf.Document.openDocument(buf, "application/pdf"); return Array.from({ length: d.countPages() }, (_, i) => d.loadPage(i).toStructuredText().asText()).join("\n"); };
async function pdf(token, name) {
  const r = await fetch(`${base}/api/pdf/jobcard/${token}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const pages = mupdf.Document.openDocument(buf, "application/pdf").countPages();
  for (let p = 0; p < pages; p++) fs.writeFileSync(shot(`${name}-pdf-p${p + 1}.png`), pagePng(buf, p, 1.3));
  return { ok: r.ok, disposition: r.headers.get("content-disposition") ?? "", text: textOf(buf), buf, pages };
}
/** Runs SQL on the TEST database with the no-delete triggers off (db-sql refuses nothing; the file checks the role first). */
function testSql(body) {
  const f = path.join(os.tmpdir(), `checkin-${process.pid}.sql`);
  fs.writeFileSync(f, `do $$ begin if coalesce((select value #>> '{}' from public.settings where key = 'database_role'), 'live') <> 'test' then raise exception 'Refused: not the TEST database'; end if; end $$;\nset session_replication_role = replica;\n${body}\n`);
  try { execSync(`node --env-file=.env.test.local scripts/db-sql.mjs "${f}"`, { cwd: projectRoot, encoding: "utf8" }); } finally { fs.rmSync(f, { force: true }); }
}

const uploaded = [];
let j859 = null;
try {
  cleanupDb();
  /* A: the seeded car, made a company customer with two marked panels */
  const seed = await api("/api/e2e/stage", { stage: "assign" });
  const jobId = seed.json?.jobId;
  check("A: the test car is seeded", !!jobId, JSON.stringify(seed.json ?? seed.text ?? "").slice(0, 160));
  const job = await one("select id, job_number, customer_id, created_by from public.jobs where id = $1", [jobId]);
  await sql("update public.customers set company_name = $1, full_name = $2 where id = $3", [COMPANY, SAME_NAME, job.customer_id]);
  // The seed's car is past approval; this one waits for the customer (the stamp trigger guards first_approval_at, so off).
  testSql(`update public.jobs set status = 'pending_approval', stage = 'gate_in', first_approval_at = null, assigned_to = null, gated_in_at = coalesce(gated_in_at, now()) where id = '${jobId}';`);
  const waiting = await one("select status, first_approval_at from public.jobs where id = $1", [jobId]);
  check("A: the car waits for the customer's approval", waiting?.status === "pending_approval" && !waiting?.first_approval_at, JSON.stringify(waiting));
  const marks = { front_bumper: { damage: ["scratch"], severity: "minor", note: null }, door_fl: { damage: ["dent", "paint_damage"], severity: "moderate", note: "Deep dent by the handle" } };
  await sql("update public.gate_ins set damage_panels = $1::jsonb, damage_note = null where job_id = $2", [JSON.stringify(marks), jobId]);
  const photo = fs.readFileSync(path.join(projectRoot, "public", "preview.jpg"));
  for (const [id, panel] of [[M1, "front_bumper"], [M2, "door_fl"]]) {
    const p = `test/${jobId}/damage-${panel}.jpg`;
    const up = await storage.upload(p, photo, { contentType: "image/jpeg", upsert: true });
    if (!up.error) uploaded.push(p);
    await sql("insert into public.gate_in_media (id, job_id, kind, storage_path, caption, uploaded_by, created_by, updated_by) values ($1, $2, 'damage_photo', $3, $4, $5, $5, $5) on conflict (id) do nothing", [id, jobId, p, `panel:${panel}`, job.created_by]);
  }
  const tokenA = `e2e-checkin-${Date.now()}`;
  await sql("insert into public.approval_requests (id, job_id, kind, token, sent_to_name, sent_to_phone, terms_text, status, sent_at, sent_by) values ($1, $2, 'job_card', $3, $4, '+971500000071', 'Test terms', 'sent', now(), $5) on conflict (id) do nothing", [AR1, jobId, tokenA, COMPANY, job.created_by]);
  const seeded = await one("select (select count(*)::int from public.gate_in_media where job_id = $1 and kind = 'damage_photo' and caption like 'panel:%') as photos, (select token from public.approval_requests where id = $2) as token, (select company_name from public.customers where id = $3) as company", [jobId, AR1, job.customer_id]);
  check("A: two panel photos, the link and the company are in place", seeded?.photos === 2 && seeded?.token === tokenA && !!seeded?.company, JSON.stringify(seeded));
  const company = seeded.company; // as the tidy trigger stored it

  /* The advisor's WhatsApp message (the send window on the job card) */
  {
    const { browser, page } = await browserFor("service_advisor", { viewport: { width: 1440, height: 900 } });
    await page.goto(`${base}/jobs/${jobId}`, { waitUntil: "load", timeout: 60000 });
    await pageReady(page);
    await page.getByRole("button", { name: "Send again" }).first().click();
    const box = page.locator("[data-send-message]").first();
    await box.waitFor({ timeout: 10000 });
    const message = (await box.evaluate((el) => ("value" in el && el.value) || el.textContent || "")).trim();
    fs.writeFileSync(shot("whatsapp-message.txt"), message);
    await page.screenshot({ path: shot("whatsapp-send-window-1440.png") });
    check("WhatsApp: the message greets the company once, without the legal ending", /^Dear E2E Holiday Homes Rental,/i.test(message), message.split("\n")[0]);
    check("WhatsApp: the message says check-in and never job card", /check-in/i.test(message) && !/job card/i.test(message), message.replace(/\s+/g, " ").slice(0, 200));
    check("WhatsApp: the message carries the link", /https?:\/\/\S+/.test(message));
    await browser.close();
  }

  /* The customer's page, phone and computer */
  for (const [w, h] of [[390, 844], [1440, 900]]) {
    const { browser, page } = await browserFor("owner", { viewport: { width: w, height: h }, touch: w < 800, mobile: w < 800 });
    await page.context().clearCookies();
    await page.goto(`${base}/approve/${tokenA}?preview=1`, { waitUntil: "load", timeout: 60000 });
    await pageReady(page);
    await page.evaluate(() => document.querySelectorAll("img[loading=lazy]").forEach((i) => { i.loading = "eager"; }));
    await sleep(600);
    const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    await page.screenshot({ path: shot(`A-check-in-${w}.png`), fullPage: true });
    check(`A ${w}: the title is VEHICLE CHECK-IN with the Arabic under it`, (await page.locator("[data-front-title]").innerText()).trim() === "VEHICLE CHECK-IN" && (await page.locator("[data-front-title-ar]").innerText()).trim() === "استلام المركبة");
    check(`A ${w}: the number reads Reference ${job.job_number}`, new RegExp(`REFERENCE\\s*${job.job_number}`).test(body), body.match(/REFERENCE.{0,20}/)?.[0] ?? "(none)");
    check(`A ${w}: the button reads Download check-in (PDF)`, (await page.getByText("Download check-in (PDF)", { exact: true }).count()) === 1);
    check(`A ${w}: "job card" appears nowhere on the page`, !/job card/i.test(body), body.match(/.{0,40}job card.{0,40}/i)?.[0] ?? "");
    check(`A ${w}: the page title (WhatsApp preview) says Vehicle check-in`, /Vehicle check-in/.test(await page.locator('meta[property="og:title"]').getAttribute("content")) && !/job card/i.test(await page.title()), await page.title());
    const cust = await page.evaluate(() => Array.from(document.querySelectorAll("section div")).find((d) => d.firstElementChild?.textContent?.trim().toLowerCase() === "customer")?.innerText ?? "");
    const norm = (s) => s.toLowerCase().replace(/l\.?l\.?c\.?/g, "").replace(/[^a-z0-9]/g, "");
    const times = cust.split("\n").filter((l) => norm(l) && norm(l) === norm(company)).length;
    check(`A ${w}: the company shows once (the contact name was the company again)`, times === 1, cust.replace(/\n/g, " | "));
    const name = page.locator("[data-approver-name]");
    check(`A ${w}: the name box is empty with "Type your full name"`, (await name.inputValue()) === "" && (await name.getAttribute("placeholder")) === "Type your full name" && (await name.getAttribute("required")) !== null);
    const items = await page.locator("[data-damage-item]").allInnerTexts();
    check(`A ${w}: the written list has the two panels with damage and severity`, items.length === 2 && /Front bumper/i.test(items.join(" ")) && /Scratch/i.test(items.join(" ")) && /Minor/i.test(items.join(" ")) && /Door – front left/i.test(items.join(" ")) && /Dent, Paint damage/i.test(items.join(" ")) && /Moderate/i.test(items.join(" ")), items.map((t) => t.replace(/\s+/g, " ")).join(" || "));
    check(`A ${w}: each listed panel shows its photo`, (await page.locator("[data-damage-section] [data-damage-photo]").count()) >= 2, String(await page.locator("[data-damage-section] [data-damage-photo]").count()));
    const fills = await page.evaluate(() => Object.fromEntries(["front_bumper", "door_fl", "bonnet"].map((k) => [k, document.querySelector(`[data-damage-section] [data-car-outline] [data-panel="${k}"]`)?.getAttribute("fill") ?? null])));
    check(`A ${w}: the diagram colours the two marked panels (and not the others)`, !!fills.front_bumper && !!fills.door_fl && fills.front_bumper !== fills.bonnet && fills.door_fl !== fills.bonnet && fills.front_bumper !== fills.door_fl, JSON.stringify(fills));
    const labels = await page.locator("[data-damage-section] [data-outline-label]").allTextContents();
    check(`A ${w}: FRONT / REAR / LEFT / RIGHT on the diagram`, ["FRONT", "REAR", "LEFT", "RIGHT"].every((l) => labels.includes(l)), labels.join(","));
    const dmg = page.locator("[data-damage-section]").first();
    await dmg.scrollIntoViewIfNeeded();
    await dmg.screenshot({ path: shot(`A-damage-${w}.png`) });
    if (w === 390) {
      const appr = page.locator("#approval");
      await appr.scrollIntoViewIfNeeded();
      await appr.screenshot({ path: shot("A-name-box-empty-390.png") });
    }
    await browser.close();
  }

  /* The PDF before approval */
  {
    const p = await pdf(tokenA, "A-before");
    check("A PDF: opens, file name OFJ Vehicle check-in <number>.pdf", p.ok && p.disposition.includes(`filename="OFJ Vehicle check-in ${job.job_number}.pdf"`), p.disposition);
    check("A PDF: titled VEHICLE CHECK-IN with Reference, never JOB CARD", /VEHICLE CHECK-IN/.test(p.text) && new RegExp(`Reference ${job.job_number}`).test(p.text) && !/job card/i.test(p.text), p.text.slice(0, 160).replace(/\s+/g, " "));
    check("A PDF: CHECK-IN APPROVAL says not approved yet", /CHECK-IN APPROVAL/i.test(p.text) && /Not approved yet/.test(p.text));
    check("A PDF: the damage list on paper", /Front bumper/.test(p.text) && /Door – front left/.test(p.text));
    check("A PDF: 'Damage noted' points down to the list (it comes after the details on paper)", /2 panels \(see below\)/.test(p.text) && !/see above/.test(p.text));
    const layout = checkPdf(p.buf, "check-in");
    check(`A PDF: layout clean (${p.pages} page${p.pages === 1 ? "" : "s"})`, layout.length === 0, layout.slice(0, 3).join(" | "));
  }

  /* A typed name is required (the server, too) */
  {
    const r = await fetch(`${base}/api/approve/${tokenA}`, { method: "POST", body: new URLSearchParams({ agree: "on", approver_name: "" }), redirect: "manual" });
    check("approval without a typed name is refused", r.status === 303 && /error=Please(%20|\+)type(%20|\+)your(%20|\+)full(%20|\+)name/.test(r.headers.get("location") ?? ""), r.headers.get("location") ?? String(r.status));
    const still = await one("select approved_at from public.approval_requests where id = $1", [AR1]);
    check("… and nothing was approved", !still?.approved_at);
  }

  /* The customer approves with a typed name */
  {
    const { browser, page } = await browserFor("owner", { viewport: { width: 390, height: 844 }, touch: true, mobile: true });
    await page.context().clearCookies();
    await page.goto(`${base}/approve/${tokenA}`, { waitUntil: "load", timeout: 60000 });
    await pageReady(page);
    await page.locator('input[name="agree"]').check();
    await page.locator("[data-approver-name]").fill(TYPED);
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    const line = page.locator("[data-approved-line]");
    await line.waitFor({ timeout: 20000 });
    const words = (await line.innerText()).replace(/\s+/g, " ").trim();
    check(`approved line: "Approved by ${TYPED} for <company> on …"`, words.startsWith(`Approved by ${TYPED} for ${company} on `), words);
    await line.scrollIntoViewIfNeeded();
    await page.screenshot({ path: shot("A-approved-390.png") });
    await browser.close();
    const stored = await one("select approver_name from public.approval_requests where id = $1", [AR1]);
    check("the typed name is what was stored", stored?.approver_name === TYPED, stored?.approver_name ?? "(none)");
    const p = await pdf(tokenA, "A-after");
    check("A PDF after approving: the same approval line", p.text.replace(/\s+/g, " ").includes(`Approved by ${TYPED} for ${company} on `), (p.text.match(/Approved by.{0,90}/) ?? [""])[0]);
  }

  /* B: a test copy of J-00859's check-in (its own photos; no panels were marked on that gate-in) */
  j859 = await one("select jb.id, jb.customer_id, c.full_name, c.company_name, jb.created_by, gi.damage_panels from public.jobs jb join public.customers c on c.id = jb.customer_id join public.gate_ins gi on gi.job_id = jb.id where jb.job_number = 'J-00859'");
  if (!j859) console.log("SKIP B: J-00859 is not on the test database");
  else {
    // On live the contact name equals the company; the test copy's names were replaced separately, so match them here.
    await sql("update public.customers set full_name = company_name where id = $1 and company_name is not null", [j859.customer_id]);
    const tokenB = `e2e-checkin-859-${Date.now()}`;
    await sql("insert into public.approval_requests (id, job_id, kind, token, sent_to_name, sent_to_phone, terms_text, status, sent_at, sent_by) values ($1, $2, 'job_card', $3, $4, '+971500000072', 'Test terms', 'sent', now(), $5) on conflict (id) do nothing", [AR2, j859.id, tokenB, j859.company_name, j859.created_by]);
    check("B: J-00859 had no panels marked at gate-in", Object.keys(j859.damage_panels ?? {}).length === 0, JSON.stringify(j859.damage_panels));
    // The test copy has the photo rows but not the files (the copy never copies storage): a placeholder picture goes to
    // each missing path on the TEST storage for this look, and is removed again at the end.
    const rows = await sql("select storage_path from public.gate_in_media where job_id = $1 and kind = 'damage_photo' and removed_at is null", [j859.id]);
    for (const r of rows) {
      const up = await storage.upload(r.storage_path, fs.readFileSync(path.join(projectRoot, "public", "preview.jpg")), { contentType: "image/jpeg", upsert: false });
      if (!up.error) uploaded.push(r.storage_path);
    }
    const { browser, page } = await browserFor("owner", { viewport: { width: 390, height: 844 }, touch: true, mobile: true });
    await page.context().clearCookies();
    await page.goto(`${base}/approve/${tokenB}?preview=1`, { waitUntil: "load", timeout: 60000 });
    await pageReady(page);
    await page.evaluate(() => document.querySelectorAll("img[loading=lazy]").forEach((i) => { i.loading = "eager"; }));
    await sleep(800);
    const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    await page.screenshot({ path: shot("B-J-00859-copy-390.png"), fullPage: true });
    check("B: J-00859 copy titled VEHICLE CHECK-IN, Reference J-00859, Download check-in (PDF)", /VEHICLE CHECK-IN/.test(body) && /REFERENCE\s*J-00859/.test(body) && /Download check-in \(PDF\)/.test(body) && !/job card/i.test(body));
    const cust = await page.evaluate(() => Array.from(document.querySelectorAll("section div")).find((d) => d.firstElementChild?.textContent?.trim().toLowerCase() === "customer")?.innerText ?? "");
    check("B: the company shows once", cust.split("\n").filter((l) => l.trim().toLowerCase() === String(j859.company_name).trim().toLowerCase()).length === 1, `${cust.split("\n").length} lines in the box`);
    check("B: the name box starts empty", (await page.locator("[data-approver-name]").inputValue()) === "");
    const dmgB = page.locator("[data-damage-section]").first();
    check(`B: its ${rows.length} damage photos show in the damage section (no panels, so as damage photos)`, (await dmgB.locator("[data-damage-photo]").count()) === rows.length && (await dmgB.locator("[data-damage-item]").count()) === 0, `${await dmgB.locator("[data-damage-photo]").count()} photos, ${await dmgB.locator("[data-damage-item]").count()} panels`);
    await dmgB.scrollIntoViewIfNeeded();
    await dmgB.screenshot({ path: shot("B-J-00859-damage-390.png") });
    await browser.close();
    const p = await pdf(tokenB, "B-J-00859-copy");
    check("B PDF: OFJ Vehicle check-in J-00859.pdf, VEHICLE CHECK-IN, no job card", p.disposition.includes('filename="OFJ Vehicle check-in J-00859.pdf"') && /VEHICLE CHECK-IN/.test(p.text) && !/job card/i.test(p.text), p.disposition);
  }
} catch (e) {
  check("walked without a crash", false, String(e?.stack ?? e).slice(0, 400));
} finally {
  // Every test row and file goes again: the seeded car by the clean-up, the J-00859 copy's link by id and its name back.
  if (uploaded.length) await storage.remove(uploaded).catch(() => null);
  if (j859) await sql("update public.customers set full_name = $1 where id = $2", [j859.full_name, j859.customer_id]);
  try { testSql(`delete from public.approval_requests where id in ('${AR1}', '${AR2}');\ndelete from public.gate_in_media where id in ('${M1}', '${M2}');`); } catch (e) { console.log("clean-up of the links failed:", String(e.message).slice(0, 200)); }
  cleanupDb();
  const left = await one("select (select count(*)::int from public.approval_requests where id in ($1, $2)) as links, (select count(*)::int from public.gate_in_media where id in ($3, $4)) as media", [AR1, AR2, M1, M2]);
  check("clean-up: the test links and photos are gone", left?.links === 0 && left?.media === 0, JSON.stringify(left));
}
process.exit(summary() ? 1 : 0);
