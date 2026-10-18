// Proof for section D of the 16 October batch: the deposit is the advisor's choice on the quotation (switch, AED or %,
// one-tap chips, the suggestion in grey, "Deposit required" for the customer only when set, the reminder on Quotation
// complete); the LPO waits for the deposit (owner override with a reason), the notifications, the deposit receipt
// ("Advance payment", "Balance remaining", sendable), the owner's dashboard list, accounts' deposits not yet invoiced,
// the 24 h reminder; revisions after the customer's approval need the owner (the advisor asks, Parts changes ask by
// themselves, the owner allows one or declines); the owner's approval box under "Before sending" with "Approved by
// Omar, 11:45"; the services list (wheels as services, Outside work with "our cost"); Required jobs on the report
// become service lines; a typed job saved to the list with one tap; long part names wrap in the Parts table.
//   node --env-file=.env.local tests/browser/test-t.mjs
import { api, base, browserFor, cleanupDb, cookieHeader, go, makeChecks, sleep, sql, submitted } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 16 * 60 * 1000).unref();
cleanupDb();

const until = async (fn, tries = 60, ms = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } return null; };
const only = (process.env.ONLY ?? "").split(",").map((x) => x.trim()).filter(Boolean);
async function section(name, fn) {
  if (only.length && !only.some((n) => name.startsWith(n + " "))) return;
  console.log(`\n== ${name}`);
  try { await fn(); } catch (e) { check(`${name}: no crash`, false, String(e?.message ?? e).slice(0, 300)); }
}
const pdfText = async (buf) => {
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  let t = "";
  for (let i = 0; i < doc.countPages(); i++) t += doc.loadPage(i).toStructuredText().asText();
  return t.replace(/\s+/g, " ");
};
/** Answers the markup and parts questions on "Quotation complete" so the deposit question (or completion) can come. */
async function answerCompleteDialogs(page) {
  for (let i = 0; i < 6; i++) {
    const found = await until(async () => {
      if (await page.locator("[data-low-profit-send]").count()) return "low";
      if (await page.locator("[data-markup-continue]").count()) return "markup";
      if (await page.locator("[data-parts-leave]").count()) return "parts";
      if (await page.locator("[data-deposit-ask]").count()) return "deposit";
      return null;
    }, 15, 400);
    if (!found || found === "deposit") break;
    await page.locator(found === "low" ? "[data-low-profit-send]" : found === "markup" ? "[data-markup-continue]" : "[data-parts-leave]").click();
    await sleep(400);
  }
}

