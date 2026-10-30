// Proof for the approved-quotation lock (16 October, evening): once the customer approves, an advisor cannot remove a
// line, change a price or change the discount, from the editor's own save route or straight in the database; every
// refused attempt is written in the quotation's history; the page shows the lines as plain text with the banner and
// "Ask owner to revise"; the owner's Revise makes version 2 as a draft and is logged while version 1 stays locked;
// with a proforma out only the owner may revise; with a tax invoice out nobody may.
//   node --env-file=.env.test.local tests/browser/test-x.mjs
import { api, base, browserFor, cleanupDb, cookieHeader, go, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 9 * 60 * 1000).unref();
cleanupDb();
const until = async (fn, tries = 40, ms = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } return null; };
const save = async (body, cookie) => { const r = await fetch(`${base}/api/quote/save`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => ({})) }; };

/* ---------------- 1. An approved quotation: every change refused and logged ---------------- */
console.log("\n== 1 approved: refused and logged");
const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
const { jobId, quotationId: Q1 } = seed;
const advisor = await cookieHeader("service_advisor");
const owner = await cookieHeader("owner");
const linesBefore = await sql("select id, title, line_type, unit_price, hours, is_active from public.quotation_lines where quotation_id = $1 and is_active and fee_kind is null order by position", [Q1]);
const labour = linesBefore.find((l) => l.line_type === "labour");
const part = linesBefore.find((l) => l.line_type === "part");
check("1: the seed's quotation is approved with a labour line and a part line", (await sql("select status from public.quotations where id = $1", [Q1]))[0]?.status === "approved" && !!labour && !!part);

const r1 = await save({ quotationId: Q1, opId: `x-${Date.now()}-1`, removeLine: { id: labour.id } }, advisor);
check("1: the advisor's remove is refused (423) with the lock message", r1.status === 423 && r1.json.locked === true && /locked: approved by the customer on \d+ \w+\. Ask the owner to revise\./.test(r1.json.error ?? ""), `${r1.status} ${JSON.stringify(r1.json)}`);
const r2 = await save({ quotationId: Q1, opId: `x-${Date.now()}-2`, patchLine: { id: part.id, markup_percent: 300 } }, advisor);
check("1: the advisor's price change is refused", r2.status === 423 && r2.json.locked === true, `${r2.status} ${JSON.stringify(r2.json)}`);
const r3 = await save({ quotationId: Q1, opId: `x-${Date.now()}-3`, header: { discount_kind: "percent", discount_value: 15 } }, advisor);
check("1: the advisor's discount change is refused", r3.status === 423 && r3.json.locked === true, `${r3.status} ${JSON.stringify(r3.json)}`);
const r4 = await save({ quotationId: Q1, opId: `x-${Date.now()}-4`, addLine: { line_type: "labour", title: "SNEAKED IN", hours: 1 } }, advisor);
check("1: the advisor's new line is refused", r4.status === 423, `${r4.status}`);
const r5 = await save({ quotationId: Q1, opId: `x-${Date.now()}-5`, patchLine: { id: part.id, markup_percent: 300 } }, owner);
check("1: the owner cannot change the approved version in place either (a new version is the way)", r5.status === 423, `${r5.status}`);
const after = await sql("select id, unit_price, hours, is_active, markup_percent from public.quotation_lines where quotation_id = $1 and fee_kind is null order by position", [Q1]);
check("1: nothing on the approved version changed", after.length === linesBefore.length && after.every((l) => l.is_active) && String(after.find((l) => l.id === part.id)?.unit_price) === String(part.unit_price) && (await sql("select discount_kind, discount_value from public.quotations where id = $1", [Q1]))[0]?.discount_kind === null, JSON.stringify(after));
const refusals = await sql("select note from public.quotation_events where quotation_id = $1 and event_type = 'edit_refused' order by created_at", [Q1]);
check("1: five refused attempts are in the quotation's history, naming who, what and where from", refusals.length === 5 && refusals.every((e) => /^Refused: .+ \((service advisor|owner)\) tried to .+ on Q-STAGE-1 v1 from the quotation editor\./.test(e.note)) && /remove a line/.test(refusals[0].note) && /change a line \(markup percent\)/.test(refusals[1].note) && /change the discount kind, discount value/.test(refusals[2].note), JSON.stringify(refusals.map((e) => e.note.slice(0, 120))));
check("1: the job's history carries the refusals too", ((await sql("select count(*)::int as n from public.job_events where job_id = $1 and event_type = 'quote_edit_refused'", [jobId]))[0]?.n ?? 0) === 5);

