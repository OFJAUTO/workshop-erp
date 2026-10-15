// Proof for the list of 15 October 2026: revise a sent quotation (A2), credit terms (B1), no jumping while typing (B2),
// damage note chips (B3), wheel order (B4), Materials hidden on mechanical jobs (B5), the software items (B6), clocks that
// leave out breaks and after-hours (B7), Minor and Major service as services (B8), capitals (B9), Labour charges (B10),
// the discount scope (B11), sticker sizes (B12), the markup reminder (B13), removing a job with its parts (B14) and the
// parts step bar (B15).
// Run against `npx next dev -p 3100`:  node --env-file=.env.local tests/browser/test-k.mjs
import fs from "node:fs";
import path from "node:path";
import { api, base, browserFor, cleanupDb, cookieHeader, go, makeChecks, projectRoot, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 18 * 60 * 1000).unref();
cleanupDb();

const until = async (fn, tries = 60, ms = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } return null; };
const afterSubmit = async (page) => { const before = page.url(); await page.waitForURL((u) => u.toString() !== before, { timeout: 30000 }).catch(() => null); await sleep(600); };
const shot = (page, name) => page.screenshot({ path: path.join(projectRoot, "tests", "browser", "shots", `${name}.png`) }).catch(() => null);
async function section(name, fn) {
  console.log(`\n== ${name}`);
  try { await fn(); } catch (e) { check(`${name}: no crash`, false, String(e?.message ?? e).slice(0, 300)); }
}
async function pdfText(buf) {
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  let text = "";
  for (let i = 0; i < doc.countPages(); i++) text += doc.loadPage(i).toStructuredText("preserve-whitespace").asText() + "\n";
  return text;
}
async function fetchAs(pathname, role) {
  const res = await fetch(`${base}${pathname}`, { headers: { cookie: await cookieHeader(role) } });
  return { status: res.status, buf: res.ok ? Buffer.from(await res.arrayBuffer()) : null };
}
/** The total the customer sees on the link (the live figure from the lines), then the approval with that figure. */
const linkTotal = async (token) => { const t = pageText(await (await fetch(`${base}/quote/${token}`)).text()); const m = t.match(/Total including VAT\s*AED\s?([\d,]+(?:\.\d{2})?)/i); return m ? Number(m[1].replace(/,/g, "")) : 0; };
const approveViaLink = async (token, amount) => fetch(`${base}/api/quote/${token}`, { method: "POST", body: new URLSearchParams({ action: "approve", approver_name: "Stage Customer", agree: "on", approved_amount: String(amount) }), redirect: "manual" });
const pageText = (html) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const CUST = "22222222-0000-4000-8000-00000000e301";

