// Evening section 3 proof: the OWNER never asks himself. A locked, approved inspection report gives him
// a direct Edit (no change request, no one-hour window); his edits save and land quietly on the job's
// history; an advisor still gets the ask-the-owner path; the job card says when a sent report changed.
// Run: node --env-file=.env.local tests/browser/test-owner3.mjs   (dev server on :3100)
import path from "node:path";
import { api, base, browserFor, cleanupDb, cookieHeader, go, here, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shot = (name) => path.join(here, "shots", name);

cleanupDb();
const seed = await api("/api/e2e/stage", { stage: "approved" });
const jobId = seed.json?.jobId;
if (!jobId) { console.error("seed failed"); process.exit(1); }
const insp = (await sql("select id, status, unlocked_until from public.inspections where job_id = $1", [jobId]))[0];
check("0: the seeded report is approved and locked", insp.status === "approved" && !insp.unlocked_until, JSON.stringify(insp));

/* ---------------- 1. The report page: Edit for the owner, the ask for everyone else ---------------- */
const { browser: ob, page: op } = await browserFor("owner", { viewport: { width: 1366, height: 950 } });
await go(op, `${base}/jobs/${jobId}/inspection`);
const ownerBody = ((await op.textContent("body")) ?? "").replace(/\s+/g, " ");
check("1: the owner sees a direct Edit report button", (await op.locator("[data-owner-edit-report]").count()) === 1);
check("1: nothing asks the owner to approve himself", !/Ask the owner to approve a change/.test(ownerBody));
await op.locator("[data-owner-edit]").scrollIntoViewIfNeeded();
await op.screenshot({ path: shot("owner3-1-edit-card.png"), clip: (await op.locator("[data-owner-edit]").locator("xpath=ancestor::*[contains(@class,'flex-col')][1]").boundingBox()) ?? undefined });

const { MANAGER_MECH } = await import("./pw-lib.mjs");
const { browser: ab, page: ap } = await (await import("./pw-lib.mjs")).browserForId(MANAGER_MECH);
await go(ap, `${base}/jobs/${jobId}/inspection`);
check("1: the workshop manager still asks the owner", /Ask the owner to approve a change/.test(((await ap.textContent("body")) ?? "")));
await ab.close();

/* ---------------- 2. The owner's edit saves on the locked report; an advisor's is refused ---------------- */
const item = (await sql("select id, item_key, item_label from public.inspection_items where inspection_id = $1 order by position limit 1", [insp.id]))[0];
const ownerCookie = await cookieHeader("owner");
const save = await fetch(`${base}/api/inspection/save`, { method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ inspectionId: insp.id, item: { key: item.item_key, remarks: "Owner corrected this remark after approval" } }) });
check("2: the owner's edit on the locked report saves", save.status === 200, `${save.status} ${await save.text().then((t) => t.slice(0, 100))}`);
const after = (await sql("select remarks from public.inspection_items where id = $1", [item.id]))[0];
check("2: the change is really in", after.remarks === "Owner corrected this remark after approval", JSON.stringify(after));
const logged = await sql("select count(*)::int as n from public.job_events where job_id = $1 and event_type = 'report_owner_edit'", [jobId]);
check("2: the job's history quietly says the owner edited it", (logged[0]?.n ?? 0) === 1);
const save2 = await fetch(`${base}/api/inspection/save`, { method: "POST", headers: { cookie: ownerCookie, "content-type": "application/json" }, body: JSON.stringify({ inspectionId: insp.id, inspection: { manager_note_internal: "Owner's note, edited after approval" } }) });
const note = (await sql("select manager_note_internal from public.inspections where id = $1", [insp.id]))[0];
check("2: the manager's note is editable too", save2.status === 200 && note.manager_note_internal === "Owner's note, edited after approval", JSON.stringify(note));
const onceMore = await sql("select count(*)::int as n from public.job_events where job_id = $1 and event_type = 'report_owner_edit'", [jobId]);
check("2: the history line is once an hour, not per keystroke", (onceMore[0]?.n ?? 0) === 1);

const advCookie = await cookieHeader("service_advisor");
const refused = await fetch(`${base}/api/inspection/save`, { method: "POST", headers: { cookie: advCookie, "content-type": "application/json" }, body: JSON.stringify({ inspectionId: insp.id, item: { key: item.item_key, remarks: "advisor try" } }) });
check("2: an advisor on the locked report is still refused", refused.status === 423 || refused.status === 403, `${refused.status}`);

/* ---------------- 3. The owner's technician-screen form is open on the locked report ---------------- */
await go(op, `${base}/my-jobs/${jobId}`);
const formText = ((await op.textContent("body")) ?? "").replace(/\s+/g, " ");
check("3: the form page says the owner edits freely", /You are the owner: edit anything below/.test(formText));
await op.locator("#item-prescan").waitFor({ timeout: 20000 }).catch(() => null);
const editable = await op.locator("textarea:not([disabled]), input:not([disabled]):not([type=hidden]):not([type=checkbox]):not([type=radio])").count();
check("3: the form's boxes are open, not read-only", editable > 5, `${editable} editable boxes`);
await op.screenshot({ path: shot("owner3-2-form-open.png"), fullPage: false });

/* ---------------- 4. A sent report that changed afterwards says so on the job card ---------------- */
await sql("insert into public.report_links (job_id, inspection_id, token, status, sent_at, created_at) values ($1, (select id from public.inspections where job_id = $1), 'e2e-own3-tok', 'sent', now() - interval '2 hours', now() - interval '2 hours')", [jobId]);
await go(op, `${base}/jobs/${jobId}`);
check("4: the job card flags the change after sending, link stays latest", (await op.locator("[data-report-changed]").count()) === 1);

await ob.close();
cleanupDb();
process.exit(summary() ? 1 : 0);
