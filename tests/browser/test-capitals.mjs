// Evening section 5 proof: NOTHING changes typed capitals any more. The SQL tidy helpers and the client
// textCase boxes keep "OFJ" as OFJ (whitespace tidy only, codes still go UPPER); the converted names were
// put back (OFJ Platinum); screens still DISPLAY names in capitals by CSS.
// Run: node --env-file=.env.local tests/browser/test-capitals.mjs   (dev server on :3100)
import path from "node:path";
import { api, base, browserFor, cleanupDb, go, here, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shot = (name) => path.join(here, "shots", name);

cleanupDb();

/* ---------------- 1. The database keeps typed capitals ---------------- */
const fx = (await sql("select public.erp_title_case('  OFJ   platinum PACKAGE ') as t, public.erp_sentence_case(' KEEP my CAPITALS as TYPED ') as s, public.erp_upper_code(' wba123 ') as u"))[0];
check("1: title tidy only trims and collapses spaces", fx.t === "OFJ platinum PACKAGE", JSON.stringify(fx));
check("1: sentence tidy only trims", fx.s === "KEEP my CAPITALS as TYPED");
check("1: codes still go to CAPITALS", fx.u === "WBA123");

const seed = await api("/api/e2e/stage", { stage: "quote" });
const jobId = seed.json?.jobId;
const qid = seed.json?.quotationId;
const advisor = (await sql("select id from public.staff where role_id = 'service_advisor' and is_active limit 1"))[0].id;
await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, details, source_type, quantity, hours, labour_rate, created_by, updated_by) values ($1, 7, 'labour', 'OFJ wArRiOr EDITION detail', 'ALL CAPS note stays AS TYPED', 'manual', 1, 1, 350, $2, $2)", [qid, advisor]);
const line = (await sql("select title, details from public.quotation_lines where quotation_id = $1 and position = 7", [qid]))[0];
check("1: a line through the tidy trigger keeps its exact capitals", line.title === "OFJ wArRiOr EDITION detail" && line.details === "ALL CAPS note stays AS TYPED", JSON.stringify(line));
const car = await api("/api/e2e/car", {});
await sql("update public.customers set full_name = 'JAMES mcCLOUD of OFJ' where id = (select customer_id from public.jobs where id = $1)", [car.json.job_id]);
const cust = (await sql("select full_name from public.customers where id = (select customer_id from public.jobs where id = $1)", [car.json.job_id]))[0];
check("1: a customer name keeps its exact capitals too", cust.full_name === "JAMES mcCLOUD of OFJ", JSON.stringify(cust));

/* ---------------- 2. The packages were put back and the box keeps what is typed ---------------- */
const pkg = (await sql("select value::text as v from public.settings where key = 'bodyshop_packages'"))[0];
check("2: the stored packages read OFJ again, never Ofj", pkg.v.includes("OFJ") && !pkg.v.includes("Ofj"), pkg.v.slice(0, 80));
const { browser, page } = await browserFor("owner", { viewport: { width: 1440, height: 950 } });
await go(page, `${base}/settings/packages`);
const nameBox = page.locator("[data-package-name]").first();
await nameBox.click({ clickCount: 3 });
await nameBox.pressSequentially("OFJ CERAMIC Test NAME");
await page.locator("body").click();
await sleep(600);
check("2: the package name box keeps the typed capitals on blur", (await nameBox.inputValue()) === "OFJ CERAMIC Test NAME", await nameBox.inputValue());
await page.screenshot({ path: shot("caps-1-packages.png"), fullPage: false });

/* ---------------- 3. The display stays CAPITALS by CSS (the 15 October rule) ---------------- */
const { browser: ab, page: ap } = await browserFor("service_advisor", { viewport: { width: 1440, height: 950 } });
await go(ap, `${base}/jobs/${jobId}/quote/${qid}`);
const tf = await ap.locator('textarea[id^="name-"]').first().evaluate((el) => getComputedStyle(el).textTransform);
check("3: the editor's name boxes still display in capitals", tf === "uppercase", tf);

await browser.close(); await ab.close();
cleanupDb();
process.exit(summary() ? 1 : 0);
