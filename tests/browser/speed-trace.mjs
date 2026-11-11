// SPEED TRACE (11 November 2026, Section 16): opens ONE page as a role on the test server started with
// SPEED_TRACE=<file>, then reads that file for the page's window: how many database calls, and how many "waves"
// (calls that had to wait for the one before - the chain that makes a page slow). Prints the waves in order.
//   PAGE=/dashboard ROLE=accounts TRACE=<file> E2E_BASE=http://localhost:3102 node --env-file=.env.test.local tests/browser/speed-trace.mjs
import { readFileSync } from "node:fs";
import { base, browserFor } from "./pw-lib.mjs";

const page = process.env.PAGE ?? "/dashboard";
const role = process.env.ROLE ?? "owner";
const file = process.env.TRACE;
const b = await browserFor(role, { viewport: { width: 800, height: 1280 }, touch: true });
await b.page.goto(`${base}${page}`, { waitUntil: "domcontentloaded", timeout: 90000 });
await new Promise((r) => setTimeout(r, 1500));
const t0 = Date.now();
await b.page.goto(`${base}${page}`, { waitUntil: "domcontentloaded", timeout: 90000 });
const t1 = Date.now();
await b.browser.close();
const rows = readFileSync(file, "utf8").trim().split("\n").map((l) => { const [s, d, m, p, q] = l.split("\t"); return { s: Number(s), d: Number(d), e: Number(s) + Number(d), m, p, q }; }).filter((r) => r.s >= t0 - 50 && r.s <= t1);
rows.sort((a, b) => a.s - b.s);
const waves = [];
let end = 0;
for (const r of rows) {
  if (r.s >= end - 5 || !waves.length) waves.push([r]);
  else waves[waves.length - 1].push(r);
  end = Math.max(end, r.e);
}
console.log(`${role} ${page}: ${t1 - t0} ms, ${rows.length} database calls in ${waves.length} waves`);
waves.forEach((w, i) => console.log(`${String(i + 1).padStart(3)} +${String(w[0].s - t0).padStart(5)}ms ×${w.length}  ${w.slice(0, 4).map((r) => `${r.m} ${r.p}${r.q ? " " + r.q.slice(0, 70) : ""}`).join("  |  ")}`));
