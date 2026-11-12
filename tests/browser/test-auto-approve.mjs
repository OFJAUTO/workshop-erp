// Auto-approve while the owner is away (12 November 2026), on the TEST database through the test server.
//  A. The owner switches it ON on Settings > Approvals (only the free items pre-ticked); an advisor cannot open the page.
//  B. Switch ON: an advisor sends a quotation with a complimentary recovery - no waiting, logged AUTO-APPROVED (OWNER AWAY),
//     no bell to the owner, in the Auto-approved list with its cost; the dashboard shows it is ON.
//  C. A type NOT ticked (total above the approval amount) still waits for the owner.
//  D. Switch OFF: the same complimentary item waits for the owner again.
//   node --env-file=.env.test.local tests/browser/test-auto-approve.mjs      (npm run test:autoapprove)
import fs from "node:fs";
import path from "node:path";
import { api, base, browserFor, browserForId, cleanupDb, makeChecks, projectRoot, sql, sleep, go } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const PROOF = path.join(projectRoot, "docs", "proof", "2026-11-12-auto-approve");
fs.mkdirSync(PROOF, { recursive: true });
const one = async (q, p = []) => (await sql(q, p))[0] ?? null;
const started = new Date().toISOString();

const before = await one("select value::text v from public.settings where key = 'auto_approve'");
const beforeAbove = await one("select value::text v from public.settings where key = 'quote_owner_approval_above_aed'");

/** A fresh quotation on the stage car, with (optionally) a complimentary recovery for goodwill. */
async function freshQuote({ comp }) {
  cleanupDb();
  const seed = await api("/api/e2e/stage", { stage: "quote" });
  const { jobId, quotationId } = seed.json ?? {};
  await sql("update public.part_requests set status = 'unavailable', closed_reason = 'auto-approve test' where job_id = $1 and status = 'open'", [jobId]);
  // This test is about approvals, not parts: the stage car's unpriced part leaves this quotation.
  await sql("update public.quotation_lines set is_active = false where quotation_id = $1 and line_type = 'part'", [quotationId]);
  await sql("update public.part_items set is_active = false where job_id = $1", [jobId]);
  await sql("update public.part_requests set is_active = false where job_id = $1", [jobId]);
  if (comp) {
    await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, unit_cost, unit_price, price_display, created_by, updated_by) select $1, 5, 'recovery', 'RECOVERY – PICK-UP AND DROP-OFF', 'manual', 1, 150, 150, 'complimentary', created_by, created_by from public.quotations where id = $1", [quotationId]);
    await sql("update public.quotations set comp_reason = 'goodwill', comp_note = 'E2e loyal customer' where id = $1", [quotationId]);
  }
  const advisorId = (await one("select created_by from public.quotations where id = $1", [quotationId]))?.created_by;
  return { jobId, quotationId, advisorId };
}

/** The advisor completes and sends the quotation through the screen; true when the send window opened (no waiting). */
async function advisorSends({ jobId, quotationId, advisorId }, shotName) {
  const { browser, page } = await browserForId(advisorId, { viewport: { width: 1440, height: 1300 } });
  await go(page, `${base}/jobs/${jobId}/quote/${quotationId}`);
  const complete = page.getByRole("button", { name: /complete$/ });
  if (await complete.count()) {
    await complete.click();
    for (let i = 0; i < 24; i++) {
      await sleep(900);
      if (await page.locator("[data-low-profit-ask]").count()) { await page.locator("[data-low-profit-send]").click(); continue; }
      if (await page.locator("[data-high-markup-ask]").count()) { await page.locator("[data-high-markup-send]").click(); continue; }
      if (await page.locator("[data-markup-ask]").count()) { await page.locator("[data-markup-continue]").click(); continue; }
      if (await page.locator("[data-parts-ask]").count()) { await page.locator("[data-parts-add]").click(); continue; }
      if (await page.locator("[data-deposit-ask]").count()) { await page.locator("[data-deposit-skip]").click(); continue; }
      if ((await one("select completed_at from public.quotations where id = $1", [quotationId]))?.completed_at) break;
    }
    await sleep(1500);
  }
  await go(page, `${base}/jobs/${jobId}/quote/${quotationId}`);
  const sendBtn = page.getByRole("button", { name: /^Send (the )?quotation$/ }).first();
  const had = await sendBtn.count();
  let opened = false;
  if (had) {
    await sendBtn.click();
    const copy = page.locator("[role='dialog']").getByRole("button", { name: /^Copy/ }).first();
    opened = !!(await copy.waitFor({ timeout: 20000 }).then(() => true).catch(() => false));
    const round = page.locator("[role='dialog']").getByRole("button", { name: /^AED .*down/ }).first();
    if (await round.count()) await round.click();
    if (opened) { await copy.click(); await sleep(2000); }
  }
  await page.screenshot({ path: path.join(PROOF, shotName) });
  const words = ((await page.locator("main").innerText().catch(() => "")) ?? "").replace(/\s+/g, " ");
  await browser.close();
  return { opened, had, words };
}

