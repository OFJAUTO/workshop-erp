// Fix 2 of 4 November 2026: LPO resend after refusal, the approval always current, parts-desk delete at any
// stage, no forced revision on approved quotations, and the gate-in read-only view.
//   A. Peter sends the main LPO (3 parts) for approval.
//   B. He deletes one WHILE it waits: the LPO line is cut, the total moves, the approvers hear "updated after
//      sending", and the approval page says so - the owner never decides on a stale list.
//   C. The owner REFUSES with a reason. The Parts page shows the refused card with the reason and "Send for
//      approval again" - no dead end. Peter deletes another part, resends: the new version carries the number
//      with V2 and the CURRENT list, and the owner's page shows what changed against the refused list, highlighted.
//   D. The owner approves V2; the supplier LPO splits with the V2 number. Deleting the ordered part: the ⋯
//      ending window opens with "Cancelled with the supplier" PRE-SELECTED and saves with one tap (no typing);
//      the bulk Delete does the same for a ticked ordered part, named in the one confirm ("Delete 1 part on J-…?").
//   E. Deleting a part that sits on the APPROVED quotation: no owner ask, no advisor task, no notification -
//      the approved line and the customer's price stay, and the job card shows the quiet "removed after approval" line.
//   F. The gate-in login sees the dashboard read-only (cars + stages, no customer name, no money) and the
//      inspection report read-only; the job card and money pages refuse it.
// Run: node --env-file=.env.test.local tests/browser/test-fix2.mjs   (test server on 3102: npm run test:server)
import path from "node:path";
import { mkdirSync } from "node:fs";
import { api, base, browserFor, browserForId, cleanupDb, go, here, makeChecks, sleep, sql, submitted, sendLpo } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const dir = path.join(here, "shots", "fix2");
mkdirSync(dir, { recursive: true });
const shot = (name) => path.join(dir, name);
const text = async (loc) => ((await loc.first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
const until = async (fn, tries = 60, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const rowOf = (page, name) => page.locator("[data-row-key]").filter({ has: page.locator("[data-part-name]", { hasText: new RegExp(name, "i") }) }).first();

const ID = (n) => `22222222-0000-4000-8000-00000000ef${n}`;
const P1 = ID("01"), P2 = ID("02"), P3 = ID("03");
const SUPPLIER = "E2E FIX2 SUPPLIER";
const t0 = new Date().toISOString();

cleanupDb();
const seed = await api("/api/e2e/stage", { stage: "approved" });
const jobId = seed.json?.jobId;
if (!jobId) { console.error("seed failed:", JSON.stringify(seed).slice(0, 300)); process.exit(1); }
const [{ job_number: jobNumber }] = await sql("select job_number from public.jobs where id = $1", [jobId]);
const [{ id: seedPartId }] = await sql("select id from public.part_items where job_id = $1 and description ilike '%brake pads%' limit 1", [jobId]);
// The seed's own part (approved, no supplier) stays OFF the LPO path: section E deletes it as a plain row.
await sql("update public.part_items set order_status = 'none' where id = $1", [seedPartId]);

// Three parts of our own, priced To order from one supplier (the seed's own part stays off the LPO: order none).
for (const [id, name, cost] of [[P1, "E2E FILTER ALPHA", 100], [P2, "E2E FILTER BRAVO", 200], [P3, "E2E FILTER CHARLIE", 300]]) {
  await sql(
    "insert into public.part_items (id, job_id, description, quantity, confirmed_quantity, part_type, cost_aed, supplier, availability, delivery_date, order_status, confirm_status, priced_at) values ($1, $2, $3, 1, 1, 'genuine', $4, $5, 'to_order', (now() + interval '2 days')::date, 'to_order', 'confirmed', now()) on conflict (id) do nothing",
    [id, jobId, name, cost, SUPPLIER],
  );
}
const made = await sql("select id from public.part_items where id = any(array[$1, $2, $3]::uuid[])", [P1, P2, P3]);
if (made.length !== 3) { console.error("part seed failed (the sql route hides errors): got", made.length); process.exit(1); }

const partsUser = (await sql("select id from public.staff where role_id = 'parts' and is_active order by created_at limit 1"))[0];
const { browser: pb, page: pp } = await browserForId(partsUser.id, { viewport: { width: 1440, height: 900 } });

/* ---------------- A. Send the main LPO for approval ---------------- */
await go(pp, `${base}/parts/${jobId}`);
await sendLpo(pp);
const po = await until(() => sql("select id, number, total_cost_aed from public.purchase_orders where job_id = $1 and kind = 'main' and status = 'pending_approval'", [jobId]).then((r) => r[0] ?? null));
if (!po) { console.error("send failed; page url:", pp.url()); process.exit(1); }
check("A1: the main LPO waits for approval with 3 lines", !!po && (await sql("select count(*)::int as n from public.purchase_order_lines where po_id = $1 and is_active", [po.id]))[0].n === 3, po?.number);

/* ---------------- B. Deleting while it waits keeps the approval current ---------------- */
await rowOf(pp, "E2E FILTER ALPHA").locator("[data-row-select]").check();
await pp.locator("[data-delete-all]").click();
const confirmTitle = await text(pp.locator("[data-delete-confirm-title]"));
check(`B1: the one question names the count and the job ("Delete 1 part on ${jobNumber}?")`, confirmTitle === `Delete 1 part on ${jobNumber}?`, confirmTitle);
await pp.screenshot({ path: shot("b1-delete-confirm.png"), clip: (await pp.locator("[data-delete-confirm]").boundingBox()) ?? undefined });
await pp.locator("[data-delete-confirm-yes]").click();
const cut = await until(() => sql("select l.is_active from public.purchase_order_lines l where l.po_id = $1 and l.part_item_id = $2", [po.id, P1]).then((r) => (r[0] && r[0].is_active === false ? r[0] : null)));
check("B2: the pending LPO's line is cut at once", !!cut);
const afterCut = await until(() => sql("select total_cost_aed from public.purchase_orders where id = $1", [po.id]).then((r) => (Number(r[0]?.total_cost_aed) === 500 ? r[0].total_cost_aed : null)), 30);
check("B3: the LPO total moved (500 = 200 + 300)", Number(afterCut) === 500, String(afterCut));
const told = await until(() => sql("select title from public.notifications where created_at > $1 and title like $2 limit 1", [t0, `${po.number} updated after sending%`]).then((r) => r[0] ?? null));
check("B4: the approvers hear \"updated after sending\"", !!told, told?.title);
await go(pp, `${base}/parts/${jobId}`);
check("B5: the Parts page shows the Updated-after-sending badge", (await pp.locator("[data-lpo-updated-after-sending]").count()) === 1);

const { browser: ob, page: op } = await browserFor("owner", { viewport: { width: 1440, height: 900 } });
await go(op, `${base}/parts/orders/${po.id}`);
check("B6: the owner's approval page says what changed after sending", /removed: E2E FILTER ALPHA/i.test(await text(op.locator("[data-lpo-updated-note]"))));
await op.screenshot({ path: shot("b6-approval-updated.png"), fullPage: true });

/* ---------------- C. Refusal is not a dead end: reason shown, edit, send again as V2 ---------------- */
await op.locator("textarea[name='note']").fill("Too dear, get another quote");
await op.locator("button[name='decision'][value='refuse']").click();
await submitted(op);
const [{ status: refusedStatus }] = await sql("select status from public.purchase_orders where id = $1", [po.id]);
check("C1: the refused LPO is closed", refusedStatus === "cancelled");
await go(pp, `${base}/parts/${jobId}`);
check("C2: Peter sees the refused card with the owner's reason", /Too dear, get another quote/.test(await text(pp.locator("[data-refused-reason]"))));
await pp.screenshot({ path: shot("c2-refused-card.png"), clip: (await pp.locator("[data-refused-lpo]").boundingBox()) ?? undefined });

// Peter edits the list: BRAVO goes; then he sends again.
await rowOf(pp, "E2E FILTER BRAVO").locator("[data-row-select]").check();
await pp.locator("[data-delete-all]").click();
await pp.locator("[data-delete-confirm-yes]").click();
await until(() => sql("select 1 from public.part_items where id = $1 and is_active = false", [P2]).then((r) => r[0] ?? null));
await pp.locator("[data-resend-lpo]").click();
await submitted(pp);
const v2 = await until(() => sql("select id, number from public.purchase_orders where job_id = $1 and kind = 'main' and status = 'pending_approval'", [jobId]).then((r) => r[0] ?? null));
check("C3: the new version carries the refused number with V2", !!v2 && v2.number === `${po.number} V2`, v2?.number);
const [{ n: v2lines }] = await sql("select count(*)::int as n from public.purchase_order_lines where po_id = $1 and is_active", [v2.id]);
check("C4: V2 carries the CURRENT list (1 line: CHARLIE)", v2lines === 1);
const [{ superseded_by: sup }] = await sql("select superseded_by from public.purchase_orders where id = $1", [po.id]);
check("C5: the refused LPO is put away (superseded by V2)", sup === v2.id);

await go(op, `${base}/parts/orders/${v2.id}`);
check("C6: the owner sees the diff against the refused list, highlighted", (await op.locator("[data-lpo-diff]").count()) === 1 && /E2E FILTER BRAVO/i.test(await text(op.locator("[data-lpo-diff-removed]"))));
await op.screenshot({ path: shot("c6-diff.png"), clip: (await op.locator("[data-lpo-diff]").boundingBox()) ?? undefined });

/* ---------------- D. Approve V2; delete an ORDERED part with one tap ---------------- */
await op.getByRole("button", { name: "Approve", exact: true }).click();
await op.locator("[data-confirm-yes-money]").click({ timeout: 8000 }).catch(() => null);
await submitted(op);
const split = await until(() => sql("select id, number, status from public.purchase_orders where parent_id = $1", [v2.id]).then((r) => r[0] ?? null));
check("D1: the supplier LPO splits with the V2 number", !!split && split.number === `${po.number} V2-1`, split?.number);

// The ending window pre-selects "Cancelled with the supplier"; Save works with nothing typed (one tap).
await go(pp, `${base}/parts/${jobId}`);
const row3 = rowOf(pp, "E2E FILTER CHARLIE");
await row3.scrollIntoViewIfNeeded().catch(() => {});
await row3.locator("button[aria-label='More for this part']").click();
await pp.getByRole("button", { name: /Remove: not needed \(ordered: choose its ending\)/ }).click();
const dialog = pp.locator("[data-end-dialog]");
await dialog.waitFor({ timeout: 10000 });
check("D2: \"Cancelled with the supplier\" is pre-selected", (await dialog.locator("[data-end-option='cancelled'][aria-pressed='true']").count()) === 1);
await pp.screenshot({ path: shot("d2-end-preselected.png"), clip: (await dialog.boundingBox()) ?? undefined });
check("D3: Save is enabled with nothing typed (one tap)", (await dialog.locator("[data-end-save]:not([disabled])").count()) === 1);
await dialog.locator("[data-end-save]").click();
await dialog.locator("[data-end-done]").waitFor({ timeout: 20000 });
await dialog.locator("[data-end-close]").click();
const [{ disposition: d3 }] = await sql("select disposition from public.part_items where id = $1", [P3]);
check("D4: the part ended as cancelled with the supplier", d3 === "cancelled");

/* ---------------- E. Deleting a part on the APPROVED quotation is quiet ---------------- */
const beforeLine = await sql("select l.id, l.is_active from public.quotation_lines l join public.quotations q on q.id = l.quotation_id where l.part_item_id = $1 and q.status = 'approved'", [seedPartId]);
check("E1: the seed part sits on the approved quotation", beforeLine.length === 1 && beforeLine[0].is_active === true);
const tE = new Date().toISOString();
await go(pp, `${base}/parts/${jobId}`);
await rowOf(pp, "brake pads").locator("[data-row-select]").check();
await pp.locator("[data-delete-all]").click();
check("E2: the confirm says the approved line stays", /approved quotation stays/i.test(await text(pp.locator("[data-delete-confirm]"))));
await pp.locator("[data-delete-confirm-yes]").click();
await until(() => sql("select 1 from public.part_items where id = $1 and is_active = false", [seedPartId]).then((r) => r[0] ?? null));
const afterLine = await until(() => sql("select l.is_active, l.quotation_id, q.number, q.version, q.status from public.quotation_lines l join public.quotations q on q.id = l.quotation_id where l.part_item_id = $1", [seedPartId]).then((r) => (r.length ? r : null)), 20);
check("E3: the approved quotation's line is untouched (customer price unchanged)", !!afterLine && afterLine.length === 1 && afterLine[0].is_active === true, JSON.stringify(afterLine));
const quietEvent = await until(() => sql("select note from public.job_events where job_id = $1 and event_type = 'parts_removed_after_approval'", [jobId]).then((r) => r[0] ?? null));
check("E4: the quiet event is written", !!quietEvent && /after approval/.test(quietEvent.note));
const noise = await sql("select title from public.notifications where created_at > $1 and (title ilike '%revise%' or title ilike '%part removed%' or type = 'revision_request')", [tE]);
check("E5: no task and no notification to anyone", noise.length === 0, JSON.stringify(noise).slice(0, 120));
const asks = await sql("select 1 from public.quotations q where q.job_id = $1 and q.revision_requested_at > $2", [jobId, tE]);
check("E6: no revision ask on the quotation", asks.length === 0);
await go(op, `${base}/jobs/${jobId}`);
const quiet = await text(op.locator("[data-parts-removed-line]"));
check("E7: the job card's quotation box shows the quiet line", /1 part removed by .+ after approval/.test(quiet), quiet);
await op.locator("[data-parts-removed-line]").scrollIntoViewIfNeeded();
await op.screenshot({ path: shot("e7-quiet-line.png"), clip: (await op.locator("[data-quotation-list]").boundingBox()) ?? undefined });

/* ---------------- F. Gate-in: read-only board and reports, nothing else ---------------- */
const [{ full_name: custName }] = await sql("select c.full_name from public.customers c join public.jobs j on j.customer_id = c.id where j.id = $1", [jobId]);
const { browser: gb, page: gp } = await browserFor("gate_in", { viewport: { width: 1280, height: 900 } });
await go(gp, `${base}/dashboard`);
check("F1: the gate-in login opens the read-only board", (await gp.locator("[data-gatein-board]").count()) === 1 && (await gp.locator(`[data-gatein-car="${jobNumber}"]`).count()) === 1);
const body = (await gp.textContent("body")) ?? "";
check("F2: no customer name on the board", !!custName && !body.includes(custName), custName);
check("F3: no money on the board", !/AED\s*[\d,]/.test(body));
await gp.screenshot({ path: shot("f1-gatein-board.png"), fullPage: true });
await gp.locator(`[data-gatein-car="${jobNumber}"] [data-gatein-report]`).click();
await gp.waitForURL(/\/inspection/, { timeout: 15000 });
const insBody = (await gp.textContent("body")) ?? "";
check("F4: the inspection report opens read-only (no approve/send-back decision anywhere)", (await gp.getByRole("button", { name: /approve|send back/i }).count()) === 0 && /inspection/i.test(insBody));
check("F5: no customer name on the report either", !insBody.includes(custName));
await gp.screenshot({ path: shot("f4-gatein-report.png"), fullPage: false });
await go(gp, `${base}/jobs/${jobId}`);
check("F6: the job card refuses the gate-in login", !new RegExp(`/jobs/${jobId}$`).test(gp.url()), gp.url());
await go(gp, `${base}/invoices`);
check("F7: the money pages refuse it too", !/\/invoices/.test(gp.url()), gp.url());

await pb.close(); await ob.close(); await gb.close();
cleanupDb();
process.exit(summary() ? 1 : 0);
