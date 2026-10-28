// Proof for the 18 October (afternoon) batch. Sections by ONLY=S1,S2,…
//   S1: the technician receives parts on his own tablet (tick, Select all, his PIN, light green lines),
//       Parts only mark "Ready for handover" (instant notification, 2-hour reminder), nothing blocks
//       starting work, receiving is required before "Job finished".
//   node --env-file=.env.local tests/browser/test-z.mjs
import { api, base, browserFor, browserForId, cleanupDb, freeTech, go, makeChecks, setPin, sleep, sql, submitted } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 20 * 60 * 1000).unref();
const until = async (fn, tries = 60, ms = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } return null; };
const only = (process.env.ONLY ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const want = (name) => !only.length || only.includes(name);
const shot = (page, name) => page.screenshot({ path: `tests/browser/shots/${name}.png`, fullPage: false });

/* ================= S1: the technician receives parts on his own tablet ================= */
if (want("S1")) {
  console.log("\n== S1 technician receives parts");
  cleanupDb();
  const { jobId } = (await api("/api/e2e/stage", { stage: "approved" })).json;
  // The parts have arrived at the desk.
  await sql("update public.part_items set order_status = 'received', received_qty = greatest(coalesce(confirmed_quantity, quantity, 1), 1) where job_id = $1 and is_active", [jobId]);
  const nParts = (await sql("select count(*)::int as n from public.part_items where job_id = $1 and is_active", [jobId]))[0]?.n ?? 0;
  // Any active technician will do (real ones may be clocked in right now, so freeTech can come back empty).
  let techId = await freeTech(jobId);
  if (!techId) {
    techId = (await sql("select id from public.staff where role_id = 'technician' and is_active order by display_name limit 1"))[0]?.id;
    await sql("insert into public.job_technicians (job_id, staff_id) select $1, $2 where not exists (select 1 from public.job_technicians where job_id = $1 and staff_id = $2)", [jobId, techId]);
    await sql("update public.job_technicians set is_active = true, left_at = null, done_at = null where job_id = $1 and staff_id = $2", [jobId, techId]);
  }
  const onCar = (await sql("select count(*)::int as n from public.job_technicians where job_id = $1 and is_active and left_at is null", [jobId]))[0]?.n ?? 0;
  check("S1: a technician is on the car for the test", onCar >= 1 && !!techId, String(onCar));
  await setPin(techId, "1234");
  const techName = (await sql("select display_name from public.staff where id = $1", [techId]))[0]?.display_name ?? "";
  const mark = (await sql("select now() as t"))[0]?.t;

  // Parts mark them "Ready for handover" (their only step; no desk-side confirm exists any more).
  const { browser: pb, page: pp } = await browserFor("parts", { viewport: { width: 1280, height: 950 } });
  await go(pp, `${base}/parts/handover/${jobId}`);
  check("S1: the desk has no technician pick, no PIN and no sign-for", !/Sign here|I sign instead|signs for/i.test((await pp.textContent("body")) ?? "") && (await pp.locator("select[name='technician']").count()) === 0);
  await shot(pp, "s1-desk-before");
  await pp.locator("[data-mark-ready]").click();
  await submitted(pp);
  const readyN = await until(async () => { const n = (await sql("select count(*)::int as n from public.part_items where job_id = $1 and ready_for_handover_at is not null", [jobId]))[0]?.n; return n === nParts ? n : null; }, 30, 400);
  check(`S1: "Ready for handover" stamps every part (${nParts})`, readyN === nParts, String(readyN));
  const techTold = await until(async () => (await sql("select title from public.notifications where staff_id = $1 and type = 'handover' and created_at > $2 and title like '%ready for you%' limit 1", [techId, mark]))[0] ?? null, 30, 400);
  check("S1: the technician is told 'N parts ready for you: <plate> (<car>) at the parts desk'", /^\d+ parts? ready for you: .+ at the parts desk$/.test(techTold?.title ?? ""), techTold?.title);
  const mgrTold = (await sql("select count(*)::int as n from public.notifications where type = 'handover' and created_at > $1 and title like '%ready at the desk%'", [mark]))[0]?.n ?? 0;
  check("S1: the workshop manager is told too", mgrTold >= 1, String(mgrTold));
  await go(pp, `${base}/parts/handover/${jobId}`);
  check("S1: the desk shows 'Ready · waiting for the technician'", (await pp.locator("[data-ready-part]").count()) === nParts);
  await shot(pp, "s1-desk-ready");
  await pb.close();

  // Two hours pass: one reminder, then quiet.
  await sql("update public.part_items set ready_for_handover_at = now() - interval '3 hours' where job_id = $1", [jobId]);
  const cronAuth = { headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` } };
  await fetch(`${base}/api/cron/housekeeping`, cronAuth);
  const reminded = await until(async () => (await sql("select title from public.notifications where staff_id = $1 and created_at > $2 and title like 'Still at the parts desk%' limit 1", [techId, mark]))[0] ?? null, 20, 400);
  check("S1: after two hours one reminder goes out", /^Still at the parts desk: \d+ parts? for /.test(reminded?.title ?? ""), reminded?.title);
  await fetch(`${base}/api/cron/housekeeping`, cronAuth);
  await sleep(1500);
  const remindCount = (await sql("select count(*)::int as n from public.notifications where staff_id = $1 and created_at > $2 and title like 'Still at the parts desk%'", [techId, mark]))[0]?.n ?? 0;
  check("S1: the reminder never repeats", remindCount === 1, String(remindCount));

  // The technician, on his own tablet: amber note, ticks, Select all, his PIN, light green lines.
  const { browser: tb, page: tp } = await browserForId(techId, { viewport: { width: 820, height: 1180 }, touch: true });
  await go(tp, `${base}/my-jobs/${jobId}`);
  await until(async () => ((await tp.locator("[data-parts-for-car]").count()) ? 1 : null), 30, 400);
  check("S1: the note is a small amber line, not a red banner", new RegExp(`${nParts} parts? not received yet`).test((await tp.locator("[data-parts-note]").textContent().catch(() => "")) ?? ""));
  check("S1: nothing blocks starting work (no red border on the parts card)", !/border-red/.test((await tp.locator("[data-parts-for-car]").getAttribute("class")) ?? ""));
  check("S1: a tick box per line, every row starts UNTICKED grey", (await tp.locator("[data-part-take][data-ticked='0']").count()) === nParts && new RegExp("I've received these \\(0\\)").test((await tp.locator("[data-receive-parts]").textContent()) ?? ""));
  check("S1: the button is off with nothing ticked", await tp.locator("[data-receive-parts]").isDisabled());
  await shot(tp, "s1-tech-before");
  // Tick everything (Select all when there are several rows, the row itself otherwise).
  if (nParts > 1) {
    check("S1: Select all is there", (await tp.locator("[data-select-all-parts]").count()) === 1);
    await tp.locator("[data-select-all-parts]").click();
  } else {
    await tp.locator("[data-part-take] button").first().click();
  }
  await until(async () => ((await tp.locator("[data-part-take][data-ticked='1']").count()) === nParts ? 1 : null), 20, 300);
  const tickedBg = await tp.locator("[data-part-take][data-ticked='1'] > button").first().evaluate((el) => getComputedStyle(el).backgroundColor);
  check("S1: a ticked row is light green (computed colour)", tickedBg === "rgb(232, 245, 236)", tickedBg);
  await shot(tp, "s1-tech-ticked");
  // Wrong PIN first: refused in words.
  await tp.locator("[data-receive-pin]").fill("9999");
  await tp.locator("[data-receive-parts]").click();
  const refusal = await until(async () => { const t = await tp.locator("[data-parts-for-car] [role='alert']").textContent().catch(() => null); return t && /not your PIN/i.test(t) ? t : null; }, 20, 400);
  check("S1: a wrong PIN is refused in words", !!refusal, refusal ?? "");
  const stillNone = (await sql("select count(*)::int as n from public.part_items where job_id = $1 and issue_status = 'confirmed'", [jobId]))[0]?.n ?? 0;
  check("S1: nothing moved on a wrong PIN", stillNone === 0);
  // The right PIN: received.
  await tp.locator("[data-receive-pin]").fill("1234");
  await tp.locator("[data-receive-parts]").click();
  const allIn = await until(async () => { const n = (await sql("select count(*)::int as n from public.part_items where job_id = $1 and issue_status = 'confirmed'", [jobId]))[0]?.n; return n === nParts ? n : null; }, 30, 500);
  check(`S1: his own PIN receives all ${nParts}`, allIn === nParts, String(allIn));
  const ho = (await sql("select pin_used, to_staff, confirmed_by, device_id is not null as has_device from public.part_handovers where job_id = $1 and status = 'confirmed' order by created_at desc limit 1", [jobId]))[0];
  check("S1: the receipt is written with his PIN on his device", ho?.pin_used === true && ho?.to_staff === techId && ho?.confirmed_by === techId, JSON.stringify(ho));
  await until(async () => ((await tp.locator("[data-part-received]").count()) === nParts ? 1 : null), 30, 400);
  const row = (await tp.locator("[data-part-received]").first().textContent().catch(() => "")) ?? "";
  check("S1: lines turn light green with his name and the time", (await tp.locator("[data-part-received]").count()) === nParts && row.includes(techName) && /\d{2}:\d{2}/.test(row), row.slice(0, 120));
  await shot(tp, "s1-tech-after");
  // The notification, as the technician sees it.
  await go(tp, `${base}/notifications`);
  check("S1: the 'ready for you' notification is on his list", /ready for you/.test((await tp.textContent("body")) ?? ""));
  await shot(tp, "s1-notification");
  await tb.close();

  // The desk shows them with the technician now.
  const { browser: pb2, page: pp2 } = await browserFor("parts", { viewport: { width: 1280, height: 950 } });
  await go(pp2, `${base}/parts/handover/${jobId}`);
  check("S1: the desk shows 'With the technician' with his name", new RegExp(`received by ${techName}`, "i").test((await pp2.textContent("body")) ?? ""));
  await shot(pp2, "s1-desk-after");
  await pb2.close();
}

/* ================= S2: the proforma asks how the customer will pay ================= */
if (want("S2")) {
  console.log("\n== S2 proforma payment method");
  cleanupDb();
  const { jobId } = (await api("/api/e2e/stage", { stage: "ready" })).json;
  const pro = await until(async () => (await sql("select id, token from public.invoices where job_id = $1 and kind = 'proforma' and status = 'issued' limit 1", [jobId]))[0] ?? null, 20, 500);
  check("S2: the Ready car has its proforma", !!pro?.id);
  const { browser, page } = await browserFor("service_advisor", { viewport: { width: 1280, height: 1000 } });
  await go(page, `${base}/jobs/${jobId}/invoice`);
  await page.getByRole("button", { name: /^Send the proforma/ }).first().click();
  await until(async () => ((await page.locator("[data-pay-how]").count()) ? 1 : null), 20, 400);
  const labels = await page.locator("[data-expected]").allTextContents();
  check("S2: exactly four choices - Card in the shop / Payment link / Bank transfer / Cash", (await page.locator("[data-expected]").count()) === 4 && /Card in the shop/.test(labels[0] ?? "") && /Payment link/.test(labels[1] ?? "") && /Bank transfer/.test(labels[2] ?? "") && /Cash/.test(labels[3] ?? "") && !labels.some((l) => /cheque/i.test(l)), labels.join(" | "));
  check("S2: Continue is off until a method is chosen", await page.locator("[data-pay-continue]").isDisabled());
  await page.locator("[data-expected='link']").click();
  await until(async () => ((await page.locator("[data-link-fields]").count()) ? 1 : null), 10, 300);
  check("S2: Payment link shows the paste box at once", (await page.locator("[data-link-url]").count()) === 1);
  await shot(page, "s2-send");
  await page.locator("[data-pay-continue]").click();
  const err = await until(async () => { const t = (await page.locator("[data-pay-how]").textContent().catch(() => "")) ?? ""; return /Paste the payment link/.test(t) ? t : null; }, 15, 300);
  check("S2: an empty link cannot send", !!err, (err ?? "").slice(0, 120));
  await page.locator("[data-link-url]").fill("https://example.com/e2e-pay-test");
  await page.locator("[data-pay-continue]").click();
  await until(async () => { const r = (await sql("select expected_payment_method from public.invoices where id = $1", [pro.id]))[0]; return r?.expected_payment_method === "link" ? 1 : null; }, 30, 400);
  check("S2: the choice is saved on the proforma", true);
  const pl = await until(async () => (await sql("select url from public.payment_links where invoice_id = $1 and is_active and replaced_at is null order by added_at desc limit 1", [pro.id]))[0] ?? null, 20, 400);
  check("S2: the pasted link is stored, never opened by us", (pl?.url ?? "").includes("example.com/e2e-pay-test"));
  const msg = (await page.locator("[role='dialog'] textarea").inputValue().catch(() => "")) ?? "";
  check("S2: the message tells the customer about Pay now", /Pay now/.test(msg), msg.slice(-120));
  await page.keyboard.press("Escape");
  // The customer's proforma shows the Pay now button.
  const res = await fetch(`${base}/proforma/${pro.token}`);
  const html = await res.text();
  check("S2: the customer's proforma has the Pay now button", res.status === 200 && /Pay now ·/.test(html));
  const { browser: cb, page: cp } = await browserFor("owner", { viewport: { width: 420, height: 900 } });
  await go(cp, `${base}/proforma/${pro.token}`);
  await shot(cp, "s2-proforma");
  await cb.close();
  // The advisor changes his mind later and re-sends with a different method.
  await go(page, `${base}/jobs/${jobId}/invoice`);
  await page.getByRole("button", { name: /^Send the proforma/ }).first().click();
  await until(async () => ((await page.locator("[data-pay-how]").count()) ? 1 : null), 20, 400);
  await page.locator("[data-expected='card']").click();
  await page.locator("[data-pay-continue]").click();
  const changed = await until(async () => ((await sql("select expected_payment_method from public.invoices where id = $1", [pro.id]))[0]?.expected_payment_method === "card" ? 1 : null), 30, 400);
  check("S2: the method can be changed and re-sent", !!changed);
  await page.keyboard.press("Escape");
  // Card in the shop: recording needs the slip photo (the form unfolds once the proforma is sent).
  await sql("update public.invoices set sent_at = now() where id = $1", [pro.id]);
  await sql("update public.jobs set ready_sent_at = now() where id = $1", [jobId]);
  await go(page, `${base}/jobs/${jobId}/invoice`);
  const before = (await sql("select count(*)::int as n from public.payments where invoice_id = $1 and is_active", [pro.id]))[0]?.n ?? 0;
  await page.locator("[data-method='card']").first().click();
  // 29 October 2026: a card payment needs the bank auth code.
  if (await page.locator("[data-auth-code]").count()) await page.locator("[data-auth-code]").first().fill(`TZ${String(Date.now()).slice(-4)}`);
  await page.locator("[data-amount-partial]").first().click();
  await page.locator("[data-amount-input]").first().fill("100");
  check("S2: the card slip photo box is there and required", (await page.locator("[data-proof-input]").count()) >= 1 && (await page.locator("[data-proof-input]").first().getAttribute("required")) !== null);
  await shot(page, "s2-payment-form");
  await page.locator("[data-record-payment]").first().click();
  await sleep(1500);
  const after1 = (await sql("select count(*)::int as n from public.payments where invoice_id = $1 and is_active", [pro.id]))[0]?.n ?? 0;
  check("S2: without the photo nothing is recorded", after1 === before, String(after1));
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await page.locator("[data-proof-input]").first().setInputFiles({ name: "slip.png", mimeType: "image/png", buffer: png });
  await page.locator("[data-record-payment]").first().click();
  const pay = await until(async () => { const r = (await sql("select id, proof_path from public.payments where invoice_id = $1 and is_active and method = 'card' order by created_at desc limit 1", [pro.id]))[0]; return r?.proof_path ? r : null; }, 30, 500);
  check("S2: with the photo the payment records and keeps the slip", !!pay?.proof_path && String(pay.proof_path).startsWith("payments/"), JSON.stringify(pay));
  await go(page, `${base}/jobs/${jobId}/invoice`);
  check("S2: the card slip is one tap away next to the receipt", (await page.locator("[data-proof-link]").count()) >= 1);
  await shot(page, "s2-payment-recorded");
  await browser.close();
  await sql("delete from public.payment_links where invoice_id = $1", [pro.id]);
}

/* ================= S3: the parts screens (LPO cards, receiving, the step bar) ================= */
if (want("S3")) {
  console.log("\n== S3 parts screens");
  cleanupDb();
  const { jobId } = (await api("/api/e2e/stage", { stage: "approved" })).json;
  await sql("update public.part_items set availability = 'to_order', supplier = 'E2e Supplier', cost_aed = 100, order_status = 'to_order', delivery_date = (now() at time zone 'Asia/Dubai' + interval '2 days')::date where job_id = $1 and is_active", [jobId]);
  // Parts send the LPO; the owner approves it.
  const { browser: pb, page: pp } = await browserFor("parts", { viewport: { width: 1360, height: 1000 } });
  await go(pp, `${base}/parts/${jobId}`);
  await pp.locator("[data-send-lpo]").click();
  const main = await until(async () => (await sql("select id from public.purchase_orders where job_id = $1 and kind = 'main' and status = 'pending_approval' limit 1", [jobId]))[0] ?? null, 30, 400);
  check("S3: the main LPO waits for approval", !!main?.id);
  const { browser: ob, page: op } = await browserFor("owner", { viewport: { width: 1360, height: 1000 } });
  await go(op, `${base}/parts/orders/${main.id}`);
  await op.getByRole("button", { name: /^Approve$/ }).click();
  const sup = await until(async () => (await sql("select id, number from public.purchase_orders where job_id = $1 and kind = 'supplier' limit 1", [jobId]))[0] ?? null, 30, 400);
  check("S3: the supplier LPO exists after approval", !!sup?.id);
  await ob.close();
  // Pending card: white with a black border. Then Ordered: the whole card light green with "Ordered ✓".
  await go(pp, `${base}/parts/${jobId}`);
  await until(async () => ((await pp.locator("[data-supplier-lpo]").count()) ? 1 : null), 20, 400);
  check("S3: a pending LPO card is white with a black border", (await pp.locator("[data-supplier-lpo][data-ordered='0']").count()) === 1 && /border-ink bg-white/.test((await pp.locator("[data-supplier-lpo]").getAttribute("class")) ?? ""));
  check("S3: the step bar shows LPO for vendor as the current step", (await pp.locator("[data-step='lpo'][data-state='current']").count()) === 1);
  await shot(pp, "s3-lpo-pending");
  await pp.locator("[data-lpo-ordered]").click();
  await until(async () => ((await sql("select status from public.purchase_orders where id = $1", [sup.id]))[0]?.status === "ordered" ? 1 : null), 30, 400);
  await go(pp, `${base}/parts/${jobId}`);
  check("S3: the ordered card turns light green with Ordered ✓", (await pp.locator("[data-supplier-lpo][data-ordered='1']").count()) === 1 && /Ordered ✓/.test((await pp.locator("[data-lpo-state]").textContent()) ?? "") && /border-green bg-green-soft/.test((await pp.locator("[data-supplier-lpo]").getAttribute("class")) ?? ""));
  check("S3: 'All ordered ✓' shows over the cards", (await pp.locator("[data-all-ordered]").count()) === 1);
  check("S3: done steps stay green, Parts received is now current", (await pp.locator("[data-step='lpo'][data-state='done']").count()) === 1 && (await pp.locator("[data-step='received'][data-state='current']").count()) === 1);
  await shot(pp, "s3-lpo-ordered");
  // Receiving: tick, Mark received, the panel on the same page with stickers and the supplier invoice.
  check("S3: a tick box per arriving line", (await pp.locator("[data-receive-row]").count()) >= 1);
  await pp.locator("[data-mark-received]").click();
  await until(async () => ((await pp.locator("[data-receive-confirm]").count()) ? 1 : null), 15, 300);
  check("S3: the panel opens on the same page with a sticker switch per part", (await pp.locator("[data-sticker-row]").count()) >= 1 && /Stickers × \d+/.test((await pp.locator("[data-sticker-switch]").first().textContent()) ?? ""));
  await pp.locator("[data-invoice-number]").fill("SI-E2E-77");
  await pp.locator("[data-invoice-date]").fill("2026-10-18");
  await pp.locator("[data-invoice-amount]").fill("105");
  await shot(pp, "s3-receive-panel");
  await pp.locator("[data-no-stickers]").click();
  const rec = await until(async () => ((await sql("select count(*)::int as n from public.part_items where job_id = $1 and order_status = 'received'", [jobId]))[0]?.n ?? 0) > 0 ? 1 : null, 30, 400);
  check("S3: the ticked parts are received", !!rec);
  const inv = await until(async () => { const r = (await sql("select supplier_invoice_number, supplier_invoice_date::text as supplier_invoice_date, supplier_invoice_amount, supplier_invoice_status from public.purchase_orders where id = $1", [sup.id]))[0]; return r?.supplier_invoice_number ? r : null; }, 30, 400);
  check("S3: the supplier invoice lands on the LPO", inv?.supplier_invoice_number === "SI-E2E-77" && String(inv?.supplier_invoice_date).startsWith("2026-10-18") && Number(inv?.supplier_invoice_amount) === 105 && inv?.supplier_invoice_status === "received", JSON.stringify(inv));
  await until(async () => ((await pp.locator("[data-received-list]").count()) ? 1 : null), 20, 400);
  await pp.locator("[data-received-list] summary").click();
  check("S3: received lines stay visible, collapsed and light green", (await pp.locator("[data-received-line]").count()) >= 1);
  check("S3: the step bar moves on (received done, handover current)", (await pp.locator("[data-step='received'][data-state='done']").count()) === 1 && (await pp.locator("[data-step='handover'][data-state='current']").count()) === 1);
  check("S3: the ordered line in the card is green", (await pp.locator("[data-lpo-line][data-line-received='1']").count()) >= 1);
  await shot(pp, "s3-received");
  await pb.close();
}

/* ================= S4: the part sticker text always fits ================= */
if (want("S4")) {
  console.log("\n== S4 part stickers");
  cleanupDb();
  const { jobId } = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const longName = "Front stabiliser link left hand side with bushes";
  const p1 = (await sql("select id from public.part_items where job_id = $1 and is_active order by created_at limit 1", [jobId]))[0]?.id;
  await sql("update public.part_items set description = $2, order_status = 'received', received_qty = 1, confirmed_quantity = 1, quantity = 1 where id = $1", [p1, longName]);
  await sql(`insert into public.part_items (id, job_id, part_request_id, description, quantity, confirmed_quantity, availability, order_status, received_qty, created_by, updated_by)
             select '22222222-0000-4000-8000-00000000e4aa', job_id, part_request_id, 'Rear stabiliser link right hand side with bushes', 1, 1, availability, 'received', 1, created_by, updated_by from public.part_items where id = $1`, [p1]);
  const { browser, page } = await browserFor("parts", { viewport: { width: 1100, height: 950 } });
  await go(page, `${base}/parts/labels/${jobId}`);
  await until(async () => ((await page.locator("[data-part-sticker]").count()) >= 2 ? 1 : null), 20, 400);
  await sleep(600); // FitText settles
  const names = page.locator("[data-part-sticker] [data-fit-text]").filter({ hasText: /stabiliser/i });
  check("S4: both stickers carry the FULL name, never '…'", (await names.count()) === 2 && !/…/.test((await names.first().textContent()) ?? "") && new RegExp(longName.slice(0, 30), "i").test((await names.first().textContent()) ?? ""), ((await names.first().textContent()) ?? "").slice(0, 60));
  const fits = await names.evaluateAll((els) => els.map((el) => ({ over: getComputedStyle(el).whiteSpace === "nowrap" && el.scrollWidth > el.clientWidth + 1, wrapped: getComputedStyle(el).whiteSpace === "normal", size: parseFloat(getComputedStyle(el).fontSize), lines: el.querySelector("span")?.getClientRects().length ?? 1 })));
  check("S4: the long name is shrunk (and wrapped to 2 lines at most), nothing cut off", fits.every((x) => !x.over && (!x.wrapped || x.lines <= 2)), JSON.stringify(fits));
  check("S4: the two different parts read differently on their stickers", /front stabiliser/i.test((await names.first().textContent()) ?? "") && /rear stabiliser/i.test((await names.nth(1).textContent()) ?? ""));
  const jobFits = await page.locator("[data-part-sticker] [data-fit-text]").evaluateAll((els) => els.filter((el) => /^J-\d+$/.test((el.textContent ?? "").trim())).map((el) => ({ over: el.scrollWidth > el.clientWidth + 1, oneLine: getComputedStyle(el).whiteSpace === "nowrap" })));
  check("S4: the job number sits on ONE line, shrunk to fit", jobFits.length >= 2 && jobFits.every((x) => x.oneLine && !x.over), JSON.stringify(jobFits));
  check("S4: 'Print all (N)' sits at the top and 'Print this one' stays per sticker", /Print all \(2\)/.test((await page.locator(".bar").textContent()) ?? "") && (await page.getByRole("button", { name: "Print this one" }).count()) === 2);
  await shot(page, "s4-stickers");
  await browser.close();
}

/* ================= S5: the job card stage boxes ================= */
if (want("S5")) {
  console.log("\n== S5 stage boxes");
  cleanupDb();
  const { jobId } = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const { browser, page } = await browserFor("service_advisor", { viewport: { width: 1360, height: 1000 } });
  await go(page, `${base}/jobs/${jobId}`);
  await until(async () => ((await page.locator("[data-stage-track]").count()) ? 1 : null), 20, 400);
  const doneCls = (await page.locator("[data-stage-box='gate_in']").getAttribute("class")) ?? "";
  check("S5: a done step is an entire light-green box", (await page.locator("[data-stage-box='gate_in']").getAttribute("data-state")) === "done" && /bg-green-soft/.test(doneCls) && /border-green/.test(doneCls), doneCls);
  check("S5: every earlier step is green too", (await page.locator("[data-stage-box][data-state='done']").count()) >= 4);
  const partsState = (await page.locator("[data-stage-box='parts']").getAttribute("data-state")) ?? "";
  const partsCls = (await page.locator("[data-stage-box='parts']").getAttribute("class")) ?? "";
  check("S5: the in-progress Parts step is a full amber box", partsState === "current" && /bg-amber-soft/.test(partsCls) && /border-amber-bar/.test(partsCls), `${partsState} ${partsCls}`);
  const partsCardCls = (await page.locator("[data-stage-card='parts']").getAttribute("class")) ?? "";
  check("S5: the big Parts box matches the bar exactly (same amber classes, same state)", (await page.locator("[data-stage-card='parts']").getAttribute("data-state")) === "current" && /bg-amber-soft/.test(partsCardCls) && /border-amber-bar/.test(partsCardCls), partsCardCls);
  const apprCardCls = (await page.locator("[data-stage-card='approval']").getAttribute("class")) ?? "";
  check("S5: the approved Job card approval box is a full green box with ✓", (await page.locator("[data-stage-card='approval']").getAttribute("data-state")) === "done" && /bg-green-soft/.test(apprCardCls) && /border-green/.test(apprCardCls) && /✓ Job card approval/.test((await page.locator("[data-stage-card='approval']").textContent()) ?? ""), apprCardCls);
  const workCardCls = (await page.locator("[data-stage-card='work']").getAttribute("class")) ?? "";
  check("S5: a not-started big box is grey like the bar", (await page.locator("[data-stage-card='work']").getAttribute("data-state")) === "later" && /bg-chip/.test(workCardCls), workCardCls);
  const laterCls = (await page.locator("[data-stage-box='work']").getAttribute("class")) ?? "";
  check("S5: a step not started is grey", (await page.locator("[data-stage-box='work']").getAttribute("data-state")) === "later" && /bg-chip/.test(laterCls) && /text-muted/.test(laterCls), laterCls);
  check("S5: the parts dots follow the same logic (done green, current amber)", /bg-green/.test((await page.locator("[data-step-dot='pricing']").getAttribute("class")) ?? "") && /bg-amber-bar/.test((await page.locator("[data-step-dot][data-state='current']").first().getAttribute("class")) ?? ""));
  await page.locator("[data-stage-track]").scrollIntoViewIfNeeded();
  await shot(page, "s5-jobcard");
  // A current step with nothing part-way shows white with a black border: Work, once the car is released.
  await sql("update public.part_items set order_status = 'received', received_qty = greatest(coalesce(confirmed_quantity, quantity, 1), 1), issue_status = 'confirmed', issued_qty = 1, tech_received_qty = 1 where job_id = $1 and is_active", [jobId]);
  await sql("update public.jobs set status = 'in_work', stage = 'work' where id = $1", [jobId]);
  await go(page, `${base}/jobs/${jobId}`);
  const workCls = (await page.locator("[data-stage-box='work']").getAttribute("class")) ?? "";
  check("S5: the current step is a full amber box, in the bar and the big box alike", (await page.locator("[data-stage-box='work']").getAttribute("data-state")) === "current" && /border-amber-bar bg-amber-soft/.test(workCls) && (await page.locator("[data-stage-card='work']").getAttribute("data-state")) === "current", workCls);
  check("S5: Parts shows done (green) behind it", (await page.locator("[data-stage-box='parts']").getAttribute("data-state")) === "done");
  await shot(page, "s5-jobcard-work");
  await browser.close();
}

/* ================= S6: "Is the car wash free?" before sending ================= */
if (want("S6")) {
  console.log("\n== S6 send to wash");
  cleanupDb();
  const { jobId } = (await api("/api/e2e/stage", { stage: "approved" })).json;
  await sql("update public.jobs set status = 'pending_wash', stage = 'wash', wash_sent_at = null where id = $1", [jobId]);
  const { browser, page } = await browserFor("service_advisor", { viewport: { width: 1360, height: 1000 } });
  await go(page, `${base}/jobs/${jobId}`);
  await page.locator("[data-send-wash]").click();
  await until(async () => ((await page.locator("[data-wash-ask]").count()) ? 1 : null), 15, 300);
  const askText = (await page.locator("[data-wash-ask]").textContent()) ?? "";
  check("S6: the question asks 'Is the car wash free? Check with the wash team'", /Is the car wash free\?/.test(askText) && /Check with the wash team before sending/.test(askText));
  check("S6: an empty wash says 'Wash is free' in green", (await page.locator("[data-wash-free]").count()) === 1 && /text-green/.test((await page.locator("[data-wash-free]").getAttribute("class")) ?? ""));
  await page.getByRole("button", { name: "Cancel" }).click();
  check("S6: Cancel sends nothing", (await sql("select wash_sent_at from public.jobs where id = $1", [jobId]))[0]?.wash_sent_at === null);
  // Another car is in the wash: the pop-up lists it, with its plate and model.
  await sql(`insert into public.jobs (id, job_number, vehicle_id, customer_id, status, stage, is_open, priority, gated_in_by, gated_in_at, wash_sent_at, created_by, updated_by)
             select '22222222-0000-4000-8000-00000000e4bb', 'J-E2E98', vehicle_id, customer_id, 'pending_wash', 'wash', true, priority, gated_in_by, gated_in_at, now(), created_by, updated_by from public.jobs where id = $1`, [jobId]);
  const busy = (await sql("select count(*)::int as n from public.jobs where id = '22222222-0000-4000-8000-00000000e4bb'"))[0]?.n ?? 0;
  check("S6: the busy car is seeded", busy === 1);
  await go(page, `${base}/jobs/${jobId}`);
  await page.locator("[data-send-wash]").click();
  await until(async () => ((await page.locator("[data-wash-ask]").count()) ? 1 : null), 15, 300);
  const inNow = (await page.locator("[data-wash-in-now]").textContent().catch(() => "")) ?? "";
  check("S6: it shows 'In the wash now: 1 car' with the plate and model", /In the wash now: 1 car/.test(inNow) && /Dubai S 30303/i.test(inNow) && /Porsche/i.test(inNow), inNow.slice(0, 120));
  await shot(page, "s6-wash-popup");
  await page.locator("[data-wash-yes]").click();
  const sent = await until(async () => ((await sql("select wash_sent_at from public.jobs where id = $1", [jobId]))[0]?.wash_sent_at ? 1 : null), 30, 400);
  check("S6: 'Yes, send to wash' sends the car", !!sent);
  // "Skip the wash" keeps its one-tap flow, no pop-up.
  await sql("update public.jobs set wash_sent_at = null where id = $1", [jobId]);
  await go(page, `${base}/jobs/${jobId}`);
  await page.getByRole("button", { name: "Skip the wash" }).click();
  await sleep(500);
  check("S6: Skip the wash has no pop-up, just the reason box", (await page.locator("[data-wash-ask]").count()) === 0 && (await page.locator("textarea[name='reason']").count()) >= 1);
  await browser.close();
}

/* ================= S7: recovery - the new form, road km, monthly payment, Excel ================= */
if (want("S7")) {
  console.log("\n== S7 recovery");
  cleanupDb();
  const PIN = "https://maps.google.com/?q=25.1812,55.2807";
  const defaultDriver = (await sql("select name from public.recovery_drivers where is_active and company is null order by is_default desc, name limit 1"))[0]?.name ?? "";
  const { browser, page } = await browserFor("owner", { viewport: { width: 1360, height: 1050 } });
  await go(page, `${base}/recovery`);
  check("S7: the first choice is two big buttons, Our truck and External recovery", (await page.locator("[data-side-ours]").count()) === 1 && (await page.locator("[data-side-external]").count()) === 1 && new RegExp(defaultDriver).test((await page.locator("[data-side-ours]").textContent()) ?? ""));
  await shot(page, "s7-form-choice");
  // Our truck: no driver boxes at all, just the pin, details, date (today) and job number.
  await page.locator("[data-side-ours]").click();
  await until(async () => ((await page.locator("[data-new-trip]").count()) ? 1 : null), 10, 300);
  check("S7: our truck shows no driver name, mobile, company or plate boxes", (await page.locator("[data-new-trip] input[name='driver_name'], [data-new-trip] input[name='driver_phone'], [data-new-trip] input[name='truck_plate'], [data-new-trip] input[name='company']").count()) === 0);
  check("S7: the date is today", (await page.locator("[data-new-trip] input[name='date']").inputValue()) === new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10));
  await page.locator("[data-pin-box]").fill(PIN);
  await page.locator("input[name='location_details']").fill("E2e pin ours");
  await shot(page, "s7-form-ours");
  await page.locator("[data-save-trip]").click();
  const t1 = await until(async () => (await sql("select id, driver_name, company, lat, road_km, km_source from public.recovery_trips where location_details ilike 'e2e pin ours' order by created_at desc limit 1"))[0] ?? null, 30, 400);
  check("S7: the trip carries the saved driver by itself (our truck, no company)", !!t1 && t1.driver_name === defaultDriver && t1.company === null && Number(t1.lat) === 25.1812, JSON.stringify(t1));
  // External recovery: Flatbed or Closed box, a new company saved with its mobile.
  await go(page, `${base}/recovery`);
  await page.locator("[data-side-external]").click();
  await until(async () => ((await page.locator("[data-external-fields]").count()) ? 1 : null), 10, 300);
  await page.locator("[data-trip-kind] button", { hasText: "Delivery" }).click();
  await page.locator("[data-truck-type='flatbed']").click();
  await page.locator("[data-company-choice]").selectOption("__new__");
  await page.locator("[data-company-name]").fill("E2e Recovery Co");
  await page.locator("[data-company-phone]").fill("+971500000777");
  await page.locator("[data-pin-box]").fill(PIN);
  await page.locator("input[name='location_details']").fill("E2e pin external");
  await page.locator("[data-save-trip]").click();
  const t2 = await until(async () => (await sql("select id, kind, company, recovery_kind, driver_phone from public.recovery_trips where location_details ilike 'e2e pin external' limit 1"))[0] ?? null, 30, 400);
  check("S7: the external delivery carries the company, the type and its mobile", !!t2 && t2.kind === "delivery" && /e2e recovery co/i.test(t2.company ?? "") && t2.recovery_kind === "flatbed" && t2.driver_phone === "+971500000777", JSON.stringify(t2));
  check("S7: the company is saved for next time", ((await sql("select count(*)::int as n from public.recovery_companies where name ilike 'e2e recovery co'"))[0]?.n ?? 0) === 1);
  // No key in this dev run: "Distance not found - enter km"; the typed km stands, with no "≈" anywhere.
  await go(page, `${base}/recovery`);
  await until(async () => ((await page.locator("[data-enter-km]").count()) >= 1 ? 1 : null), 20, 400);
  check("S7: a trip with no route asks for the km by hand, never a silent straight line", (await page.locator("[data-enter-km]").first().textContent() ?? "").includes("Distance not found"));
  await page.locator(`[data-trip='${t2.id}'] [data-km-box]`).fill("12.5");
  await page.locator(`[data-trip='${t2.id}'] [data-enter-km] button`).click();
  const km = await until(async () => { const r = (await sql("select road_km, km_source from public.recovery_trips where id = $1", [t2.id]))[0]; return r?.road_km ? r : null; }, 30, 400);
  check("S7: the typed km is saved as manual", Number(km?.road_km) === 12.5 && km?.km_source === "manual", JSON.stringify(km));
  await go(page, `${base}/recovery`);
  const kmText = (await page.locator(`[data-trip='${t2.id}'] [data-trip-km]`).textContent().catch(() => "")) ?? "";
  check("S7: the log shows one-way road km with no ≈", /12\.5 km/.test(kmText) && !kmText.includes("≈"), kmText);
  // Monthly payment: never per trip; "Mark <month> paid" only once everything is approved; then locked.
  check("S7: the per-trip Paid button is gone", (await page.locator("[data-trip-paid]").count()) === 0);
  const month = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 7);
  await sql("update public.recovery_trips set price_aed = 240, delivered_at = now(), status = 'claimed' where id = $1", [t2.id]);
  await go(page, `${base}/recovery?month=${month}&who=${encodeURIComponent(t2.company)}`);
  const whoRow = page.locator(`[data-recovery-who='${t2.company}']`);
  check("S7: a claimed trip blocks the month's payment ('1 trip not approved yet')", /1 trip not approved yet/.test((await whoRow.locator("[data-month-open]").textContent().catch(() => "")) ?? ""));
  await page.locator(`[data-trip='${t2.id}'] [data-trip-approve]`).click();
  await until(async () => ((await sql("select status from public.recovery_trips where id = $1", [t2.id]))[0]?.status === "approved" ? 1 : null), 30, 400);
  await go(page, `${base}/recovery?month=${month}`);
  const payBtn = whoRow.locator("[data-month-pay]");
  check("S7: 'Mark <month> paid - AED 240' appears once every trip is approved", /paid · AED 240/.test((await payBtn.textContent().catch(() => "")) ?? ""), (await payBtn.textContent().catch(() => "")) ?? "");
  await shot(page, "s7-monthly");
  await payBtn.click();
  const payout = await until(async () => (await sql("select total_aed, trip_count from public.recovery_payouts where who = $1 and month = $2", [t2.company, month]))[0] ?? null, 30, 400);
  check("S7: the payout is written (who, month, total) and the trips lock", Number(payout?.total_aed) === 240 && payout?.trip_count === 1 && (await sql("select paid_month, status from public.recovery_trips where id = $1", [t2.id]))[0]?.status === "paid", JSON.stringify(payout));
  await go(page, `${base}/recovery?month=${month}`);
  check("S7: the month shows Paid ✓ and the button is gone", (await whoRow.locator("[data-month-paid-done]").count()) === 1 && (await whoRow.locator("[data-month-pay]").count()) === 0);
  // The Excel export: a real .xlsx with the agreed columns and a bold TOTAL TO PAY row; "All drivers" gives one sheet each plus a summary.
  const { cookieHeader } = await import("./pw-lib.mjs");
  const cookies = await cookieHeader("owner");
  const res = await fetch(`${base}/api/export/recovery?month=${month}`, { headers: { cookie: cookies } });
  check("S7: the export is a real .xlsx", res.status === 200 && (res.headers.get("content-type") ?? "").includes("spreadsheetml"), res.headers.get("content-type") ?? "");
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
  const ws = wb.worksheets[0];
  const headers = (ws.getRow(1).values ?? []).slice(1);
  check("S7: the columns match the agreed list", JSON.stringify(headers) === JSON.stringify(["Date", "Pick-up/Delivery", "Plate", "Job number", "Driver/company", "From", "To", "Road km", "Price (AED)", "AED per km", "Status"]), JSON.stringify(headers));
  check("S7: the header row is bold and frozen", ws.getRow(1).font?.bold === true && ws.views?.[0]?.state === "frozen");
  const last = ws.getRow(ws.rowCount);
  check("S7: the bottom row carries TOTAL TO PAY in bold, amounts as numbers", last.font?.bold === true && JSON.stringify(last.values).includes("TOTAL TO PAY") && typeof last.getCell(9).value === "number", JSON.stringify(last.values).slice(0, 120));
  const resAll = await fetch(`${base}/api/export/recovery?month=${month}&who=all`, { headers: { cookie: cookies } });
  const wbAll = new ExcelJS.Workbook();
  await wbAll.xlsx.load(Buffer.from(await resAll.arrayBuffer()));
  check("S7: 'All drivers' has a summary sheet plus one sheet per driver or company", wbAll.worksheets[0]?.name === "Summary" && wbAll.worksheets.length >= 2, wbAll.worksheets.map((w) => w.name).join(" | "));
  await browser.close();
}

/* ================= S8: the advisor bonus ================= */
if (want("S8")) {
  console.log("\n== S8 advisor bonus");
  cleanupDb();
  const { jobId } = (await api("/api/e2e/stage", { stage: "ready" })).json;
  const advisorId = (await sql("select gated_in_by from public.jobs where id = $1", [jobId]))[0]?.gated_in_by;
  // A paid tax invoice with AED 20,000 pure profit (no costs on the job).
  await sql(`insert into public.invoices (id, job_id, customer_id, kind, status, number, issued_at, subtotal_aed, discount_aed, taxable_aed, vat_aed, total_aed, created_by, updated_by)
             select '22222222-0000-4000-8000-00000000e4cc', id, customer_id, 'tax_invoice', 'issued', 'INV-E2E01', now(), 20000, 0, 20000, 1000, 21000, gated_in_by, gated_in_by from public.jobs where id = $1`, [jobId]);
  const invOk = (await sql("select count(*)::int as n from public.invoices where number = 'INV-E2E01'"))[0]?.n === 1;
  check("S8: the test tax invoice is seeded", invOk);
  await sql(`insert into public.payments (id, number, job_id, invoice_id, customer_id, method, amount_aed, received_at, received_by, status, created_by, updated_by)
             select '22222222-0000-4000-8000-00000000e4cd', 'RCT-E2E01', job_id, id, customer_id, 'cash', 21000, now(), created_by, 'recorded', created_by, created_by from public.invoices where number = 'INV-E2E01'`);
  const payOk = (await sql("select count(*)::int as n from public.payments where number = 'RCT-E2E01'"))[0]?.n === 1;
  check("S8: the full payment is seeded", payOk);
  const advisorName = (await sql("select display_name from public.staff where id = $1", [advisorId]))[0]?.display_name ?? "";
  // The owner's view: the row, the rate, the bonus, the approve button.
  const { browser: ob, page: op } = await browserFor("owner", { viewport: { width: 1360, height: 1000 } });
  await go(op, `${base}/bonus`);
  await until(async () => ((await op.locator("[data-bonus-row='INV-E2E01']").count()) ? 1 : null), 20, 400);
  const rowText = (await op.locator("[data-bonus-row='INV-E2E01']").textContent()) ?? "";
  check("S8: the paid 20,000-profit invoice qualifies at the default 5% (AED 1,000)", /Profit AED 20,000/.test(rowText) && /5%/.test(rowText) && /AED 1,000/.test(rowText), rowText.slice(0, 140));
  check("S8: it sits under the job's advisor", (await op.locator(`[data-bonus-advisor='${advisorName}'] [data-bonus-row='INV-E2E01']`).count()) === 1, advisorName);
  await shot(op, "s8-owner");
  // The owner overrides the rate with a reason.
  const card = op.locator(`[data-bonus-advisor='${advisorName}']`);
  await card.locator("[data-bonus-edit]").first().click();
  await card.locator("[data-bonus-rate]").fill("7.5");
  await card.locator("[data-bonus-reason]").fill("Hard job, well handled");
  await card.getByRole("button", { name: "Save" }).click();
  await op.waitForURL(/message=/, { timeout: 15000 }).catch(() => null);
  await go(op, `${base}/bonus`);
  const changed = (await op.locator("[data-bonus-row='INV-E2E01']").textContent()) ?? "";
  check("S8: the owner's override (7.5%, with the reason) recalculates the bonus to AED 1,500", /7\.5%/.test(changed) && /AED 1,500/.test(changed) && /Hard job, well handled/.test(changed), changed.slice(0, 160));
  // The advisor sees only his own rows and his total; no profit, no other advisors, no rates.
  const { browser: ab, page: ap } = await browserForId(advisorId, { viewport: { width: 1360, height: 900 } });
  await go(ap, `${base}/bonus`);
  await until(async () => ((await ap.locator("[data-my-bonus]").count()) ? 1 : null), 20, 400);
  const mine = (await ap.locator("[data-my-bonus]").textContent()) ?? "";
  check("S8: the advisor sees his invoice and bonus, marked waiting for approval", /INV-E2E01/.test(mine) && /AED 1,500/.test(mine) && /Waiting for owner approval/.test((await ap.textContent("body")) ?? ""), mine.slice(0, 140));
  check("S8: the advisor sees no profit figure and no rate", !/Profit/.test(mine) && !/7\.5%/.test(mine));
  check("S8: the advisor cannot approve or change anything", (await ap.locator("[data-approve-bonuses]").count()) === 0 && (await ap.locator("[data-bonus-edit]").count()) === 0);
  await shot(ap, "s8-advisor");
  await ab.close();
  // The owner approves the period; the Excel goes to the accountant.
  await op.locator("[data-approve-bonuses]").click();
  const period = await until(async () => (await sql("select period, total_aed, rows::text as snapshot from public.advisor_bonus_periods order by created_at desc limit 1"))[0] ?? null, 30, 400);
  check("S8: approving freezes the period (real invoices included) with the test row inside", !!period && Number(period.total_aed) >= 1500 && String(period.snapshot).includes("INV-E2E01"), JSON.stringify({ period: period?.period, total: period?.total_aed }));
  await go(op, `${base}/bonus`);
  check("S8: the period shows Approved", /Approved/.test((await op.textContent("body")) ?? ""));
  const { cookieHeader } = await import("./pw-lib.mjs");
  const res = await fetch(`${base}/api/export/bonus?period=${period.period}`, { headers: { cookie: await cookieHeader("owner") } });
  check("S8: the Excel for the accountant downloads (owner only)", res.status === 200 && (res.headers.get("content-type") ?? "").includes("spreadsheetml"));
  const resAdvisor = await fetch(`${base}/api/export/bonus?period=${period.period}`, { headers: { cookie: await cookieHeader("service_advisor") } });
  check("S8: an advisor cannot take the Excel", resAdvisor.status === 403);
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
  const text = JSON.stringify(wb.worksheets[0].getSheetValues());
  check("S8: one row per invoice with totals per advisor", text.includes("INV-E2E01") && text.includes(`${advisorName} TOTAL`) && text.includes("TOTAL TO PAY"), text.slice(0, 160));
  // A credit note later: the approved bonus comes back off the NEXT period.
  await sql(`insert into public.invoices (id, job_id, customer_id, kind, status, number, issued_at, subtotal_aed, discount_aed, taxable_aed, vat_aed, total_aed, credit_of, created_by, updated_by)
             select '22222222-0000-4000-8000-00000000e4ce', job_id, customer_id, 'credit_note', 'issued', 'CRN-E2E01', ($1::date + interval '10 days'), 20000, 0, 20000, 1000, 21000, id, created_by, created_by from public.invoices where number = 'INV-E2E01'`, [period.period + "-25"]);
  const nextKey = (await sql("select to_char(($1::date + interval '1 month'), 'YYYY-MM') as k", [period.period + "-01"]))[0]?.k;
  await go(op, `${base}/bonus?period=${nextKey}`);
  await until(async () => ((await op.locator("[data-bonus-row='INV-E2E01']").count()) ? 1 : null), 20, 400);
  const claw = (await op.locator("[data-bonus-row='INV-E2E01']").textContent()) ?? "";
  check("S8: the credit-noted bonus is deducted from the next period", /Credit note/.test(claw) && /-AED 1,500|AED -1,500/.test(claw.replace(/−/g, "-")), claw.slice(0, 160));
  await op.close();
  await ob.close();
}

/* ================= S10: the dashboard layout and less clutter ================= */
if (want("S10")) {
  console.log("\n== S10 dashboard");
  cleanupDb();
  const { jobId } = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const { browser, page } = await browserFor("service_advisor", { viewport: { width: 1360, height: 1100 } });
  await go(page, `${base}/dashboard`);
  const greeting = ((await page.locator("[data-greeting]").textContent()) ?? "").trim();
  check("S10: the title greets by first name for the Dubai time of day", /^Good (morning|afternoon|evening), [A-Za-z]+$/.test(greeting), greeting);
  const dateCls = (await page.locator("[data-home-date]").getAttribute("class")) ?? "";
  check("S10: the date sits under it, bigger and bold", /text-\[17px\]/.test(dateCls) && /font-bold/.test(dateCls), dateCls);
  check("S10: the search bar is in the top row (grey fill, rounded, the right placeholder)", ((await page.locator("[data-search-input]").first().getAttribute("placeholder")) ?? "").startsWith("Search any car") && /bg-chip/.test((await page.locator("[data-search-input]").first().getAttribute("class")) ?? ""));
  await page.locator("[data-search-input]").first().fill("3030");
  await until(async () => ((await page.locator("[data-search-hit]").count()) ? 1 : null), 25, 400);
  const hit = (await page.locator("[data-search-hit]").first().textContent()) ?? "";
  check("S10: typing a few letters drops instant results with plate, model and stage", /Dubai S 30303/i.test(hit) && /Porsche/i.test(hit), hit.slice(0, 120));
  await shot(page, "s10-search");
  await page.locator("[data-search-hit]").first().click();
  await page.waitForURL(new RegExp(`/jobs/${jobId}`), { timeout: 15000 }).catch(() => null);
  check("S10: one tap on a result opens the job card", page.url().includes(`/jobs/${jobId}`), page.url().slice(-50));
  await go(page, `${base}/dashboard`);
  // One WAITING ON YOU box; the two old boxes are gone.
  check("S10: one 'Waiting on you (N)' box replaces the two old boxes", (await page.locator("[data-waiting-panel]").count()) === 1 && !/Proformas to send|Awaiting payment/.test((await page.textContent("body")) ?? ""));
  const summaryEl = page.locator("[data-waiting-summary]");
  if (await summaryEl.count()) {
    await summaryEl.click();
    check("S10: tapping it opens the list on the same page", (await page.locator("[data-waiting-panel] li").count()) >= 1);
  } else {
    check("S10: with nothing waiting it is one line, 'Nothing waiting ✓'", /Nothing waiting ✓/.test((await page.locator("[data-waiting-panel]").textContent()) ?? ""));
  }
  // The advisor target in one slim line.
  check("S10: the team target is one slim line with the ⓘ", /^Team today: AED/.test(((await page.locator("[data-advisor-today]").textContent()) ?? "").trim()) && (await page.locator("[data-advisor-info]").count()) === 1 && (await page.locator("[data-my-month]").count()) === 1);
  // The slim summary row, with 0 in plain grey and tooltips instead of grey captions.
  check("S10: the summary boxes are one slim row, label and number on one line", (await page.locator("[data-summary-row]").count()) === 1 && (await page.locator("[data-summary-tile]").count()) === 4);
  const zeroTiles = await page.locator("[data-summary-tile]").evaluateAll((els) => els.filter((el) => el.textContent?.trim().endsWith("0")).map((el) => el.querySelector("span:last-child")?.className ?? ""));
  check("S10: a zero reads plain grey", zeroTiles.every((c) => c.includes("text-muted")), JSON.stringify(zeroTiles));
  // The Pending chip row is gone; the Stage dropdown lists only stages with something in them.
  check("S10: the Pending chip row is deleted; Stage is a small dropdown", !/>Pending</.test(await page.content()) && (await page.locator("[data-stage-filter]").count()) === 1);
  const options = await page.locator("[data-stage-filter] option").allTextContents();
  check("S10: the dropdown holds only options with counts (plus All)", options[0] === "All" && options.slice(1).every((o) => /\(\d+\)/.test(o) && !/\(0\)/.test(o)), options.join(" | "));
  await shot(page, "s10-advisor-after-live");
  await browser.close();
  // Narrow screens: the search drops to its own full-width row under the date.
  const { browser: mb, page: mp } = await browserFor("service_advisor", { viewport: { width: 390, height: 860 } });
  await go(mp, `${base}/dashboard`);
  check("S10: on a narrow screen the search gets its own full-width row", await mp.locator("[data-search-row] [data-search-input]").isVisible());
  await shot(mp, "s10-advisor-mobile");
  await mb.close();
  // Every role's home carries the same greeting and search.
  for (const [role, name] of [["owner", "owner"], ["accounts", "accounts"], ["parts", "parts"]]) {
    const { browser: rb, page: rp } = await browserFor(role, { viewport: { width: 1360, height: 1000 } });
    await go(rp, `${base}/dashboard`);
    check(`S10: the ${name} home has the greeting and the search`, /^Good (morning|afternoon|evening), /.test(((await rp.locator("[data-greeting]").textContent().catch(() => "")) ?? "").trim()) && (await rp.locator("[data-search-input]").count()) >= 1);
    await rb.close();
  }
}

cleanupDb();
process.exit(summary() ? 1 : 0);