/* ---------------- 1. The quote builder: pinned pickers, Materials hidden, the discount scope, the markup reminder, revise, remove with parts, steps ---------------- */
let jobId = null;
let v1 = null;
let v2 = null;
let token = null;
await section("1 quote builder and revision", async () => {
  const seed = await api("/api/e2e/stage", { stage: "quote" });
  ({ jobId, quotationId: v1, token } = seed.json);
  check("seed: a draft quotation with a labour line and a part", !!jobId && !!v1 && !!token, JSON.stringify(seed.json ?? seed.text).slice(0, 120));
  const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0]?.id;
  const { browser, page } = await browserFor("owner", { viewport: { width: 1366, height: 900 } });
  await go(page, `${base}/jobs/${jobId}/quote/${v1}`);
  await until(async () => ((await page.locator("[data-labour-boxes]").count()) ? 1 : null), 30, 500);

  // B5: no Materials line on a mechanical job.
  check("B5: the Materials line is not on a mechanical quotation", (await page.locator("[data-materials]").count()) === 0);

  // B8/B10: the pickers put Labour charges first, and Minor and Major service first among the services.
  await page.locator("button[aria-label='Open the labour jobs list']").first().click();
  const labourText = await until(async () => { const t = await page.locator("[role='dialog']").first().textContent().catch(() => null); return /labour charges/i.test(t ?? "") ? t : null; }, 20, 300);
  const idxLabour = (labourText ?? "").search(/labour charges/i);
  const idxBrake = (labourText ?? "").search(/brake pad replacement/i);
  check("B10: LABOUR CHARGES is the first item in the Labour picker", idxLabour >= 0 && (idxBrake < 0 || idxLabour < idxBrake), `${idxLabour} vs ${idxBrake}`);
  check("B8: Minor and Major service are not in the Labour picker", !/minor service|major service/i.test(labourText ?? ""));
  await page.locator("[role='dialog'] button[aria-label='Close']").first().click();
  await sleep(300);
  await page.locator("button", { hasText: /^\+ Add line$/ }).click();
  const svcBtn = page.locator("button", { hasText: /^Service$/ }).first();
  if (await svcBtn.count()) await svcBtn.click();
  await until(async () => ((await page.locator("button[aria-label='Open the services list']").count()) ? 1 : null), 30, 400);
  const arrow = page.locator("button[aria-label='Open the services list']").last();
  if (await arrow.count()) await arrow.click();
  const svcText = await until(async () => { const t = await page.locator("[role='dialog']").first().textContent().catch(() => null); return /minor service/i.test(t ?? "") ? t : null; }, 20, 300);
  const iMinor = (svcText ?? "").search(/minor service/i), iMajor = (svcText ?? "").search(/major service/i), iOther = (svcText ?? "").search(/fuel injector service/i);
  check("B8: MINOR SERVICE and MAJOR SERVICE sit at the top of the Services picker (minor at AED 750)", iMinor >= 0 && iMajor >= 0 && (iOther < 0 || (iMinor < iOther && iMajor < iOther)) && /750/.test(svcText ?? ""), `${iMinor}/${iMajor}/${iOther}`);
  await page.locator("[role='dialog'] button[aria-label='Close']").first().click();
  await sleep(300);
  // The empty line added for the picker check goes.
  const empty = (await sql("select id from public.quotation_lines where quotation_id = $1 and is_active and coalesce(title, '') = '' and line_type in ('labour', 'package')", [v1]));
  for (const e of empty) await sql("update public.quotation_lines set is_active = false where id = $1", [e.id]);
  await page.reload();
  await until(async () => ((await page.locator("[data-labour-boxes]").count()) ? 1 : null), 30, 500);

  // B11: the discount scope.
  await page.locator("[data-labour-discount]").click();
  await until(async () => ((await page.locator("[data-discount-scope]").count()) ? 1 : null), 20, 300);
  check("B11: the Discount box offers Labour only and Labour + services", (await page.locator("[data-discount-scope] button").count()) === 2);
  await page.locator("[data-discount-scope] button", { hasText: /Labour \+ services/ }).click();
  await page.locator("[data-labour-discount-dialog] input[aria-label='Discount amount']").fill("10");
  await page.locator("[data-labour-discount-dialog] button", { hasText: /^Apply$/ }).click();
  const scoped = await until(async () => { const r = (await sql("select discount_scope, discount_kind, discount_value from public.quotations where id = $1", [v1]))[0]; return r?.discount_scope === "labour_services" && Number(r?.discount_value) === 10 ? r : null; }, 30, 500);
  check("B11: the scope and the 10% save on the quotation", !!scoped, JSON.stringify(scoped));
  await until(async () => (/Labour and services discount/.test((await page.locator("[data-labour-discount-row]").textContent().catch(() => "")) ?? "") ? 1 : null), 20, 500);
  check("B11: the summary row reads 'Labour and services discount (10%)'", /Labour and services discount \(10%\)/.test((await page.locator("[data-labour-discount-row]").textContent().catch(() => "")) ?? ""), (await page.locator("[data-labour-discount-row]").textContent().catch(() => "")) ?? "");

  // B13: the parts markup at the minimum: the reminder, then Continue anyway (logged).
  await sql("update public.quotation_lines set markup_percent = 5, unit_price = 210 where quotation_id = $1 and line_type = 'part'", [v1]);
  await sql("update public.part_requests set status = 'rejected', removed_at = now(), removed_reason = 'E2e: closed for the test' where job_id = $1 and status = 'open'", [jobId]);
  await sql("update public.inspections set estimated_hours_manager = coalesce(estimated_hours_manager, estimated_hours, 2) where job_id = $1", [jobId]);
  await sql("update public.jobs set parts_pricing_done_at = now(), parts_pricing_reopened_at = null where id = $1", [jobId]);
  await page.reload();
  await until(async () => ((await page.locator("[data-labour-boxes]").count()) ? 1 : null), 30, 500);
  await page.locator("button", { hasText: /^Quotation complete$/ }).click();
  const asked = await until(async () => ((await page.locator("[data-markup-ask]").count()) ? 1 : null), 30, 500);
  const stateNow = (await sql("select completed_at, markup_skipped_at, (select string_agg(markup_percent::text, ',') from public.quotation_lines l where l.quotation_id = q.id and l.line_type = 'part' and l.is_active) as markups from public.quotations q where id = $1", [v1]))[0];
  check("B13: 'Parts markup is still at the minimum 5%. Set it now?' appears once", !!asked, `${JSON.stringify(stateNow)} · ${(await page.locator("[data-blocker], .border-red-bar").allTextContents().catch(() => [])).join(" | ").slice(0, 200)} · ${String(await page.textContent("body")).match(/Not complete yet[^.]*|part requests still with Parts|not yet agreed[^.]*/)?.[0] ?? "no error text"}`);
  if (asked) {
    check("B13: the question offers Set markup and Continue anyway", (await page.locator("[data-markup-set]").count()) === 1 && (await page.locator("[data-markup-continue]").count()) === 1);
    await page.locator("[data-markup-continue]").click();
    const logged = await until(async () => { const r = (await sql("select markup_skipped_at, completed_at from public.quotations where id = $1", [v1]))[0]; return r?.markup_skipped_at && r?.completed_at ? r : null; }, 40, 500);
    check("B13: Continue anyway is logged (who and when) and the quotation completes without approval", !!logged?.markup_skipped_at && !!logged?.completed_at, JSON.stringify(logged));
  }

  // A2: send v1, the customer approves, then Revise quotation.
  await sql("update public.quotations set status = 'sent', sent_at = now(), sent_by = $2 where id = $1", [v1, owner]);
  const total1 = await linkTotal(token);
  const ap1 = await approveViaLink(token, total1);
  const q1 = (await sql("select status from public.quotations where id = $1", [v1]))[0];
  check("A2: version 1 is approved on the link", ap1.status < 400 && q1?.status === "approved", `${ap1.status} ${q1?.status}`);
  const jobAfter1 = (await sql("select status from public.jobs where id = $1", [jobId]))[0];
  await page.reload();
  await until(async () => ((await page.locator("[data-revise]").count()) ? 1 : null), 30, 500);
  check("A2: the sent, approved quotation shows a clear 'Revise quotation' button", (await page.locator("[data-revise]").count()) === 1);
  await page.locator("[data-revise]").click();
  await page.waitForURL((u) => !u.toString().includes(v1), { timeout: 30000 }).catch(() => null);
  v2 = page.url().match(/\/quote\/([0-9a-f-]{36})/)?.[1] ?? null;
  const v2row = v2 ? (await sql("select version, status, discount_scope, discount_value from public.quotations where id = $1", [v2]))[0] : null;
  check("A2: Revise opens version 2 as a draft with everything copied in (discount included)", !!v2 && v2 !== v1 && Number(v2row?.version) === 2 && v2row?.status === "draft" && v2row?.discount_scope === "labour_services" && Number(v2row?.discount_value) === 10, JSON.stringify(v2row));
  check("A2: version 1 stays approved while version 2 is being prepared", (await sql("select status from public.quotations where id = $1", [v1]))[0]?.status === "approved");
  const copied = v2 ? await sql("select id, line_type, title, part_item_id, revised_from_line_id from public.quotation_lines where quotation_id = $1 and is_active order by position", [v2]) : [];
  const copiedLines = copied.filter((l) => l.line_type !== "fee");
  check("A2: the copied lines remember the lines they came from", copiedLines.length >= 2 && copiedLines.every((l) => !!l.revised_from_line_id), JSON.stringify(copied.map((l) => l.title)));

  // Add one labour line and one part on version 2 (as the advisor would), then remove the old job with its part (B14).
  const newPart = (await sql("insert into public.part_items (job_id, description, quantity, cost_aed, availability, confirm_status, confirmed_at, priced_at, created_by, updated_by) values ($1, 'E2e new part', 1, 100, 'to_order', 'confirmed', now(), now(), $2, $2) returning id", [jobId, owner]))[0]?.id;
  await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, quantity, hours, labour_rate, source_type, urgency, created_by, updated_by) values ($1, 10, 'labour', 'E2e extra labour', 1, 1, 300, 'manual', 'recommended', $2, $2)", [v2, owner]);
  await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, quantity, unit_cost, markup_percent, unit_price, part_item_id, part_type, source_type, created_by, updated_by) values ($1, 11, 'part', 'E2e new part', 1, 100, 20, 120, $2, 'genuine', 'manual', $3, $3)", [v2, newPart, owner]);
  const oldLabour = copied.find((l) => l.line_type === "labour");
  const oldPartLine = copied.find((l) => l.line_type === "part");
  await sql("update public.quotation_lines set parent_line_id = $2 where id = $1", [oldPartLine?.id, oldLabour?.id]);
  await page.reload();
  await until(async () => ((await page.locator("[data-labour-boxes]").count()) >= 2 ? 1 : null), 30, 500);
  // B14: Remove on the old job asks "Also remove its 1 part?"
  const row = page.locator(`#item-line-${oldLabour?.id}`);
  await row.locator("[data-line-menu] button[aria-label='More for this line']").click();
  await row.locator("button", { hasText: /^Remove$/ }).click();
  const ask = await until(async () => ((await page.locator("[data-remove-parts-ask]").count()) ? 1 : null), 20, 300);
  check("B14: removing a job with a part under it asks 'Also remove its 1 part?'", !!ask && /Also remove its 1 part\?/.test((await page.locator("[data-remove-parts-ask]").textContent().catch(() => "")) ?? ""));
  if (ask) await page.locator("[data-remove-with-parts]").click();
  const dropped = await until(async () => { const r = (await sql("select is_active, removed_at, removed_reason, order_status from public.part_items where id = $1", [oldPartLine?.part_item_id]))[0]; return r && r.is_active === false ? r : null; }, 30, 500);
  check("B14: the part leaves the quotation and the parts list (not ordered yet, so removed quietly)", !!dropped && /declined/i.test(dropped.removed_reason ?? ""), JSON.stringify(dropped));
  check("B14: the part line on version 2 is gone", (await sql("select count(*)::int as n from public.quotation_lines where id = $1 and is_active", [oldPartLine?.id]))[0]?.n === 0);
  await shot(page, "10-revised-quotation-v2");

  // Send version 2 and let the customer approve it again.
  await sql("update public.quotations set status = 'sent', sent_at = now(), sent_by = $2, completed_at = now() where id = $1", [v2, owner]);
  const link = await fetch(`${base}/quote/${token}`);
  const linkText = pageText(await link.text());
  const v2total = await linkTotal(token);
  check("A2: the customer's existing link opens version 2 with 'Updated on' and version 2's total", link.status === 200 && /Updated on/.test(linkText) && /Revised quotation/i.test(linkText) && v2total > 0 && v2total !== total1, `status ${link.status} · totals ${total1} -> ${v2total} · ${linkText.slice(0, 160)}`);
  const v2token = (await sql("select token from public.quotations where id = $1", [v2]))[0]?.token;
  const ap2 = await approveViaLink(v2token, v2total);
  const loc2 = ap2.headers.get("location") ?? "";
  check("A2: the approval of version 2 is accepted", ap2.status < 400 && !/error=/.test(loc2), `status ${ap2.status} · ${decodeURIComponent(loc2).slice(-200)}`);
  const after = (await sql("select id, version, status from public.quotations where number = 'Q-STAGE-1' order by version", []));
  check("A2: version 2 approved, version 1 replaced", ap2.status < 400 && after.find((q) => q.version === 2)?.status === "approved" && after.find((q) => q.version === 1)?.status === "superseded", JSON.stringify(after));
  const jobAfter2 = (await sql("select status from public.jobs where id = $1", [jobId]))[0];
  check("A2: the job keeps its stage (work and parts carry on, nothing reset)", jobAfter2?.status === jobAfter1?.status, `${jobAfter1?.status} -> ${jobAfter2?.status}`);
  const np = (await sql("select order_status from public.part_items where id = $1", [newPart]))[0];
  check("A2: the new part goes to Parts for ordering as normal", np?.order_status === "to_order", JSON.stringify(np));
  const linkAfter = pageText(await (await fetch(`${base}/quote/${token}`)).text());
  check("A2: the link shows only version 2 (approved), never version 1", /Approved/.test(linkAfter) && !/version 1/i.test(linkAfter));
  const internal = await fetchAs(`/jobs/${jobId}/quote/${v1}`, "owner");
  const internalText = internal.buf ? pageText(internal.buf.toString("utf8")) : "";
  check("A2: version 1 is still visible internally as replaced", internal.status === 200 && /version 1/.test(internalText) && /Replaced by a newer version/.test(internalText));

  // B9: capitals on the PDF and on the screen.
  const pdf = await fetchAs(`/api/pdf/quotation/${v2}`, "owner");
  const text = pdf.buf ? await pdfText(pdf.buf) : "";
  check("B9: line descriptions and the customer's name print in capitals on the PDF", pdf.status === 200 && /E2E EXTRA LABOUR/.test(text) && /STAGE TEST CUSTOMER/.test(text), text.replace(/\s+/g, " ").slice(0, 200));
  await go(page, `${base}/jobs/${jobId}/quote/${v2}`);
  await until(async () => ((await page.locator("[data-labour-boxes]").count()) ? 1 : null), 30, 500);
  const nameBox = page.locator("input[id^='name-']").first();
  check("B9: the quote screen shows the line names in capitals (stored as typed)", (await nameBox.evaluate((el) => getComputedStyle(el).textTransform)) === "uppercase" && (await nameBox.inputValue()) === "E2e extra labour");

  // B15: the step bar on the parts page and the dots on the job card.
  await go(page, `${base}/parts/${jobId}`);
  await until(async () => ((await page.locator("[data-parts-steps]").count()) ? 1 : null), 30, 500);
  const states = await page.locator("[data-parts-steps] [data-step]").evaluateAll((els) => els.map((e) => `${e.dataset.step}:${e.dataset.state}`));
  check("B15: five steps across the top, Pricing done and Request approval current after the customer's approval", states.length === 5 && states[0] === "pricing:done" && states[1] === "approval:current" && states.slice(2).every((s) => s.endsWith(":later")), states.join(" "));
  check("B15: the current step says what to do", /Send the LPO for approval/.test((await page.locator("[data-step='approval']").textContent().catch(() => "")) ?? ""));
  await shot(page, "11-parts-step-bar");
  await go(page, `${base}/jobs/${jobId}`);
  check("B15: the same five steps show as dots on the job card", (await page.locator("[data-parts-dots] [data-step-dot]").count()) === 5);
  await go(page, `${base}/parts`);
  check("B15: the parts desk shows the dots next to the car", (await page.locator("[data-parts-dots]").count()) >= 1);

  // B13: the owner's monthly summary lists the skipped markup.
  const month = (await sql("select to_char(now() at time zone 'Asia/Dubai', 'YYYY-MM') as m"))[0]?.m;
  await go(page, `${base}/reports/monthly?month=${month}`);
  check("B13: the owner's summary shows who skipped the markup and on which quotation", (await page.locator("[data-markup-skipped-row]").count()) >= 1 && /Q-STAGE-1/.test((await page.locator("[data-markup-skipped]").textContent().catch(() => "")) ?? ""));
  await browser.close();
});

