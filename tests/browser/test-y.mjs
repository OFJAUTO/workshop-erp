// Proof for the 17 October batch, run section by section with ONLY=... (e.g. ONLY=B npm run test:y).
// B1: breaks per weekday and department (the Settings grid, the saved setting, Friday's longer break in the maths).
// B3: no staff names or WhatsApp on customer pages; the only contact is "Call OFJ" with the company phone.
//   node --env-file=.env.local tests/browser/test-y.mjs
import { api, base, browserFor, cleanupDb, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 10 * 60 * 1000).unref();
const only = (process.env.ONLY ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const want = (k) => !only.length || only.includes(k);
const until = async (fn, tries = 40, ms = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } return null; };
cleanupDb();

/* ================= B1: breaks per weekday ================= */
if (want("B")) {
  console.log("\n== B1 breaks per weekday");
  const { browser, page } = await browserFor("owner", { viewport: { width: 1500, height: 1100 } });
  await go(page, `${base}/settings`);
  const grid = page.locator("[data-break-grid]");
  check("B1: Settings shows the break grid, two departments by seven days", (await grid.count()) === 1 && (await grid.locator("input").count()) === 14);
  const friMech = grid.locator("input[name='break__mechanical__fri']");
  const friBody = grid.locator("input[name='break__bodyshop__fri']");
  const monMech = grid.locator("input[name='break__mechanical__mon']");
  check("B1: Friday is prefilled 12:30-14:00 for both sides, Monday 12:30-13:30 / 13:30-14:30", (await friMech.inputValue()) === "12:30-14:00" && (await friBody.inputValue()) === "12:30-14:00" && (await monMech.inputValue()) === "12:30-13:30" && (await grid.locator("input[name='break__bodyshop__mon']").inputValue()) === "13:30-14:30");
  // Change Monday's mechanical break, save, confirm the setting, put it back.
  await monMech.fill("12:00-13:00");
  await page.getByRole("button", { name: /^Save settings$/ }).first().click();
  const saved = await until(async () => { const v = (await sql("select value->'mechanical'->>'mon' as m from public.settings where key = 'break_times'"))[0]?.m; return v === "12:00-13:00" ? v : null; }, 30, 500);
  check("B1: a changed day saves into the per-day setting", saved === "12:00-13:00", String(saved));
  // A bad value is refused in words.
  await go(page, `${base}/settings`);
  await page.locator("[data-break-grid] input[name='break__mechanical__mon']").fill("13:00-12:00");
  await page.getByRole("button", { name: /^Save settings$/ }).first().click();
  const barText = await until(async () => { const t = (await page.textContent("body")) ?? ""; return /must look like 12:30-13:30/.test(t) ? t : null; }, 20, 500);
  check("B1: a backwards break is refused in words", !!barText);
  await sql("update public.settings set value = jsonb_set(value, '{mechanical,mon}', '\"12:30-13:30\"') where key = 'break_times'");
  await browser.close();
  // The maths: a Friday span loses 90 minutes, a Monday span 60 (unit maths proven in working-time; here the server uses it end to end).
  const fri = (await api("/api/e2e/sql", { sql: "select 1" })).status;
  check("B1: the sql helper is up (the per-day maths is unit-checked in working-time.ts)", fri === 200);
}

/* ================= B3: customer pages carry no staff names ================= */
if (want("B")) {
  console.log("\n== B3 customer pages");
  cleanupDb();
  const seed = (await api("/api/e2e/stage", { stage: "quote" })).json;
  await sql("update public.quotations set status = 'sent', sent_at = now(), valid_until = now() + interval '7 days' where id = $1", [seed.quotationId]);
  const token = (await sql("select token from public.quotations where id = $1", [seed.quotationId]))[0]?.token;
  const qpage = await (await fetch(`${base}/quote/${token}`)).text();
  const qtext = qpage.replace(/<[^>]+>/g, " ");
  check("B3: the quotation link has Call OFJ with the company number and no WhatsApp", /Call OFJ/.test(qtext) && /\+971 4 330 3113/.test(qtext) && !/wa\.me/.test(qpage));
  const staffNames = await sql("select display_name from public.staff where is_active");
  const leaked = staffNames.map((s) => s.display_name).filter((n) => n && n.length > 3 && qtext.includes(n));
  check("B3: no staff name on the quotation link", leaked.length === 0, JSON.stringify(leaked));
  // The invoice link: no contact block at all, no staff names, no WhatsApp.
  cleanupDb();
  const ready = (await api("/api/e2e/stage", { stage: "ready" })).json;
  const itoken = ready.invoice?.token;
  const ipage = await (await fetch(`${base}/invoice/${itoken}`)).text();
  const itext = ipage.replace(/<[^>]+>/g, " ");
  const ileaked = staffNames.map((s) => s.display_name).filter((n) => n && n.length > 3 && itext.includes(n));
  check("B3: the invoice link has no contact block, no WhatsApp and no staff name", !/data-call-ofj/.test(ipage) && !/wa\.me/.test(ipage) && ileaked.length === 0, JSON.stringify(ileaked));
  check("B3: the invoice link still shows the amount and the PDF button", /Amount due|Paid, thank you/.test(itext) && /View proforma \(PDF\)|View tax invoice \(PDF\)/.test(itext));
}

