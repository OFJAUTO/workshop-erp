// Batch 29 Oct (2), section 1: the customer on the car card, the owner details panel, and NO customer anywhere for
// the workshop roles.
//  A  the owner and an advisor: a test car's card shows its customer and a "Tech · <name>" tag; tapping the name opens
//     the details panel (a pop-up at 1440x900, a sheet at 800x1280); the real J-00655 (DUBAI EE 72836) shows its own
//     customer (read from the database, never written into this file) with "Tech · <its technician>" - read only.
//  B  every workshop role (workshop manager, the technician on the car, Parts, QC, team leader): the pages they can
//     open, their search and the panel's data route never carry the customer's name, phone, the approver or the
//     driver; the technician's search for the J-00655 customer's name finds nothing; his own card shows no customer.
//   E2E_BASE=http://localhost:3101 node --env-file=.env.local tests/browser/test-customers1.mjs
import path from "node:path";
import fs from "node:fs";
import { MANAGER_MECH, api, base, browserFor, browserForId, cleanupDb, cookieHeader, freeTech, go, here, makeChecks, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const SHOTS = path.join(here, "shots", "customers1");
fs.mkdirSync(SHOTS, { recursive: true });
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 14 * 60 * 1000).unref();
const until = async (fn, tries = 40, gap = 250) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, gap)); } return null; };
const SECRETS = ["Stage Test Customer", "500000003", "50 000 0003", "Stage Driver Person", "500000077", "50 000 0077"];

const seed = (await api("/api/e2e/stage", { stage: "ready" })).json;
const jobId = seed.jobId;
const job = (await sql("select j.vehicle_id, j.job_number from public.jobs j where j.id = $1", [jobId]))[0];
const tech = await freeTech(jobId);
const techName = (await sql("select display_name from public.staff where id = $1", [tech]))[0]?.display_name ?? "";
const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0].id;
// The job card went to someone else (a driver), who approved it; the history says so with his phone.
await sql("insert into public.approval_requests (job_id, token, status, sent_to_phone, sent_to_name, approver_name, approved_at, terms_text, created_by, opened_at) values ($1, md5(random()::text), 'approved', '+971500000077', 'Stage Driver Person', 'Stage Driver Person', now(), 'Terms', $2, now())", [jobId, owner]);
await sql("insert into public.job_events (job_id, event_type, note, created_by) values ($1, 'approval_sent', 'Approval link created for Stage Driver Person (+971500000077)', $2)", [jobId, owner]);
const real = (await sql("select j.id, j.job_number, a.id as tech_id, a.display_name as tech, coalesce(c.company_name, c.full_name) as customer from public.jobs j left join public.staff a on a.id = j.assigned_to join public.customers c on c.id = j.customer_id where j.job_number = 'J-00655'"))[0] ?? null;
const realName = real?.customer ?? "";
const realWord = realName.split(" ")[0] ?? "";
const has = (text, words) => String(text ?? "").toLowerCase().includes(String(words).toLowerCase());

const cardOf = (page, id) => page.locator(`[data-car-card][data-flash-id='${id}']`).first();
async function openOnDashboard(page, id) {
  const card = cardOf(page, id);
  await card.evaluate((el) => { for (let d = el.closest("details"); d; d = d.parentElement?.closest("details") ?? null) d.open = true; el.scrollIntoView({ block: "center" }); }).catch(() => null);
  return card;
}