/* ---------------- 2. Gate-in damage chips and no jumping while typing ---------------- */
await section("2 damage chips, no jumping", async () => {
  const { browser, page } = await browserFor("owner", { viewport: { width: 1024, height: 1366 } });
  await go(page, `${base}/jobs/${jobId}/media`);
  await until(async () => ((await page.locator("[data-damage-chip]").count()) ? 1 : null), 30, 500);
  check("B3: one row of tap chips above the damage note, from Settings", (await page.locator("[data-damage-chip]").count()) >= 10 && (await page.locator("[data-damage-chip='Kerbed wheels']").count()) === 1);
  check("B3: no separate Save note button", (await page.locator("button", { hasText: /^Save note$/ }).count()) === 0);
  const box = page.locator("[data-damage-note] textarea");
  const rectBefore = await box.boundingBox();
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await page.locator("[data-damage-chip='Scratches']").click();
  await page.locator("[data-damage-chip='Dents']").click();
  const saved = await until(async () => { const r = (await sql("select damage_note from public.gate_ins where job_id = $1", [jobId]))[0]; return r?.damage_note === "Scratches, Dents" ? r : null; }, 30, 500);
  check("B3: each tap writes the word into the note and the note saves itself", !!saved && (await box.inputValue()) === "Scratches, Dents", JSON.stringify(saved));
  await page.locator("[data-damage-chip='Scratches']").click();
  const removed = await until(async () => { const r = (await sql("select damage_note from public.gate_ins where job_id = $1", [jobId]))[0]; return r?.damage_note === "Dents" ? r : null; }, 30, 500);
  check("B3: tapping a chip again removes the word", !!removed && (await box.inputValue()) === "Dents", `db ${JSON.stringify((await sql("select damage_note from public.gate_ins where job_id = $1", [jobId]))[0])} · box "${await box.inputValue()}" · status "${await page.locator("[data-damage-status]").textContent().catch(() => "")}"`);
  await box.click();
  await page.keyboard.type(", small scuff on the door");
  await sleep(2000);
  const rectAfter = await box.boundingBox();
  const scrollAfter = await page.evaluate(() => window.scrollY);
  check("B2: typing in the damage note moves nothing: the box stays where it was and the page does not scroll", Math.abs((rectAfter?.y ?? 0) - (rectBefore?.y ?? 0)) < 1 && scrollAfter === scrollBefore, `y ${rectBefore?.y} -> ${rectAfter?.y}, scroll ${scrollBefore} -> ${scrollAfter}`);
  const typed = await until(async () => { const r = (await sql("select damage_note from public.gate_ins where job_id = $1", [jobId]))[0]; return /small scuff/.test(r?.damage_note ?? "") ? r : null; }, 30, 500);
  check("B3: typed words save by themselves too", !!typed && /^Dents, small scuff/.test(typed.damage_note), `db ${JSON.stringify((await sql("select damage_note from public.gate_ins where job_id = $1", [jobId]))[0])} · box "${await box.inputValue()}" · status "${await page.locator("[data-damage-status]").textContent().catch(() => "")}"`);
  await shot(page, "12-damage-chips");
  await browser.close();
});