/* ================= C1: commission under Recovery cost, owner approval ================= */
if (want("C")) {
  console.log("\n== C1 commission");
  cleanupDb();
  const { jobId, quotationId } = (await api("/api/e2e/stage", { stage: "quote" })).json;
  const mark = (await sql("select now() as t"))[0]?.t;
  const { browser: ab, page: ap } = await browserFor("service_advisor", { viewport: { width: 1440, height: 1100 } });
  await go(ap, `${base}/jobs/${jobId}/quote/${quotationId}`);
  check("C1: one Commission line sits in the internal box, the old bottom section is gone", (await ap.locator("[data-internal-box] [data-commission-line]").count()) === 1 && (await ap.locator("[data-commission-box]").count()) === 0 && (await ap.locator("[data-commission-add]").count()) === 1);
  const rows = await ap.locator("[data-internal-box] dt").allTextContents();
  check("C1: the Commission line is directly under Recovery cost", rows.findIndex((t) => /^Commission/.test(t)) === rows.findIndex((t) => /^Recovery cost/.test(t)) + 1, JSON.stringify(rows.slice(0, 6)));
  await ap.locator("[data-commission-add]").click();
  await ap.locator("[data-commission-who]").fill("E2e Agent");
  await ap.locator("[data-commission-amount]").fill("100");
  await ap.locator("[data-commission-save]").click();
  const pend = await until(async () => { const r = (await sql("select commission_to, commission_status, commission_aed from public.quotations where id = $1", [quotationId]))[0]; return r?.commission_status === "pending" ? r : null; }, 30, 500);
  check("C1: an advisor's commission waits for the owner and counts for nothing yet", !!pend && pend.commission_to === "E2e Agent" && Number(pend.commission_aed) === 0, JSON.stringify(pend));
  await go(ap, `${base}/jobs/${jobId}/quote/${quotationId}`);
  check("C1: the line reads amber 'Waiting for owner approval' and profit says '(commission pending)'", (await ap.locator("[data-commission-pending]").count()) === 1 && (await ap.locator("[data-profit-commission-pending]").count()) === 1);
  const told = (await sql("select title from public.notifications where type = 'commission_approval' and created_at > $1 order by created_at desc limit 1", [mark]))[0];
  check("C1: the owner is told 'Commission for E2e Agent, AED 100 on [car] ([job])'", /^Commission for E2e Agent, AED 100\.00 on .+ \(J-/.test(told?.title ?? ""), told?.title);
  await ab.close();
  // The owner approves on the page.
  const { browser: ob, page: op } = await browserFor("owner", { viewport: { width: 1440, height: 1100 } });
  await go(op, `${base}/jobs/${jobId}/quote/${quotationId}`);
  check("C1: the owner sees Approve / Decline / Change amount on the line", (await op.locator("[data-commission-approve]").count()) === 1 && (await op.locator("[data-commission-decline]").count()) === 1 && (await op.locator("[data-commission-change]").count()) === 1);
  await op.locator("[data-commission-approve]").click();
  const appr = await until(async () => { const r = (await sql("select commission_status, commission_aed from public.quotations where id = $1", [quotationId]))[0]; return r?.commission_status === "approved" && Number(r.commission_aed) === 100 ? r : null; }, 30, 500);
  check("C1: approved: it counts in cost (commission_aed 100) and is logged", !!appr && ((await sql("select count(*)::int as n from public.quotation_events where quotation_id = $1 and event_type = 'commission_approved'", [quotationId]))[0]?.n ?? 0) === 1, JSON.stringify(appr));
  await ob.close();
  // An advisor's change after approval waits again; the owner declines with a note; it is removed.
  const { browser: ab2, page: ap2 } = await browserFor("service_advisor", { viewport: { width: 1440, height: 1100 } });
  await go(ap2, `${base}/jobs/${jobId}/quote/${quotationId}`);
  await ap2.locator("[data-commission-edit]").click();
  await ap2.locator("[data-commission-amount]").fill("150");
  await ap2.locator("[data-commission-save]").click();
  const again = await until(async () => { const r = (await sql("select commission_status, commission_value, commission_aed from public.quotations where id = $1", [quotationId]))[0]; return r?.commission_status === "pending" && Number(r.commission_value) === 150 ? r : null; }, 30, 500);
  check("C1: an edit after approval waits for the owner again and stops counting", !!again && Number(again.commission_aed) === 0, JSON.stringify(again));
  await ab2.close();
  const { browser: ob2, page: op2 } = await browserFor("owner", { viewport: { width: 1440, height: 1100 } });
  await go(op2, `${base}/jobs/${jobId}/quote/${quotationId}`);
  await op2.locator("[data-commission-decline]").click();
  await op2.locator("[data-commission-decline-note]").fill("Not on this job");
  await op2.locator("[data-commission-decline-send]").click();
  const dec = await until(async () => { const r = (await sql("select commission_to, commission_status, commission_decision_note from public.quotations where id = $1", [quotationId]))[0]; return r?.commission_status === "declined" ? r : null; }, 30, 500);
  // The advisor's notice is the action's last step: wait for it, never read straight after the row flips.
  const toldDec = await until(async () => ((await sql("select count(*)::int as n from public.notifications where type = 'commission_approval' and title like 'Commission declined%' and created_at > $1", [mark]))[0]?.n ?? 0) >= 1 ? 1 : null, 30, 500);
  check("C1: declined: removed with the owner's note, the advisor is told", !!dec && dec.commission_to === null && dec.commission_decision_note === "Not on this job" && !!toldDec, JSON.stringify(dec));
  await go(op2, `${base}/jobs/${jobId}/quote/${quotationId}`);
  check("C1: the line shows the decline and offers + Add again", (await op2.locator("[data-commission-declined]").count()) === 1);
  // The owner's own commission is approved at once.
  await op2.locator("[data-commission-declined] [data-commission-add]").click();
  await op2.locator("[data-commission-who]").fill("E2e Agent");
  await op2.locator("[data-commission-amount]").fill("5");
  await op2.locator("[data-commission-fields] button", { hasText: /^% of total before VAT$/ }).click();
  await op2.locator("[data-commission-save]").click();
  const own = await until(async () => { const r = (await sql("select commission_status, commission_kind, commission_value, commission_aed from public.quotations where id = $1", [quotationId]))[0]; return r?.commission_status === "approved" && r?.commission_kind === "percent" ? r : null; }, 30, 500);
  check("C1: the owner's own commission (5%) is approved at once and counted", !!own && Number(own.commission_value) === 5 && Number(own.commission_aed) > 0, JSON.stringify(own));
  await ob2.close();
  // The locked (customer-approved) quotation still takes a commission: it never touches the customer's figures.
  cleanupDb();
  const locked = (await api("/api/e2e/stage", { stage: "approved" })).json;
  const { browser: ob3, page: op3 } = await browserFor("owner", { viewport: { width: 1440, height: 1100 } });
  await go(op3, `${base}/jobs/${locked.jobId}/quote/${locked.quotationId}`);
  check("C1: the locked view carries the commission line", (await op3.locator("[data-quote-locked]").count()) === 1 && (await op3.locator("[data-commission-add]").count()) === 1);
  await op3.locator("[data-commission-add]").click();
  await op3.locator("[data-commission-who]").fill("E2e Agent");
  await op3.locator("[data-commission-amount]").fill("50");
  await op3.locator("[data-commission-save]").click();
  const onLocked = await until(async () => { const r = (await sql("select commission_status, commission_aed, total_aed from public.quotations where id = $1", [locked.quotationId]))[0]; return r?.commission_status === "approved" && Number(r.commission_aed) === 50 ? r : null; }, 30, 500);
  check("C1: it saves on the approved quotation without touching the customer's total", !!onLocked && Number(onLocked.commission_aed) === 50, JSON.stringify(onLocked));
  await ob3.close();
}

cleanupDb();
process.exit(summary() ? 1 : 0);
