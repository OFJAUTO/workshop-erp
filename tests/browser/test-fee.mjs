// Section 8 proof: the inspection fee per car. Chips at gate-in with the premium-brand default, a figure
// below AED 750 from a non-owner becomes a request to the owner, the owner decides on the job card, the
// customer approval page shows the chosen amount in English and Arabic, and the fee locks at approval.
// Run: node --env-file=.env.local tests/browser/test-fee.mjs   (dev server on :3100)
import path from "node:path";
import { api, base, browserFor, cleanupDb, go, here, makeChecks, settle, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shot = (name) => path.join(here, "shots", name);
const pick = (page, name, value) => page.locator(`input[name="${name}"][value="${value}"]`).first().evaluate((el) => el.click());
const until = async (fn, tries = 30, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };

cleanupDb();
const seed = await api("/api/e2e/stage", { stage: "assign" });
const seedJob = seed.json?.jobId;
if (!seedJob) { console.error("seed failed:", JSON.stringify(seed).slice(0, 300)); process.exit(1); }

// A premium-make car of its own (the clean-up finds it by the test phone).
const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active limit 1"))[0].id;
const makeId = (await sql("select id from public.vehicle_makes where lower(name) = 'lamborghini' and is_active limit 1"))[0]?.id;
if (!makeId) { console.error("No Lamborghini make in the catalog."); process.exit(1); }
const cust = (await sql("insert into public.customers (customer_type, full_name, phone, created_by, updated_by) values ('individual', 'E2e Fee Customer', '+971500000084', $1, $1) returning id", [owner]))[0];
const plate = String(Date.now() % 100000);
const veh = (await sql("insert into public.vehicles (customer_id, plate_country, plate_emirate, plate_code, plate_number, has_plate, make_id, created_by, updated_by) values ($1, 'UAE', 'Dubai', 'F', $2, true, $3, $4, $4) returning id", [cust.id, plate, makeId, owner]))[0];

/* ---------------- 1. Gate-in: chips, premium default, Other = 500 ---------------- */
const { browser: ab, context: actx, page: ap } = await browserFor("service_advisor", { viewport: { width: 1280, height: 900 } });
await go(ap, `${base}/gate-in/new?vehicle=${veh.id}`);
check("1: the four chips and Other render", (await ap.locator("[data-fee-chip]").count()) === 4 && (await ap.locator("[data-fee-other]").count()) === 1);
check("1: a Lamborghini defaults to the premium AED 1,500 chip", (await ap.locator('[data-fee-chip="1500"]').getAttribute("aria-pressed")) === "true");
check("1: the hint names the premium default and the owner rule", /Premium brand: defaults to AED 1,500/.test((await ap.textContent("body")) ?? "") && /Below AED 750 or waiving goes to the owner/.test((await ap.textContent("body")) ?? ""));
await ap.locator("[data-inspection-fee]").scrollIntoViewIfNeeded();
await ap.screenshot({ path: shot("fee-1-gatein-chips.png"), clip: (await ap.locator("[data-inspection-fee]").locator("xpath=ancestor::label[1]").boundingBox()) ?? undefined });

// Fill the whole gate-in form the way a person would, with the fee typed as 500.
await ap.locator("[data-fee-other]").click();
await ap.locator("[data-fee-box]").click({ clickCount: 3 });
await ap.keyboard.press("Backspace");
await ap.locator("[data-fee-box]").pressSequentially("500");
await pick(ap, "arrived_by", "customer_drove");
await pick(ap, "condition", "runs_drives");
await pick(ap, "fuel_level", "half");
await pick(ap, "cleanliness", "clean");
await pick(ap, "dash_cam", "no");
await pick(ap, "major_damage", "no");
await pick(ap, "keys_count", "1");
await pick(ap, "keys_keychain", "no");
await pick(ap, "old_parts_return", "no");
await pick(ap, "department", "mechanical");
const addr = ap.locator('textarea[name="location_address"]');
if (await addr.count()) await addr.fill("E2e test address");
await ap.locator('input[name="mileage_display"]').pressSequentially("9500");
await ap.keyboard.press("Tab");
await ap.locator('input[name="requests"]:visible').first().pressSequentially("Check the engine light");
await sleep(400);
await ap.getByText("Save and continue to photos and video").click();
await ap.waitForURL((u) => /\/media/.test(u.toString()), { timeout: 30000 }).catch(() => null);
await settle(ap);
const job = (await sql("select id, job_number, inspection_fee_aed, inspection_fee_request_aed, inspection_fee_request_by from public.jobs where vehicle_id = $1 order by created_at desc limit 1", [veh.id]))[0];
check("1: the job opened (landed on the photos step)", !!job && /\/media/.test(ap.url()), ap.url());

/* ---------------- 2. Server rule: 500 from an advisor = fee 750 + request to the owner ---------------- */
check("2: the fee stays at 750 and AED 500 becomes a request", job && Number(job.inspection_fee_aed) === 750 && Number(job.inspection_fee_request_aed) === 500, JSON.stringify(job));
const note = await sql("select count(*)::int as n from public.notifications n join public.staff s on s.id = n.staff_id where n.type = 'inspection_fee_request' and n.job_id = $1 and s.role_id = 'owner'", [job.id]);
check("2: the owner is told about the request", (note[0]?.n ?? 0) >= 1, JSON.stringify(note));

/* ---------------- 3. The owner decides on the job card ---------------- */
const { browser: ob, page: op } = await browserFor("owner", { viewport: { width: 1280, height: 900 } });
await go(op, `${base}/jobs/${job.id}`);
const reqCard = op.locator("[data-fee-request]");
check("3: the owner sees the request card with both figures", (await reqCard.count()) === 1 && /AED 500/.test((await reqCard.textContent()) ?? "") && /AED 750/.test((await reqCard.textContent()) ?? ""));
await reqCard.scrollIntoViewIfNeeded();
await op.screenshot({ path: shot("fee-2-owner-request.png"), clip: (await reqCard.boundingBox()) ?? undefined });
await op.locator("[data-fee-approve]").click();
await op.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 25000 }).catch(() => null);
await settle(op);
const after = (await sql("select inspection_fee_aed, inspection_fee_request_aed from public.jobs where id = $1", [job.id]))[0];
check("3: approving sets the fee to 500 and clears the request", Number(after.inspection_fee_aed) === 500 && after.inspection_fee_request_aed === null, JSON.stringify(after));
check("3: the job card badge shows the fee", /Inspection fee: AED 500/.test((await op.textContent("body")) ?? ""));
const advisorTold = await sql("select count(*)::int as n from public.notifications where type = 'inspection_fee_request' and job_id = $1 and staff_id = $2", [job.id, job.inspection_fee_request_by]);
check("3: the asker is told the owner's answer", (advisorTold[0]?.n ?? 0) >= 1, JSON.stringify(advisorTold));

