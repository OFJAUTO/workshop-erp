// 13 November 2026: CHECK BEFORE YOU SEND. An LPO with a clean set of parts goes in one tap; one with a part at AED 1, a
// placeholder part number and a quantity different from the quote shows all three highlighted and cannot go until "I
// checked the highlighted lines" is ticked; "Go back and edit" returns with nothing lost; each confirmation is logged and
// the approver sees the same flags. TEST only.
//   node --env-file=.env.test.local tests/browser/test-sendcheck.mjs
import fs from "node:fs";
import path from "node:path";
import { api, base, browserFor, cleanupDb, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-13-check-before-send";
fs.mkdirSync(OUT, { recursive: true });
const until = async (fn, tries = 60, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const text = async (page, sel) => (((await page.locator(sel).first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim());
const day = (n) => new Date(Date.now() + 4 * 3600000 + n * 86400000).toISOString().slice(0, 10);

try {
  cleanupDb();
  // The car: the stage seed's own part (clean) and a second part that the quote priced at 1 piece.
  const q = (await api("/api/e2e/stage", { stage: "quote" })).json;
  const JOB = q.jobId, QID = q.quotationId;
  const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active limit 1"))[0].id;
  const P2 = (await sql("insert into public.part_items (job_id, description, part_number, quantity, confirmed_quantity, cost_aed, cost_confirmed_aed, cost_confirmed_at, availability, delivery_date, supplier, confirm_status, part_type, priced_by, priced_at, order_status) values ($1, 'E2E BRAKE DISC', 'DISC', 1, 1, 1, 1, now(), 'to_order', $2::date, 'E2E Check Supplier', 'confirmed', 'genuine', $3, now(), 'none') returning id", [JOB, day(2), owner]))[0].id;
  await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, unit_cost, markup_percent, unit_price, part_item_id, part_type, created_by, updated_by) values ($1, 5, 'part', 'E2E BRAKE DISC', 'manual', 1, 1, 50, 1.5, $2, 'genuine', $3, $3)", [QID, P2, owner]);
  await api("/api/e2e/stage", { stage: "approved" });
  const PA = (await sql("select part_item_id from public.quotation_lines where quotation_id = $1 and line_type = 'part' and part_item_id <> $2", [QID, P2]))[0].part_item_id;
  // After approval: the clean part gets a real part number and supplier; the second now needs 2 (the quote said 1).
  await sql("update public.part_items set part_number = 'A1673306800', supplier = 'E2E Check Supplier', availability = 'to_order', delivery_date = $2::date, cost_confirmed_aed = cost_aed, cost_confirmed_at = now() where id = $1", [PA, day(3)]);
  await sql("update public.part_items set confirmed_quantity = 2, quantity = 2, order_status = 'to_order' where id = $1", [P2]);
  await sql("update public.part_requests set status = 'closed' where job_id = $1 and status = 'open'", [JOB]);

  const parts = await browserFor("parts", { viewport: { width: 1440, height: 1100 } });
  await go(parts.page, `${base}/parts/${JOB}#lpo`);
  check("0: both parts can be ticked for the LPO", (await parts.page.locator(`[data-lpo-pick="${PA}"]:not([disabled])`).count()) === 1 && (await parts.page.locator(`[data-lpo-pick="${P2}"]:not([disabled])`).count()) === 1);

  // 1. Clean: one tap.
  await parts.page.locator(`[data-lpo-pick="${PA}"]`).check();
  await parts.page.locator("[data-send-lpo-selected]").click();
  const win = parts.page.locator("[data-check-send]");
  await win.waitFor({ timeout: 15000 });
  check("1a: the window shows the supplier, part number, quantity, price, total incl. VAT and delivery", /E2e Check Supplier|E2E Check Supplier/i.test(await text(parts.page, "[data-check-group]")) && /A1673306800/.test(await text(parts.page, `[data-check-line="${PA}"]`)) && /incl\. VAT|VAT/.test(await text(parts.page, "[data-check-total]")) && (await parts.page.locator("[data-check-delivery]").count()) === 1);
  check("1b: nothing flagged: no tick asked, YES is ready", (await win.getAttribute("data-check-flagged")) === "0" && (await parts.page.locator("[data-check-tick]").count()) === 0 && (await parts.page.locator("[data-check-yes]").isEnabled()));
  await win.locator("div[role=dialog]").screenshot({ path: path.join(OUT, "1-clean-one-tap-1440.png") }).catch(() => parts.page.screenshot({ path: path.join(OUT, "1-clean-one-tap-1440.png") }));
  await parts.page.locator("[data-check-yes]").click();
  const lpo = await until(async () => (await sql("select po_id from public.part_items where id = $1 and po_id is not null", [PA]))[0]);
  check("1c: one tap sent it for approval", !!lpo);

  // 2. Flagged: AED 1, a placeholder part number, a quantity different from the quote - all three highlighted.
  await go(parts.page, `${base}/parts/${JOB}#lpo`);
  await parts.page.locator(`[data-lpo-pick="${P2}"]`).check();
  await parts.page.locator("[data-send-lpo-selected]").click();
  await win.waitFor({ timeout: 15000 });
  const flagsText = await text(parts.page, `[data-check-line="${P2}"]`);
  check("2a: the line is highlighted with the AED 1 price", /AED 1\.00 looks like a typing slip/.test(flagsText), flagsText);
  check("2b: … the placeholder part number", /Part number "DISC" is a word/.test(flagsText), flagsText);
  check("2c: … and the quantity different from the quote", /Quantity 2 but the customer's quote says 1/.test(flagsText), flagsText);
  check("2d: it cannot be sent until \"I checked the highlighted lines\" is ticked", (await parts.page.locator("[data-check-tick]").count()) === 1 && !(await parts.page.locator("[data-check-yes]").isEnabled()));
  await parts.page.screenshot({ path: path.join(OUT, "2-flagged-needs-tick-1440.png") });
  await parts.page.setViewportSize({ width: 800, height: 1280 });
  await sleep(400);
  await parts.page.screenshot({ path: path.join(OUT, "2-flagged-needs-tick-800.png") });
  await parts.page.setViewportSize({ width: 1440, height: 1100 });

  // 3. Go back and edit: nothing lost.
  await parts.page.locator("[data-check-back]").click();
  await sleep(400);
  check("3: Go back and edit closes it; the tick on the part is still there (nothing lost)", (await win.count()) === 0 && (await parts.page.locator(`[data-lpo-pick="${P2}"]`).isChecked()));
  check("3b: and nothing was sent", (await sql("select po_id from public.part_items where id = $1", [P2]))[0]?.po_id === null);

  // 4. Ticked: sent; the confirmation is logged with its flags; the approver sees them.
  await parts.page.locator("[data-send-lpo-selected]").click();
  await win.waitFor({ timeout: 15000 });
  await parts.page.locator("[data-check-tick] input").check();
  await parts.page.locator("[data-check-yes]").click();
  const sent = await until(async () => (await sql("select po_id from public.part_items where id = $1 and po_id is not null", [P2]))[0]);
  check("4a: ticked: it goes", !!sent);
  const logs = await sql("select kind, flag_count, flags from public.send_checks where $1 = any(part_ids) or $2 = any(part_ids) order by created_at", [PA, P2]);
  check("4b: each confirmation is logged (who, when, which flags)", logs.length === 2 && logs[0].flag_count === 0 && logs[1].flag_count >= 3, JSON.stringify(logs.map((l) => [l.kind, l.flag_count])));
  const own = await browserFor("owner", { viewport: { width: 1440, height: 1100 } });
  await go(own.page, `${base}/parts/orders/${sent.po_id}`);
  const seen = await text(own.page, "[data-sent-check]");
  check("4c: the approver sees the same flags on the LPO", /E2E BRAKE DISC/.test(seen) && /typing slip/.test(seen), seen.slice(0, 200));
  await own.page.locator("[data-sent-check]").screenshot({ path: path.join(OUT, "4-approver-sees-flags-1440.png") });
  await own.browser.close();
  await parts.browser.close();
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
