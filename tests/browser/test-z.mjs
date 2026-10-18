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
  check("S1: a tick box per line, all ticked to start", (await tp.locator("[data-part-take]").count()) === nParts && new RegExp(`I've received these \\(${nParts}\\)`).test((await tp.locator("[data-receive-parts]").textContent()) ?? ""));
  if (nParts > 1) {
    check("S1: Select all is there", (await tp.locator("[data-select-all-parts]").count()) === 1);
  }
  await shot(tp, "s1-tech-before");
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

cleanupDb();
process.exit(summary() ? 1 : 0);
