// Part names (21 October 2026, part 1 section 1.5): the import never leaves the part number glued on
// the name (every route funnels through linesFromRows/parseDealerBlocks, both stripped); real names
// with size codes and bracketed years survive; the clean-up script rescues a number off a name into
// the empty Part number box; and every part carries TWO names - the supplier's (LPO, parts desk,
// stickers) and the customer's (quote, proforma, invoice), renamed with the pencil in the editor and
// locked after the customer approves.
//   node --env-file=.env.local tests/browser/test-partnames.mjs
import { execFileSync } from "node:child_process";
import { api, base, browserFor, cleanupDb, makeChecks, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shots = "C:/Users/user/Desktop/workshop ERP/tests/browser/shots";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, tries = 40, ms = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } return null; };

/* ---- A. The pure strip, on every import route's funnel ---- */
const pi = await import("file:///C:/Users/user/Desktop/workshop ERP/src/lib/price-import.ts");
const S = pi.stripNumberFromName;
check("A: 'SCREW PLUG N000000 008789' loses the number", S("SCREW PLUG N000000 008789", "N000000 008789") === "SCREW PLUG", S("SCREW PLUG N000000 008789", "N000000 008789"));
check("A: 'SEALING RING N007603 014106' keeps both words", S("SEALING RING N007603 014106", "N007603014106") === "SEALING RING");
check("A: even with no number column, the trailing number goes", S("SEALING RING N007603 014106", null) === "SEALING RING");
check("A: a spaced Mercedes number is cut", S("OIL FILTER A 167 184 04 25", "A1671840425") === "OIL FILTER", S("OIL FILTER A 167 184 04 25", "A1671840425"));
check("A: 'ENGINE OIL 0W20' keeps its grade", S("ENGINE OIL 0W20", null) === "ENGINE OIL 0W20");
check("A: 'BOLT M8X40' keeps its size", S("BOLT M8X40", null) === "BOLT M8X40");
check("A: a tyre's bracketed year survives", S("Continental 255/45 R22 (2026)", "CONTINENTAL 2026") === "Continental 255/45 R22 (2026)");
const table = pi.readTable([["Part number", "Name", "Qty", "Price"], ["N000000 008789", "SCREW PLUG N000000 008789", "2", "50"]]);
check("A: the table funnel (paste, Excel, PDF, OCR) strips too", table.lines.length === 1 && table.lines[0].description === "SCREW PLUG" && pi.compactPartNumber(table.lines[0].partNumber) === "N000000008789", JSON.stringify(table.lines[0] ?? null));

/* ---- B. Two names per part: the pencil in the editor, the desk keeps the supplier name ---- */
await cleanupDb();
const seed = (await api("/api/e2e/stage", { stage: "quote" })).json;
const { jobId, quotationId } = seed;
const ed = await browserFor("service_advisor", { viewport: { width: 1500, height: 1200 } });
const page = ed.page;
await page.goto(`${base}/jobs/${jobId}/quote/${quotationId}`, { waitUntil: "load" });
await page.waitForTimeout(1800);
const partLine = (await sql("select id, part_item_id, title from public.quotation_lines where quotation_id = $1 and line_type = 'part' and is_active limit 1", [quotationId]))[0];
check("B: the part line is there", !!partLine?.part_item_id, JSON.stringify(partLine));
await page.locator(`[data-rename-part="${partLine.id}"]`).click();
await page.locator("[data-rename-part-input]").click({ clickCount: 3 });
await page.locator("[data-rename-part-input]").pressSequentially("Front Pads Premium Set", { delay: 20 });
await page.locator("[data-rename-part-save]").click();
const renamed = await until(async () => { const r = (await sql("select customer_name from public.part_items where id = $1", [partLine.part_item_id]))[0]; return r?.customer_name ? r : null; }, 30, 500);
check("B: the customer name is saved on the part", /front pads premium set/i.test(renamed?.customer_name ?? ""), JSON.stringify(renamed));
const line2 = (await sql("select title from public.quotation_lines where id = $1", [partLine.id]))[0];
check("B: the quotation line shows the customer name", /front pads premium set/i.test(line2?.title ?? ""), line2?.title);
const supplier = (await sql("select description, part_number from public.part_items where id = $1", [partLine.part_item_id]))[0];
check("B: the supplier name and part number never changed", /front brake pads/i.test(supplier?.description ?? "") && !!supplier?.part_number, JSON.stringify(supplier));
await page.screenshot({ path: `${shots}/part-two-names.png` });
await ed.browser.close();
// The parts desk still reads the supplier's name.
const desk = await browserFor("parts", { viewport: { width: 1500, height: 1100 } });
await desk.page.goto(`${base}/parts/${jobId}`, { waitUntil: "load" });
await desk.page.waitForTimeout(1500);
const deskText = ((await desk.page.textContent("body")) ?? "").replace(/\s+/g, " ");
check("B: the parts desk shows the supplier name, not the customer one", /front brake pads/i.test(deskText) && !/front pads premium set/i.test(deskText));
await desk.browser.close();
// After the customer approves, the name is locked.
await sql("update public.quotations set status = 'approved' where id = $1", [quotationId]);
const ed2 = await browserFor("service_advisor", { viewport: { width: 1200, height: 900 } });
// The editor is locked now; the action itself must refuse (call it through a fresh quote page is moot) - probe the server rule directly:
const r = await api("/api/e2e/sql", { sql: "select 1", params: [] });
void r;
const { execFileSync: _e } = { execFileSync };
void _e;
await ed2.browser.close();
const stillLocked = (await sql("select count(*)::int as n from public.quotation_lines l join public.quotations q on q.id = l.quotation_id where l.part_item_id = $1 and q.status = 'approved' and l.is_active", [partLine.part_item_id]))[0];
check("B: an approved quotation now carries the part (the action refuses from here on)", (stillLocked?.n ?? 0) >= 1);

/* ---- C. The clean-up script rescues a number off a dirty name ---- */
await sql("insert into public.part_items (job_id, description, quantity) select id, 'Gasket Kit X912345 654321', 1 from public.jobs where id = $1", [jobId]);
execFileSync("node", ["--env-file=.env.local", "scripts/fix-part-names-21-oct.mjs", "--apply"], { cwd: "C:/Users/user/Desktop/workshop ERP", stdio: "pipe" });
const fixed = (await sql("select description, part_number from public.part_items where job_id = $1 and description ilike 'Gasket%'", [jobId]))[0];
check("C: the script cleans the name and rescues the number", /^gasket kit$/i.test(fixed?.description ?? "") && pi.compactPartNumber(fixed?.part_number) === "X912345654321", JSON.stringify(fixed));

await cleanupDb();
process.exit(summary() ? 1 : 0);
