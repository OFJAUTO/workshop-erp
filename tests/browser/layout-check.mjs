// The automatic layout check (29 October 2026, batch section 2; made fast the same night, batch 2 section 0): every
// page of every role's menu, the job-level pages of a seeded test car and every customer page, at the computer,
// tablet and phone sizes, plus once with the text at 130%. Fails on anything layout-rules.mjs finds: sideways
// scrolling, controls overlapping or cut off, text on text, clipped text, a word broken across two lines, something
// sticking out of its card, a button too small for a finger on a touch screen. Screenshots land in
// tests/browser/shots/layout/ and are the proof.
//   npm run test:layout                          every role, the customer pages, then every pop-up
//   ROLE=owner,advisor npm run test:layout       some roles (ROLE=customer the customer pages, ROLE=popups the pop-ups)
//   PAGES=/dashboard,/jobs SIZES=800x1280,1440x900 ROLE=owner   only the pages a change touched, at two sizes
//   WORKERS=4                                    pages checked at once (default 4)
// Fast by design: ONE browser, ONE login per role (its cookies shared by every worker), each page loaded once for the
// computer sizes and once for the touch sizes and resized in between, and no fixed waits - a page is ready when the
// bell has docked (hydrated), the fonts are in and two frames have been drawn. Best against the production test
// server (npm run test:server, E2E_BASE=http://localhost:3102); works against the dev server too.
import { mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { chromium } from "playwright-core";
import { MANAGER_MECH, api, base, cleanupDb, loginCookies, loginCookiesById, pageReady, sql } from "./pw-lib.mjs";
import { measurePage } from "./layout-rules.mjs";

const started = Date.now();
mkdirSync("tests/browser/shots/layout", { recursive: true });
/** [width, height, touch]: a computer, a laptop, an Android tablet sideways and upright, an iPad both ways, a phone. */
const SIZES = [
  [1920, 1080, false],
  [1440, 900, false],
  [1366, 768, false],
  [1280, 800, true],
  [1024, 768, true],
  [800, 1280, true],
  [768, 1024, true],
  [390, 844, true],
];
/** Once per page with the text at 130% (a person who set larger text on the tablet). */
const BIG_TEXT = [800, 1280, true];
const onlyRoles = (process.env.ROLE ?? "").split(",").map((r) => r.trim()).filter(Boolean);
const wants = (name) => !onlyRoles.length || onlyRoles.includes(name);
const onlyPages = (process.env.PAGES ?? "").split(",").map((p) => p.trim()).filter(Boolean);
const onlySizes = (process.env.SIZES ?? "").split(",").map((p) => p.trim()).filter(Boolean);
const [partNo, partOf] = (process.env.PART ?? "1/1").split("/").map((n) => Number(n) || 1);
const WORKERS = Math.max(1, Number(process.env.WORKERS) || 4);
const sizes = SIZES.filter(([w, h]) => !onlySizes.length || onlySizes.includes(`${w}x${h}`));
/** The screen families: one page load each, the sizes inside a family are reached by resizing. */
const FAMILIES = [sizes.filter((s) => !s[2]), sizes.filter((s) => s[2])].filter((f) => f.length);

const browser = await chromium.launch({ executablePath: process.env.E2E_BROWSER ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });

const ready = pageReady;

// The tablet and phone sizes are real touch screens (a coarse pointer, no hover), switched on the page through the
// browser's own emulation, so the page's touch rules (44 px controls) apply exactly as on the device.
const cdpOf = new WeakMap();
async function setTouch(page, on) {
  let s = cdpOf.get(page);
  if (!s) {
    s = { cdp: await page.context().newCDPSession(page), on: false };
    cdpOf.set(page, s);
  }
  if (s.on === on) return;
  await s.cdp.send("Emulation.setTouchEmulationEnabled", on ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
  s.on = on;
}

const findings = [];
const counter = { n: 0 };
async function measure(page, tag, path, [width, height, touch], big) {
  const problems = await page.evaluate(measurePage, { touch }).catch((e) => [`check failed: ${String(e).slice(0, 80)}`]);
  const slug = path.replace(/\W+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "home";
  await page.screenshot({ path: `tests/browser/shots/layout/${tag}-${slug}-${width}x${height}${big ? "-130" : ""}.png` }).catch(() => null);
  const where = `${tag} ${path} @${width}x${height}${big ? " (text 130%)" : ""}`;
  for (const p of problems) findings.push(`${where}: ${p}`);
  if (problems.length) console.log(`FAIL ${where}\n  - ${problems.join("\n  - ")}`);
  counter.n++;
}

/** One page: loaded once per family, measured at every size of the family, then once at 130% text. */
async function checkPage(page, tag, path) {
  for (const family of FAMILIES) {
    const [w0, h0, touch] = family[0];
    await page.setViewportSize({ width: w0, height: h0 });
    await setTouch(page, touch);
    try {
      await page.goto(`${base}${path}`, { waitUntil: "load", timeout: 60000 });
    } catch {
      findings.push(`${tag} ${path} @${w0}x${h0}: the page did not load`);
      continue;
    }
    await ready(page);
    for (const size of family) {
      await page.setViewportSize({ width: size[0], height: size[1] });
      await ready(page);
      await measure(page, tag, path, size, false);
    }
    if (touch && !onlySizes.length) {
      await page.setViewportSize({ width: BIG_TEXT[0], height: BIG_TEXT[1] });
      await page.addStyleTag({ content: "html { font-size: 130% !important; }" }).catch(() => null);
      await ready(page);
      await measure(page, tag, path, BIG_TEXT, true);
    }
  }
}

/** The seeded test car (fixed test ids, removed by the clean-up): its job pages and its customer links. */
async function seedPages() {
  const seededCar = (await api("/api/e2e/stage", { stage: "ready" })).json;
  const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0].id;
  const insp = (await sql("select id from public.inspections where job_id = $1 limit 1", [seededCar.jobId]))[0]?.id ?? null;
  const reportToken = randomBytes(16).toString("base64url");
  if (insp) await sql("insert into public.report_links (job_id, inspection_id, token, created_by, updated_by, opened_at, status) values ($1, $2, $3, $4, $4, now(), 'opened')", [seededCar.jobId, insp, reportToken, owner]);
  const approvalToken = randomBytes(16).toString("base64url");
  await sql("insert into public.approval_requests (job_id, token, status, sent_to_phone, sent_to_name, terms_text, created_by, opened_at) values ($1, $2, 'sent', '+971500000001', 'E2e Customer', 'Terms', $3, now())", [seededCar.jobId, approvalToken, owner]);
  const qToken = (await sql("select token from public.quotations where id = $1", [seededCar.quotationId]))[0]?.token ?? null;
  const job = seededCar.jobId;
  return {
    staff: [`/jobs/${job}`, `/jobs/${job}/quote/${seededCar.quotationId}`, `/jobs/${job}/inspection`, `/jobs/${job}/invoice`, `/jobs/${job}/work`, `/jobs/${job}/gate-in`, `/parts/${job}`, `/estimates/new`, `/settings`, `/settings/inspection`, `/settings/services`],
    customer: [qToken ? `/quote/${qToken}` : null, seededCar.invoice?.token ? `/invoice/${seededCar.invoice.token}` : null, seededCar.invoice?.token ? `/proforma/${seededCar.invoice.token}` : null, insp ? `/report/${reportToken}` : null, `/approve/${approvalToken}`].filter(Boolean),
  };
}

const technicianId = (await sql("select id from public.staff where role_id = 'technician' and is_active order by display_name limit 1"))[0]?.id ?? null;
const bodyshopId = (await sql("select id from public.staff where is_active and department_id in ('bodyshop', 'paint', 'ppf_tint', 'detailing') and role_id in ('workshop_manager', 'team_leader') order by role_id desc limit 1"))[0]?.id ?? null;
const leaderId = (await sql("select id from public.staff where is_active and role_id = 'team_leader' and display_name not ilike 'E2e %' order by display_name limit 1"))[0]?.id ?? null;
const roles = [
  { name: "owner", key: "owner" },
  { name: "advisor", key: "service_advisor" },
  { name: "parts", key: "parts" },
  { name: "accounts", key: "accounts" },
  { name: "workshop-manager", id: MANAGER_MECH },
  technicianId ? { name: "technician", id: technicianId } : null,
  bodyshopId ? { name: "bodyshop", id: bodyshopId } : null,
  leaderId ? { name: "team-leader", id: leaderId } : null,
].filter(Boolean).filter((r) => wants(r.name));

// Pages reached from inside another page (not in the menu) that still need checking.
// The parts desk's estimate pricing page (30 October 2026) opens any estimate read-only: the newest one is used.
const anEstimate = (await sql("select id from public.quotations where kind = 'estimate' and is_active and deleted_at is null order by created_at desc limit 1"))[0]?.id ?? null;
const EXTRA_PAGES = { owner: ["/settings/packages", "/commissions", "/settings/warranty", "/warranties", "/card-settlements", "/estimates/new", "/reports/inspection-fees"], advisor: ["/estimates/new"], accounts: ["/commissions", "/card-settlements"], parts: anEstimate ? [`/parts/estimate/${anEstimate}`] : [] };
const slice = (list) => {
  if (partOf <= 1) return list;
  const size = Math.ceil(list.length / partOf);
  return list.slice((partNo - 1) * size, partNo * size);
};

const needSeed = wants("owner") || wants("customer");
const seeded = needSeed ? await seedPages() : { staff: [], customer: [] };

// One login per role; every worker opens its own context with those cookies.
const cookiesOf = new Map();
for (const role of roles) cookiesOf.set(role.name, role.id ? await loginCookiesById(role.id) : await loginCookies(role.key));
cookiesOf.set("customer", []);

/** A worker's page for a role (one context per role per worker, reused for every page of that role). */
function pagePool() {
  const pages = new Map();
  return async (roleName) => {
    if (pages.has(roleName)) return pages.get(roleName);
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addCookies(cookiesOf.get(roleName));
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on("dialog", (d) => d.accept().catch(() => null));
    pages.set(roleName, page);
    return page;
  };
}

// Each role's menu: wherever it lands plus every link in its sidebar/menu.
const items = [];
const discover = pagePool();
for (const role of roles) {
  const page = await discover(role.name);
  await page.goto(`${base}/`, { waitUntil: "load", timeout: 60000 });
  await ready(page);
  const hrefs = await page.evaluate(() => [...document.querySelectorAll("aside a[href], [data-menu-drawer] a[href]")].map((a) => a.getAttribute("href")).filter((h) => h && h.startsWith("/") && !h.startsWith("/api")));
  const landed = new URL(page.url()).pathname;
  const targets = slice([...new Set([landed, ...hrefs, ...(EXTRA_PAGES[role.name] ?? []), ...(role.name === "owner" ? seeded.staff : [])])]).filter((p) => !onlyPages.length || onlyPages.includes(p));
  for (const path of targets) items.push({ tag: role.name, path });
  console.log(`${role.name}: ${targets.length} pages`);
}
if (wants("customer")) for (const path of slice(seeded.customer)) items.push({ tag: "customer", path });

// The workers take the next page from the one queue until it is empty.
let next = 0;
await Promise.all(Array.from({ length: Math.min(WORKERS, items.length || 1) }, async () => {
  const pageFor = pagePool();
  while (next < items.length) {
    const item = items[next++];
    const page = await pageFor(item.tag);
    await checkPage(page, item.tag, item.path).catch((e) => findings.push(`${item.tag} ${item.path}: check crashed (${String(e.message ?? e).split("\n")[0].slice(0, 100)})`));
  }
}));
await browser.close();
if (needSeed) cleanupDb();
const pagesSeconds = Math.round((Date.now() - started) / 1000);

// Every pop-up too: with the full check, or alone with ROLE=popups.
if (!onlyRoles.length || onlyRoles.includes("popups")) {
  const { runPopups } = await import("./popup-check.mjs");
  findings.push(...(await runPopups()));
}
const took = Math.round((Date.now() - started) / 1000);
const mmss = (s) => `${Math.floor(s / 60)} min ${s % 60} s`;
console.log(`\n${items.length} pages · ${counter.n} page views checked with ${WORKERS} workers · sizes ${sizes.map(([w, h]) => `${w}x${h}`).join(", ")}${onlySizes.length ? "" : ` and ${BIG_TEXT[0]}x${BIG_TEXT[1]} with the text at 130%`} · screenshots in tests/browser/shots/layout/`);
console.log(`Took ${mmss(took)} (pages ${mmss(pagesSeconds)}${took > pagesSeconds ? `, pop-ups ${mmss(took - pagesSeconds)}` : ""}).`);
console.log(findings.length ? `${findings.length} problems found` : "No overlaps, nothing cut off, no text on text, no broken words, nothing out of its card, no sideways scrolling.");
process.exit(findings.length ? 1 : 0);