/* ---------------- 3. Credit terms ---------------- */
await section("3 credit terms", async () => {
  const { browser, page } = await browserFor("owner", { viewport: { width: 1366, height: 900 } });
  await go(page, `${base}/customers/${CUST}/edit`);
  check("B1: the owner sees the payment terms choice, off by default", (await page.locator("[data-credit-terms] input[type='radio']").count()) === 5 && (await page.locator("[data-credit-terms] input[value='']").isChecked()));
  await page.locator("[data-credit-terms] input[value='30']").check({ force: true });
  await page.locator("button[type='submit']", { hasText: /Save/ }).first().click();
  await afterSubmit(page);
  const c = (await sql("select credit_terms_days, credit_terms_set_by from public.customers where id = $1", [CUST]))[0];
  check("B1: 30 days credit saves with who set it", Number(c?.credit_terms_days) === 30 && !!c?.credit_terms_set_by, JSON.stringify(c));
  await browser.close();
  const { browser: ab, page: ap } = await browserFor("service_advisor", { viewport: { width: 1366, height: 900 } });
  await go(ap, `${base}/customers/${CUST}/edit`);
  check("B1: an advisor sees the terms but cannot change them", (await ap.locator("[data-credit-terms] input").count()) === 0 && /30 days \(set by the owner\)/.test((await ap.locator("[data-credit-terms]").textContent().catch(() => "")) ?? ""));
  // A car ready with a balance due: the advisor may release it on credit terms.
  const ready = await api("/api/e2e/stage", { stage: "ready" });
  const rj = ready.json?.jobId;
  await go(ap, `${base}/jobs/${rj}/gate-out`);
  check("B1: the gate-out shows the credit terms notice instead of blocking the release", (await ap.locator("[data-credit-release]").count()) === 1, (await ap.textContent("body"))?.match(/Balance due[^.]*\.|Credit terms[^.]*\./)?.[0] ?? "");
  await ab.close();
  await sql("update public.customers set credit_terms_days = null, credit_terms_set_by = null, credit_terms_set_at = null where id = $1", [CUST]);
  const { browser: bb, page: bp } = await browserFor("service_advisor", { viewport: { width: 1366, height: 900 } });
  await go(bp, `${base}/jobs/${rj}/gate-out`);
  check("B1: with credit terms off, full payment before release is the rule again", (await bp.locator("[data-credit-release]").count()) === 0 && /Balance due/.test((await bp.textContent("body")) ?? ""));
  await bb.close();
});

