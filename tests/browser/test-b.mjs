// Browser tests for the overnight build of 10 to 11 October (loose items, owner's reports, handover with PIN,
// stickers, per-unit services, breaks, workshop load, devices, scan emails, phone size). Against npx next dev -p 3100.
import { MANAGER_MECH, api, base, browserFor, browserForId, cleanupDb, loginCookies, plain, sql } from "./pw-lib.mjs";

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${String(detail).slice(0, 200)}` : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const only = process.argv[2] ?? "";
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanup(); process.exit(2); }, 15 * 60 * 1000).unref();
const go = async (page, url) => { await page.goto(url, { waitUntil: "load" }); await sleep(1500); };
const settle = async (page) => { await page.waitForLoadState("load"); await sleep(1500); };
const submitted = async (page) => { const before = page.url(); await page.waitForURL((u) => u.toString() !== before && /message=|error=/.test(u.toString()), { timeout: 25000 }).catch(() => null); await settle(page); };
const cleanup = () => cleanupDb();
const cookieHeader = async (role) => (await loginCookies(role)).map((c) => `${c.name}=${c.value}`).join("; ");
const dubaiHHMM = (d) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
let settingsJsonb = true;
const setSetting = async (key, value) => sql(settingsJsonb ? "update public.settings set value = to_jsonb($2::text) where key = $1" : "update public.settings set value = $2 where key = $1", [key, value]);
const getSetting = async (key) => { const r = await sql("select value from public.settings where key = $1", [key]); return r[0]?.value; };
const setJson = async (key, value) => sql("update public.settings set value = $2::jsonb where key = $1", [key, JSON.stringify(value)]);

async function freeTech(jobId) {
  const t = await sql("select s.id from public.staff s where s.role_id = 'technician' and s.is_active and not exists (select 1 from public.work_sessions w where w.technician_id = s.id and w.ended_at is null and w.is_active) order by s.display_name limit 1");
  const id = t[0]?.id;
  if (!id) return null;
  await sql("insert into public.job_technicians (job_id, staff_id) values ($1, $2) on conflict (job_id, staff_id) do update set is_active = true, left_at = null", [jobId, id]);
  await sql("update public.jobs set assigned_to = $2 where id = $1", [jobId, id]);
  return id;
}

async function section(name, fn) {
  if (only && !name.startsWith(only)) return;
  console.log(`\n== ${name}`);
  try { await fn(); } catch (e) { check(`${name}: no crash`, false, e.message.slice(0, 220)); }
}

cleanup();
{ const t = await sql("select pg_typeof(value)::text as t from public.settings limit 1"); settingsJsonb = t[0]?.t === "jsonb"; }

/* ---------------- G: loose items, and H: the owner's reports ---------------- */
await section("G-H loose items and reports", async () => {
  const { browser, page } = await browserFor("service_advisor");
  await go(page, `${base}/gate-in`);
  check("gate-in offers Loose items, no car (G1)", (await page.getByRole("link", { name: "Loose items, no car" }).count()) === 1);
  await go(page, `${base}/gate-in/loose?new=1`);
  await page.locator("input[name=new_name]").fill("e2e loose customer");
  await page.locator("input[name=new_phone]").fill("+971500000099");
  await page.locator("label:has-text('Wheel')").first().click();
  await page.locator("input[name=item_description_0]").fill("21 inch, black");
  await page.locator("input[name=item_quantity_0]").fill("4");
  await page.getByRole("button", { name: "+ Another item" }).click();
  await sleep(300);
  await page.locator("label:has-text('Bumper')").nth(1).click();
  await page.locator("input[name=item_description_1]").fill("front, scratched");
  await page.locator("textarea[name=requests]").fill("Repair the kerb damage and repaint\nBalance all four");
  await page.locator("label:has(input[name=department][value=bodyshop])").last().click();
  await page.getByRole("button", { name: "Open the job card" }).click();
  await page.waitForURL((u) => /\/jobs\/[0-9a-f-]{36}\?message=/.test(u.toString()), { timeout: 25000 }).catch(() => null);
  await settle(page);
  const jobId = (page.url().match(/\/jobs\/([0-9a-f-]{36})/) ?? [])[1];
  check("loose gate-in opens a job card (G2)", !!jobId, page.url().slice(0, 120));
  if (!jobId) { await browser.close(); return; }
  const body = await page.textContent("body");
  check("job card shows Loose items, items received, no inspection tile (G3)", /Loose items/.test(body ?? "") && /Items received/.test(body ?? "") && !/Inspection report/.test(body ?? "") && /4 × Wheel/.test(body ?? ""), (body ?? "").match(/Items received.{0,80}/)?.[0] ?? "");
  const items = await sql("select item_type, quantity, qr_code from public.job_items where job_id = $1 order by position", [jobId]);
  check("two items saved with QR tags (G2)", items.length === 2 && items[0].quantity === 4 && items.every((i) => i.qr_code), JSON.stringify(items));
  const job = await sql("select status, stage, job_kind, department from public.jobs where id = $1", [jobId]);
  check("loose job starts at Quote, bodyshop (G4)", job[0]?.status === "pending_quote" && job[0]?.job_kind === "loose" && job[0]?.department === "bodyshop", JSON.stringify(job));
  const tagsHtml = await (await fetch(`${base}/print/item-tags/${jobId}`, { headers: { cookie: await cookieHeader("service_advisor") } })).text();
  check("item tags page prints one tag per item (G2 tags)", (plain(tagsHtml).match(/Item \d of 2/g) ?? []).length === 2 && /data:image\/png/.test(tagsHtml), String((plain(tagsHtml).match(/Item \d of 2/g) ?? []).length));
  await page.getByRole("button", { name: "Start quotation" }).click();
  await page.waitForURL((u) => /\/quote\//.test(u.toString()), { timeout: 25000 }).catch(() => null);
  check("quotation opens without an inspection (G4)", /\/quote\//.test(page.url()), page.url().slice(-60));
  await browser.close();
  // Work done: the items go to QC, pass, and are Ready without a wash.
  await sql("update public.jobs set status = 'pending_qc', stage = 'qc', stage_entered_at = now() where id = $1", [jobId]);
  await sql("insert into public.qc_checks (job_id, round, status, items) values ($1, 1, 'open', $2::jsonb)", [jobId, JSON.stringify([{ key: "general:1", kind: "general", label: "Paint matches and no runs", result: null, remark: null }])]);
  const { browser: bq, page: pq } = await browserFor("qc_inspector");
  await go(pq, `${base}/qc/${jobId}`);
  const passes = pq.getByRole("button", { name: "PASS" });
  for (let i = 0; i < (await passes.count()); i++) await passes.nth(i).click();
  await pq.getByRole("button", { name: /Finish: pass/ }).click();
  await submitted(pq);
  const afterQc = await sql("select status, stage from public.jobs where id = $1", [jobId]);
  check("QC pass sends loose items straight to Ready, no wash (G4)", afterQc[0]?.status === "ready" && afterQc[0]?.stage === "ready", JSON.stringify(afterQc) + " " + pq.url().slice(-80));
  await bq.close();
  // Collection, one item first.
  const { browser: bo, page: po } = await browserFor("owner");
  await go(po, `${base}/jobs/${jobId}/gate-out`);
  const boxes = po.locator("input[name=item]");
  check("gate-out lists the items with tick boxes (G5)", (await boxes.count()) === 2, String(await boxes.count()));
  await boxes.nth(1).uncheck();
  await po.locator("input[name=collector_name]").fill("Stage Driver");
  await po.locator("input[name=handover_confirmed]").check();
  if (await po.locator("input[name=release_reason]").count()) await po.locator("input[name=release_reason]").fill("Owner released, no invoice on the test job");
  await po.getByRole("button", { name: /collected|close the job/ }).click();
  await submitted(po);
  const partial = await sql("select is_open, status from public.jobs where id = $1", [jobId]);
  const col = await sql("select count(*)::int as n from public.job_items where job_id = $1 and collected_at is not null", [jobId]);
  check("one item collected, job still open (G5)", partial[0]?.is_open === true && col[0]?.n === 1, JSON.stringify({ partial, col, url: po.url().slice(-90) }));
  await go(po, `${base}/jobs/${jobId}/gate-out`);
  check("the collected item shows as Gone (G5)", /Gone/.test(await po.textContent("body")));
  await po.locator("input[name=collector_name]").fill("Stage Driver");
  await po.locator("input[name=handover_confirmed]").check();
  if (await po.locator("input[name=release_reason]").count()) await po.locator("input[name=release_reason]").fill("Owner released, no invoice on the test job");
  await po.getByRole("button", { name: /collected|close the job/ }).click();
  await submitted(po);
  const closed = await sql("select is_open, status, owner_report_at, owner_report->'verdict' as verdict, owner_report->'loose' as loose from public.jobs where id = $1", [jobId]);
  check("last item collected closes the job (G5)", closed[0]?.is_open === false && closed[0]?.status === "closed", JSON.stringify(closed));
  check("owner's report written at gate-out (H1)", !!closed[0]?.owner_report_at && closed[0]?.loose === true && ["good", "acceptable", "talk"].includes(closed[0]?.verdict), JSON.stringify(closed));
  const note = await sql("select title, href from public.notifications where job_id = $1 and type = 'owner_report' limit 1", [jobId]);
  check("owner notified with a link to the report (H1)", note.length === 1 && /Job report/.test(note[0].title) && note[0].href === `/reports/jobs/${jobId}`, JSON.stringify(note));
  await go(po, `${base}/reports/jobs/${jobId}`);
  const rb = await po.textContent("body");
  check("job report page: money, time, people, customer, flags (H1)", /Money/.test(rb ?? "") && /Where the time went/.test(rb ?? "") && /People/.test(rb ?? "") && /Customer/.test(rb ?? "") && /Things to look at/.test(rb ?? "") && /Loose items/.test(rb ?? ""), (rb ?? "").slice(0, 100));
  const month = new Date().toISOString().slice(0, 7);
  await go(po, `${base}/reports/cars?month=${month}`);
  const cb = await po.textContent("body");
  check("Finished cars lists the job (H2)", new RegExp((closed[0] && (await sql("select job_number from public.jobs where id = $1", [jobId]))[0]?.job_number) ?? "zzz").test(cb ?? ""), (cb ?? "").slice(0, 80));
  await go(po, `${base}/reports/people?month=${month}`);
  check("People page renders (H3)", /Technicians/.test(await po.textContent("body")) && /Service advisors/.test(await po.textContent("body")));
  await go(po, `${base}/reports/monthly?month=${month}`);
  const mb = await po.textContent("body");
  check("Monthly summary renders with the numbers (H4)", /Gated out/.test(mb ?? "") && /Invoiced before VAT/.test(mb ?? "") && /Verdicts/.test(mb ?? ""));
  const pdf = await fetch(`${base}/api/pdf/monthly?month=${month}`, { headers: { cookie: await cookieHeader("owner") } });
  check("monthly PDF downloads (H4)", pdf.status === 200 && (pdf.headers.get("content-type") ?? "").includes("pdf"), `${pdf.status} ${pdf.headers.get("content-type")}`);
  const nav = await po.locator("nav a:has-text('Reports')").count();
  check("Reports in the owner's menu (H)", nav >= 1);
  await bo.close();
  const { browser: bm, page: pm } = await browserForId(MANAGER_MECH);
  const r = await pm.goto(`${base}/reports/monthly`, { waitUntil: "load" });
  check("reports are the owner's only (H)", !/\/reports\//.test(pm.url()), pm.url().slice(-40) + " " + r?.status());
  await bm.close();
});

/* ---------------- C, D: handover with the technician's PIN, battery warranty sticker ---------------- */
await section("C-D handover and stickers", async () => {
  const seed = await api("/api/e2e/stage", { stage: "approved" });
  const { jobId } = seed.json;
  const PA = "22222222-0000-4000-8000-00000000e306";
  await sql("update public.jobs set status = 'in_work', stage = 'work', plan_released_at = now(), work_started_at = now() where id = $1", [jobId]);
  await sql("update public.part_items set order_status = 'received', received_qty = 1, description = 'Battery 12V 80Ah AGM' where id = $1", [PA]).catch(async () => sql("update public.part_items set order_status = 'received', received_qty = 1, description = 'Battery 12V 80Ah AGM' where id = $1", [PA]));
  const techId = await freeTech(jobId);
  check("technician on the job", !!techId);
  await api("/api/e2e/stage", { stage: "pin", id: techId, pin: "1234" });
  const { browser, page } = await browserFor("parts");
  await go(page, `${base}/parts/handover/${jobId}`);
  const box = page.locator(`input[name=part][value='${PA}']`);
  check("handover page lists the received part with a tick box (C2)", (await box.count()) === 1, (await page.textContent("body") ?? "").slice(0, 100));
  if (!(await box.count())) { await browser.close(); return; }
  if (!(await box.isChecked())) await box.check();
  await sleep(300);
  const brand = page.locator(`input[name='battery_brand__${PA}']`);
  check("battery fields appear for a battery (D2)", (await brand.count()) === 1);
  if (await brand.count()) { await brand.fill("varta"); await page.locator(`input[name='battery_model__${PA}']`).fill("E39"); }
  check("warranty sticker locked to the quantity (D2)", /Warranty stickers/.test(await page.textContent("body")) && (await page.locator(`input[name='stickers__${PA}']`).inputValue()) === "1", await page.locator(`input[name='stickers__${PA}']`).inputValue());
  await page.locator("select[name=technician]").selectOption(techId);
  check("no scanning on the handover page (C1)", !/Scan/i.test(await page.textContent("body")));
  await page.locator("button[type=submit]:has-text('Hand over')").click();
  await page.waitForURL((u) => /message=|error=/.test(u.toString()), { timeout: 25000 }).catch(() => null);
  await settle(page);
  // H1: the stickers print from the waiting box, in a new tab; opening the page counts as printing.
  const printLink = page.locator("a[href*='/print/stickers/']").first();
  check("Hand over offers the sticker print page in a new tab (D1, H1)", (await printLink.count()) >= 1 && (await printLink.getAttribute("target")) === "_blank", page.url().slice(-100));
  if (await printLink.count()) { await go(page, `${base}${await printLink.getAttribute("href")}`); }
  const ho = await sql("select id, status, stickers_printed_at, stickers from public.part_handovers where job_id = $1 order by created_at desc limit 1", [jobId]);
  check("handover is pending until the technician confirms (C2)", ho[0]?.status === "pending" && !!ho[0]?.stickers_printed_at, JSON.stringify(ho[0] ?? null).slice(0, 200));
  const notBefore = await sql("select issue_status from public.part_items where id = $1", [PA]);
  check("part still counts as with Parts (C2)", notBefore[0]?.issue_status !== "confirmed", JSON.stringify(notBefore));
  await browser.close();
  const { browser: bt, page: pt } = await browserForId(techId, { viewport: { width: 820, height: 1180 }, touch: true });
  await go(pt, `${base}/my-jobs`);
  check("technician's list shows the handover banner (C2)", /handing you/.test(await pt.textContent("body")), (await pt.textContent("body") ?? "").match(/.{0,40}handing you.{0,60}/)?.[0] ?? "");
  await go(pt, `${base}/my-jobs/${jobId}`);
  const receive = pt.getByRole("button", { name: "Receive parts" }).first();
  if (await receive.count()) { await receive.click(); await sleep(400); }
  const pin = pt.locator("input[aria-label=PIN]");
  check("PIN box on the technician's device (C2)", (await pin.count()) === 1);
  if (await pin.count()) {
    await pin.fill("1234");
    await pt.getByRole("button", { name: "I received these parts" }).click();
    await sleep(3500);
    const after = await sql("select h.status, h.confirmed_at, p.issue_status from public.part_handovers h join public.part_items p on p.id = $2 where h.id = $1", [ho[0]?.id, PA]);
    check("PIN confirms the handover and the part is with the technician (C2)", after[0]?.status === "confirmed" && after[0]?.issue_status === "confirmed", JSON.stringify(after));
    const bw = await sql("select brand, model, warranty_until as valid_until from public.battery_warranties where job_id = $1", [jobId]);
    check("battery warranty recorded with brand and until date (D2)", bw.length === 1 && bw[0].brand === "Varta" && !!bw[0].valid_until, JSON.stringify(bw));
    const code = ho[0]?.stickers?.[PA]?.code;
    if (code) {
      const html = await (await fetch(`${base}/s/${code}`)).text();
      check("battery QR opens a plain In warranty page for anyone (D2)", /warranty/i.test(html) && !/Sign in/i.test(html), html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").match(/.{0,60}warranty.{0,40}/i)?.[0] ?? "");
    } else check("sticker QR code stored on the handover", false, JSON.stringify(ho[0]?.stickers));
  }
  await bt.close();
  const { browser: bp, page: pp } = await browserFor("parts");
  await go(pp, `${base}/parts/trail/${jobId}`);
  check("Parts trail offers a logged reprint (D1)", /Print the stickers again/.test(await pp.textContent("body")));
  await bp.close();
});

/* ---------------- B1, A5: a service priced per tyre, hours at 0.5 ---------------- */
await section("B1-A5 services and hours", async () => {
  const cat = await sql("insert into public.service_categories (name, position) values ('e2e Tyres', 99) returning id");
  const svc = await sql("insert into public.services (category_id, name, department, price_aed, price_per, usual_quantity, time_allowance_hours) values ($1, 'e2e Wheel balancing', 'both', 50, 'tyre', 4, 0.3) returning id", [cat[0]?.id]);
  const seed = await api("/api/e2e/stage", { stage: "quote" });
  const { jobId, quotationId } = seed.json;
  const r = await api("/api/quote/save", { quotationId, addLine: { service_id: svc[0]?.id } }, await cookieHeader("service_advisor"));
  check("service added to the quotation through the save route", r.status === 200, JSON.stringify(r.json ?? r.text).slice(0, 120));
  const { browser, page } = await browserFor("owner");
  await go(page, `${base}/jobs/${jobId}/quote/${quotationId}`);
  await sleep(500);
  const body = await page.textContent("body");
  check("per-unit service shows price per tyre × usual quantity (B1)", /per tyre × 4/.test(body ?? "") && /AED 200/.test(body ?? ""), (body ?? "").match(/.{0,30}per tyre.{0,40}/)?.[0] ?? "");
  const plus = page.getByRole("button", { name: "One more" }).first();
  if (await plus.count()) { await plus.click(); await sleep(1800); check("the + button raises the quantity and the total (A6, 11 Oct)", /per tyre × 5/.test(await page.textContent("body")) && /AED 250/.test(await page.textContent("body")), (await page.textContent("body") ?? "").match(/per tyre × \d/)?.[0] ?? ""); }
  else check("− and + on the per-unit line (A6, 11 Oct)", false);
  await sleep(300);
  const hours = page.locator("input[aria-label='Hours']").first();
  check("hours box found (A5)", (await hours.count()) >= 1);
  if (await hours.count()) {
    await hours.fill("0.5"); await hours.press("Tab"); await sleep(1500);
    const h1 = await sql("select hours from public.quotation_lines where quotation_id = $1 and line_type = 'labour' and is_active order by position limit 1", [quotationId]);
    check("0.5 h saved as 0.5 (A5)", Number(h1[0]?.hours) === 0.5, JSON.stringify(h1));
    await sleep(1500);
      await sleep(400);
    const hoursB = page.locator("input[aria-label='Hours']").first();
    await hoursB.fill(".7"); await hoursB.press("Tab"); await sleep(1500);
    const h2 = await sql("select hours from public.quotation_lines where quotation_id = $1 and line_type = 'labour' and is_active order by position limit 1", [quotationId]);
    check("a leading dot works: .7 saved as 0.7 (A5)", Number(h2[0]?.hours) === 0.7, JSON.stringify(h2));
    await sleep(1500);
      await sleep(400);
    const hoursC = page.locator("input[aria-label='Hours']").first();
    await hoursC.fill("1,3"); await hoursC.press("Tab"); await sleep(1500);
    const h3 = await sql("select hours from public.quotation_lines where quotation_id = $1 and line_type = 'labour' and is_active order by position limit 1", [quotationId]);
    check("a comma works: 1,3 saved as 1.3 (A5)", Number(h3[0]?.hours) === 1.3, JSON.stringify(h3));
  }
  const cons = page.getByRole("button", { name: "+ Consumables" });
  check("consumables are a button, never added by themselves (B2)", (await cons.count()) === 1 && !/Consumables/.test((await sql("select string_agg(title, ',') as t from public.quotation_lines where quotation_id = $1", [quotationId]))[0]?.t ?? ""));
  await browser.close();
  await api("/api/e2e/stage", { stage: "approved" });
  const wl = await api("/api/e2e/stage", { stage: "worklines", id: jobId });
  const line = (wl.json?.lines ?? []).find((l) => /Wheel balancing/i.test(l.title));
  check("approved per-unit service reaches the work order with allowance × quantity (A2, B1)", !!line && Math.abs(Number(line.hours_quoted) - 1.5) < 0.01, JSON.stringify(wl.json?.lines ?? wl.text).slice(0, 200));
  const { browser: bm, page: pm } = await browserForId(MANAGER_MECH);
  await sql("update public.jobs set status = 'in_work', stage = 'work', plan_released_at = now() where id = $1", [jobId]);
  await go(pm, `${base}/jobs/${jobId}/work`);
  const open = pm.locator("summary:has-text('time budget')");
  if (await open.count()) {
    await open.click();
    await pm.locator("input[name=budget_hours]").fill("0.5");
    await pm.locator("input[name=reason]").fill("Quick job, half an hour");
    await pm.getByRole("button", { name: "Save budget" }).click();
    await submitted(pm);
    const b = await sql("select budget_hours from public.jobs where id = $1", [jobId]);
    check("budget box takes 0.5 (A5)", Number(b[0]?.budget_hours) === 0.5, JSON.stringify(b));
  } else check("budget form on the work order", false);
  await bm.close();
});

/* ---------------- E2: the clock pauses itself at the break ---------------- */
await section("E2 break", async () => {
  const seed = await api("/api/e2e/stage", { stage: "approved" });
  const { jobId } = seed.json;
  const techId = await freeTech(jobId);
  await sql("update public.jobs set status = 'in_work', stage = 'work', plan_released_at = now(), work_started_at = now() where id = $1", [jobId]);
  await api("/api/e2e/stage", { stage: "worklines", id: jobId });
  await sql("update public.staff set break_start = null, break_end = null where id = $1", [techId]);
  await sql("insert into public.work_sessions (job_id, technician_id, started_at, created_by, updated_by) values ($1, $2, now() - interval '10 minutes', $2, $2)", [jobId, techId]);
  // Since 17 October the break lives in the per-day grid: today's window is set for both sides.
  const original = await getSetting("break_times");
  // Around Dubai midnight "now-2min" is yesterday: the window is clamped to the day it is read on.
  const winStart = dubaiHHMM(new Date(Date.now() - 2 * 60000));
  const winEnd = dubaiHHMM(new Date(Date.now() + 40 * 60000));
  const win = winStart < winEnd ? `${winStart}-${winEnd}` : `00:00-${winEnd < "00:05" ? "00:59" : winEnd}`;
  const everyDay = Object.fromEntries(["sat", "sun", "mon", "tue", "wed", "thu", "fri"].map((d) => [d, win]));
  await setJson("break_times", { mechanical: everyDay, bodyshop: everyDay });
  try {
    const { browser, page } = await browserForId(techId, { viewport: { width: 820, height: 1180 }, touch: true });
    await go(page, `${base}/my-jobs/${jobId}`);
    await sleep(3000);
    const body = await page.textContent("body");
    check("break banner with Keep working (E2)", /Break/.test(body ?? "") && (await page.getByRole("button", { name: "Keep working" }).count()) === 1, (body ?? "").match(/.{0,40}Break.{0,80}/)?.[0] ?? "");
    const s1 = await sql("select pause_reason, ended_at, through_break from public.work_sessions where job_id = $1 and technician_id = $2 order by started_at desc limit 1", [jobId, techId]);
    check("the clock paused itself with reason Break (E2)", s1[0]?.ended_at !== null && s1[0]?.pause_reason === "Break", JSON.stringify(s1));
    await page.getByRole("button", { name: "Keep working" }).click();
    await sleep(3500);
    const s2 = await sql("select ended_at, through_break from public.work_sessions where job_id = $1 and technician_id = $2 order by started_at desc limit 1", [jobId, techId]);
    check("Keep working starts a session marked through the break (E2)", s2[0]?.ended_at === null && s2[0]?.through_break === true, JSON.stringify(s2));
    await browser.close();
  } finally {
    await setJson("break_times", original && typeof original === "object" ? original : { mechanical: {}, bodyshop: {} });
  }
  const { browser: b2, page: p2 } = await browserFor("owner");
  await go(p2, `${base}/team`);
  const first = await p2.locator("a[href^='/team/']:not([href*='tablets']):not([href*='new'])").first().getAttribute("href");
  if (first) {
    await go(p2, `${base}${first}`);
    check("Team form has the person's own break (E1)", (await p2.locator("input[name=break_start]").count()) === 1 && (await p2.locator("input[name=break_end]").count()) === 1);
  }
  await b2.close();
});

/* ---------------- E4, E5, E6: workshop load, devices, phone size ---------------- */
await section("E4-E6 load, devices, phone", async () => {
  const seed = await api("/api/e2e/stage", { stage: "assign" });
  const { browser, page } = await browserForId(MANAGER_MECH);
  await go(page, `${base}/workshop-load`);
  const wb = await page.textContent("body");
  check("Workshop load page: one line per technician with the week's load (E4)", /Workshop load/.test(wb ?? "") && /h this week/.test(wb ?? "") && (await page.locator("ul li").count()) >= 2, (wb ?? "").slice(0, 80));
  await go(page, `${base}/assign`);
  const boxes = page.locator("input[type=checkbox][name=technician]");
  check("assignment list with tick boxes, freest first (E4)", (await boxes.count()) >= 2 && /Freest first/.test(await page.textContent("body")), String(await boxes.count()));
  check("menu has Workshop load (E4)", (await page.locator("nav a:has-text('Workshop load')").count()) >= 1);
  await browser.close();
  const { browser: bo, page: po } = await browserFor("owner");
  await go(po, `${base}/team/tablets`);
  const tb = await po.textContent("body");
  const devices = await sql("select count(*)::int as n from public.devices where is_active");
  check("tablets page: Block this device and the mode switch (E5)", devices[0]?.n === 0 || (/Block this device/.test(tb ?? "") && /(Make personal|Switch to shared)/.test(tb ?? "")), `${devices[0]?.n} devices`);
  await bo.close();
  void seed;
  const inWork = await api("/api/e2e/stage", { stage: "approved" });
  await sql("update public.jobs set status = 'in_work', stage = 'work', plan_released_at = now() where id = $1", [inWork.json.jobId]);
  const t6 = await freeTech(inWork.json.jobId);
  const { browser: bt, page: pt } = await browserForId(t6, { viewport: { width: 390, height: 844 }, touch: true, mobile: true });
  for (const path of [`/my-jobs/${inWork.json.jobId}`, "/my-jobs"]) {
    await go(pt, `${base}${path}`);
    const w = await pt.evaluate(() => document.documentElement.scrollWidth);
    check(`no sideways scroll at phone width on ${path} (E6)`, w <= 392, `${w}px`);
  }
  await bt.close();
});

/* ---------------- I: scan reports by email (read from the mailbox since 16 October) ---------------- */
await section("I scan emails", async () => {
  const r = await fetch(`${base}/api/e2e/mailbox`, { method: "POST", headers: { "content-type": "application/json", "x-e2e-secret": process.env.E2E_SECRET ?? "" }, body: JSON.stringify({ from: "e2e@example.com", subject: "e2e forwarding confirmation", text: "Your confirmation code is 123456", messageId: `e2e-b-${Date.now()}` }) });
  const j = await r.json().catch(() => ({}));
  check("an email without a report is kept under Other emails (I3)", r.status === 200 && j.kept === true, `${r.status} ${JSON.stringify(j)}`);
  const { browser, page } = await browserFor("owner");
  await go(page, `${base}/scans`);
  const body = await page.textContent("body");
  check("Other emails shows the subject and text (I3)", /e2e forwarding confirmation/.test(body ?? "") && /123456/.test(body ?? ""));
  check("the page says where the reports come from and offers Check the mailbox now (I2)", /Where the reports come from/.test(body ?? "") && (await page.locator("[data-check-mailbox]").count()) === 1);
  await page.getByRole("button", { name: "Put away" }).first().click();
  await page.waitForFunction(() => !/e2e forwarding confirmation/.test(document.body.innerText), null, { timeout: 12000 }).catch(() => null);
  await go(page, `${base}/scans`);
  check("Put away hides the email (I3)", !/e2e forwarding confirmation/.test(await page.textContent("body")));
  await browser.close();
  const { browser: bm, page: pm } = await browserForId(MANAGER_MECH);
  await go(pm, `${base}/scans`);
  check("manager never sees Other emails (I4)", !/Other emails/.test(await pm.textContent("body")));
  await bm.close();
});

/* ---------------- D3: the oil service sticker and its QC line ---------------- */
await section("D3 service sticker", async () => {
  // The line is named before the customer approves (an approved quotation refuses any change).
  const seed = await api("/api/e2e/stage", { stage: "ready", labourTitle: "ENGINE OIL AND FILTER CHANGE" });
  const { jobId } = seed.json;
  const { browser, page } = await browserFor("owner");
  await go(page, `${base}/jobs/${jobId}`);
  const body = await page.textContent("body");
  check("job card shows the oil service sticker card, not printed yet (D3)", /Oil service sticker/.test(body ?? "") && /not printed yet/i.test(body ?? ""), (body ?? "").match(/Oil service sticker.{0,80}/)?.[0] ?? "");
  const html = await (await fetch(`${base}/print/service-sticker/${jobId}`, { headers: { cookie: await cookieHeader("owner") } })).text();
  check("service sticker print page renders with the next service (D3)", /data:image\/png/.test(html) && /next/i.test(html), html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 120));
  const st = await sql("select j.service_sticker->>'printed_at' as printed, v.next_service_date, v.next_service_mileage from public.jobs j join public.vehicles v on v.id = j.vehicle_id where j.id = $1", [jobId]);
  check("printing saves the sticker and the next service on the car (D3)", !!st[0]?.printed && !!st[0]?.next_service_date && Number(st[0]?.next_service_mileage) > 42000, JSON.stringify(st));
  await sql("update public.jobs set status = 'pending_qc', stage = 'qc' where id = $1", [jobId]);
  const qc = await api("/api/e2e/stage", { stage: "qc-open", id: jobId });
  const items = qc.json?.qc?.items ?? [];
  check("QC list has the sticker line (D3)", items.some((i) => i.key === "sticker:service" && /sticker/i.test(i.label)), JSON.stringify(items.map((i) => i.key)).slice(0, 200));
  await browser.close();
});

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
cleanup();
process.exit(0);
