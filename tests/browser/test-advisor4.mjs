// Evening section 4 proof: ONE advisor in charge per car. The badge and change control on the job card
// (logged, the new person told); notifications go to the in-charge advisor only - a Follow brings them
// to a second advisor by choice; the advisor dashboard splits My cars / Other cars with a Mine-All
// switch; the owner's bell skips informational types.
// Run: node --env-file=.env.test.local tests/browser/test-advisor4.mjs   (dev server on :3100)
import path from "node:path";
import { api, base, browserFor, browserForId, cleanupDb, cookieHeader, go, here, makeChecks, settle, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shot = (name) => path.join(here, "shots", name);
const until = async (fn, tries = 30, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };

cleanupDb();
const seed = await api("/api/e2e/stage", { stage: "quote" });
const jobId = seed.json?.jobId;
const qid = seed.json?.quotationId;
if (!jobId || !qid) { console.error("seed failed"); process.exit(1); }
const adarsh = (await sql("select id from public.staff where display_name = 'Adarsh' and is_active limit 1"))[0].id;
const anas = (await sql("select id from public.staff where display_name = 'Anas' and is_active limit 1"))[0]?.id;
const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active limit 1"))[0].id;
if (!anas) { console.error("No second advisor (Anas) found."); process.exit(1); }

/* ---------------- 1. The badge and the change control (logged, the new person told) ---------------- */
const { browser: ob, page: op } = await browserFor("owner", { viewport: { width: 1440, height: 950 } });
await go(op, `${base}/jobs/${jobId}`);
check("1: the job card carries the advisor-in-charge badge", (await op.locator("[data-advisor-badge]").count()) >= 1, await op.locator("[data-advisor-badge]").first().getAttribute("data-advisor-badge"));
await op.locator("[data-advisor-change]").click();
await sleep(300);
await op.locator('[data-advisor-control] select[name="staff_id"]').selectOption(anas);
await op.locator("[data-advisor-save]").click();
await op.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 25000 }).catch(() => null);
await settle(op);
const after = (await sql("select advisor_id from public.jobs where id = $1", [jobId]))[0];
check("1: the change saves", after.advisor_id === anas, JSON.stringify(after));
const ev = await sql("select count(*)::int as n from public.job_events where job_id = $1 and event_type = 'advisor_change'", [jobId]);
check("1: the change is logged on the job's history", (ev[0]?.n ?? 0) === 1);
const told = await sql("select count(*)::int as n from public.notifications where job_id = $1 and type = 'advisor_change' and staff_id = $2", [jobId, anas]);
check("1: the new advisor is told", (told[0]?.n ?? 0) === 1);
await op.locator("[data-advisor-control]").scrollIntoViewIfNeeded();
await op.screenshot({ path: shot("adv4-1-control.png"), clip: (await op.locator("header, [data-advisor-control]").first().boundingBox()) ?? undefined });

/* ---------------- 2. Notifications go to the in-charge advisor only; Follow opts a second one in ---------------- */
await sql("delete from public.notifications where job_id = $1", [jobId]).catch(() => null);
await sql("update public.notifications set read_at = read_at where false").catch(() => null);
// The owner takes the editor lock on Anas's quotation: the heads-up must reach Anas, not Adarsh.
const ownerCookie = await cookieHeader("owner");
await fetch(`${base}/api/quote/save`, { method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ quotationId: qid, lock: "take" }) });
const heads = await until(async () => { const r = await sql("select staff_id from public.notifications where job_id = $1 and type = 'quote_other_editor'", [jobId]); return r.length ? r : null; });
check("2: the heads-up reached the advisor in charge (Anas) only", !!heads && heads.some((h) => h.staff_id === anas) && !heads.some((h) => h.staff_id === adarsh), JSON.stringify(heads ?? []));
await fetch(`${base}/api/quote/save`, { method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ quotationId: qid, lock: "release" }) });

// Adarsh presses Follow; when Anas himself takes the lock, the follower hears (Anas, the taker, does not).
const { browser: db, page: dp } = await browserForId(adarsh, { viewport: { width: 1440, height: 950 } });
await go(dp, `${base}/jobs/${jobId}`);
await dp.locator("[data-advisor-change]").click();
await sleep(300);
await dp.locator("[data-follow-toggle]").click();
await dp.waitForURL((u) => /message=/.test(u.toString()), { timeout: 25000 }).catch(() => null);
const follows = (await sql("select is_active from public.job_followers where job_id = $1 and staff_id = $2", [jobId, adarsh]))[0];
check("2: Follow is recorded", !!follows?.is_active, JSON.stringify(follows ?? {}));
const anasCookie = await cookieHeader(anas);
await fetch(`${base}/api/quote/save`, { method: "POST", headers: { cookie: anasCookie, "content-type": "application/json" }, body: JSON.stringify({ quotationId: qid, lock: "take" }) });
const heads2 = await until(async () => { const r = await sql("select staff_id from public.notifications where job_id = $1 and type = 'quote_other_editor' and staff_id = $2", [jobId, adarsh]); return r.length ? r : null; });
check("2: the follower hears about someone else's work on the car", !!heads2, JSON.stringify(heads2 ?? []));

/* ---------------- 3. The owner's bell skips informational types ---------------- */
await sql("insert into public.approval_requests (job_id, kind, token, sent_to_name, sent_to_phone, sent_by, status, terms_text) values ($1, 'job_card', 'e2e-adv4-tok', 'E2e Customer', '+971500000093', $2, 'created', 'Terms')", [jobId, owner]);
await fetch(`${base}/approve/e2e-adv4-tok`);
const opened = await until(async () => { const r = await sql("select staff_id from public.notifications where job_id = $1 and type = 'approval_opened'", [jobId]); return r.length ? r : null; });
check("3: 'customer opened the link' rings the advisor, never the owner's bell", !!opened && opened.some((o) => o.staff_id === anas) && !opened.some((o) => o.staff_id === owner), JSON.stringify(opened ?? []));

/* ---------------- 4. The advisor dashboard: My cars first, Other cars folded, Mine/All switch ---------------- */
const { browser: ab2, page: ap2 } = await browserForId(anas, { viewport: { width: 1440, height: 950 } });
await go(ap2, `${base}/dashboard`);
check("4: the Mine/All switch shows for advisors", (await ap2.locator("[data-scope-switch]").count()) === 1);
const mineCards = await ap2.locator(`[data-flash-id="${jobId}"]`).count();
check("4: Anas's car sits in My cars (not inside the fold)", mineCards >= 1 && (await ap2.locator(`[data-other-cars] [data-flash-id="${jobId}"]`).count()) === 0);
check("4: the other cars sit folded and lighter", (await ap2.locator("[data-other-cars]").count()) === 1);
check("4: the cards carry the advisor badge", (await ap2.locator("[data-advisor-badge]").count()) >= 1);
await ap2.screenshot({ path: shot("adv4-2-dashboard-mine.png"), fullPage: false });
await ap2.locator('[data-scope="all"]').click();
await sleep(400);
check("4: All shows one flat list", (await ap2.locator("[data-other-cars]").count()) === 0);
const { browser: xb, page: xp } = await browserForId(adarsh);
await go(xp, `${base}/dashboard`);
check("4: for Adarsh the same car sits under Other cars", (await xp.locator(`[data-other-cars] [data-flash-id="${jobId}"]`).count()) === 1);
await xb.close();

await ob.close(); await db.close(); await ab2.close();
cleanupDb();
process.exit(summary() ? 1 : 0);