/* ---------------- 4. Pure rules and data: wheel order, clocks, steps, software items, stickers ---------------- */
await section("4 rules and data", async () => {
  const insp = fs.readFileSync(path.join(projectRoot, "src", "lib", "inspection.ts"), "utf8");
  const order = [...insp.matchAll(/\{ key: "(fl|fr|rl|rr)", label:/g)].map((m) => m[1]).join(",");
  const wheels = fs.readFileSync(path.join(projectRoot, "src", "lib", "wheels.ts"), "utf8").match(/WHEEL_KINDS = \[([^\]]+)\]/)?.[1] ?? "";
  check("B4: tyres and wheels follow a walk round the car: front left, rear left, rear right, front right", order === "fl,rl,rr,fr" && /"wheel_fl", "wheel_rl", "wheel_rr", "wheel_fr"/.test(wheels), `${order} · ${wheels}`);
  const wt = await import(`file:///${path.join(projectRoot, "src", "lib", "working-time.ts").replace(/\\/g, "/").replace(/^\//, "")}`);
  const w = { openHour: 8, closeHour: 18, workingDays: ["mon", "tue", "wed", "thu", "fri", "sat"], breakStart: "12:30", breakEnd: "13:30" };
  // 15 October 2026 is a Thursday; moments are given in Dubai time (+04:00).
  const m1 = wt.countedMinutes("2026-10-15T12:00:00+04:00", "2026-10-15T14:00:00+04:00", w);
  const m2 = wt.countedMinutes("2026-10-15T16:00:00+04:00", "2026-10-15T21:00:00+04:00", w);
  const m3 = wt.countedMinutes("2026-10-15T12:00:00+04:00", "2026-10-15T14:00:00+04:00", w, { throughBreak: true });
  check("B7: a clock leaves out the break (12:00 to 14:00 counts 60 min, 120 when worked through) and stops at closing (16:00 to 21:00 counts 120 min)", m1 === 60 && m3 === 120 && m2 === 120, `${m1} ${m3} ${m2}`);
  const ps = await import(`file:///${path.join(projectRoot, "src", "lib", "parts-steps.ts").replace(/\\/g, "/").replace(/^\//, "")}`);
  const part = (o) => ({ is_active: true, order_status: "ordered", received_qty: 0, quantity: 1, issue_status: null, from_stock: false, po_id: "po", ...o });
  const s1 = ps.partsSteps({ jobStatus: "waiting_parts", pricingDoneAt: "x", pricingReopenedAt: null, parts: [part({}), part({ order_status: "received", received_qty: 1 })], mainLpoStatus: "approved", toOrder: 0 }).map((s) => `${s.key}:${s.state}`).join(" ");
  const s2 = ps.partsSteps({ jobStatus: "waiting_parts", pricingDoneAt: "x", pricingReopenedAt: "y", parts: [part({ order_status: "received", received_qty: 1 })], mainLpoStatus: "approved", toOrder: 0 }).map((s) => `${s.key}:${s.state}`).join(" ");
  const s3 = ps.partsSteps({ jobStatus: "waiting_parts", pricingDoneAt: "x", pricingReopenedAt: null, parts: [part({ from_stock: true, order_status: "received", received_qty: 1, po_id: null })], mainLpoStatus: null, toOrder: 0 }).map((s) => `${s.key}:${s.state}`).join(" ");
  check("B15: ordered parts half received: Parts received is current with '1 of 2 received'", s1 === "pricing:done approval:done lpo:done received:current handover:later", s1);
  check("B15: Edit pricing sends the later steps back to grey", s2 === "pricing:current approval:later lpo:later received:later handover:later", s2);
  check("B15: parts from our stock skip the LPO steps and land on Handover", s3 === "pricing:done approval:done lpo:done received:done handover:current", s3);
  const svc = await sql("select lower(name) as n, line_kind, price_aed from public.services where is_active and lower(name) in ('labour charges','minor service','major service','software update','software reset','coding / programming')");
  const by = Object.fromEntries(svc.map((s) => [s.n, s]));
  check("B6: the three software items exist as separate labour jobs", !!by["software update"] && !!by["software reset"] && !!by["coding / programming"]);
  check("B8: Minor service is a service at AED 750, Major service a service with no default price", by["minor service"]?.line_kind === "service" && Number(by["minor service"]?.price_aed) === 750 && by["major service"]?.line_kind === "service" && by["major service"]?.price_aed === null);
  check("B10: Labour charges exists as an hour-based labour line", by["labour charges"]?.line_kind === "labour" && by["labour charges"]?.price_aed === null);
  const labels = (await sql("select i->>'label' as l from public.settings st, jsonb_array_elements(st.value) s, jsonb_array_elements(s->'items') i where st.key = 'inspection_checklist' and (i->>'label' ilike '%software%' or i->>'label' ilike '%coding%')")).map((r) => r.l);
  check("B6: the inspection checklist carries Software update, Software reset and Coding / programming", labels.includes("Software update") && labels.includes("Software reset") && labels.includes("Coding / programming"), labels.join(" | "));
  // B12: the stickers print at their own exact size, each with its size in Settings.
  const sticker = await fetchAs(`/print/service-sticker/${jobId}?serviced_on=2026-10-15&mileage=1200`, "owner");
  const sHtml = sticker.buf ? sticker.buf.toString("utf8") : "";
  check("B12: the service sticker page prints at its exact size with no margins", sticker.status === 200 && /@page \{ size: 60mm 60mm; margin: 0; \}/.test(sHtml), sHtml.match(/@page[^}]*\}/)?.[0] ?? `status ${sticker.status}`);
  const stickerSettings = await fetchAs(`/settings/stickers`, "owner");
  const ssHtml = stickerSettings.buf ? stickerSettings.buf.toString("utf8") : "";
  check("B12: the label size per sticker is set in Settings (battery and service)", stickerSettings.status === 200 && /name="sticker_battery_mm"/.test(ssHtml) && /name="sticker_service_mm"/.test(ssHtml));
});

cleanupDb();
process.exit(summary() ? 1 : 0);
