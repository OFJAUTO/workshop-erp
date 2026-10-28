// B3 (28 October 2026): the discount pop-up fits at every width, the amount stays exactly as typed (a thousands comma
// included), the % is information only, and the words, the owner's box and the approval follow WHO gave the discount.
// After the independent review: the owner's own discount approves nothing else, an approval covers only what the owner
// saw (a bigger discount goes back to him), a box left open never approves newer figures, Apply with the same figures
// changes nothing, and a new version keeps who gave the discount.
// Run against a local dev server: E2E_BASE=http://localhost:3101 npm run test:b3
import path from "node:path";
import fs from "node:fs";
import { api, base, browserFor, cleanupDb, go, here, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const SHOTS = path.join(here, "shots", "b3");
fs.mkdirSync(SHOTS, { recursive: true });
const until = async (fn, tries = 30, ms = 400) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } return null; };

await cleanupDb();
const seed = (await api("/api/e2e/stage", { stage: "quote" })).json;
const Q = seed.quotationId;
const URL = `${base}/jobs/${seed.jobId}/quote/${Q}`;
// A labour base of AED 12,000 (40 h × 300), so AED 5,611 is a real share of it. Parts priced, so the quotation can be sent.
await sql("update public.quotation_lines set hours = 40, quantity = 40, labour_rate = 300, unit_price = 300 where quotation_id = $1 and line_type = 'labour' and is_active", [Q]);
await sql("update public.part_requests set status = 'done' where job_id = $1", [seed.jobId]);
await sql("update public.jobs set parts_pricing_done_at = now() where id = $1", [seed.jobId]);
const advisor = (await sql("select id, display_name from public.staff where role_id = 'service_advisor' and is_active order by display_name limit 1"))[0];
const ownerId = (await sql("select id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0]?.id;
const limit = Number((await sql("select value #>> '{}' v from public.settings where key = 'discount_limit_percent'"))[0]?.v) || 10;
const above = Number((await sql("select value #>> '{}' v from public.settings where key = 'quote_owner_approval_above_aed'"))[0]?.v) || 0;
const row = async () => (await sql("select status, discount_kind, discount_value::text v, discount_set_by, owner_approved_at, owner_approval_reason r, token, completed_at from public.quotations where id = $1", [Q]))[0];

/** One editor at a time: the previous step's browser held the edit lock (90 s), so each step starts free. */
const freeLock = () => sql("update public.quotations set editing_by = null, editing_at = null where id = $1", [Q]);

async function giveDiscount(page, typed, expect) {
  await page.locator("[data-labour-discount]").first().click();
  const dlg = page.locator("[data-labour-discount-dialog]");
  await dlg.locator("button", { hasText: /^AED$/ }).click();
  const box = dlg.locator('input[aria-label="Discount amount"]');
  await box.click({ clickCount: 3 });
  await box.press("Backspace");
  await box.pressSequentially(String(typed));
  await sleep(1300);
  await dlg.getByRole("button", { name: "Apply" }).click();
  await until(async () => Number((await row())?.v) === expect);
  await sleep(1500);
}

/** "Send quotation" as the person on the page (the quotation is marked complete first, as the advisor would). */
async function send(page) {
  await sql("update public.quotations set completed_at = now() where id = $1", [Q]);
  await go(page, URL);
  await page.getByRole("button", { name: /^Send quotation$/ }).first().click();
  await sleep(3000);
  await page.keyboard.press("Escape").catch(() => null);
}

// ---------------------------------------------------------------- 1. The pop-up fits at every width
{
  await freeLock();
  const { browser, page } = await browserFor("owner", { viewport: { width: 1920, height: 1000 } });
  await go(page, URL);
  await page.locator("[data-labour-discount]").first().click();
  const dlg = page.locator("[data-labour-discount-dialog]");
  await dlg.locator("button", { hasText: /^AED$/ }).click();
  for (const w of [1920, 1366, 1024, 800]) {
    await page.setViewportSize({ width: w, height: 1000 });
    await sleep(300);
    const fit = await page.evaluate(() => {
      const kinds = document.querySelector("[data-discount-kind]");
      const k = kinds.getBoundingClientRect();
      return [...kinds.querySelectorAll("button")].map((b) => { const r = b.getBoundingClientRect(); return { text: b.textContent, inside: r.left >= k.left - 1 && r.right <= k.right + 1, whole: b.scrollWidth <= b.clientWidth + 1, onScreen: r.right <= window.innerWidth }; });
    });
    check(`1 @${w}: % and AED both whole and visible`, fit.length === 2 && fit.every((b) => b.inside && b.whole && b.onScreen) && fit[1].text === "AED", JSON.stringify(fit));
    await dlg.screenshot({ path: path.join(SHOTS, `1-discount-dialog-${w}.png`) });
  }
  await page.keyboard.press("Escape");
  await browser.close();
}

// ---------------------------------------------------------------- 2. An advisor types "5,611": stored exactly, named, above the limit
{
  await freeLock();
  const { browser, page } = await browserFor("service_advisor", { viewport: { width: 1366, height: 1000 } });
  await go(page, URL);
  await giveDiscount(page, "5,611", 5611);
  const q = await row();
  check("2 '5,611' typed with a thousands comma is stored as AED 5,611 exactly", q?.discount_kind === "aed" && Number(q.v) === 5611 && q.discount_set_by === advisor.id, JSON.stringify(q));
  const status = (await page.locator("[data-discount-status]").textContent()) ?? "";
  check("3 the line shows AED 5,611.00 exactly and the % to one decimal as information", /5,611\.00/.test(status) && /46\.8% of labour/.test(status), status);
  check("4 the line names the advisor and the limit", status.includes(advisor.display_name) && /limit/.test(status) && (await page.locator("[data-discount-status]").getAttribute("data-discount-by")) === "advisor", status);
  await page.locator("[data-discount-status]").screenshot({ path: path.join(SHOTS, "2-advisor-line.png") });
  await browser.close();
}

// ---------------------------------------------------------------- 3. The owner presses Apply without changing anything: still the advisor's
{
  await freeLock();
  const { browser, page } = await browserFor("owner", { viewport: { width: 1366, height: 1000 } });
  await go(page, URL);
  await page.locator("[data-labour-discount]").first().click();
  await page.locator("[data-labour-discount-dialog]").getByRole("button", { name: "Apply" }).click();
  await sleep(2500);
  const q = await row();
  check("5 Apply with the same figures changes nothing: the discount is still the advisor's", q?.discount_set_by === advisor.id && Number(q.v) === 5611, JSON.stringify(q));
  await browser.close();
}

// ---------------------------------------------------------------- 4. The advisor sends: it waits for the owner with the exact words
{
  await freeLock();
  const { browser, page } = await browserFor("service_advisor", { viewport: { width: 1366, height: 1000 } });
  await send(page);
  const q = await until(async () => { const r = await row(); return r?.status === "pending_owner" ? r : null; });
  check("6 above the limit the advisor's send waits for the owner", !!q && new RegExp(`^discount AED 5,611\\.00( \\+ round-off AED [\\d.]+)? = 46\\.8% of labour \\(limit ${limit}%\\)$`).test(q.r ?? ""), JSON.stringify(q));
  await browser.close();
}

// ---------------------------------------------------------------- 5. The owner's box: exact amount, who gave it; a box left open is refused
{
  await freeLock();
  const { browser, page } = await browserFor("owner", { viewport: { width: 1366, height: 1000 } });
  await go(page, URL);
  const boxText = (await page.locator("[data-owner-box]").textContent().catch(() => "")) ?? "";
  check("7 the owner's box shows the exact amount and who gave it", /AED 5,611\.00/.test(boxText) && boxText.includes(advisor.display_name), boxText);
  const status = (await page.locator("[data-discount-status]").textContent()) ?? "";
  check("8 the owner sees who gave it (not 'given by the owner')", status.includes(advisor.display_name) && !/given by the owner/.test(status), status);
  await page.screenshot({ path: path.join(SHOTS, "3-owner-sees-advisor-discount.png"), fullPage: false });
  // Meanwhile the figures change (as if the advisor raised the discount and sent again): the open box must not approve it.
  const real = (await row())?.r;
  await sql("update public.quotations set owner_approval_reason = 'discount AED 9,999.00 = 83.3% of labour (limit 15%)' where id = $1", [Q]);
  await page.locator("[data-owner-approve]").click();
  await page.waitForURL((u) => /error=/.test(u.toString()), { timeout: 20000 }).catch(() => null);
  const q1 = await row();
  check("9 a box opened before the figures changed cannot approve them (refused, still waiting)", q1?.status === "pending_owner" && !q1.owner_approved_at && /figures changed/i.test(decodeURIComponent(page.url())), `${JSON.stringify(q1)} ${page.url().slice(-120)}`);
  // Back to the real reason; the owner approves what he sees.
  await sql("update public.quotations set owner_approval_reason = $2 where id = $1", [Q, real]);
  await go(page, URL);
  await page.locator("[data-owner-approve]").click();
  await page.waitForURL((u) => /message=/.test(u.toString()), { timeout: 20000 }).catch(() => null);
  const q2 = await row();
  check("10 the owner approves: back to the advisor, the reason he saw is kept", q2?.status === "draft" && !!q2.owner_approved_at && q2.r === real, JSON.stringify(q2));
  await browser.close();
}

// ---------------------------------------------------------------- 6. The advisor sees "approved by the owner"; a BIGGER discount goes back to the owner
{
  await freeLock();
  const { browser, page } = await browserFor("service_advisor", { viewport: { width: 1366, height: 1000 } });
  await sql("update public.quotations set completed_at = now() where id = $1", [Q]);
  await go(page, URL);
  const st = page.locator("[data-discount-status]");
  check("11 after the owner's approval the advisor's line says 'approved by the owner', no amber warning", (await st.getAttribute("data-discount-approved")) === "" && /approved by the owner/.test((await st.textContent()) ?? "") && (await page.locator("[data-discount-limit-note]").count()) === 0, (await st.textContent()) ?? "");
  await st.screenshot({ path: path.join(SHOTS, "4-approved-line.png") });
  await giveDiscount(page, "6000", 6000);
  await send(page);
  const q = await until(async () => { const r = await row(); return r?.status === "pending_owner" ? r : null; });
  check("12 a bigger discount after the approval goes back to the owner (the approval covered AED 5,611 only)", !!q && /AED 6,000\.00/.test(q.r ?? "") && !q.owner_approved_at, JSON.stringify(q));
  await browser.close();
}

// ---------------------------------------------------------------- 7. The owner's own discount on a waiting quotation: other reasons stay, nothing else approved
{
  // Make the total pass the owner's approval line too (when that setting is on), so a second reason exists.
  // Labour big enough that the total stays above the line after the owner's AED 7,000, small enough that the
  // advisor's AED 6,000 is still above the limit.
  const lo = above / 1.05 + 7000;
  const hi = (6000 * 100) / limit;
  const hours = above > 0 ? Math.ceil((lo + hi) / 2 / 300) : 40;
  if (above > 0) {
    await sql("update public.quotation_lines set hours = $2, quantity = $2 where quotation_id = $1 and line_type = 'labour' and is_active", [Q, hours]);
    await freeLock();
    const { browser, page } = await browserFor("service_advisor", { viewport: { width: 1366, height: 1000 } });
    await go(page, URL);
    // Any change while it waits brings the owner's box up to date (here: Apply with the same figures).
    await page.locator("[data-labour-discount]").first().click();
    await page.locator("[data-labour-discount-dialog]").getByRole("button", { name: "Apply" }).click();
    const q = await until(async () => { const r = await row(); return /Total of/.test(r?.r ?? "") ? r : null; });
    check("13 still waiting: the owner's box is brought up to the new figures (the total too)", !!q && q.status === "pending_owner" && /discount AED 6,000\.00/.test(q.r ?? "") && /Total of/.test(q.r ?? ""), JSON.stringify(q));
    await browser.close();
  }
  await freeLock();
  const { browser, page } = await browserFor("owner", { viewport: { width: 1366, height: 1000 } });
  await go(page, URL);
  await giveDiscount(page, "7000", 7000);
  const q = await until(async () => { const r = await row(); return r && !/discount AED/.test(r.r ?? "") ? r : null; });
  if (above > 0) {
    check("14 the owner's own discount is no longer a reason, but the large total still waits for him (nothing approved by itself)", !!q && q.status === "pending_owner" && /^Total of/.test(q.r ?? "") && !q.owner_approved_at && q.discount_set_by === ownerId, JSON.stringify(q));
    await go(page, URL);
    check("15 the owner's box shows the total only", /Total of/.test((await page.locator("[data-owner-box]").textContent().catch(() => "")) ?? "") && !/discount given by/.test((await page.locator("[data-owner-box]").textContent().catch(() => "")) ?? ""));
    await page.locator("[data-owner-approve]").click();
    await page.waitForURL((u) => /message=/.test(u.toString()), { timeout: 20000 }).catch(() => null);
  } else {
    check("14 with nothing else to approve, the owner's own discount sends it back to the advisor", !!q && q.status === "draft" && !q.r && !q.owner_approved_at, JSON.stringify(q));
  }
  await go(page, URL);
  const s2 = (await page.locator("[data-discount-status]").textContent()) ?? "";
  check("16 'given by the owner (no limit)' on the line", /given by the owner \(no limit\)/.test(s2) && /7,000\.00/.test(s2), s2);
  await page.locator("[data-discount-status]").screenshot({ path: path.join(SHOTS, "5-owner-line.png") });
  await browser.close();
}

// ---------------------------------------------------------------- 8. The advisor sends: the owner's discount needs nobody's approval
{
  await freeLock();
  const { browser, page } = await browserFor("service_advisor", { viewport: { width: 1366, height: 1000 } });
  await send(page);
  const q = await until(async () => { const r = await row(); return r?.token && r.status === "draft" ? r : null; });
  check("17 the advisor's send goes through: the owner's own discount is not a reason", !!q && q.status === "draft" && !!q.token, JSON.stringify(await row()));
  await browser.close();
}

// ---------------------------------------------------------------- 9. A new version keeps who gave the discount
{
  await sql("update public.quotations set status = 'sent', sent_at = now() where id = $1", [Q]);
  await freeLock();
  const { browser, page } = await browserFor("service_advisor", { viewport: { width: 1366, height: 1000 } });
  await go(page, URL);
  const bar = page.locator("form [data-revise-bar]").first();
  if (await bar.count()) {
    await bar.click();
    const v2 = await until(async () => (await sql("select id, discount_kind, discount_value::text v, discount_set_by from public.quotations where parent_id = $1 order by version desc limit 1", [Q]))[0] ?? null);
    check("18 the next version keeps the discount AND who gave it (the owner)", !!v2 && Number(v2.v) === 7000 && v2.discount_set_by === ownerId, JSON.stringify(v2));
  } else check("18 the next version keeps who gave the discount", false, "no Revise button for the advisor");
  await browser.close();
}

// ---------------------------------------------------------------- 10. The estimate page has the same box
const EID = "22222222-0000-4000-8000-00000000e360";
const cust = (await sql("select customer_id, vehicle_id from public.jobs where id = $1", [seed.jobId]))[0];
await sql("insert into public.quotations (id, kind, number, version, customer_id, vehicle_id, status, owner_approval_reason, discount_set_by, created_by, updated_by) values ($1, 'estimate', 'E-STAGE-B3', 1, $2, $3, 'pending_owner', 'discount AED 900.00 = 15.0% of labour (limit 10%)', $4, $4, $4) on conflict (id) do update set status = 'pending_owner', owner_approval_reason = excluded.owner_approval_reason, discount_set_by = excluded.discount_set_by", [EID, cust.customer_id, cust.vehicle_id, advisor.id]);
{
  const { browser, page } = await browserFor("owner", { viewport: { width: 1366, height: 1000 } });
  await go(page, `${base}/estimates/${EID}`);
  check("19 an estimate waiting for the owner shows the approval box", (await page.locator("[data-owner-box]").count()) === 1 && /900\.00/.test((await page.locator("[data-owner-box]").textContent()) ?? ""));
  await browser.close();
}

cleanupDb();
process.exit(summary() ? 1 : 0);
