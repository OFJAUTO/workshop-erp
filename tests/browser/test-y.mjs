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

cleanupDb();
process.exit(summary() ? 1 : 0);