/* ---------------- 2. Straight in the database: the trigger refuses ---------------- */
console.log("\n== 2 database lock");
await sql("update public.quotation_lines set unit_price = 1 where id = $1", [part.id]);
await sql("update public.quotation_lines set is_active = false where id = $1", [labour.id]);
await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, quantity) values ($1, 99, 'labour', 'SNEAKED IN BY SQL', 1)", [Q1]);
await sql("update public.quotations set discount_percent = 20 where id = $1", [Q1]);
const dbAfter = await sql("select count(*)::int as n, bool_and(is_active) as all_live, max(unit_price) filter (where id = $2) as part_price from public.quotation_lines where quotation_id = $1 and fee_kind is null", [Q1, part.id]);
check("2: a direct update, removal or insert on the approved lines is refused by the database", dbAfter[0]?.n === linesBefore.length && dbAfter[0]?.all_live === true && String(dbAfter[0]?.part_price) === String(part.unit_price), JSON.stringify(dbAfter));
check("2: a direct change of the discount on the approved header is refused by the database", Number((await sql("select discount_percent from public.quotations where id = $1", [Q1]))[0]?.discount_percent) === 0);
const lt = await sql("update public.quotation_lines set line_total = line_total where id = $1 returning id", [part.id]);
check("2: the bookkeeping columns stay free (the stored total can be recomputed)", lt.length === 1);

/* ---------------- 3. The advisor's screen: plain text, banner, Ask owner ---------------- */
console.log("\n== 3 advisor's screen");
{
  const { browser, page } = await browserFor("service_advisor", { viewport: { width: 1280, height: 1000 } });
  await go(page, `${base}/jobs/${jobId}/quote/${Q1}`);
  const banner = (await page.locator("[data-lock-banner]").textContent().catch(() => "")) ?? "";
  check("3: the banner reads 'Approved by the customer on <date>. Locked. Ask the owner to revise.'", /^Approved by the customer on \d+ \w+\. Locked\. Ask the owner to revise\.$/.test(banner.trim()), banner);
  check("3: every line is plain text: no boxes, no delete buttons, no menus", (await page.locator("[data-quote-locked] input, [data-quote-locked] textarea, [data-quote-locked] select").count()) === 0 && (await page.locator("button[aria-label='Remove']").count()) === 0 && (await page.locator("[data-line-menu]").count()) === 0 && (await page.locator("[data-locked-line]").count()) === linesBefore.length);
  check("3: no Revise button for the advisor, 'Ask owner to revise' instead", (await page.locator("[data-revise]").count()) === 0 && (await page.locator("[data-revise-bar]").count()) === 0 && (await page.locator("[data-ask-revise]").count()) === 1);
  check("3: the grand total is shown as approved", /AED/.test((await page.locator("[data-locked-total]").textContent().catch(() => "")) ?? ""));
  await page.locator("[data-ask-revise]").click();
  await page.locator("[data-revise-ask] textarea, [data-revise-ask] input[name='reason']").first().fill("Customer wants the brake pads left out");
  await page.locator("[data-ask-revise-send]").click();
  await page.waitForURL(/message=/, { timeout: 15000 }).catch(() => null);
  const asked = await until(async () => (await sql("select revision_requested_at from public.quotations where id = $1", [Q1]))[0]?.revision_requested_at ? 1 : null, 20, 500);
  check("3: Ask owner to revise reaches the owner and is written down", !!asked && ((await sql("select count(*)::int as n from public.quotation_events where quotation_id = $1 and event_type = 'revision_requested'", [Q1]))[0]?.n ?? 0) === 1);
  await browser.close();
}