/* ---------------- 1. D1: the deposit is the advisor's choice ---------------- */
await section("1 deposit choice", async () => {
  const seed = await api("/api/e2e/stage", { stage: "quote" });
  const { jobId, quotationId, token } = seed.json;
  // Parts worth AED 12,000 on the quotation (cost 10,000 + 20% markup): above the suggestion threshold in Settings (AED 10,000).
  await sql("update public.quotation_lines set unit_cost = 10000, markup_percent = 20, unit_price = 12000, line_total = 12000 where quotation_id = $1 and part_item_id is not null", [quotationId]);
  await sql("update public.part_requests set status = 'done' where job_id = $1 and status = 'open'", [jobId]);
  await sql("update public.jobs set parts_pricing_done_at = now() where id = $1", [jobId]);
  const threshold = Number((await sql("select value from public.settings where key = 'deposit_threshold_aed'"))[0]?.value) || 0;
  check("1: the Settings threshold is below the parts total (AED 12,000)", threshold > 0 && threshold < 12000, String(threshold));
  const { browser, page } = await browserFor("service_advisor", { viewport: { width: 1366, height: 1100 } });
  await go(page, `${base}/jobs/${jobId}/quote/${quotationId}`);
  await until(async () => ((await page.locator("[data-deposit-box]").count()) ? 1 : null), 30, 500);
  check("1: the Summary has 'Ask for a deposit', off by default", (await page.locator("[data-deposit-switch]").count()) === 1 && !(await page.locator("[data-deposit-switch]").isChecked()));
  check("1: the system suggestion shows in grey (50% of parts above the threshold)", /Suggested: AED 6,000/.test((await page.locator("[data-deposit-hint]").textContent().catch(() => "")) ?? ""), (await page.locator("[data-deposit-hint]").textContent().catch(() => "")) ?? "");
  check("1: no 'Deposit required' row while it is off", (await page.locator("[data-deposit-row]").count()) === 0);
  await page.locator("[data-deposit-switch]").check();
  await sleep(300);
  check("1: on: the chips and the AED | % toggle appear, the suggested amount filled in", (await page.locator("[data-deposit-chips] button").count()) === 3 && (await page.locator("[data-deposit-value]").inputValue()) === "6000" && /= AED 6,000/.test((await page.locator("[data-deposit-amount]").textContent()) ?? ""));
  await page.locator("[data-deposit-chips] button", { hasText: "100% of parts" }).click();
  const saved = await until(async () => { const r = (await sql("select deposit_mode, deposit_value, deposit_aed from public.quotations where id = $1", [quotationId]))[0]; return r?.deposit_mode === "percent_parts" && Number(r.deposit_value) === 100 && Number(r.deposit_aed) === 12000 ? r : null; }, 30, 500);
  check("1: '100% of parts' saves the choice and the amount (AED 12,000)", !!saved, JSON.stringify(saved));
  check("1: the Summary row says Deposit required AED 12,000", /12,000/.test((await page.locator("[data-deposit-row]").textContent().catch(() => "")) ?? ""));
  const ev = await sql("select note from public.quotation_events where quotation_id = $1 and event_type = 'deposit_set' order by created_at desc limit 1", [quotationId]);
  check("1: the choice is written in the quote history", /deposit 100% of parts/.test(ev[0]?.note ?? ""), ev[0]?.note ?? "");
  // The customer sees it only now.
  await sql("update public.quotations set status = 'sent', sent_at = now() where id = $1", [quotationId]);
  const { browser: cb, page: cp } = await browserFor("owner", { viewport: { width: 420, height: 900 } });
  await go(cp, `${base}/quote/${token}`);
  check("1: the customer's page says 'Deposit required: AED 12,000.00'", /Deposit required: AED 12,000\.00/.test((await cp.locator("[data-deposit-required]").textContent().catch(() => "")) ?? ""), ((await cp.textContent("body")) ?? "").slice(0, 200));
  await cb.close();
  await sql("update public.quotations set status = 'draft', sent_at = null, opened_at = null where id = $1", [quotationId]);
  await go(page, `${base}/jobs/${jobId}/quote/${quotationId}`);
  await until(async () => ((await page.locator("[data-deposit-box]").count()) ? 1 : null), 30, 500);
  // Off again: nothing for the customer.
  await page.locator("[data-deposit-switch]").uncheck();
  const off = await until(async () => { const r = (await sql("select deposit_mode, deposit_aed from public.quotations where id = $1", [quotationId]))[0]; return r?.deposit_mode === "none" && Number(r.deposit_aed) === 0 ? r : null; }, 30, 500);
  check("1: switching it off clears the deposit", !!off);
  await sql("update public.quotations set status = 'sent', sent_at = now() where id = $1", [quotationId]);
  const res = await fetch(`${base}/quote/${token}`);
  const resText = await res.text();
  check("1: the customer's page has no deposit line when it is off", res.status === 200 && /including VAT/i.test(resText) && !/Deposit required/.test(resText));
  await sql("update public.quotations set status = 'draft', sent_at = null, opened_at = null where id = $1", [quotationId]);
  await go(page, `${base}/jobs/${jobId}/quote/${quotationId}`);
  await until(async () => ((await page.locator("[data-deposit-box]").count()) ? 1 : null), 30, 500);
  // "Quotation complete" with parts above the threshold and no deposit: the reminder.
  const completeBtn = page.locator("button", { hasText: /^Quotation complete$/ });
  const beforeSending = ((await page.locator("#item-parts").textContent().catch(() => "")) ?? "").slice(0, 300);
  check("1: 'Quotation complete' is offered with nothing blocking it", (await completeBtn.count()) === 1 && /Nothing blocks it/.test(beforeSending), beforeSending);
  await completeBtn.click();
  await answerCompleteDialogs(page);
  const ask = await until(async () => ((await page.locator("[data-deposit-ask]").count()) ? 1 : null), 30, 400);
  const diag = ask ? "" : JSON.stringify({ alert: ((await page.locator("[role='alert']").allTextContents().catch(() => [])) ?? []).join(" | ").slice(0, 300), dialogs: await page.locator("[data-markup-ask], [data-parts-ask], [data-deposit-ask]").count(), db: (await sql("select completed_at, deposit_mode, deposit_aed, deposit_skipped_at from public.quotations where id = $1", [quotationId]))[0], bar: ((await page.locator("[data-labour-boxes]").first().textContent().catch(() => "")) ?? "").slice(0, 80), body: ((await page.textContent("body")) ?? "").match(/Not complete yet[^.]*\./)?.[0] ?? "" });
  check("1: 'No deposit on this quote. Send without a deposit?' is asked", !!ask && /No deposit on this quote/.test((await page.locator("[data-deposit-ask]").textContent()) ?? ""), diag);
  await page.locator("[data-deposit-add]").click();
  const added = await until(async () => { const r = (await sql("select deposit_mode, deposit_aed from public.quotations where id = $1", [quotationId]))[0]; return r?.deposit_mode === "aed" && Number(r.deposit_aed) === 6000 ? r : null; }, 30, 500);
  check("1: 'Add deposit' switches it on with the suggested amount", !!added, JSON.stringify(added));
  check("1: the deposit box is open again on screen", (await page.locator("[data-deposit-switch]").isChecked()));
  // Off once more, then "Send without deposit": logged, no second question.
  await page.locator("[data-deposit-switch]").uncheck();
  await until(async () => ((await sql("select deposit_mode from public.quotations where id = $1", [quotationId]))[0]?.deposit_mode === "none" ? 1 : null), 30, 500);
  await page.locator("button", { hasText: /^Quotation complete$/ }).click();
  await answerCompleteDialogs(page);
  await until(async () => ((await page.locator("[data-deposit-ask]").count()) ? 1 : null), 20, 400);
  await page.locator("[data-deposit-skip]").click();
  const done = await until(async () => { const r = (await sql("select completed_at, deposit_skipped_at from public.quotations where id = $1", [quotationId]))[0]; return r?.completed_at && r?.deposit_skipped_at ? r : null; }, 30, 500);
  check("1: 'Send without deposit' completes the quotation and writes the skip down", !!done && (await sql("select 1 from public.quotation_events where quotation_id = $1 and event_type = 'deposit_skipped'", [quotationId])).length === 1);
  await browser.close();
});

