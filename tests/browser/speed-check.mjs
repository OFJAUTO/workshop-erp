// SPEED CHECK (11 November 2026, Section 16): how long the pages and a few button taps take as a TABLET loads them
// (800 × 1280, touch), against the TEST server (never live: tests never sign in on live). Each page is opened once to
// warm it, then measured RUNS times; we keep the middle figure. Reported per page: the server's answer (time to the
// first byte) and the page ready (fonts and two frames), plus how far this PC is from the test database, so the
// numbers can be read for the live site (server and database both in Mumbai there).
//   E2E_BASE=http://localhost:3102 node --env-file=.env.test.local tests/browser/speed-check.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { api, base, browserFor, sql } from "./pw-lib.mjs";

const RUNS = Number(process.env.RUNS ?? 3);
const out = [];
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function timePage(page, url) {
  const runs = [];
  for (let i = 0; i <= RUNS; i++) {
    const t0 = Date.now();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.evaluate(() => document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))));
    const wall = Date.now() - t0;
    const nav = await page.evaluate(() => { const n = performance.getEntriesByType("navigation")[0]; return n ? { ttfb: Math.round(n.responseStart - n.requestStart), dom: Math.round(n.domContentLoadedEventEnd) } : null; });
    if (i > 0) runs.push({ wall, ttfb: nav?.ttfb ?? null });
  }
  return { ttfb: median(runs.map((r) => r.ttfb ?? 0)), ready: median(runs.map((r) => r.wall)) };
}

async function timeClick(page, url, selector, waitFor) {
  const runs = [];
  for (let i = 0; i <= RUNS; i++) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    const el = page.locator(selector).first();
    if ((await el.count()) === 0) return null;
    const t0 = Date.now();
    await el.click();
    await waitFor(page);
    if (i > 0) runs.push(Date.now() - t0);
  }
  return { ttfb: null, ready: median(runs) };
}

const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
const jobId = seed?.jobId;
const qid = jobId ? (await sql("select id from public.quotations where job_id = $1 order by version desc limit 1", [jobId]))[0]?.id : null;
const est = (await sql("select id from public.quotations where kind = 'estimate' and is_active order by created_at desc limit 1"))[0]?.id;
const po = (await sql("select id from public.purchase_orders where is_active order by created_at desc limit 1"))[0]?.id;

// The database distance from this PC: one tiny read, ten times.
const t = [];
for (let i = 0; i < 10; i++) { const a = Date.now(); await sql("select 1"); t.push(Date.now() - a); }
const dbRoundTrip = median(t);

const PLAN = {
  owner: ["/dashboard", "/jobs", jobId && `/jobs/${jobId}`, qid && `/jobs/${jobId}/quote/${qid}`, est && `/estimates/${est}`, "/estimates", "/invoices", "/approvals", "/profit", "/reports/monthly", "/calendar", po && `/parts/orders/${po}`],
  service_advisor: ["/dashboard", "/quotes", "/estimates", "/jobs"],
  parts: ["/dashboard", "/parts", jobId && `/parts/${jobId}`, "/stickers", "/parts/orders"],
  accounts: ["/dashboard", "/supplier-invoices", "/supplier-payments", "/accounts-posting"],
  technician: ["/my-jobs"],
  gate_in: ["/dashboard"],
  workshop_manager: ["/dashboard", "/assign"],
};
for (const [role, pages] of Object.entries(PLAN)) {
  const b = await browserFor(role, { viewport: { width: 800, height: 1280 }, touch: true });
  for (const p of pages.filter(Boolean)) {
    try {
      const r = await timePage(b.page, `${base}${p}`);
      out.push({ what: `${role} · ${p}`, kind: "page", ...r });
    } catch (e) {
      out.push({ what: `${role} · ${p}`, kind: "page", ttfb: null, ready: null, error: String(e.message).slice(0, 80) });
    }
  }
  if (role === "parts") {
    const r = await timeClick(b.page, `${base}/dashboard`, "[data-parts-tile]", (pg) => pg.waitForURL(/tile=/, { timeout: 30000 }));
    if (r) out.push({ what: "parts · tap a dashboard tile", kind: "button", ...r });
  }
  if (role === "owner") {
    const r = await timeClick(b.page, `${base}/jobs`, "[data-job-sort]:not([aria-current])", (pg) => pg.waitForURL(/sort=/, { timeout: 30000 }));
    if (r) out.push({ what: "owner · jobs list: tap a sort", kind: "button", ...r });
  }
  if (role === "gate_in") {
    const r = await timeClick(b.page, `${base}/dashboard`, '[data-gatein-tile="in"]', (pg) => pg.waitForURL(/tile=in/, { timeout: 30000 }));
    if (r) out.push({ what: "gate_in · tap In the workshop", kind: "button", ...r });
  }
  await b.browser.close();
}

const ranked = out.filter((r) => r.ready != null).sort((a, b) => b.ready - a.ready);
const report = { at: new Date().toISOString(), base, runs: RUNS, dbRoundTripMs: dbRoundTrip, slowest10: ranked.slice(0, 10), all: out };
mkdirSync("docs/proof/2026-11-11-speed", { recursive: true });
writeFileSync(`docs/proof/2026-11-11-speed/speed-${process.env.SPEED_TAG ?? "before"}.json`, JSON.stringify(report, null, 2));
console.log(`database round trip from this PC: ${dbRoundTrip} ms`);
for (const r of ranked.slice(0, 10)) console.log(`${String(r.ready).padStart(6)} ms ready · ${String(r.ttfb ?? "-").padStart(5)} ms server · ${r.what}`);
const under = ranked.filter((r) => r.ready < 1000).length;
console.log(`${under} of ${ranked.length} under 1 second${out.some((r) => r.error) ? ` · ${out.filter((r) => r.error).length} failed to load` : ""}`);
