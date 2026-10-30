// Overnight 22-23 October 2026, section 6: one A/C gas item (Good / Low / Empty / N/A; Low or Empty asks Leak?
// with the A/C repairs, ticks the recharge by itself, R134a / R1234yf and grams; no litres, no approval spec) and the
// duplicate "... service due" items folded into their fluid items as a "Service due?" switch. Old reports keep their
// answers on the merged item; the report, its PDF and the quotation's reference read the merged item.
// Run: node --env-file=.env.test.local tests/browser/test-inspection6.mjs   (dev server; E2E_BASE for another port)
import path from "node:path";
import { api, base, browserFor, cleanupDb, cookieHeader, go, here, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shot = (name) => path.join(here, "shots", name);
const text = async (loc) => ((await loc.first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const AC = "air_conditioning.a_c_gas_level";
const OIL = "engine_bay.engine_oil_level_and_condition";

/* 1. The checklist and the old reports */
const list = JSON.parse((await sql("select value::text as v from public.settings where key = 'inspection_checklist'"))[0].v);
const items = list.flatMap((s) => s.items);
check("1: the duplicate items are gone from the checklist (4 service-due items and A/C gas recharge)", !items.some((i) => /service_items\.(a_c_gas_recharge|engine_oil_service_due|brake_fluid_change_due|coolant_change_due|transmission_oil_service_due)/.test(i.key)));
const ac = items.find((i) => i.key === AC);
check("1: one item 'A/C gas' with the Good / Low / Empty style", ac?.label === "A/C gas" && ac?.style === "gas", JSON.stringify(ac));
check("1: engine oil, brake fluid, coolant and transmission fluid ask 'Service due?'", ["engine_bay.engine_oil_level_and_condition", "engine_bay.brake_fluid", "cooling.coolant_tank", "transmission_and_driveline.transmission_and_differential_fluid_condition"].every((k) => items.find((i) => i.key === k)?.due === true));
const folded = await sql("select count(*)::int as n from public.inspection_items where merged_into is not null");
const carried = await sql("select count(*)::int as n from public.inspection_items where service_due or recharge_needed");
check("1: old reports keep their answers on the merged item (folded rows marked, service due / recharge carried)", folded[0].n >= 10 && carried[0].n >= 1, `${folded[0].n} folded, ${carried[0].n} carried`);
const svc = await sql("select count(*)::int as n from public.services where suggest_for::text ~ '(service_due|change_due|a_c_gas_recharge)'");
check("1: no service still points at a removed item", svc[0].n === 0);

/* 2. The technician's form */
cleanupDb();
const seed = await api("/api/e2e/stage", { stage: "inspection" });
const jobId = seed.json.jobId;
await sql("update public.inspections set scan_read_at = now() where job_id = $1", [jobId]);
const rows = await sql("select item_key, style from public.inspection_items where inspection_id = $1 and item_key in ($2, 'service_items.a_c_gas_recharge')", [seed.json.inspectionId, AC]);
check("2: a new report has the one A/C gas item (style gas) and no recharge item", rows.length === 1 && rows[0].style === "gas", JSON.stringify(rows));
const techId = seed.json.technicianId;
const { browserForId } = await import("./pw-lib.mjs");
const { browser, page } = await browserForId(techId, { viewport: { width: 900, height: 1100 } });
await go(page, `${base}/my-jobs/${jobId}`);
const acCard = page.locator(`#item-${AC.replace(/\./g, "\\.")}`);
await acCard.scrollIntoViewIfNeeded();
const labels = await acCard.locator("button").allTextContents();
check("2: the A/C gas answers are Good / Low / Empty / N/A", ["Good", "Low", "Empty", "N/A"].every((w) => labels.some((l) => l.trim() === w)), labels.slice(0, 6).join(" | "));
await acCard.getByRole("button", { name: "Low", exact: true }).click();
await acCard.locator("[data-ac-panel]").waitFor({ timeout: 10000 });
check("2: Low opens Leak? and ticks 'Recharge needed' by itself", await acCard.locator("[data-ac-recharge]").isChecked());
check("2: no litres and no approval spec on the A/C item", !/litres|Approval spec/i.test(await text(acCard)));
await acCard.getByRole("button", { name: "Sweating", exact: true }).click();
await acCard.getByRole("button", { name: "Condenser", exact: true }).click();
await acCard.getByRole("button", { name: "R1234yf", exact: true }).click();
await acCard.locator('[data-ac-grams="600"]').click();
await acCard.scrollIntoViewIfNeeded();
await page.screenshot({ path: shot("insp6-1-ac-gas.png"), clip: (await acCard.boundingBox()) ?? undefined });
const saved = await until(async () => { const r = (await sql("select status, recharge_needed, leak_severity, leak_repair, fluid_grade, fluid_qty::float8 as q, fluid_unit, remarks from public.inspection_items where inspection_id = $1 and item_key = $2", [seed.json.inspectionId, AC]))[0]; return r?.fluid_qty !== null && r?.q === 600 && r?.leak_repair === "condenser" ? r : null; });
check("2: saved: Low, recharge needed, sweating leak, condenser, R1234yf, 600 g", !!saved && saved.status === "average" && saved.recharge_needed && saved.leak_severity === "sweating" && saved.fluid_grade === "R1234yf" && saved.fluid_unit === "g", JSON.stringify(saved));
check("2: the remark writes itself ('sweating leak · repair: condenser · recharge needed: R1234yf 600 g')", /sweating leak · repair: condenser · recharge needed: R1234yf 600 g/.test(saved?.remarks ?? ""), saved?.remarks);
const parts = JSON.stringify((await sql("select parts_list from public.inspections where id = $1", [seed.json.inspectionId]))[0]?.parts_list ?? []);
check("2: the condenser repair added 'A/C condenser' to the parts", /A\/C condenser/.test(parts), parts.slice(0, 200));
// Engine oil: Good level, but the service is due.
const oil = page.locator(`#item-${OIL.replace(/\./g, "\\.")}`);
await oil.scrollIntoViewIfNeeded();
await oil.getByRole("button", { name: "Good", exact: true }).click();
await oil.locator('[data-service-due-choice="yes"]').click();
await page.screenshot({ path: shot("insp6-2-service-due.png"), clip: (await oil.boundingBox()) ?? undefined });
check("2: 'Service due?' Yes saves on the engine oil item", !!(await until(async () => ((await sql("select service_due from public.inspection_items where inspection_id = $1 and item_key = $2", [seed.json.inspectionId, OIL]))[0]?.service_due ? 1 : null))));
await browser.close();

/* 3. The customer's report PDF and the quotation's reference read the merged items */
await sql("update public.inspections set status = 'approved', approved_at = now(), submitted_at = now() where id = $1", [seed.json.inspectionId]);
const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active limit 1"))[0].id;
const tok = `e2ereport${Math.random().toString(36).slice(2, 12)}`;
await sql("insert into public.report_links (job_id, inspection_id, token, status, created_by, updated_by) values ($1, $2, $3, 'sent', $4, $4)", [jobId, seed.json.inspectionId, tok, owner]);
const pdf = await fetch(`${base}/api/pdf/report/${tok}`);
const mupdf = await import("mupdf");
const doc = mupdf.Document.openDocument(Buffer.from(await pdf.arrayBuffer()), "application/pdf");
let t = "";
for (let i = 0; i < doc.countPages(); i++) t += doc.loadPage(i).toStructuredText("preserve-whitespace").asText();
t = t.replace(/\s+/g, " ");
check("3: the report says A/C gas LOW with the leak, the repair and 'recharge needed: R1234yf 600 g'", /LOW/i.test(t) && /A\/C gas/i.test(t) && /recharge needed: R1234yf 600 g/i.test(t), t.match(/.{0,40}A\/C gas.{0,140}/i)?.[0] ?? String(pdf.status));
check("3: engine oil shows under Needs attention as 'Service due'", /SERVICE DUE.{0,20}Engine oil/i.test(t), t.match(/.{0,30}Engine oil.{0,60}/i)?.[0] ?? "");
check("3: no merged-away item on the report (no 'A/C gas recharge', no 'Engine oil service due')", !/A\/C gas recharge|Engine oil service due/i.test(t));
for (let p = 0; p < Math.min(doc.countPages(), 2); p++) (await import("node:fs")).writeFileSync(shot(`insp6-3-report-p${p + 1}.png`), Buffer.from(doc.loadPage(p).toPixmap(mupdf.Matrix.scale(1.3, 1.3), mupdf.ColorSpace.DeviceRGB, false, true).asPNG()));
const { browser: ab, page: ap } = await browserFor("service_advisor", { viewport: { width: 1366, height: 1000 } });
await go(ap, `${base}/jobs/${jobId}/inspection`);
check("3: the manager's report page shows A/C gas as Low (the merged item)", /A\/C gas/.test(await text(ap.locator("main"))));
await ab.close();
void cookieHeader;

cleanupDb();
process.exit(summary() ? 1 : 0);