/* ---------------- 4. The owner: Revise makes version 2, logged; version 1 stays locked ---------------- */
console.log("\n== 4 owner revises");
{
  const { browser, page } = await browserFor("owner", { viewport: { width: 1280, height: 1000 } });
  await go(page, `${base}/jobs/${jobId}/quote/${Q1}`);
  const banner = (await page.locator("[data-lock-banner]").textContent().catch(() => "")) ?? "";
  check("4: the owner's banner offers Revise", /Locked\. Revise to change it/.test(banner) && (await page.locator("[data-revise]").count()) === 1, banner);
  await page.locator("[data-revise]").click();
  await page.waitForURL((u) => !u.toString().includes(Q1), { timeout: 20000 }).catch(() => null);
  const v2 = (await sql("select id, version, status from public.quotations where number = 'Q-STAGE-1' and version = 2", []))[0];
  check("4: Revise made version 2 as a draft and opened it", !!v2 && v2.status === "draft" && page.url().includes(v2.id), `${JSON.stringify(v2)} ${page.url()}`);
  const v1 = (await sql("select status from public.quotations where id = $1", [Q1]))[0];
  check("4: version 1 is still the approved one, untouched", v1?.status === "approved" && (await sql("select count(*)::int as n from public.quotation_lines where quotation_id = $1 and is_active and fee_kind is null", [Q1]))[0]?.n === linesBefore.length);
  const ev = (await sql("select note from public.quotation_events where quotation_id = $1 and event_type = 'quote_revised'", [v2?.id ?? Q1]))[0];
  check("4: the revision is logged with the owner's name", /version 2 started by /.test(ev?.note ?? ""), ev?.note);
  const v2labour = (await sql("select id from public.quotation_lines where quotation_id = $1 and line_type = 'labour' and is_active limit 1", [v2?.id]))[0];
  const r = await save({ quotationId: v2?.id, opId: `x-${Date.now()}-6`, patchLine: { id: v2labour?.id, hours: 3 } }, owner);
  check("4: version 2 can be changed (the draft is where the work happens)", r.status === 200, `${r.status} ${JSON.stringify(r.json)}`);
  check("4: version 2 is editable on screen (boxes are back, no lock banner)", (await (async () => { await go(page, `${base}/jobs/${jobId}/quote/${v2?.id}`); return (await page.locator("[data-lock-banner]").count()) === 0 && (await page.locator("[data-quote-locked]").count()) === 0 && (await page.locator("input[data-amount]").count()) > 0; })()));
  await browser.close();
}

/* ---------------- 5. Proforma out: only the owner; tax invoice out: nobody ---------------- */
console.log("\n== 5 proforma and tax invoice");
cleanupDb();
const ready = (await api("/api/e2e/stage", { stage: "ready" })).json;
check("5: the Ready seed has an approved quotation and a proforma", !!ready.invoice && ready.invoice.kind === "proforma", JSON.stringify(ready.invoice));
{
  const { browser, page } = await browserFor("service_advisor", { viewport: { width: 1280, height: 1000 } });
  await go(page, `${base}/jobs/${ready.jobId}/quote/${ready.quotationId}`);
  const banner = (await page.locator("[data-lock-banner]").textContent().catch(() => "")) ?? "";
  check("5: with a proforma out the advisor reads 'only the owner can revise' and has no Ask button", new RegExp(`Proforma ${ready.invoice.number} issued: only the owner can revise\\.$`).test(banner.trim()) && (await page.locator("[data-ask-revise]").count()) === 0 && (await page.locator("[data-revise]").count()) === 0, banner);
  await browser.close();
}
{
  const { browser, page } = await browserFor("owner", { viewport: { width: 1280, height: 1000 } });
  await go(page, `${base}/jobs/${ready.jobId}/quote/${ready.quotationId}`);
  check("5: the owner still has Revise with a proforma out", (await page.locator("[data-revise]").count()) === 1);
  await sql("update public.invoices set kind = 'tax_invoice' where id = $1", [ready.invoice.id]);
  await go(page, `${base}/jobs/${ready.jobId}/quote/${ready.quotationId}`);
  const banner = (await page.locator("[data-lock-banner]").textContent().catch(() => "")) ?? "";
  check("5: with a tax invoice out even the owner has no Revise: 'changes only by credit note'", new RegExp(`Tax invoice ${ready.invoice.number} issued: changes only by credit note\\.$`).test(banner.trim()) && (await page.locator("[data-revise]").count()) === 0 && (await page.locator("[data-revise-bar]").count()) === 0, banner);
  await browser.close();
}

cleanupDb();
process.exit(summary() ? 1 : 0);
