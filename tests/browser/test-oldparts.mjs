// Old parts photo at gate-out (20 October 2026, part 2 section 8): ticking "Old parts handed over"
// opens Photo / Gallery buttons (optional); the photo is kept with the time and who took it, and the
// job card history shows it under the gate-out record.
//   node --env-file=.env.test.local tests/browser/test-oldparts.mjs
import { Buffer } from "node:buffer";
import { api, base, browserFor, cleanupDb, makeChecks, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shots = "C:/Users/user/Desktop/workshop ERP/tests/browser/shots";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, tries = 40, ms = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } return null; };

await cleanupDb();
const seed = (await api("/api/e2e/stage", { stage: "ready" })).json;
const jobId = seed.jobId;
await sql("update public.gate_ins set old_parts_return = true where job_id = $1", [jobId]);

const adv = await browserFor("service_advisor", { viewport: { width: 1500, height: 1200 } });
const page = adv.page;
await page.goto(`${base}/jobs/${jobId}/gate-out`, { waitUntil: "load" });
await page.waitForTimeout(1500);
check("the Old parts tick is there", (await page.locator("[data-old-parts-tick]").count()) === 1);
check("no photo buttons before the tick", (await page.locator("[data-old-parts-photos]").count()) === 0);
await page.locator("[data-old-parts-tick]").click();
await page.waitForTimeout(400);
check("ticking opens the photo box", (await page.locator("[data-old-parts-photos]").count()) === 1);
check("it says the photo is optional, kept with time and name", /optional/i.test((await page.locator("[data-old-parts-photos]").textContent()) ?? ""));

// A photo goes up straight away (before the form is even submitted).
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFElEQVR4nGNgYGD4z4AGMAXIVQEAvqgD/aXCeBkAAAAASUVORK5CYII=", "base64");
await page.locator("[data-old-parts-photos] input[type=file]").first().setInputFiles({ name: "old-parts.png", mimeType: "image/png", buffer: png });
const row = await until(async () => (await sql("select id, caption, uploaded_by is not null as who, taken_at is not null as t from public.job_files where job_id = $1 and kind = 'gate_out_photo' and caption = 'Old parts handed over'", [jobId]))[0] ?? null, 30, 500);
check("saved with the caption, the time and who", !!row && row.who === true && row.t === true, JSON.stringify(row));
await page.waitForTimeout(800);
check("the thumbnail shows with an X", (await page.locator("[data-old-parts-photos] [data-remove-file]").count()) === 1);
await page.screenshot({ path: `${shots}/old-parts-photo.png` });
await adv.browser.close();

// The job card history: with the gate-out recorded, the photo sits under it with time and name.
await sql("insert into public.gate_outs (job_id, keys_returned, keychain_returned, keys_match, old_parts_handed) values ($1, 1, true, true, true)", [jobId]);
const own = await browserFor("owner", { viewport: { width: 1500, height: 1600 } });
await own.page.goto(`${base}/jobs/${jobId}`, { waitUntil: "load" });
await own.page.waitForTimeout(1800);
// The gate-out record sits in the Gate-in details fold (a button, not a <details>): open it.
await own.page.getByRole("button", { name: /Gate-in details/i }).click();
await own.page.waitForTimeout(500);
check("the job card history shows the old-parts photo block", (await own.page.locator("[data-old-parts-history]").count()) === 1);
const histText = ((await own.page.locator("[data-old-parts-history]").textContent().catch(() => "")) ?? "").replace(/\s+/g, " ");
check("with the time and the name", /Old parts handed over/i.test(histText) && /\d{1,2}:\d{2}/.test(histText), histText.slice(0, 140));
const bodyText = ((await own.page.textContent("body")) ?? "").replace(/\s+/g, " ");
check("the record line says Handed over with the photo count", /Old parts.*Handed over.*1 photo/i.test(bodyText));
await own.page.locator("[data-old-parts-history]").scrollIntoViewIfNeeded().catch(() => null);
await own.page.screenshot({ path: `${shots}/old-parts-history.png` });
await own.browser.close();

await cleanupDb();
process.exit(summary() ? 1 : 0);
