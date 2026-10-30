// Shared helpers for the browser tests. They drive the installed Microsoft Edge (headless) against a local
// server started with `npx next dev -p 3100`, log people in through the test-only /api/e2e routes (refused in
// production), run SQL through /api/e2e/sql, and clean every test row up with tests/e2e-cleanup.sql.
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

export const base = process.env.E2E_BASE ?? "http://localhost:3100";
export const secret = process.env.E2E_SECRET;
export const here = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(here, "..", "..");
const EDGE = process.env.E2E_BROWSER ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";

if (!secret) {
  console.error("E2E_SECRET is missing. Run with: node --env-file=.env.local tests/browser/<test>.mjs");
  process.exit(2);
}

const toCookies = (r) => r.headers.getSetCookie().map((c) => { const [nv] = c.split(";"); const i = nv.indexOf("="); return { name: nv.slice(0, i), value: nv.slice(i + 1), domain: "localhost", path: "/" }; });
async function login(body) {
  const r = await fetch(`${base}/api/e2e/login`, { method: "POST", headers: { "content-type": "application/json", "x-e2e-secret": secret }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`login ${JSON.stringify(body)}: ${r.status} ${await r.text()}`);
  return toCookies(r);
}
export const loginCookies = (role) => login({ role });
export const loginCookiesById = (id) => login({ id });
export const cookieHeader = async (roleOrId) => ((roleOrId.includes("-") ? await loginCookiesById(roleOrId) : await loginCookies(roleOrId)).map((c) => `${c.name}=${c.value}`).join("; "));

async function open(cookies, opts) {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const context = await browser.newContext({ viewport: opts.viewport ?? { width: 1024, height: 768 }, hasTouch: !!opts.touch, isMobile: !!opts.mobile });
  await context.addCookies(cookies);
  // Waiting on you is closed by default (29 October 2026); the tests that act on its rows open it after every load, as
  // a person taps the bar. A test of the bar itself passes { waitingOpen: false }.
  if (opts.waitingOpen !== false) {
    await context.addInitScript(() => {
      const openAll = () => document.querySelectorAll("[data-waiting-panel] details:not([open])").forEach((d) => { d.open = true; });
      window.addEventListener("load", () => {
        openAll();
        new MutationObserver(openAll).observe(document.body, { childList: true, subtree: true });
      });
    });
  }
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
  // Browser confirm boxes are accepted; prompts get their default.
  page.on("dialog", (d) => d.accept().catch(() => null));
  return { browser, context, page };
}
export async function browserFor(role, opts = {}) { return open(await loginCookies(role), opts); }
export async function browserForId(id, opts = {}) { return open(await loginCookiesById(id), opts); }

export async function api(path, body, cookies) {
  const r = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-e2e-secret": secret, ...(cookies ? { cookie: cookies } : {}) }, body: JSON.stringify(body ?? {}) });
  const t = await r.text();
  try { return { status: r.status, json: JSON.parse(t) }; } catch { return { status: r.status, text: t }; }
}
export const sql = async (q, params = []) => (await api("/api/e2e/sql", { sql: q, params })).json?.rows ?? [];

/** Removes every test row (fixed ids, test customers, test services and emails). Safe to run at any time. */
export function cleanupDb() {
  try {
    const out = execSync(`node --env-file=.env.local scripts/db-sql.mjs "${path.join(projectRoot, "tests", "e2e-cleanup.sql")}"`, { cwd: projectRoot, encoding: "utf8" });
    console.log("cleanup:", out.trim().split("\n").slice(-2).join(" | "));
  } catch (e) {
    console.log("cleanup failed:", String(e.message).slice(0, 200));
  }
}

/** HTML to plain text (React's comment markers removed), for checks on server-rendered pages. */
export const plain = (html) => html.replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

/** A technician with no clock running anywhere, put on the job as its technician. */
export async function freeTech(jobId, departmentId = null) {
  const t = await sql("select s.id, s.display_name from public.staff s where s.role_id = 'technician' and s.is_active and ($1::text is null or s.department_id = $1) and not exists (select 1 from public.work_sessions w where w.technician_id = s.id and w.ended_at is null and w.is_active) order by s.display_name limit 1", [departmentId]);
  const id = t[0]?.id;
  if (!id) return null;
  if (jobId) {
    await sql("insert into public.job_technicians (job_id, staff_id) select $1, $2 where not exists (select 1 from public.job_technicians where job_id = $1 and staff_id = $2)", [jobId, id]);
    await sql("update public.job_technicians set is_active = true, left_at = null, done_at = null where job_id = $1 and staff_id = $2", [jobId, id]);
    await sql("update public.jobs set assigned_to = $2 where id = $1", [jobId, id]);
  }
  return id;
}
/** Gives a person a known PIN for the test (test route only). */
export const setPin = (id, pin = "1234") => api("/api/e2e/stage", { stage: "pin", id, pin });

/** Mert, the mechanical workshop manager. */
export const MANAGER_MECH = "ef508864-0daa-43d9-8d74-e581e18fb841";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A first visit compiles the page on the dev server, which can take longer than the usual 15 s.
export const go = async (page, url) => { await page.goto(url, { waitUntil: "load", timeout: 60000 }); await sleep(1500); };
export const settle = async (page) => { await page.waitForLoadState("load"); await sleep(1500); };
/** Ready without a fixed wait: loaded, hydrated (the bell has docked into its slot on a staff page), fonts in, two frames drawn. */
export async function pageReady(page) {
  await page.waitForFunction(() => {
    if (document.readyState !== "complete") return false;
    const slots = document.querySelectorAll("#header-bell-slot, #topbar-bell-slot, [data-bell-fallback]");
    return !slots.length || !!document.querySelector("#header-bell-slot button, #topbar-bell-slot button, [data-bell-fallback] button");
  }, null, { timeout: 10000, polling: 100 }).catch(() => null);
  await page.evaluate(() => document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))).catch(() => null);
}
/** Waits for a form's redirect: the URL changes and carries ?message= or ?error=. Never waits for "networkidle" (the notification poll never stops). */
export const submitted = async (page) => { const before = page.url(); await page.waitForURL((u) => u.toString() !== before && /message=|error=/.test(u.toString()), { timeout: 25000 }).catch(() => null); await settle(page); };

/** A tiny result list shared by every test file. */
export function makeChecks() {
  const results = [];
  const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${String(detail).slice(0, 220)}` : ""}`); return ok; };
  const summary = () => { const failed = results.filter((r) => !r.ok).length; console.log(`\n${results.length - failed} passed, ${failed} failed`); return failed; };
  return { results, check, summary };
}

/** THE inspection fee choice (30 October 2026), required when an advisor or the owner does the gate-in: a fee of AED amount, or no fee with a reason. */
export async function chooseInspectionFee(page, amount = 1000) {
  const box = page.locator("[data-fee-choice-box]").first();
  if (!(await box.count())) return;
  if (amount) {
    await box.locator('[data-fee-choice="fee"]').click();
    await box.locator(`[data-fee-chip="${amount}"]`).click();
  } else {
    await box.locator('[data-fee-choice="none"]').click();
    await box.locator('[data-no-fee-reason="regular_customer"]').first().click();
    await box.locator('[data-inspection-type="full"]').click();
  }
}

/** Ticks a person in THE staff picker; someone already on a car asks once ("Put on this car as well?") and the test says yes. */
export async function pickPerson(scope, id) {
  await scope.locator(id ? `[data-pick-person="${id}"]` : "[data-pick-person]").first().click();
  const yes = scope.locator("[data-pick-busy] button").first();
  if (await yes.count()) await yes.click();
}