try {
  /* ---------------- A ---------------- */
  for (const [w, h, name] of [[1440, 900, "computer"], [800, 1280, "tablet"]]) {
    const { browser, page } = await browserFor("owner", { viewport: { width: w, height: h }, touch: w < 1100 });
    await go(page, `${base}/dashboard`);
    const card = await openOnDashboard(page, jobId);
    const text = (await card.textContent().catch(() => "")) ?? "";
    check(`A ${name}: the owner's card shows the job's customer`, /Stage Test Customer/i.test(text), text.slice(0, 120));
    check(`A ${name}: the technician has his own "Tech · ${techName}" tag, not in the customer line`, (await card.locator("[data-staff-tag]").textContent().catch(() => ""))?.startsWith(`Tech · ${techName}`) && !/Stage Test Customer/.test((await card.locator("[data-staff-tag]").textContent().catch(() => "")) ?? ""));
    await card.locator("[data-customer-name]").first().click();
    const panel = page.locator("[data-customer-panel]");
    await panel.waitFor({ timeout: 8000 });
    await until(async () => /Stage Test Customer/i.test((await panel.textContent()) ?? ""));
    const pText = (await panel.textContent()) ?? "";
    check(`A ${name}: tapping the name opens the details panel (name, Call, WhatsApp, previous jobs, buttons)`, /Stage Test Customer/i.test(pText) && (await panel.locator("[data-panel-call]").count()) > 0 && (await panel.locator("[data-panel-whatsapp]").count()) > 0 && /Previous jobs/i.test(pText) && (await panel.locator("[data-panel-customer-page]").count()) === 1 && (await panel.locator("[data-panel-gate-in]").count()) === 1);
    check(`A ${name}: the panel shows who approved the job card when it was someone else`, /approved by\s*Stage Driver Person/i.test(pText));
    check(`A ${name}: the card itself did not open`, page.url().endsWith("/dashboard"));
    const box = await panel.boundingBox();
    check(`A ${name}: ${w >= 1100 ? "a pop-up in the middle" : "a sheet from the bottom, full width"}`, !!box && (w >= 1100 ? box.width <= 640 && box.y > 10 : Math.abs(box.width - w) <= 2 && Math.abs(box.y + box.height - h) <= 2), JSON.stringify(box));
    await page.screenshot({ path: path.join(SHOTS, `A-panel-${name}-${w}x${h}.png`) });
    await page.locator("[data-panel-close]").click();
    check(`A ${name}: ✕ closes the panel`, !!(await until(async () => (await panel.count()) === 0)));
    if (real) {
      const rc = await openOnDashboard(page, real.id);
      const rt = (await rc.textContent().catch(() => "")) ?? "";
      check(`A ${name}: J-00655 (DUBAI EE 72836) shows its customer and "Tech · ${real.tech}"`, has(rt, realName) && (await rc.locator("[data-staff-tag]").textContent().catch(() => ""))?.startsWith(`Tech · ${String(real.tech).split(" ")[0]}`), rt.slice(0, 160));
      await rc.screenshot({ path: path.join(SHOTS, `A-J-00655-owner-${w}x${h}.png`) }).catch(() => null);
    }
    await browser.close();
  }
  {
    const { browser, page } = await browserFor("service_advisor", { viewport: { width: 800, height: 1280 }, touch: true });
    await go(page, `${base}/dashboard`);
    if (real) {
      const rc = await openOnDashboard(page, real.id);
      const rt = (await rc.textContent().catch(() => "")) ?? "";
      check("A advisor: J-00655 shows its customer with the Tech tag", has(rt, realName) && (await rc.locator("[data-staff-tag]").count()) === 1);
      await rc.screenshot({ path: path.join(SHOTS, "A-J-00655-advisor-800x1280.png") }).catch(() => null);
    }
    await browser.close();
  }

  /* ---------------- B ---------------- */
  const roles = [["workshop manager", MANAGER_MECH], ["technician on the car", tech]];
  for (const role of ["parts", "qc_inspector", "team_leader"]) {
    const p = (await sql("select id from public.staff where role_id = $1 and is_active and display_name not ilike 'E2e %' order by display_name limit 1", [role]))[0];
    if (p) roles.push([role.replace("_", " "), p.id]);
  }
  const pages = ["/dashboard", "/jobs", `/jobs/${jobId}`, `/jobs/${jobId}/gate-in`, `/jobs/${jobId}/inspection`, `/my-jobs`, `/my-jobs/${jobId}`, "/calendar", "/assign", "/parts", `/parts/${jobId}`, `/vehicles/${job.vehicle_id}`, "/vehicles", "/bodyshop", "/workshop", `/api/search?q=${encodeURIComponent("Stage Test")}`, `/api/search?q=500000003`, `/api/customer-panel?job=${jobId}`, `/api/pdf/gate-in/${jobId}`];
  for (const [label, id] of roles) {
    const cookie = await cookieHeader(id);
    const leaks = [];
    let reached = 0;
    for (const p of pages) {
      const r = await fetch(`${base}${p}`, { headers: { cookie }, redirect: "manual" });
      if (r.status !== 200) continue;
      reached++;
      const isPdf = (r.headers.get("content-type") ?? "").includes("pdf");
      const body = isPdf ? Buffer.from(await r.arrayBuffer()).toString("latin1") : await r.text();
      for (const s of SECRETS) if (body.toLowerCase().includes(s.toLowerCase())) leaks.push(`${p}: "${s}"`);
    }
    check(`B ${label}: ${reached} pages, the search and the panel route carry no customer, approver, driver or phone`, leaks.length === 0 && reached > 0, leaks.slice(0, 6).join(" · "));
    const panel = await fetch(`${base}/api/customer-panel?job=${jobId}`, { headers: { cookie } });
    check(`B ${label}: the details panel's data route refuses (403)`, panel.status === 403, `HTTP ${panel.status}`);
  }
  if (real?.tech_id) {
    const cookie = await cookieHeader(real.tech_id);
    const s = await (await fetch(`${base}/api/search?q=${encodeURIComponent(realWord)}`, { headers: { cookie } })).json();
    check(`B ${real.tech}: a search for the customer's name finds nothing`, Array.isArray(s.hits) && !s.hits.some((h) => h.href === `/jobs/${real.id}`), JSON.stringify(s).slice(0, 120));
    const ownerCookie = await cookieHeader("owner");
    const so = await (await fetch(`${base}/api/search?q=${encodeURIComponent(realWord)}`, { headers: { cookie: ownerCookie } })).json();
    check("B the owner's search for the same name finds J-00655 (the search itself works)", (so.hits ?? []).some((h) => h.href === `/jobs/${real.id}`));
    const { browser, page } = await browserForId(real.tech_id, { viewport: { width: 800, height: 1280 }, touch: true });
    await go(page, `${base}/my-jobs`);
    const html = await page.content();
    check(`B ${real.tech}'s own tablet: My jobs never carries the customer's name`, !has(html, realName));
    await page.screenshot({ path: path.join(SHOTS, "B-technician-my-jobs-800x1280.png") });
    await go(page, `${base}/my-jobs/${real.id}`);
    check(`B ${real.tech}'s own tablet: the J-00655 job screen never carries the customer`, !has(await page.content(), realName));
    await page.screenshot({ path: path.join(SHOTS, "B-technician-J-00655-800x1280.png") });
    const box = page.locator("input[type='search'], [data-top-search] input").first();
    if (await box.count()) {
      await box.fill(realWord);
      await new Promise((r) => setTimeout(r, 1500));
      await page.screenshot({ path: path.join(SHOTS, "B-technician-search-customer-800x1280.png") });
    }
    await browser.close();
  }
} catch (e) {
  check("walked without a crash", false, (e?.message ?? String(e)).slice(0, 300));
} finally {
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
