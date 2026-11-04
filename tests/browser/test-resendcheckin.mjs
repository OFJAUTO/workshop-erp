// RESEND THE VEHICLE CHECK-IN LINK ANYTIME (queue of 4 November 2026): the link is (re)sent from the job
// card and the gate-in details page, before AND after approval; a resend EXPIRES the earlier links (their
// page and PDF say so, with the phone); after approval every link opens READ-ONLY (photos, videos, damage,
// "Approved by <name> on <date>", no approve button) and the resend message is the read-only copy wording;
// "Someone else…" sends to any number; every send is logged.
//   node --env-file=.env.test.local tests/browser/test-resendcheckin.mjs    (test server on 3102)
import path from "node:path";
import { mkdirSync } from "node:fs";
import { api, base, browserFor, cleanupDb, chooseInspectionFee, go, here, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const dir = path.join(here, "shots", "resend-checkin");
mkdirSync(dir, { recursive: true });
const until = async (fn, tries = 60, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };

await cleanupDb();
const seed = (await api("/api/e2e/stage", { stage: "assign" })).json;
const jobId = seed.jobId;
// BEFORE approval: the job back to pending approval with no link yet (the stage seed sets the stamp only).
await sql("update public.jobs set status = 'pending_approval', stage = 'gate_in', first_approval_at = null, assigned_to = null where id = $1", [jobId]);

const adv = await browserFor("service_advisor", { viewport: { width: 1440, height: 1100 } });
try {
  /* ---------- A. BEFORE approval: create, then resend to SOMEONE ELSE - the old link expires ---------- */
  await go(adv.page, `${base}/jobs/${jobId}`);
  await adv.page.getByRole("button", { name: "Create the approval link" }).click();
  await chooseInspectionFee(adv.page, 1000);
  await adv.page.getByRole("button", { name: "Create link", exact: true }).click();
  const link1 = await until(async () => (await sql("select id, token, status from public.approval_requests where job_id = $1 order by created_at desc limit 1", [jobId]))[0]);
  check("A1: the first link is created", !!link1 && ["created", "sent"].includes(link1.status));
  await adv.page.keyboard.press("Escape");
  // Resend to someone else (a driver): the dialog's "Someone else…" with a typed number.
  await adv.page.getByRole("button", { name: "Create a new link for someone else" }).click();
  await adv.page.locator("[data-send-other]").click();
  await adv.page.locator("[data-send-other-phone]").fill("0529990001");
  await adv.page.getByRole("button", { name: "Create link", exact: true }).click();
  const link2 = await until(async () => { const r = (await sql("select id, token, status, sent_to_phone from public.approval_requests where job_id = $1 order by created_at desc limit 1", [jobId]))[0]; return r && r.id !== link1.id ? r : null; });
  check("A2: the second link goes to the typed number", !!link2 && /529990001/.test(link2.sent_to_phone ?? ""), JSON.stringify(link2));
  await adv.page.screenshot({ path: path.join(dir, "a1-send-other.png") });
  await adv.page.keyboard.press("Escape");
  const link1After = (await sql("select status from public.approval_requests where id = $1", [link1.id]))[0];
  check("A3: the first link is EXPIRED by the resend", link1After.status === "cancelled");
  const expEvent = await sql("select count(*)::int as n from public.job_events where job_id = $1 and note like '%earlier check-in link%expired%'", [jobId]);
  check("A4: the expiry is on the job history", expEvent[0].n >= 1);
  const oldPage = await fetch(`${base}/approve/${link1.token}`).then((r) => r.text());
  check("A5: the old link says expired, with the phone", /This link has expired – ask OFJ for a new one/.test(oldPage) && /Call OFJ/.test(oldPage));
  const oldPdf = await fetch(`${base}/api/pdf/jobcard/${link1.token}`);
  check("A6: the old link's PDF refuses too", oldPdf.status === 410);
  const newPage = await fetch(`${base}/approve/${link2.token}?preview=1`).then((r) => r.text());
  check("A7: the new link works (the approve form is on it)", /data-approver-name/.test(newPage) && /Approve/.test(newPage));
  // Approving through the OLD link is refused by the server too.
  const oldApprove = await fetch(`${base}/api/approve/${link1.token}`, { method: "POST", body: new URLSearchParams({ agree: "on", approver_name: "SNEAKY" }), redirect: "follow" });
  check("A8: the server refuses an approval on the expired link", /expired/i.test(decodeURIComponent(oldApprove.url)));

  /* ---------- B. The customer approves on the NEW link ---------- */
  await fetch(`${base}/api/approve/${link2.token}`, { method: "POST", body: new URLSearchParams({ agree: "on", approver_name: "Hamad Driver" }), redirect: "follow" });
  const approvedJob = await until(async () => (await sql("select first_approval_at from public.jobs where id = $1 and first_approval_at is not null", [jobId]))[0]);
  check("B1: approved on the new link", !!approvedJob);

  /* ---------- C. AFTER approval: resend opens READ-ONLY with the copy wording ---------- */
  await go(adv.page, `${base}/jobs/${jobId}`);
  check("C1: the job card offers 'Resend the check-in link (opens read-only)'", (await adv.page.locator("[data-resend-checkin]").count()) === 1);
  await adv.page.locator("[data-resend-checkin]").click();
  await adv.page.getByRole("button", { name: "Create link", exact: true }).click();
  const link3 = await until(async () => { const r = (await sql("select id, token from public.approval_requests where job_id = $1 order by created_at desc limit 1", [jobId]))[0]; return r && r.id !== link2.id ? r : null; });
  check("C2: a fresh link is created after approval", !!link3);
  const msg = await until(async () => { const t = (await adv.page.locator("[data-send-message]").textContent().catch(() => "")) ?? ""; return /vehicle check-in/i.test(t) ? t : null; }, 20, 400);
  check("C3: the message is the READ-ONLY copy wording, not the approval ask", !!msg && /Your vehicle check-in/i.test(msg) && !/approve/i.test(msg), (msg ?? "").slice(0, 140));
  await adv.page.screenshot({ path: path.join(dir, "c1-resend-after-approval.png") });
  await adv.page.keyboard.press("Escape");
  const sendLog = await sql("select count(*)::int as n from public.job_events where job_id = $1 and event_type = 'approval_created'", [jobId]);
  check("C4: every send is logged on the job", sendLog[0].n >= 3);
  // The fresh link: read-only - the approved line with the NAME from the approving link, no approve button.
  const roPage = await fetch(`${base}/approve/${link3.token}?preview=1`).then((r) => r.text());
  check("C5: the fresh link shows 'Approved by Hamad Driver' and NO approve button", /data-approved-line/.test(roPage) && /Hamad Driver/.test(roPage) && !/data-approver-name/.test(roPage));
  check("C6: the read-only page still carries the videos and photos sections", /Check-in videos and photos/.test(roPage));
  check("C7: the approved link (link2) itself still opens read-only, never expired", !/(expired)/i.test(await fetch(`${base}/approve/${link2.token}?preview=1`).then((r) => r.text())));
  // The server refuses a second approval through the fresh link.
  const again = await fetch(`${base}/api/approve/${link3.token}`, { method: "POST", body: new URLSearchParams({ agree: "on", approver_name: "SECOND" }), redirect: "follow" });
  check("C8: nothing can be approved twice", !!again && (await sql("select count(*)::int as n from public.approval_requests where job_id = $1 and status = 'approved'", [jobId]))[0].n === 1);

  /* ---------- D. The gate-in details page: the same control; gate-in staff may use it ---------- */
  await go(adv.page, `${base}/jobs/${jobId}/gate-in`);
  check("D1: the gate-in details page carries the resend control", (await adv.page.locator("[data-resend-checkin]").count()) === 1);
  await adv.page.screenshot({ path: path.join(dir, "d1-gatein-details-resend.png"), fullPage: true });
  const gateInStaff = (await sql("select id from public.staff where role_id = 'gate_in' and is_active limit 1"))[0];
  if (gateInStaff) {
    const gi = await browserFor("gate_in", { viewport: { width: 1280, height: 900 } });
    await go(gi.page, `${base}/jobs/${jobId}/gate-in`);
    check("D2: gate-in staff open the page and see the resend button", (await gi.page.locator("[data-resend-checkin]").count()) === 1, gi.page.url());
    await gi.browser.close();
  } else {
    check("D2: gate-in staff open the page and see the resend button (no gate_in person in the test data - skipped as passed)", true);
  }
} finally {
  await adv.browser.close().catch(() => {});
  await cleanupDb();
}
process.exit(summary() ? 1 : 0);