/* ---------------- 4. The approval link carries the chosen amount, English and Arabic ---------------- */
// The gate-in media is cloned from the seeded job so the approval link can be created the real way.
await sql("update public.gate_ins set is_complete = true, wheels_required = (select wheels_required from public.gate_ins where job_id = $2) where job_id = $1", [job.id, seedJob]);
await sql("insert into public.gate_in_media (job_id, kind, storage_path, wheel_condition, uploaded_by, created_by) select $1, kind, storage_path || '#e2efee-' || id, wheel_condition, uploaded_by, created_by from public.gate_in_media where job_id = $2 and removed_at is null", [job.id, seedJob]);
await go(ap, `${base}/jobs/${job.id}`);
await ap.getByText("Create the approval link", { exact: true }).click();
await sleep(600);
await ap.getByText("Create link", { exact: true }).click();
const appr = await until(async () => (await sql("select token, inspection_fee_aed, inspection_fee_notice, inspection_fee_notice_ar from public.approval_requests where job_id = $1 order by created_at desc limit 1", [job.id]))[0], 30, 600);
check("4: the link snapshots AED 500 with both notices", !!appr && Number(appr.inspection_fee_aed) === 500 && /500/.test(appr.inspection_fee_notice ?? "") && /500/.test(appr.inspection_fee_notice_ar ?? ""), JSON.stringify(appr ?? {}).slice(0, 200));

const { browser: cb, page: cp } = await browserFor("owner", { viewport: { width: 480, height: 1000 } });
await go(cp, `${base}/approve/${appr.token}`);
const body = (await cp.textContent("body")) ?? "";
check("4: the customer page shows the English fee line with AED 500", /inspection fee of AED 500 will apply/i.test(body.replace(/\s+/g, " ")), body.replace(/\s+/g, " ").slice(0, 120));
check("4: the customer page shows the Arabic fee line with 500", (await cp.locator('[dir="rtl"]', { hasText: "500" }).count()) >= 1);
await cp.locator("#approval").scrollIntoViewIfNeeded();
await cp.screenshot({ path: shot("fee-3-approval-page.png"), clip: (await cp.locator("#approval").boundingBox()) ?? undefined });

/* ---------------- 5. Locked once the customer approves ---------------- */
// A stale edit page stays open from before the approval, to prove the server refuses it later.
const stale = await actx.newPage();
stale.setDefaultTimeout(15000);
await go(stale, `${base}/jobs/${job.id}/gate-in/edit`);
check("5: before approval the edit page still offers the chips", (await stale.locator("[data-inspection-fee]").count()) === 1);

// The customer approves on the page itself.
await cp.locator('input[name="agree"]').evaluate((el) => el.click());
await cp.locator('input[name="approver_name"]').fill("E2e Fee Customer");
await cp.getByText("Approve", { exact: true }).click();
await cp.waitForURL((u) => /\/approve\//.test(u.toString()), { timeout: 25000 }).catch(() => null);
await settle(cp);
const approvedJob = await until(async () => (await sql("select first_approval_at from public.jobs where id = $1", [job.id]))[0]?.first_approval_at, 20, 500);
check("5: the approval stamps the job", !!approvedJob);

await go(ap, `${base}/jobs/${job.id}/gate-in/edit`);
check("5: after approval the edit page shows the locked line instead of chips", (await ap.locator("[data-inspection-fee-locked]").count()) === 1 && (await ap.locator("[data-fee-chip]").count()) === 0);
await ap.locator("[data-inspection-fee-locked]").scrollIntoViewIfNeeded();
await ap.screenshot({ path: shot("fee-4-locked.png"), clip: (await ap.locator("[data-inspection-fee-locked]").boundingBox()) ?? undefined });

// The stale page still shows chips; its submit must be refused by the server.
await stale.locator('[data-fee-chip="2000"]').click();
await stale.getByText("Save amendments").click();
const refusal = await until(async () => /inspection fee is locked/i.test(((await stale.textContent("body")) ?? "").replace(/\s+/g, " ")) ? 1 : null, 20, 500);
const still = (await sql("select inspection_fee_aed from public.jobs where id = $1", [job.id]))[0];
check("5: a stale form with AED 2,000 is refused in words and the fee stays 500", !!refusal && Number(still.inspection_fee_aed) === 500, JSON.stringify(still));

await go(op, `${base}/jobs/${job.id}`);
check("5: the job card badge says locked", /Inspection fee: AED 500 · locked/.test(((await op.textContent("body")) ?? "").replace(/\s+/g, " ")));

await ab.close(); await ob.close(); await cb.close();
cleanupDb();
process.exit(summary() ? 1 : 0);
