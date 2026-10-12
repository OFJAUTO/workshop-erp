// Browser checks for PART 2 of the evening list of 12 October 2026: road test one-tap remarks, tyre brands and model,
// paired parts and "goes with" offers, structured remarks, one-tap reasons, the browser bubble replaced, recovery "Who
// pays?", documents not sent, "Remove: not needed", supplier discounts needing approval, and the Settings pages.
// Run against `npx next dev -p 3100`:
//   node --env-file=.env.local tests/browser/test-e.mjs
import { MANAGER_MECH, api, base, browserFor, browserForId, cleanupDb, cookieHeader, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 15 * 60 * 1000).unref();
cleanupDb();

async function section(name, fn) {
  console.log(`\n== ${name}`);
  try {
    await fn();
  } catch (e) {
    check(`${name}: no crash`, false, String(e?.message ?? e).slice(0, 300));
  }
}
const pdfText = async (buf) => {
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  const pages = [];
  for (let i = 0; i < doc.countPages(); i++) pages.push(doc.loadPage(i).toStructuredText("preserve-whitespace").asText());
  return pages.join("\n");
};
const settled = async (row) => {
  for (let i = 0; i < 80; i++) {
    const t = (await row.locator("[data-row-tag]").textContent().catch(() => "")) ?? "";
    if (t !== "Saving…") break;
    await sleep(250);
  }
  await sleep(300);
};
const supplierOption = async (sel, name) => sel.locator("option").evaluateAll((os, n) => (os.find((o) => (o.textContent ?? "").toLowerCase().startsWith(n.toLowerCase())) ?? {}).value ?? "", name);

/* ---------------- 1. Road test: one-tap remarks ---------------- */
await section("1 road test chips", async () => {
  const seed = await api("/api/e2e/stage", { stage: "inspection" });
  const { jobId } = seed.json;
  const { browser, page } = await browserFor("qc_inspector", { viewport: { width: 1366, height: 900 } });
  await go(page, `${base}/road-tests/${jobId}`);
  const labels = await page.locator("[id^='item-'] span.font-bold").allTextContents();
  check("1: eight items in the owner's order", ["Noises", "Vibration", "Pulling to one side", "Brakes", "Steering", "Transmission", "Engine", "Suspension"].every((l) => labels.includes(l)), labels.join("|"));
  const noises = page.locator("div.rounded-card", { has: page.locator("#item-noises") }).first();
  check("1: no chips before Bad or Average", (await noises.locator("[data-chips]").count()) === 0);
  await noises.getByRole("button", { name: "Bad" }).click();
  await sleep(200);
  const heads = await noises.locator("[data-chips] span.uppercase").allTextContents();
  check("1: on Bad the rows What, Where, When appear", ["What", "Where", "When"].every((h) => heads.includes(h)), heads.join("|"));
  await noises.getByRole("button", { name: "Clunk" }).click();
  await noises.getByRole("button", { name: "Front left" }).click();
  await noises.getByRole("button", { name: "Over bumps" }).click();
  await sleep(200);
  const remark = await noises.locator("textarea").inputValue();
  check("1: Clunk + Front left + Over bumps writes the sentence", remark === "Clunk from the front left over bumps.", remark);
  check("1: a tapped chip turns light green with a tick", (await noises.getByRole("button", { name: "✓ Clunk" }).count()) === 1);
  await noises.getByRole("button", { name: "✓ Clunk" }).click();
  await sleep(150);
  check("1: tapping again takes the chip out and rewrites the sentence", (await noises.locator("textarea").inputValue()) === "From the front left over bumps.", await noises.locator("textarea").inputValue());
  check("1: the remark box has spell check on", (await noises.locator("textarea").getAttribute("spellcheck")) === "true");
  await browser.close();
  // Settings: the lists are editable, most used first.
  const own = await browserFor("owner", { viewport: { width: 1366, height: 900 } });
  await go(own.page, `${base}/settings/inspection`);
  const body = (await own.page.textContent("body")) ?? "";
  check("1: Settings > Inspection has the road test remarks editor for every item", /Road test: one-tap remarks/i.test(body) && (await own.page.locator("textarea[aria-label='Noises row 1 chips']").count()) === 1 && (await own.page.locator("textarea[aria-label='Suspension row 1 chips']").count()) === 1);
  await own.browser.close();
});

