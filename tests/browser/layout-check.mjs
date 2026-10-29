// The automatic layout check (29 October 2026, batch section 2): every page of every role's menu, the job-level
// pages of a seeded test car and every customer page, at the computer, tablet and phone sizes, plus once with the
// text at 130%. Fails on anything layout-rules.mjs finds: sideways scrolling, controls overlapping or cut off, text
// on text, clipped text, a word broken across two lines, something sticking out of its card, a button too small for
// a finger on a touch screen. Screenshots land in tests/browser/shots/layout/.
//   npm run test:layout                       every role, the customer pages, then every pop-up
//   ROLE=owner PART=1/2 npm run test:layout   one role (or the customer pages, ROLE=customer), optionally a slice of
//                                             its pages so each run stays well under 15 minutes
//   ROLE=popups npm run test:layout           the pop-ups only
import { mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { MANAGER_MECH, api, browserFor, browserForId, base, cleanupDb, go, sql } from "./pw-lib.mjs";
import { measurePage } from "./layout-rules.mjs";

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
const onlyRole = process.env.ROLE ?? "";
// A quick check of only the pages a change touched: PAGES=/dashboard,/jobs SIZES=800x1280,1440x900 (no 130% pass).
const onlyPages = (process.env.PAGES ?? "").split(",").map((p) => p.trim()).filter(Boolean);
const onlySizes = (process.env.SIZES ?? "").split(",").map((p) => p.trim()).filter(Boolean);
const [partNo, partOf] = (process.env.PART ?? "1/1").split("/").map((n) => Number(n) || 1);

// The tablet and phone sizes are real touch screens (a coarse pointer, no hover), switched on the open page, so the
// page's touch rules (44 px controls) apply exactly as on the device.
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

async function check(page, path, width, height, touch, big, tag, findings) {
  await page.setViewportSize({ width, height });
  await setTouch(page, touch);
  try {
    await go(page, `${base}${path}`);
  } catch {
    findings.push(`${tag} ${path} @${width}x${height}: the page did not load`);
    return;
  }
  if (big) await page.addStyleTag({ content: "html { font-size: 130% !important; }" }).catch(() => null);
  await page.waitForTimeout(big ? 700 : 400);
  const problems = await page.evaluate(measurePage, { touch }).catch((e) => [`check failed: ${String(e).slice(0, 80)}`]);
  const slug = path.replace(/\W+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "home";
  await page.screenshot({ path: `tests/browser/shots/layout/${tag}-${slug}-${width}x${height}${big ? "-130" : ""}.png` }).catch(() => null);
  const where = `${tag} ${path} @${width}x${height}${big ? " (text 130%)" : ""}`;
  for (const p of problems) findings.push(`${where}: ${p}`);
  if (problems.length) console.log(`FAIL ${where}\n  - ${problems.join("\n  - ")}`);
  return problems.length;
}

async function checkPages(page, tag, paths, findings, counter) {
  for (const path of paths) {
    for (const [w, h, touch] of SIZES.filter(([w, h]) => !onlySizes.length || onlySizes.includes(`${w}x${h}`))) {
      await check(page, path, w, h, touch, false, tag, findings);
      counter.n++;
    }
    if (onlySizes.length) continue;
    await check(page, path, BIG_TEXT[0], BIG_TEXT[1], BIG_TEXT[2], true, tag, findings);
    counter.n++;
  }
}

/** The seeded test car (fixed test ids, removed by the clean-up): its job pages and its customer links. */
async function seedPages() {
  const ready = (await api("/api/e2e/stage", { stage: "ready" })).json;
  const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0].id;
  const insp = (await sql("select id from public.inspections where job_id = $1 limit 1", [ready.jobId]))[0]?.id ?? null;
  const reportToken = randomBytes(16).toString("base64url");
  if (insp) await sql("insert into public.report_links (job_id, inspection_id, token, created_by, updated_by, opened_at, status) values ($1, $2, $3, $4, $4, now(), 'opened')", [ready.jobId, insp, reportToken, owner]);
  const approvalToken = randomBytes(16).toString("base64url");
  await sql("insert into public.approval_requests (job_id, token, status, sent_to_phone, sent_to_name, terms_text, created_by, opened_at) values ($1, $2, 'sent', '+971500000001', 'E2e Customer', 'Terms', $3, now())", [ready.jobId, approvalToken, owner]);
  const qToken = (await sql("select token from public.quotations where id = $1", [ready.quotationId]))[0]?.token ?? null;
  const job = ready.jobId;
  return {
    staff: [`/jobs/${job}`, `/jobs/${job}/quote/${ready.quotationId}`, `/jobs/${job}/inspection`, `/jobs/${job}/invoice`, `/jobs/${job}/work`, `/jobs/${job}/gate-in`, `/parts/${job}`, `/estimates/new`, `/settings`, `/settings/inspection`, `/settings/services`],
    customer: [qToken ? `/quote/${qToken}` : null, ready.invoice?.token ? `/invoice/${ready.invoice.token}` : null, ready.invoice?.token ? `/proforma/${ready.invoice.token}` : null, insp ? `/report/${reportToken}` : null, `/approve/${approvalToken}`].filter(Boolean),
  };
}

async function roleBrowser(role) {
  if (role.id) return browserForId(role.id, { viewport: { width: 1440, height: 900 } });
  return browserFor(role.key, { viewport: { width: 1440, height: 900 } });
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
].filter(Boolean).filter((r) => !onlyRole || r.name === onlyRole);

// Pages reached from inside another page (not in the menu) that still need checking.
const EXTRA_PAGES = { owner: ["/settings/packages", "/commissions", "/settings/warranty", "/warranties", "/card-settlements"], accounts: ["/commissions", "/card-settlements"] };

const counter = { n: 0 };
const findings = [];
const needSeed = !onlyRole || onlyRole === "owner" || onlyRole === "customer";
const seeded = needSeed ? await seedPages() : { staff: [], customer: [] };
const slice = (list) => {
  if (partOf <= 1) return list;
  const size = Math.ceil(list.length / partOf);
  return list.slice((partNo - 1) * size, partNo * size);
};
for (const role of roles) {
  const { browser, page } = await roleBrowser(role);
  await go(page, `${base}/`);
  // Every page in this role's menu (the sidebar on a computer), plus wherever the role landed.
  const hrefs = await page.evaluate(() => [...document.querySelectorAll("aside a[href], [data-menu-drawer] a[href]")].map((a) => a.getAttribute("href")).filter((h) => h && h.startsWith("/") && !h.startsWith("/api")));
  const landed = new URL(page.url()).pathname;
  const targets = slice([...new Set([landed, ...hrefs, ...(EXTRA_PAGES[role.name] ?? []), ...(role.name === "owner" ? seeded.staff : [])])]).filter((p) => !onlyPages.length || onlyPages.includes(p));
  await checkPages(page, role.name, targets, findings, counter);
  await browser.close();
  console.log(`${role.name}: ${targets.length} pages done`);
}
// The customer pages, without a login.
if (!onlyRole || onlyRole === "customer") {
  const { chromium } = await import("playwright-core");
  const cb = await chromium.launch({ executablePath: process.env.E2E_BROWSER ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
  const page = await (await cb.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await checkPages(page, "customer", slice(seeded.customer), findings, counter);
  await cb.close();
  console.log(`customer: ${seeded.customer.length} pages done`);
}
if (needSeed) cleanupDb();
// Every pop-up too: with the full check, or alone with ROLE=popups.
if (!onlyRole || onlyRole === "popups") {
  const { runPopups } = await import("./popup-check.mjs");
  findings.push(...(await runPopups()));
}
console.log(`\n${counter.n} page views checked · sizes ${SIZES.map(([w, h]) => `${w}x${h}`).join(", ")} and ${BIG_TEXT[0]}x${BIG_TEXT[1]} with the text at 130% · screenshots in tests/browser/shots/layout/`);
console.log(findings.length ? `${findings.length} problems found` : "No overlaps, nothing cut off, no text on text, no broken words, nothing out of its card, no sideways scrolling.");
process.exit(findings.length ? 1 : 0);