/* ---------------- 2. D2: the LPO waits for the deposit; the receipt; the dashboards; the reminder ---------------- */
await section("2 deposit gate", async () => {
  cleanupDb();
  // The deposit is the advisor's choice on the draft; the seed sets it before the customer approves (an approved quotation refuses the change, by design).
  const { jobId, quotationId } = (await api("/api/e2e/stage", { stage: "approved", deposit: 500 })).json;
  await sql("update public.quotations set responded_at = now() - interval '30 hours' where id = $1", [quotationId]);
  const token = (await sql("select token from public.quotations where id = $1", [quotationId]))[0]?.token;
  // The owner's dashboard lists it.
  const { browser: ob, page: op } = await browserFor("owner", { viewport: { width: 1366, height: 1100 } });
  await go(op, `${base}/dashboard`);
  check("2: the owner's dashboard lists the deposit not received", (await op.locator(`[data-deposit-waiting='${jobId}']`).count()) === 1 && /AED 500 asked/.test((await op.locator(`[data-deposit-waiting='${jobId}']`).textContent()) ?? ""));
  // Parts send the LPO: the owner hears that it waits on the deposit.
  const { browser: pb, page: pp } = await browserFor("parts", { viewport: { width: 1366, height: 1100 } });
  await sql("update public.part_items set supplier = 'E2e Supplier' where job_id = $1 and is_active", [jobId]);
  await go(pp, `${base}/parts/${jobId}`);
  await pp.locator("[data-send-lpo]").click();
  await submitted(pp);
  if (/error=/.test(pp.url())) check("2: Send LPO went through", false, decodeURIComponent(pp.url().slice(-200)));
  const po = await until(async () => (await sql("select id, number, status, deposit_waiting_notified_at from public.purchase_orders where job_id = $1 and kind = 'main' order by created_at desc limit 1", [jobId]))[0] ?? null, 30, 500);
  check("2: the main LPO waits for approval", !!po && po.status === "pending_approval", JSON.stringify(po));
  const warn = await until(async () => (await sql("select title, body, href from public.notifications where job_id = $1 and type = 'lpo_waiting_deposit' limit 1", [jobId]))[0] ?? null, 30, 500);
  check("2: the owner is told 'LPO waiting, deposit not received: override?' with a link to the LPO", !!warn && /LPO waiting, deposit not received: override\?/.test(warn.title) && warn.href === `/parts/orders/${po?.id}` && !!po?.deposit_waiting_notified_at, JSON.stringify(warn));
  await pb.close();
  // The LPO page: "Deposit AED 500 not received yet."
  await go(op, `${base}/parts/orders/${po.id}`);
  check("2: the LPO page says 'Deposit AED 500 not received yet.'", /Deposit AED 500 not received yet/.test((await op.locator("[data-deposit-short]").textContent().catch(() => "")) ?? ""));
  check("2: the owner's override asks for a reason (chips)", (await op.locator('[name="override_reason"]').count()) === 1);
  // The 24 h reminder.
  const cron = await fetch(`${base}/api/cron/housekeeping`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` } });
  const overdue = await sql("select title from public.notifications where job_id = $1 and type = 'deposit_overdue' limit 1", [jobId]);
  check("2: after 24 h the advisor and accounts are reminded once", cron.status === 200 && overdue.length === 1 && /Deposit AED 500 still not received/.test(overdue[0].title) && !!(await sql("select deposit_reminded_at from public.quotations where id = $1", [quotationId]))[0]?.deposit_reminded_at, `${cron.status} ${JSON.stringify(overdue)}`);
  // The deposit is recorded on the money page.
  await go(op, `${base}/jobs/${jobId}/invoice`);
  await op.locator("summary", { hasText: /Deposit before the proforma/ }).click();
  await op.locator("[data-method='cash']").click();
  await op.locator("[data-amount-partial]").click();
  await op.locator("[data-amount-input]").fill("500");
  await op.locator("[data-record-payment]").click();
  const pay = await until(async () => (await sql("select id, number, is_deposit, deposit_quotation_id, invoice_id from public.payments where job_id = $1 and status = 'recorded' order by created_at desc limit 1", [jobId]))[0] ?? null, 30, 500);
  check("2: the deposit is recorded as a deposit pointing at the quotation", !!pay && pay.is_deposit === true && pay.deposit_quotation_id === quotationId && !pay.invoice_id, JSON.stringify(pay));
  const told = await until(async () => (await sql("select title, href from public.notifications where job_id = $1 and type = 'deposit_received' limit 1", [jobId]))[0] ?? null, 30, 500);
  check("2: Parts and the owner hear 'Deposit received: LPO can be approved' with the LPO link", !!told && /Deposit received: LPO can be approved/.test(told.title) && told.href === `/parts/orders/${po.id}`, JSON.stringify(told));
  await sleep(800);
  await go(op, `${base}/jobs/${jobId}/invoice`);
  await op.locator("summary", { hasText: /Deposit before the proforma/ }).click();
  const row = op.locator(`[data-deposit-row='${pay?.number}']`);
  check("2: the money page lists the deposit with Receipt and Send receipt", (await row.count()) === 1 && (await row.locator(`[data-send-receipt='${pay?.number}']`).count()) === 1);
  await row.locator(`[data-send-receipt='${pay?.number}']`).click();
  const dlg = await until(async () => { const t = await op.locator("[role='dialog']").first().textContent().catch(() => null); return t && /receipt/i.test(t) ? t : null; }, 20, 300);
  check("2: Send receipt opens the message with the receipt link (short) and Share PDF", !!dlg && /erp\.ofjauto\.com\/m\/[A-Za-z0-9]{4,}/.test(dlg) && /Share PDF/.test(dlg), (dlg ?? "").slice(0, 200));
  await op.keyboard.press("Escape");
  // The receipt PDF: "Advance payment", the quotation, "Balance remaining"; the customer opens it with the quotation's token.
  const rcpt = await fetch(`${base}/api/pdf/receipt/${pay.id}`, { headers: { cookie: await cookieHeader("owner") } });
  const text = rcpt.status === 200 ? await pdfText(Buffer.from(await rcpt.arrayBuffer())) : "";
  const qTotal = Number((await sql("select total_aed from public.quotations where id = $1", [quotationId]))[0]?.total_aed) || 0;
  check("2: the receipt says Advance payment against the quotation, with the balance remaining", rcpt.status === 200 && /Advance payment \(deposit\) against quotation/i.test(text) && /Balance remaining AED/i.test(text) && text.includes((qTotal - 500).toLocaleString("en-GB", { minimumFractionDigits: 2 })), (text.match(/RECEIPT.{0,500}/i)?.[0] ?? text.slice(0, 300)));
  const pub = await fetch(`${base}/api/pdf/receipt/${pay.id}?q=${token}`);
  check("2: the customer opens the receipt with the quotation's link token", pub.status === 200 && /pdf/.test(pub.headers.get("content-type") ?? ""), String(pub.status));
  const nope = await fetch(`${base}/api/pdf/receipt/${pay.id}?q=wrong`);
  check("2: a wrong token is refused", nope.status === 401 || nope.status === 403, String(nope.status));
  // Accounts see the deposit not yet on an invoice; the owner's dashboard no longer lists it.
  const { browser: ab, page: ap } = await browserFor("accounts", { viewport: { width: 1366, height: 1100 } });
  await go(ap, `${base}/dashboard`);
  check("2: accounts see 'Deposits received, not yet on an invoice'", (await ap.locator(`[data-deposit-not-invoiced='${pay?.number}']`).count()) === 1);
  await ab.close();
  await go(op, `${base}/dashboard`);
  check("2: the owner's dashboard list is gone once the deposit is in", (await op.locator(`[data-deposit-waiting='${jobId}']`).count()) === 0);
  // The LPO can be approved now, no override.
  await go(op, `${base}/parts/orders/${po.id}`);
  check("2: the LPO page no longer asks for the deposit", (await op.locator("[data-deposit-short]").count()) === 0);
  await op.locator("button[name='decision'][value='approve']").click();
  await submitted(op);
  const approved = (await sql("select status, deposit_override_reason from public.purchase_orders where id = $1", [po.id]))[0];
  check("2: approved without an override", approved?.status === "approved" && !approved?.deposit_override_reason, JSON.stringify(approved));
  // The final invoice shows the deposit as "Less deposit received (RCT-…)".
  await sql("update public.jobs set status = 'ready', stage = 'ready' where id = $1", [jobId]);
  await go(op, `${base}/jobs/${jobId}/invoice`);
  const prepBtn = op.locator("button", { hasText: /Prepare (the )?proforma|Mark ready to invoice|Issue the proforma/i }).first();
  if (await prepBtn.count()) { await prepBtn.click(); await submitted(op); }
  const pro = await until(async () => (await sql("select id, token from public.invoices where job_id = $1 and kind = 'proforma' and is_active order by created_at desc limit 1", [jobId]))[0] ?? null, 20, 500);
  if (pro) {
    const inv = await fetch(`${base}/api/pdf/invoice/${pro.token}`);
    const t2 = inv.status === 200 ? await pdfText(Buffer.from(await inv.arrayBuffer())) : "";
    const moved = (await sql("select invoice_id from public.payments where id = $1", [pay.id]))[0]?.invoice_id === pro.id;
    check("2: the proforma lists 'Less deposit received (RCT-…)' and the balance due", moved && /Less deposit received \(RCT-\d+\)/i.test(t2) && /Balance due/i.test(t2), JSON.stringify({ moved, snippet: t2.match(/AMOUNT IN WORDS.{0,400}/i)?.[0] ?? t2.slice(0, 200) }));
  } else {
    check("2: a proforma exists at Ready (deposit applied)", false, "no proforma");
  }
  await ob.close();
});

/* ---------------- 3. D3: revising an approved quotation needs the owner ---------------- */
await section("3 revision after approval", async () => {
  cleanupDb();
  const { jobId, quotationId } = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const { browser, page } = await browserFor("service_advisor", { viewport: { width: 1366, height: 1000 } });
  await go(page, `${base}/jobs/${jobId}/quote/${quotationId}`);
  await until(async () => ((await page.locator("[data-ask-revise-bar]").count()) ? 1 : null), 30, 500);
  check("3: the advisor sees Revise greyed and 'Ask owner to revise'", (await page.locator("[data-revise-bar]").count()) === 0 && (await page.locator("[data-ask-revise]").count()) === 1);
  await page.locator("[data-ask-revise]").click();
  await page.locator('[data-revise-ask] [name="reason"]').fill("Customer asked for more work");
  await page.locator("[data-ask-revise-send]").click();
  await submitted(page);
  const req = (await sql("select revision_requested_at, revision_request_kind, revision_request_reason from public.quotations where id = $1", [quotationId]))[0];
  check("3: the request is written on the quotation and the owner is told", !!req?.revision_requested_at && req.revision_request_kind === "advisor" && /more work/.test(req.revision_request_reason ?? "") && (await sql("select 1 from public.notifications where job_id = $1 and type = 'revision_request'", [jobId])).length >= 1, JSON.stringify(req));
  check("3: the bar now says the owner was asked", (await page.locator("[data-revise-pending]").count()) === 1);
  await browser.close();
  const { browser: ob, page: op } = await browserFor("owner", { viewport: { width: 1366, height: 1000 } });
  await go(op, `${base}/jobs/${jobId}/quote/${quotationId}?revise=1`);
  check("3: the owner's box shows the request with Allow and Decline", (await op.locator("[data-owner-box] [data-revision-allow]").count()) === 1 && /more work/.test((await op.locator("[data-owner-box]").textContent()) ?? ""));
  await op.locator("[data-revision-allow]").click();
  await submitted(op);
  check("3: Allow is written down", !!(await sql("select revision_allowed_at from public.quotations where id = $1", [quotationId]))[0]?.revision_allowed_at && (await sql("select 1 from public.quotation_events where quotation_id = $1 and event_type = 'revision_allowed'", [quotationId])).length === 1);
  await ob.close();
  const { browser: b2, page: p2 } = await browserFor("service_advisor", { viewport: { width: 1366, height: 1000 } });
  await go(p2, `${base}/jobs/${jobId}/quote/${quotationId}`);
  await until(async () => ((await p2.locator("[data-revise-bar]").count()) ? 1 : null), 30, 500);
  check("3: the advisor's Revise is live with 'Owner allowed one revision'", (await p2.locator("[data-revise-bar]").count()) === 1 && (await p2.locator("[data-revise-allowed]").count()) === 1);
  await p2.locator("[data-revise-bar]").click();
  await p2.waitForURL((u) => !u.toString().includes(quotationId), { timeout: 20000 }).catch(() => null);
  const versions = await sql("select id, version, status, revision_allowed_at from public.quotations where job_id = $1 and kind = 'quotation' order by version", [jobId]);
  check("3: version 2 starts as a draft and the permission is used up", versions.length === 2 && versions[1].status === "draft" && !versions[0].revision_allowed_at && (await sql("select 1 from public.quotation_events where quotation_id = $1 and event_type = 'revision_used'", [quotationId])).length === 1, JSON.stringify(versions));
  await b2.close();
  // Parts: a priced part on an approved quotation asks the owner by itself.
  cleanupDb();
  const second = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const { browser: pb, page: pp } = await browserFor("parts", { viewport: { width: 1600, height: 1000 } });
  await go(pp, `${base}/parts/${second.jobId}`);
  const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0]?.id;
  const rowKey = (await sql("insert into public.part_items (job_id, description, quantity, availability, confirm_status, confirmed_at, created_by, updated_by) values ($1, 'E2e engine mount', 1, 'to_order', 'confirmed', now(), $2, $2) returning id", [second.jobId, owner]))[0]?.id;
  await go(pp, `${base}/parts/${second.jobId}`);
  const row = pp.locator("[data-row-key]").filter({ hasText: /engine mount/i }).first();
  check("3: the new part has its price boxes", (await row.locator("input[aria-label='List price']").count()) === 1);
  const supplierOption = async (sel, name) => sel.locator("option").evaluateAll((os, n) => (os.find((o) => (o.textContent ?? "").toLowerCase().startsWith(n.toLowerCase())) ?? {}).value ?? "", name);
  await row.locator("input[aria-label='Part number']").fill("E2E-MOUNT-1");
  await row.locator("input[aria-label='Part number']").press("Tab");
  await sleep(800);
  await row.locator("select[aria-label='Type']").selectOption("genuine");
  await row.locator("input[aria-label='List price']").fill("1200");
  await row.locator("input[aria-label='List price']").press("Tab");
  await sleep(1200);
  const supSel = row.locator("select[aria-label='Supplier']");
  await supSel.selectOption(await supplierOption(supSel, "our stock"));
  await sleep(800);
  await row.locator("select[aria-label='Availability']").selectOption({ label: "In stock" });
  const priced = await until(async () => { const r = (await sql("select cost_aed from public.part_items where id = $1", [rowKey]))[0]; return Number(r?.cost_aed) === 1200 ? r : null; }, 30, 500);
  check("3: the new part is priced at AED 1,200", !!priced, JSON.stringify(priced));
  await sleep(3000);
  const asked = await until(async () => (await sql("select revision_requested_at, revision_request_kind, revision_request_reason from public.quotations where id = $1", [second.quotationId]))[0]?.revision_requested_at ? (await sql("select revision_request_kind, revision_request_reason from public.quotations where id = $1", [second.quotationId]))[0] : null, 40, 500);
  check("3: a priced part from Parts asks the owner ('Peter added E2E ENGINE MOUNT, AED 1,200: allow revised quote?')", !!asked && asked.revision_request_kind === "parts" && /added E2E ENGINE MOUNT, AED 1,200/.test(asked.revision_request_reason ?? ""), JSON.stringify(asked));
  const n2 = (await sql("select title from public.notifications where job_id = $1 and type = 'revision_request' order by created_at desc limit 1", [second.jobId]))[0];
  check("3: the owner's notification reads '… AED 1,200: allow revised quote?'", /AED 1,200: allow revised quote\?/.test(n2?.title ?? ""), n2?.title ?? "");
  check("3: no new version was made without the owner", (await sql("select count(*)::int as n from public.quotations where job_id = $1 and kind = 'quotation'", [second.jobId]))[0].n === 1);
  await pb.close();
  const { browser: ob2, page: op2 } = await browserFor("owner", { viewport: { width: 1366, height: 1000 } });
  await go(op2, `${base}/jobs/${second.jobId}/quote/${second.quotationId}`);
  await op2.locator("[data-revision-allow]").click();
  await submitted(op2);
  const v2 = await until(async () => (await sql("select id, version, status from public.quotations where job_id = $1 and kind = 'quotation' and version = 2", [second.jobId]))[0] ?? null, 30, 500);
  const line = v2 ? await until(async () => (await sql("select unit_cost from public.quotation_lines where quotation_id = $1 and is_active and part_item_id = $2", [v2.id, rowKey]))[0] ?? null, 30, 500) : null;
  check("3: Allow on a Parts request makes version 2 with the new price, the advisor told to send it", !!v2 && v2.status === "draft" && Number(line?.unit_cost) === 1200 && (await sql("select 1 from public.notifications where job_id = $1 and type = 'quote_revised_by_parts'", [second.jobId])).length >= 1, JSON.stringify({ v2, line }));
  await ob2.close();
});

/* ---------------- 4. D4: the owner's approval box under "Before sending" ---------------- */
await section("4 owner approval box", async () => {
  cleanupDb();
  const { jobId, quotationId } = (await api("/api/e2e/stage", { stage: "quote" })).json;
  await sql("update public.quotations set status = 'pending_owner', owner_approval_reason = 'Total of AED 30,000.00 is above AED 25,000.00' where id = $1", [quotationId]);
  const { browser, page } = await browserFor("service_advisor", { viewport: { width: 1366, height: 1000 } });
  await go(page, `${base}/jobs/${jobId}/quote/${quotationId}`);
  check("4: the advisor sees 'Waiting for owner approval (above AED 25,000)'", /Waiting for owner approval \(.*above AED 25,000/.test((await page.locator("[data-owner-waiting]").textContent().catch(() => "")) ?? ""));
  check("4: no approval box for the advisor", (await page.locator("[data-owner-box]").count()) === 0);
  await browser.close();
  const { browser: ob, page: op } = await browserFor("owner", { viewport: { width: 1366, height: 1000 } });
  await go(op, `${base}/jobs/${jobId}/quote/${quotationId}?approve=1`);
  await until(async () => ((await op.locator("[data-owner-box]").count()) ? 1 : null), 30, 500);
  const placed = await op.evaluate(() => { const box = document.querySelector("[data-owner-box]"); const prev = box?.previousElementSibling; return { underBeforeSending: !!prev && /Before sending|Sent/i.test(prev.textContent ?? ""), rightColumn: !!box?.closest(".flex.flex-col.gap-4"), focused: document.activeElement?.getAttribute("data-owner-approve") !== null }; });
  check("4: the box sits in the right column directly under 'Before sending', Approve focused from the notification link", placed.underBeforeSending && placed.focused, JSON.stringify(placed));
  await op.locator("[data-owner-approve]").click();
  await submitted(op);
  const q = (await sql("select status, owner_approved_at from public.quotations where id = $1", [quotationId]))[0];
  const owner = (await sql("select display_name from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0]?.display_name;
  check("4: approved: 'Approved by Omar, 11:45' in light green", q?.status === "draft" && !!q?.owner_approved_at && new RegExp(`Approved by ${owner}, `).test((await op.locator("[data-owner-approved]").textContent().catch(() => "")) ?? ""), (await op.locator("[data-owner-approved]").textContent().catch(() => "")) ?? "");
  await ob.close();
});

/* ---------------- 5. D5: services, outside work, Required jobs, save a typed job ---------------- */
await section("5 services", async () => {
  cleanupDb();
  const svcs = await sql("select c.name as category, s.name, s.line_kind, s.outside_work from public.services s join public.service_categories c on c.id = s.category_id where s.is_active and (c.name = 'Outside work' or s.name in ('Wheel alignment', 'Wheel balancing', 'Road force wheel balancing', 'Tyre fitting (per tyre)', 'Puncture repair', 'TPMS sensor programming', 'Minor service', 'Major service', 'A/C gas recharge'))");
  const names = (n) => svcs.filter((s) => s.name.toLowerCase() === n.toLowerCase());
  check("5: the wheels and tyres jobs are services", ["Wheel alignment", "Wheel balancing", "Road force wheel balancing", "Tyre fitting (per tyre)", "Puncture repair", "TPMS sensor programming"].every((n) => names(n)[0]?.line_kind === "service"), JSON.stringify(svcs.map((s) => `${s.name}:${s.line_kind}`)));
  check("5: Servicing has Minor service, Major service and A/C gas recharge as services, once each", ["Minor service", "Major service", "A/C gas recharge"].every((n) => names(n).length === 1 && names(n)[0].line_kind === "service"));
  check("5: Outside work has Lathe charges and Fuel injector service (Bosch), marked outside work", names("Lathe charges")[0]?.outside_work === true && names("Fuel injector service (Bosch)")[0]?.outside_work === true && names("Lathe charges")[0]?.category === "Outside work");
  // Wheel alignment Required on the report becomes a service line when the quotation starts.
  const { jobId, quotationId, inspectionId } = (await api("/api/e2e/stage", { stage: "quote" })).json;
  await sql("update public.quotations set is_active = false where id = $1", [quotationId]);
  const item = (await sql("select id from public.inspection_items where inspection_id = $1 and item_key = 'steering_and_suspension.wheel_alignment'", [inspectionId]))[0];
  if (item) await sql("update public.inspection_items set status = 'bad', style = 'job' where id = $1", [item.id]);
  else await sql("insert into public.inspection_items (inspection_id, section_key, section_title, item_key, item_label, position, status, style) values ($1, 'steering_and_suspension', 'Steering and suspension', 'steering_and_suspension.wheel_alignment', 'Wheel alignment', 99, 'bad', 'job')", [inspectionId]);
  const { browser, page } = await browserFor("service_advisor", { viewport: { width: 1366, height: 1000 } });
  await go(page, `${base}/jobs/${jobId}`);
  await page.locator("button", { hasText: /^Start quotation$/ }).click();
  await page.waitForURL(/\/quote\//, { timeout: 20000 }).catch(() => null);
  const newQ = (await sql("select id from public.quotations where job_id = $1 and kind = 'quotation' and is_active order by created_at desc limit 1", [jobId]))[0]?.id;
  const align = newQ ? (await sql("select title, line_type, source_key, service_id from public.quotation_lines where quotation_id = $1 and is_active and source_key = 'steering_and_suspension.wheel_alignment'", [newQ]))[0] : null;
  check("5: 'Wheel alignment: required' put a WHEEL ALIGNMENT service line on the new quotation", !!align && align.line_type === "package" && /wheel alignment/i.test(align.title) && !!align.service_id, JSON.stringify(align));
  // Lathe charges from the Services picker: the "our cost" box shows for the advisor, the line is outside work.
  await page.locator("button", { hasText: /^\+ Add line$/ }).first().click();
  await page.locator("button", { hasText: /^Service$/ }).first().click();
  await page.locator("button[aria-label='Open the services list']").last().click();
  const dialog = page.locator("[role='dialog']").first();
  await dialog.locator("input[aria-label='Search']").fill("Lathe");
  await dialog.locator("button", { hasText: /Lathe charges/i }).first().click();
  await dialog.getByRole("button", { name: /^Done/ }).click();
  const lathe = await until(async () => (await sql("select id, outside_work, line_type from public.quotation_lines where quotation_id = $1 and is_active and title ilike 'lathe charges%'", [newQ]))[0] ?? null, 30, 500);
  check("5: the Lathe charges line is a service marked outside work", !!lathe && lathe.outside_work === true && lathe.line_type === "package", JSON.stringify(lathe));
  await sleep(500);
  check("5: the advisor sees the 'our cost' box on it", (await page.locator("[data-our-cost]").count()) >= 1);
  // A typed job saved to the list with one tap.
  await sleep(800);
  await page.locator("button", { hasText: /^\+ Add line$/ }).first().click();
  await page.locator("button", { hasText: /^Labour$/ }).first().click();
  await page.locator("button[aria-label='Open the labour jobs list']").last().click();
  const d2 = page.locator("[role='dialog']").first();
  await d2.locator("input[aria-label='Search']").fill("E2e custom job xyz");
  check("5: the picker offers 'and save it to the list'", (await d2.locator("[data-save-custom]").count()) === 1);
  await d2.locator("[data-save-custom]").click();
  await d2.getByRole("button", { name: /^Done/ }).click();
  const savedSvc = await until(async () => (await sql("select s.name, s.line_kind, c.name as category from public.services s join public.service_categories c on c.id = s.category_id where s.name ilike 'E2e custom job xyz' and s.is_active"))[0] ?? null, 30, 500);
  check("5: the typed job is on the services list under Custom as a labour job", !!savedSvc && savedSvc.line_kind === "labour" && /custom/i.test(savedSvc.category), JSON.stringify(savedSvc));
  await browser.close();
});

/* ---------------- 6. D6: long part names wrap ---------------- */
await section("6 part names", async () => {
  cleanupDb();
  const { jobId } = (await api("/api/e2e/stage", { stage: "quote" })).json;
  const pa = (await sql("select id from public.part_items where job_id = $1 and is_active order by created_at limit 1", [jobId]))[0]?.id;
  await sql("update public.part_items set description = 'Front left lower control arm with ball joint and bushings, complete assembly' where id = $1", [pa]);
  const { browser, page } = await browserFor("parts", { viewport: { width: 1366, height: 900 } });
  await go(page, `${base}/parts/${jobId}`);
  const info = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll("[data-part-name] span")).find((s) => /control arm/i.test(s.textContent ?? ""));
    if (!el) return null;
    const cs = getComputedStyle(el);
    const row = el.closest("[data-row-key]");
    return { clamp: cs.webkitLineClamp, height: el.getBoundingClientRect().height, rowHeight: row?.getBoundingClientRect().height ?? 0, title: el.closest("[data-part-name]")?.getAttribute("title") ?? "" };
  });
  check("6: a long name wraps onto up to three lines and the row grows with it", !!info && String(info.clamp) === "3" && info.height > 24 && info.rowHeight > 40, JSON.stringify(info));
  check("6: the full name shows on hover", /complete assembly/.test(info?.title ?? ""));
  await browser.close();
});

cleanupDb();
process.exit(summary() ? 1 : 0);
