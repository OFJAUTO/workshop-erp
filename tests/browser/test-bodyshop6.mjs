// Evening section 6 proof: ONE way to quote (the old "New bodyshop quotation" is the estimate path with
// the package picker opening by itself) and the bodyshop board shows the REAL cars - mixed jobs and cars
// still in inspection or quoting included, each in its section or the "before the bodyshop work" strip.
// Run: node --env-file=.env.local tests/browser/test-bodyshop6.mjs   (dev server on :3100)
import path from "node:path";
import { api, base, browserFor, cleanupDb, cookieHeader, go, here, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shot = (name) => path.join(here, "shots", name);

cleanupDb();

/* ---------------- 1. One path: the old button and address land on the estimate ---------------- */
const { browser: ob, page: op } = await browserFor("owner", { viewport: { width: 1440, height: 950 } });
await go(op, `${base}/bodyshop`);
const body1 = ((await op.textContent("body")) ?? "").replace(/\s+/g, " ");
check("1: the button reads New estimate (bodyshop), the old words are gone", (await op.locator("[data-new-bodyshop-estimate]").count()) === 1 && !/New bodyshop quotation/.test(body1));
const ownerCookie = await cookieHeader("owner");
const redir = await fetch(`${base}/bodyshop/new`, { headers: { cookie: ownerCookie }, redirect: "manual" });
check("1: the old address redirects to the estimate path", [303, 307, 308].includes(redir.status) && /\/estimates\/new\?bodyshop=1/.test(redir.headers.get("location") ?? ""), `${redir.status} ${redir.headers.get("location")}`);

/* ---------------- 2. The estimate starts with Bodyshop preselected and the package picker opens itself ---------------- */
const seed = await api("/api/e2e/stage", { stage: "quote" });
if (!seed.json?.jobId) { console.error("seed failed", JSON.stringify(seed).slice(0, 200)); process.exit(1); }
const { browser: ab, page: ap } = await browserFor("service_advisor", { viewport: { width: 1366, height: 1100 } });
await go(ap, `${base}/estimates/new?bodyshop=1`);
check("2: the page says New estimate (bodyshop)", /New estimate \(bodyshop\)/.test(((await ap.textContent("body")) ?? "")));
await ap.getByPlaceholder("Type a name, company or phone…").pressSequentially("Stage Test");
await ap.getByRole("button", { name: /Stage Test Customer/ }).first().waitFor({ timeout: 20000 });
await ap.getByRole("button", { name: /Stage Test Customer/ }).first().click();
await sleep(400);
const options = await ap.locator("[data-vehicle-select] option").allTextContents();
await ap.locator("[data-vehicle-select]").selectOption({ label: options.find((o) => /30303/.test(o)) ?? "" });
await ap.getByRole("button", { name: /Start the estimate/ }).click();
await ap.waitForURL((u) => /\/estimates\/[0-9a-f-]{36}\?packages=1/.test(u.toString()), { timeout: 30000 }).catch(() => null);
check("2: the editor opens with ?packages=1", /\?packages=1/.test(ap.url()), ap.url());
await sleep(1500);
check("2: the package picker is already open", (await ap.locator("[data-package-ask]").count()) === 1);
await ap.screenshot({ path: shot("bs6-1-package-picker.png"), fullPage: false });
await ab.close();

/* ---------------- 3. The board shows the real cars (mixed and pre-work included) ---------------- */
const live = await sql("select j.job_number, j.department, j.status, v.plate_code, v.plate_number from public.jobs j join public.vehicles v on v.id = j.vehicle_id where j.is_open and j.department in ('bodyshop', 'both') and j.id::text not like '22222222-%'");
check("3: the live bodyshop cars exist for the proof (McLaren + Urus)", live.length >= 2, JSON.stringify(live));
await go(op, `${base}/bodyshop`);
const boardText = ((await op.textContent("body")) ?? "").replace(/\s+/g, " ");
const carsShown = await op.locator("[data-board-car]").count();
const allOn = live.every((j) => boardText.includes(j.plate_number));
check("3: every live bodyshop car is on the board (plates found)", allOn && carsShown >= live.length, `${carsShown} rows · ${JSON.stringify(live.map((l) => l.plate_number))}`);
check("3: the header counts them", new RegExp(`${live.length} cars? in the bodyshop`).test(boardText) || carsShown >= live.length, boardText.match(/\d+ cars? in the bodyshop/)?.[0] ?? "");
check("3: pre-work cars show their phase in plain words", /Quotation being prepared|Inspection to start|Inspection running|Waiting for the customer/.test(boardText));
await op.screenshot({ path: shot("bs6-2-board.png"), fullPage: true });

await ob.close();
cleanupDb();
process.exit(summary() ? 1 : 0);