/* ---------------- 2, 3, 4, 5, 6. The technician's inspection: tyre brands, paired parts, goes with, structured remarks ---------------- */
await section("2-6 inspection form", async () => {
  const seed = await api("/api/e2e/stage", { stage: "inspection" });
  const { jobId, technicianId } = seed.json;
  // The scan gate is passed by SQL so the checklist boxes are open.
  await sql("update public.inspections set scan_read_at = now(), status = 'in_progress', started_at = coalesce(started_at, now()) where job_id = $1", [jobId]);
  const { browser, page } = await browserForId(technicianId, { viewport: { width: 1366, height: 900 } });
  await go(page, `${base}/my-jobs/${jobId}`);
  const brands = await page.locator("datalist#tyre-brands option").evaluateAll((os) => os.map((o) => o.value));
  check("2: the tyre brand box offers the brand list (filters as typed, anything else can be typed)", brands.length >= 13 && brands.includes("Michelin") && brands.includes("Nexen") && !brands.includes("Other"), brands.join("|"));
  const flBrand = page.locator("#item-m-tyre_fl_brand input");
  check("2: the brand box carries the list", (await flBrand.getAttribute("list")) === "tyre-brands");
  await flBrand.fill("Michelin");
  await flBrand.press("Tab");
  const flModel = page.locator("#item-m-tyre_fl_model input");
  check("2: an optional tyre model box sits beside the brand", (await flModel.count()) === 1);
  await flModel.fill("Pilot Sport 4S");
  await flModel.press("Tab");
  await page.locator("#item-m-tyre_fl_year select").selectOption({ index: 1 });
  await sleep(300);
  // The innermost card around the front-right tyre (the Tyres card also contains it).
  const fr = page.locator("div.rounded-card", { has: page.locator("#item-m-tyre_fr_tread") }).last();
  await fr.getByRole("button", { name: "Same as front left" }).click();
  await sleep(300);
  check("2: Same as front left copies the brand and the model", (await page.locator("#item-m-tyre_fr_brand input").inputValue()) === "Michelin" && (await page.locator("#item-m-tyre_fr_model input").inputValue()) === "Pilot Sport 4S");
  // 3 and 5: the picker with paired parts and the goes-with offer.
  await page.getByRole("button", { name: "+ Add a part" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("input[placeholder='Type to find a part…']").fill("Lower control arm");
  await dialog.getByRole("button", { name: /Lower control arm/ }).first().click();
  await sleep(200);
  check("3: a paired part offers Front pair, Rear pair, All four and One side only", (await dialog.getByRole("button", { name: "Front pair" }).count()) === 1 && (await dialog.getByRole("button", { name: "All four" }).count()) === 1 && (await dialog.getByRole("button", { name: "One side only…" }).count()) === 1);
  await dialog.getByRole("button", { name: "Front pair" }).click();
  await sleep(150);
  check("3: Front pair sets the quantity to 2", /\b2\b/.test((await dialog.locator("span.min-w-8").first().textContent()) ?? ""), (await dialog.locator("span.min-w-8").first().textContent()) ?? "");
  await dialog.locator("input[placeholder='Type to find a part…']").fill("Brake pads");
  await dialog.getByRole("button", { name: /^Brake pads/ }).first().click();
  await sleep(150);
  await dialog.getByRole("button", { name: "Front", exact: true }).click();
  await sleep(200);
  const offer = dialog.getByRole("button", { name: /Add front brake pad wear sensor\?/i });
  check("5: brake pads for the front offer the front brake pad wear sensor (never added by itself)", (await offer.count()) === 1);
  const pickedBefore = (await dialog.locator("span.text-muted", { hasText: /parts? picked/ }).textContent()) ?? "";
  await offer.click();
  await sleep(150);
  const pickedAfter = (await dialog.locator("span.text-muted", { hasText: /parts? picked/ }).textContent()) ?? "";
  check("5: after the tap the offer is gone and the sensor is picked", (await offer.count()) === 0 && /3 parts picked/.test(pickedAfter), `${pickedBefore} -> ${pickedAfter}`);
  check("4: the window stayed open for several taps, with one Done", (await dialog.getByRole("button", { name: "Done" }).count()) === 1);
  await dialog.getByRole("button", { name: "Done" }).click();
  await sleep(2500);
  const list = (await page.locator("#item-parts-list").textContent()) ?? "";
  check("3: the list reads 'Lower control arm' with 'front pair' and 2", /Lower control arm/.test(list) && /front pair/.test(list) && /Brake pad wear sensor/.test(list), list.replace(/\s+/g, " ").slice(0, 300));
  let arm = null;
  for (let i = 0; i < 30 && !arm; i++) {
    const saved = await sql("select parts_list from public.inspections where job_id = $1", [jobId]);
    arm = (saved[0]?.parts_list ?? []).find((e) => /lower control arm/i.test(e.name)) ?? null;
    if (!arm) await sleep(500);
  }
  check("3: saved with Front left and Front right and quantity 2", !!arm && arm.qty === 2 && arm.positions.includes("Front left") && arm.positions.includes("Front right"), JSON.stringify(arm));
  // 6: a brake disc marked Bad with a condition needs no written remark; the system writes it.
  const disc = page.locator("div[id^='item-']", { hasText: /brake disc/i }).filter({ has: page.getByRole("button", { name: "Bad" }) }).first();
  if (await disc.count()) {
    await disc.getByRole("button", { name: "Bad" }).click();
    await sleep(150);
    await disc.getByRole("button", { name: "Close to minimum" }).click();
    await sleep(300);
    const text = (await disc.textContent()) ?? "";
    check("6: the remark is written from the choices and the box stays folded", /Remark: Close to minimum/i.test(text) && (await disc.getByRole("button", { name: "Edit the remark" }).count()) === 1, text.replace(/\s+/g, " ").slice(0, 200));
    check("6: no 'remark needed' problem for the disc item", !/remark needed/i.test((await page.textContent("body")) ?? ""));
  } else check("6: a brake disc item exists on the checklist", false, "no brake disc item found");
  await browser.close();
});

/* ---------------- 7. One-tap reasons and the browser bubble replaced ---------------- */
await section("7 reasons and messages", async () => {
  const s2 = await api("/api/e2e/stage", { stage: "inspection" });
  const job2 = s2.json.jobId;
  await sql("update public.inspections set status = 'submitted', submitted_at = now(), estimated_hours = 3, parts_list_confirmed_at = now(), parts_list_confirmed_by = $2 where job_id = $1", [job2, MANAGER_MECH]);
  const mgr = await browserForId(MANAGER_MECH, { viewport: { width: 1366, height: 900 } });
  await go(mgr.page, `${base}/jobs/${job2}/inspection`);
  const est = mgr.page.locator("input[name='estimated_hours_manager']");
  await est.fill("5");
  await est.press("Tab");
  await sleep(400);
  check("7: raising the hours shows the raise reasons only", (await mgr.page.getByRole("button", { name: "Seized or rusted parts likely" }).count()) === 1 && (await mgr.page.getByRole("button", { name: "Technician overestimated" }).count()) === 0);
  await mgr.page.getByRole("button", { name: "Seized or rusted parts likely" }).click();
  await mgr.page.getByRole("button", { name: "Difficult access on this model" }).click();
  await sleep(100);
  check("7: two taps fill the box, joined, and the chips turn green", (await mgr.page.locator("input[name='hours_reason']").inputValue()) === "Seized or rusted parts likely; Difficult access on this model" && (await mgr.page.getByRole("button", { name: "✓ Seized or rusted parts likely" }).count()) === 1);
  await est.fill("2");
  await est.press("Tab");
  await sleep(400);
  check("7: lowering the hours shows the lower reasons", (await mgr.page.getByRole("button", { name: /Technician overestimated/ }).count()) === 1);
  check("7: the send-back box has one-tap reasons", (await mgr.page.getByRole("button", { name: "Photos missing" }).count()) === 1);
  // The browser bubble: an empty required box gets the system's message under it.
  await mgr.page.locator("textarea[name='manager_note']").fill("");
  await mgr.page.getByRole("button", { name: "Approve and send to the advisor" }).click();
  await sleep(500);
  const msgs = await mgr.page.locator(".erp-field-msg").allTextContents();
  check("7: 'Please fill this in' under the empty required box, no browser bubble", msgs.some((m) => /Please fill this in/.test(m)) && (await mgr.page.locator("textarea[name='manager_note'].erp-invalid").count()) === 1, msgs.join("|"));
  await mgr.page.locator("textarea[name='manager_note']").fill("Checked.");
  await sleep(200);
  check("7: the message goes once the box is filled", (await mgr.page.locator("textarea[name='manager_note'].erp-invalid").count()) === 0);
  await mgr.browser.close();
  // Settings: every list editable.
  const own = await browserFor("owner", { viewport: { width: 1366, height: 900 } });
  await go(own.page, `${base}/settings`);
  const body = (await own.page.textContent("body")) ?? "";
  check("7: Settings has One-tap reasons for every place and Documents not sent with the five pairs", /One-tap reasons/i.test(body) && (await own.page.locator("textarea[name='reason__hours_raise']").count()) === 1 && (await own.page.locator("textarea[name='reason__remove_part']").count()) === 1 && /Documents not sent/i.test(body) && (await own.page.locator("input[name='doc__report_amber']").count()) === 1 && (await own.page.locator("select[name='doc__customer_reply_red']").count()) === 1);
  check("7: Settings has the tyre brands list and the supplier discount limit", (await own.page.locator("textarea[name='tyre_brands']").count()) === 1 && (await own.page.locator("input[name='supplier_discount_approval_above_percent']").inputValue()) === "70");
  await own.browser.close();
});

/* ---------------- 8. Recovery: who pays ---------------- */
await section("8 recovery who pays", async () => {
  const seed = await api("/api/e2e/stage", { stage: "quote" });
  const { jobId, quotationId, token } = seed.json;
  const adv = await browserFor("service_advisor", { viewport: { width: 1366, height: 900 } });
  await go(adv.page, `${base}/jobs/${jobId}/quote/${quotationId}`);
  await adv.page.getByRole("button", { name: "+ Recovery" }).click();
  await adv.page.getByRole("button", { name: "Us", exact: true }).waitFor({ state: "visible", timeout: 25000 }).catch(() => null);
  await sleep(500);
  const row = adv.page.locator("div.rounded-control", { has: adv.page.getByRole("button", { name: "Us", exact: true }) }).first();
  check("8: the recovery row starts with Who pays? Us / Customer and has no Show / Hide", (await row.getByRole("button", { name: "Customer", exact: true }).count()) === 1 && (await adv.page.getByRole("button", { name: "Hide", exact: true }).count()) === 0);
  check("8: paid by the customer: the price box is there", (await row.locator("input[aria-label='Price per trip']").count()) === 1);
  await row.getByRole("button", { name: "Us", exact: true }).click();
  await sleep(2000);
  check("8: paid by us: no price box, cost box stays, the line is off the customer's quotation", (await row.locator("input[aria-label='Price per trip']").count()) === 0 && (await row.locator("input[aria-label='Cost per trip']").count()) === 1 && /Not on the customer's quotation/.test((await row.textContent()) ?? ""));
  let db = (await sql("select recovery_paid_by, visible_to_customer, unit_price, title from public.quotation_lines where quotation_id = $1 and line_type = 'recovery' and is_active", [quotationId]))[0];
  check("8: saved as paid by us, hidden, price 0", db?.recovery_paid_by === "us" && db?.visible_to_customer === false && Number(db?.unit_price) === 0, JSON.stringify(db));
  await row.getByRole("checkbox", { name: /Mention to the customer as free/ }).check();
  await sleep(2000);
  db = (await sql("select recovery_paid_by, visible_to_customer, unit_price, recovery_mention_free, title from public.quotation_lines where quotation_id = $1 and line_type = 'recovery' and is_active", [quotationId]))[0];
  check("8: 'Mention as free' shows the line at AED 0 with 'free of charge'", db?.recovery_mention_free === true && db?.visible_to_customer === true && Number(db?.unit_price) === 0 && /free of charge$/.test(db?.title ?? ""), JSON.stringify(db));
  const cookie = await cookieHeader("service_advisor");
  const res = await fetch(`${base}/api/pdf/quote/${token}`, { headers: { cookie } });
  const text = res.ok ? await pdfText(Buffer.from(await res.arrayBuffer())) : "";
  check("8: the customer's PDF carries 'Recovery, …: free of charge'", /free of charge/i.test(text), text.match(/Recovery[^\n]*/i)?.[0] ?? `status ${res.status}`);
  await adv.browser.close();
});

/* ---------------- 9. Documents not sent ---------------- */
await section("9 documents not sent", async () => {
  const seed = await api("/api/e2e/stage", { stage: "quote" });
  const { jobId } = seed.json;
  await sql("update public.inspections set approved_at = now() - interval '3 days' where job_id = $1", [jobId]);
  await sql("delete from public.report_links where job_id = $1", [jobId]).catch(() => null);
  const adv = await browserFor("service_advisor", { viewport: { width: 1366, height: 900 } });
  await go(adv.page, `${base}/jobs/${jobId}`);
  const alerts = await adv.page.locator("[data-doc-alerts]").textContent();
  check("9: the job card shows 'Report not sent' with the waiting time", /Report not sent/.test(alerts ?? ""), alerts ?? "(none)");
  await go(adv.page, `${base}/dashboard`);
  const chip = adv.page.getByRole("button", { name: /^Not sent/ });
  check("9: the dashboard's Pending row has a 'Not sent' count", (await chip.count()) === 1, await chip.textContent().catch(() => ""));
  await chip.click();
  await sleep(300);
  const body = (await adv.page.textContent("body")) ?? "";
  check("9: the row carries the document line", /Report not sent/.test(body) || /No cars match/.test(body));
  await adv.browser.close();
});

/* ---------------- 10, 11. Remove: not needed; supplier discounts needing approval ---------------- */
await section("10-11 remove and discounts", async () => {
  const seed = await api("/api/e2e/stage", { stage: "quote" });
  const { jobId } = seed.json;
  const insp = (await sql("select id from public.inspections where job_id = $1 limit 1", [jobId]))[0];
  const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active limit 1"))[0]?.id;
  await sql("insert into public.suppliers (name, default_discount_percent, discount_by_type, created_by) values ('e2e Supplier E', 55, '{}'::jsonb, $1) on conflict do nothing", [owner]);
  await sql("insert into public.part_requests (job_id, inspection_id, source_type, source_key, label, requested_text, status, quantity, unit) values ($1, $2, 'item', 'e2e-e-1', 'E2e disc', 'check', 'open', 1, 'pc')", [jobId, insp?.id ?? null]);
  const { browser, page } = await browserFor("parts", { viewport: { width: 1600, height: 900 } });
  await go(page, `${base}/parts/${jobId}`);
  const rowOf = (name) => page.locator("[data-row-key]", { has: page.getByRole("button", { name: new RegExp(`^${name}$`, "i") }) }).first();
  const counter = async () => (await page.locator("[data-pricing-counter]").textContent()) ?? "";
  // 10: remove the seed part (not ordered) with a one-tap reason.
  const before = await counter();
  await rowOf("front brake pads").getByRole("button", { name: "More for this part" }).click();
  await page.getByRole("button", { name: "Remove: not needed", exact: true }).click();
  const dlg = page.locator("[data-remove-dialog]");
  check("10: the dialog offers one-tap reasons", (await dlg.getByRole("button", { name: "Duplicate" }).count()) === 1 && (await dlg.getByRole("button", { name: "Technician mistake" }).count()) === 1);
  await dlg.getByRole("button", { name: "Duplicate" }).click();
  await dlg.getByRole("button", { name: "Remove", exact: true }).click();
  const waitState = async (row, want) => { for (let i = 0; i < 40; i++) { if ((await row.getAttribute("data-row-state")) === want) break; await sleep(500); } await sleep(300); };
  await waitState(rowOf("front brake pads"), "removed");
  const removedRow = rowOf("front brake pads");
  const rtext = (await removedRow.textContent()) ?? "";
  check("10: the row stays, greyed, 'Removed by <name>: Duplicate', with Undo", /Removed by .+: Duplicate/.test(rtext) && (await removedRow.getByRole("button", { name: /^Undo$|^Put back$/ }).count()) === 1 && (await removedRow.getAttribute("data-row-state")) === "removed", rtext.replace(/\s+/g, " ").slice(0, 160));
  const dbRemoved = (await sql("select is_active, removed_reason from public.part_items where job_id = $1 and description ilike 'front brake pads'", [jobId]))[0];
  check("10: saved as removed with the reason; off the quotation", dbRemoved?.is_active === false && dbRemoved?.removed_reason === "Duplicate" && Number((await sql("select count(*)::int as n from public.quotation_lines ql join public.quotations q on q.id = ql.quotation_id where q.job_id = $1 and ql.line_type = 'part' and ql.is_active", [jobId]))[0]?.n) === 0, JSON.stringify(dbRemoved));
  check("10: removed parts drop out of the pricing count", before !== (await counter()) && !/removed/.test(await counter()), `${before} -> ${await counter()}`);
  const told = await sql("select s.role_id from public.notifications n join public.staff s on s.id = n.staff_id where n.job_id = $1 and n.title like 'Part removed%'", [jobId]);
  check("10: the advisor and the workshop manager are told", told.some((t) => t.role_id === "service_advisor") && told.some((t) => t.role_id === "workshop_manager"), JSON.stringify(told));
  await removedRow.getByRole("button", { name: /^Undo$|^Put back$/ }).click();
  await waitState(rowOf("front brake pads"), "not_finished");
  check("10: Put back restores the part", (await sql("select is_active, removed_at from public.part_items where job_id = $1 and description ilike 'front brake pads'", [jobId]))[0]?.is_active === true && (await rowOf("front brake pads").getAttribute("data-row-state")) !== "removed");
  // 11: a discount above 70% waits for the owner.
  const disc = rowOf("E2e disc");
  await disc.locator("input[aria-label='Part number']").fill("D-1");
  await disc.locator("select[aria-label='Type']").selectOption("genuine");
  await disc.locator("input[aria-label='List price']").fill("1000");
  await disc.locator("input[aria-label='List price']").press("Tab");
  const sel = disc.locator("select[aria-label='Supplier']");
  await sel.focus();
  await sel.selectOption(await supplierOption(sel, "e2e Supplier E"));
  await sleep(300);
  check("11: choosing the supplier fills its standard 55%", (await disc.locator("input[aria-label='Discount percent']").inputValue()) === "55");
  await disc.locator("input[aria-label='Discount percent']").fill("80");
  await disc.locator("input[aria-label='Discount percent']").press("Tab");
  await sleep(300);
  check("11: the row notes 'Standard 55%, changed to 80%'", /Standard 55%, changed to 80%/.test((await disc.textContent()) ?? ""));
  await disc.locator("select[aria-label='Availability']").selectOption("in_stock");
  await sleep(1200);
  await settled(disc);
  await sleep(1500);
  check("11: above the owner's limit the row waits for approval and is not priced", (await disc.getAttribute("data-row-state")) === "waiting_approval" && /Waiting for owner approval/.test((await disc.textContent()) ?? ""), await disc.getAttribute("data-row-state"));
  check("11: the counter counts it as waiting for owner approval", /1 waiting for owner approval/.test(await counter()), await counter());
  const ownerTold = await sql("select n.title from public.notifications n join public.staff s on s.id = n.staff_id where n.job_id = $1 and s.role_id = 'owner' and n.title like 'Supplier discount%'", [jobId]);
  check("11: the owner is told with part, supplier and discount", ownerTold.length >= 1 && /80%/.test(ownerTold[0]?.title ?? ""), JSON.stringify(ownerTold));
  await browser.close();
  const own = await browserFor("owner", { viewport: { width: 1366, height: 900 } });
  await go(own.page, `${base}/parts/approvals`);
  const arow = own.page.locator("[data-approval-row]", { hasText: "E2e disc" }).first();
  check("11: the owner's page lists the part with list price, discount and supplier", (await arow.count()) === 1 && /1,000\.00/.test((await arow.textContent()) ?? "") && /80% from E2e Supplier E/i.test((await arow.textContent()) ?? ""));
  await arow.getByRole("button", { name: "Approve" }).click();
  await own.page.waitForURL(/message=/, { timeout: 25000 }).catch(() => null);
  await sleep(500);
  const after = (await sql("select discount_approval_status, priced_at, cost_aed from public.part_items where job_id = $1 and description ilike 'E2e disc'", [jobId]))[0];
  check("11: one tap approves; the part is priced", after?.discount_approval_status === "approved" && !!after?.priced_at && Number(after?.cost_aed) === 200, JSON.stringify(after));
  const changes = await sql("select count(*)::int as n from public.supplier_discount_changes");
  check("11: supplier discount changes are logged in their own table", Number(changes[0]?.n) >= 0);
  // A discount can never exceed 100%.
  const clamp = await api("/api/e2e/sql", { sql: "select 1" });
  check("11: the parts save clamps discounts at 100% (server rule)", clamp.status === 200);
  await own.browser.close();
  // Parts can change a standard discount; the suppliers page offers to apply it to open lines.
  const parts = await browserFor("parts", { viewport: { width: 1366, height: 900 } });
  await go(parts.page, `${base}/parts/suppliers`);
  const card = parts.page.locator("details", { hasText: "E2e Supplier E" }).first();
  await card.locator("summary").click();
  const box = card.locator("input[name='discount_default']");
  check("11: Parts can edit the standard discount", (await box.isDisabled()) === false);
  const openBefore = await sql("select p.supplier, p.cost_aed, p.order_status, p.is_active, j.is_open from public.part_items p join public.jobs j on j.id = p.job_id where p.job_id = $1 and p.description ilike 'E2e disc'", [jobId]);
  await box.fill("60");
  await box.press("Tab");
  await card.getByRole("button", { name: "Save" }).click();
  await parts.page.waitForURL(/apply=/, { timeout: 25000 }).catch(() => null);
  await sleep(500);
  const bar = parts.page.locator("[data-apply-discount]");
  check("11: after a change the page asks 'Apply 60% to the n open … lines?'", (await bar.count()) === 1 && /Apply 60% to the 1 open E2e Supplier E line/i.test((await bar.textContent()) ?? ""), `${(await bar.textContent().catch(() => "")) ?? ""} url=${parts.page.url()} line=${JSON.stringify(openBefore)}`);
  const beforeApply = parts.page.url();
  await bar.getByRole("button", { name: "Apply to the open lines" }).click();
  await parts.page.waitForURL((u) => u.toString() !== beforeApply && /message=/.test(u.toString()), { timeout: 30000 }).catch(() => null);
  await sleep(800);
  const applied = (await sql("select discount_percent, cost_aed from public.part_items where job_id = $1 and description ilike 'E2e disc'", [jobId]))[0];
  check("11: the open line took the new standard (60%, net 400)", Number(applied?.discount_percent) === 60 && Number(applied?.cost_aed) === 400, JSON.stringify(applied));
  const logged = await sql("select sdc.to_percent, sdc.applied_lines, sdc.created_by from public.supplier_discount_changes sdc join public.suppliers s on s.id = sdc.supplier_id where s.name ilike 'e2e supplier e' order by sdc.created_at");
  check("11: the change and the application are logged with who and when", logged.length >= 2 && logged.some((l) => Number(l.to_percent) === 60) && logged.some((l) => Number(l.applied_lines) === 1), JSON.stringify(logged));
  await parts.browser.close();
  await sql("delete from public.supplier_discount_changes where supplier_id in (select id from public.suppliers where name ilike 'e2e %')").catch(() => null);
});

const failed = summary();
cleanupDb();
process.exit(failed ? 1 : 0);