/** The owner sets the switch on the settings page (ON with the free items as they are, or OFF). */
async function ownerSets(on, shotName = null) {
  const { browser, page } = await browserFor("owner", { viewport: { width: 1440, height: 1300 } });
  await go(page, `${base}/settings/approvals`);
  await page.locator(on ? "[data-auto-on]" : "[data-auto-off]").click();
  await page.locator("[data-auto-save]").click();
  const saved = (await page.locator("[data-auto-saved]").textContent({ timeout: 20000 }).catch(() => "")) ?? "";
  if (shotName) await page.screenshot({ path: path.join(PROOF, shotName), fullPage: true });
  await browser.close();
  return saved;
}

try {
  /* A. The switch */
  {
    const { browser, page } = await browserFor("owner", { viewport: { width: 1440, height: 1300 } });
    await go(page, `${base}/settings/approvals`);
    const ticks = await page.locator("[data-auto-tick]").evaluateAll((els) => els.filter((e) => e.checked).map((e) => e.getAttribute("data-auto-tick")).sort());
    check(`A1 the list of types, only the free items pre-ticked (${ticks.join(", ")})`, before?.v ? ticks.length > 0 : JSON.stringify(ticks) === JSON.stringify(["comp_goodwill", "comp_our_mistake", "comp_recovery", "comp_warranty", "free_charge_recovery"]));
    check("A2 the types that always come to the owner are listed with why", (await page.locator("[data-auto-not] li").count()) >= 10);
    await browser.close();
    const adv = await browserFor("service_advisor", { viewport: { width: 1440, height: 900 } });
    const r = await adv.page.goto(`${base}/settings/approvals`, { waitUntil: "load" });
    check("A3 only the owner opens the switches (an advisor gets not found)", r?.status() === 404);
    await adv.browser.close();
    const saved = await ownerSets(true, "1-settings-on-1440.png");
    check(`A4 switched ON ("${saved}")`, /Auto-approve is ON/.test(saved));
    const cfg = await one("select value from public.settings where key = 'auto_approve'");
    check("A5 stored ON", cfg?.value?.on === true);
  }

  /* B. A complimentary recovery goes without waiting */
  {
    const q = await freshQuote({ comp: true });
    const r = await advisorSends(q, "2-advisor-sends-1440.png");
    const row = await one("select status, owner_approved_at, owner_approved_by, comp_status, comp_decision_note from public.quotations where id = $1", [q.quotationId]);
    check(`B1 the advisor sent it straight away, no waiting (send window opened, status ${row?.status})`, r.opened && ["sent", "draft"].includes(row?.status) && row?.status !== "pending_owner", r.words.slice(0, 200));
    check("B2 approved under the owner, the complimentary stamped AUTO-APPROVED (OWNER AWAY)", !!row?.owner_approved_at && row?.comp_status === "approved" && row?.comp_decision_note === "AUTO-APPROVED (OWNER AWAY)", JSON.stringify(row));
    const log = await one("select note from public.quotation_events where quotation_id = $1 and event_type = 'auto_approved' order by created_at desc limit 1", [q.quotationId]);
    check(`B3 the log line: "${log?.note ?? ""}"`, /^AUTO-APPROVED \(OWNER AWAY\): Q-STAGE-1 v1 – complimentary \(Goodwill gesture/.test(log?.note ?? "") && /asked by .+ · cost to us AED 150\.00$/.test(log?.note ?? ""));
    const bell = await one("select count(*)::int n from public.notifications n join public.staff s on s.id = n.staff_id where s.role_id = 'owner' and n.type = 'quote_owner_approval' and n.created_at > $1", [started]);
    check("B4 no bell to the owner", bell?.n === 0, JSON.stringify(bell));
    const { browser, page } = await browserFor("owner", { viewport: { width: 1440, height: 1300 } });
    await go(page, `${base}/approvals`);
    const list = page.locator("[data-auto-list] [data-auto-row]").first();
    const text = ((await list.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ");
    check(`B5 the Approvals page's Auto-approved list, newest first with its cost ("${text.slice(0, 120)}…")`, /cost AED 150\.00/.test(text) && /AUTO-APPROVED \(OWNER AWAY\)/.test(text));
    await page.locator("#auto-approved").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(PROOF, "3-auto-approved-list-1440.png") });
    await go(page, `${base}/dashboard`);
    const dash = ((await page.locator("[data-auto-dashboard]").textContent().catch(() => "")) ?? "").replace(/\s+/g, " ");
    check(`B6 the dashboard shows it is ON ("${dash.slice(0, 110)}")`, /AUTO-APPROVE IS ON/.test(dash) && /Auto-approved today: [1-9]/.test(dash));
    await page.locator("[data-auto-dashboard]").scrollIntoViewIfNeeded().catch(() => null);
    await page.screenshot({ path: path.join(PROOF, "3b-dashboard-on-1440.png") });
    await browser.close();
    // Switched OFF and ON again: what was approved stays approved.
    await ownerSets(false);
    const still = await one("select status, owner_approved_at, comp_status from public.quotations where id = $1", [q.quotationId]);
    const logStill = await one("select count(*)::int n from public.quotation_events where quotation_id = $1 and event_type = 'auto_approved'", [q.quotationId]);
    check("B7 switching OFF undoes nothing already approved", still?.status === "sent" && !!still?.owner_approved_at && still?.comp_status === "approved" && logStill?.n === 1, JSON.stringify({ still, logStill }));
    await ownerSets(true);
  }

  /* C. A type that is NOT ticked still waits */
  {
    await sql("insert into public.settings (key, value, label) values ('quote_owner_approval_above_aed', to_jsonb(1), 'Quotation total above which the owner approves') on conflict (key) do update set value = to_jsonb(1)");
    const q = await freshQuote({ comp: false });
    const r = await advisorSends(q, "4-not-ticked-waits-1440.png");
    const row = await one("select status, owner_approved_at from public.quotations where id = $1", [q.quotationId]);
    check(`C1 a total above the approval amount (not ticked) still waits for the owner (status ${row?.status})`, row?.status === "pending_owner" && !row?.owner_approved_at && !r.opened, r.words.slice(0, 160));
    if (beforeAbove) await sql("update public.settings set value = $1::jsonb where key = 'quote_owner_approval_above_aed'", [beforeAbove.v]);
    else await sql("update public.settings set value = to_jsonb(0) where key = 'quote_owner_approval_above_aed'");
  }

  /* D. Switch OFF: the same complimentary item waits again */
  {
    const saved = await ownerSets(false);
    check(`D1 switched OFF ("${saved}")`, /OFF/.test(saved));
    const q = await freshQuote({ comp: true });
    const r = await advisorSends(q, "5-off-waits-again-1440.png");
    const row = await one("select status, owner_approved_at from public.quotations where id = $1", [q.quotationId]);
    check(`D2 switch OFF: the complimentary recovery waits for the owner again (status ${row?.status})`, row?.status === "pending_owner" && !row?.owner_approved_at && !r.opened, r.words.slice(0, 160));
    const bell = await one("select count(*)::int n from public.notifications n join public.staff s on s.id = n.staff_id where s.role_id = 'owner' and n.type = 'quote_owner_approval' and n.created_at > $1", [started]);
    check("D3 and the owner is told as normal", bell?.n >= 1);
    // E. Switched ON again: the complimentary quotation already waiting is approved the same way, and its advisor told.
    const saved2 = await ownerSets(true);
    const after = await one("select status, owner_approved_at, comp_decision_note from public.quotations where id = $1", [q.quotationId]);
    check(`E1 switched ON: a request already waiting is approved the same way ("${saved2}")`, /1 waiting request was approved now/.test(saved2) && after?.status === "draft" && !!after?.owner_approved_at && after?.comp_decision_note === "AUTO-APPROVED (OWNER AWAY)", JSON.stringify(after));
    const told = await one("select count(*)::int n from public.notifications where staff_id = $1 and title like 'AUTO-APPROVED (OWNER AWAY)%' and created_at > $2", [q.advisorId, started]);
    check("E2 the advisor is told to send it", told?.n >= 1);
  }
} catch (e) {
  check("walked without a crash", false, String(e?.stack ?? e).slice(0, 600));
} finally {
  // The switch back as it was before the test (TEST database).
  if (before?.v) await sql("update public.settings set value = $1::jsonb where key = 'auto_approve'", [before.v]);
  else await sql("update public.settings set value = jsonb_set(value, '{on}', 'false') where key = 'auto_approve'");
  await sql("delete from public.notifications where created_at > $1 and (type in ('quote_owner_approval', 'auto_approved_summary') and (href like '%22222222-0000-4000-8000-00000000e%' or href like '/approvals%'))", [started]);
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
