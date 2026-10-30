// The LIVE site, checked READ-ONLY (30 October 2026, batch 2 section 1.4). Nothing is created, changed or deleted on
// live by a test, ever: no sign-in, no test documents, no forms, no cron calls with the secret. What it checks:
//   1. the sign-in page opens at PC, tablet and phone width with no page errors, and reports the running version;
//   2. every staff page sends a signed-out visitor to sign in (nothing private answers without a login);
//   3. the public pieces answer (logo, link-preview pictures, version.json) and a made-up customer link says so
//      politely instead of failing;
//   4. the scheduled jobs refuse a call without their secret;
//   5. the database's own rules, read-only: every read with a linked table is valid (embed-check) and the security
//      check (anonymous probes, and logins simulated inside transactions that are rolled back).
//   node --env-file=.env.local tests/live-check.mjs            (npm run check:live)
import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const LIVE = process.env.LIVE_BASE ?? "https://erp.ofjauto.com";
const EDGE = process.env.E2E_BROWSER ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(here, "browser", "shots", "live");
fs.mkdirSync(SHOTS, { recursive: true });
let failed = 0;
let passed = 0;
const check = (name, ok, detail = "") => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${String(detail).slice(0, 200)}` : ""}`);
};
const head = (url) => fetch(`${LIVE}${url}`, { redirect: "manual" });

/* 1. The sign-in page at three widths. */
const browser = await chromium.launch({ executablePath: EDGE, headless: true });
for (const [w, h] of [[1366, 900], [800, 1280], [390, 844]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const r = await page.goto(`${LIVE}/login`, { waitUntil: "load", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => null);
  const version = await page.evaluate(() => window.next?.version ?? null);
  const text = ((await page.textContent("body")) ?? "").replace(/\s+/g, " ");
  check(`1: ${w}px sign-in page opens (Next.js ${version}), Sign in with its boxes, no page errors`, r?.status() === 200 && /Sign in/i.test(text) && (await page.locator("input[type=password]").count()) >= 1 && errors.length === 0, errors.join(" | "));
  await page.screenshot({ path: path.join(SHOTS, `live-login-${w}.png`) });
  await ctx.close();
}
await browser.close();
const v = await fetch(`${LIVE}/version.json`).then((r) => r.json()).catch(() => null);
check(`1: version.json answers (${v?.version ?? "?"})`, !!v?.version);

/* 2. Staff pages need a login. */
for (const p of ["/dashboard", "/jobs", "/calendar", "/calendar/new", "/estimates", "/estimates/new", "/parts", "/invoices", "/recovery", "/settings", "/reports/monthly", "/reports/inspection-fees", "/gate-in", "/my-jobs", "/bodyshop", "/zoho"]) {
  const r = await head(p);
  check(`2: ${p} sends a signed-out visitor to sign in`, [302, 303, 307, 308].includes(r.status) && /\/login/.test(r.headers.get("location") ?? ""), `${r.status} ${r.headers.get("location") ?? ""}`);
}

/* 3. Public pieces, and a made-up customer link. */
for (const p of ["/logo.svg", "/og/ofj-square-600.png", "/preview-square.jpg"]) {
  const r = await fetch(`${LIVE}${p}`);
  check(`3: ${p} answers 200`, r.status === 200, r.status);
}
for (const p of ["/quote/not-a-real-token-e2e", "/invoice/not-a-real-token-e2e", "/approve/not-a-real-token-e2e", "/warranty/not-a-real-token-e2e", "/drive/not-a-real-token-e2e"]) {
  const r = await fetch(`${LIVE}${p}`);
  check(`3: ${p.replace(/not-a-real.*/, "<made-up>")} answers without a server error`, r.status < 500, r.status);
}

/* 4. Scheduled jobs refuse a call without their secret. */
for (const p of ["/api/cron/housekeeping", "/api/cron/mailbox", "/api/cron/zoho"]) {
  const r = await fetch(`${LIVE}${p}`);
  check(`4: ${p} refuses a call without the secret`, r.status === 401 || r.status === 403, r.status);
}

/* 5. The database's own rules, read-only. */
for (const [name, file] of [["every read with a linked table is valid", "embed-check.mjs"], ["the security check (read-only)", "security-check.mjs"]]) {
  const run = spawnSync(process.execPath, [path.join(here, file)], { env: process.env, encoding: "utf8" });
  const last = (run.stdout ?? "").trim().split("\n").slice(-1)[0];
  check(`5: ${name}`, run.status === 0, last);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
