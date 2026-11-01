// Spell check WHILE TYPING (1 November 2026; replaces the pre-send check of 23 October 2026). Every word box is
// checked a moment after typing stops: a dotted underline under a word the dictionary does not know, a tap shows
// the suggestions ("ADN" -> "AND"), Ignore, and "Add to dictionary" for the owner and the advisors (for everyone).
// The shared dictionary holds customer, contact, staff and supplier names, makes and models, the parts list, the
// services, tyre brands and abbreviations, so the names line has nothing underlined. Names, phones, plates, VINs,
// part numbers, addresses, amounts and codes are never checked. Sending never asks about spelling.
//   npm run test:spell5   (test server on :3102, E2E_BASE for another port)
import fs from "node:fs";
import path from "node:path";
import { api, base, browserFor, cleanupDb, cookieHeader, go, here, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const SHOTS = path.join(here, "shots", "spell");
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (name) => path.join(SHOTS, name);
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const spell = async (text, role = "service_advisor") => (await fetch(`${base}/api/spell`, { method: "POST", headers: { "content-type": "application/json", cookie: await cookieHeader(role) }, body: JSON.stringify({ text }) })).json();
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 12 * 60 * 1000).unref();

await cleanupDb();
const wordsBefore = (await sql("select value::text as v from public.settings where key = 'spell_words'"))[0]?.v ?? "[]";
const seed = (await api("/api/e2e/stage", { stage: "quote" })).json;
const jobId = seed.jobId;
const qid = seed.quotationId;

// Real names from the test database, read now (never written into the repository).
const firstWord = (s) => String(s ?? "").trim().split(/\s+/).find((w) => /^[A-Za-z]{4,}$/.test(w)) ?? null;
const cust = (await sql("select full_name from public.customers where full_name ~ '^[A-Za-z ]+$' and length(full_name) > 8 order by created_at limit 30")).map((r) => r.full_name).find((n) => n.split(/\s+/).some((w) => w.length >= 5)) ?? null;
const staffName = (await sql("select display_name from public.staff where is_active and display_name ~ '^[A-Za-z]{5,}' order by created_at limit 1"))[0]?.display_name ?? null;
const supplier = firstWord((await sql("select name from public.suppliers where is_active and name ~ '^[A-Za-z]{5,}' order by created_at limit 1"))[0]?.name);
const model = (await sql("select m.name as make, d.name as model from public.vehicle_models d join public.vehicle_makes m on m.id = d.make_id where d.is_active and d.name ~ '^[A-Za-z]{4,}$' order by d.created_at limit 1"))[0] ?? null;
const namesLine = `${cust} AND ${staffName} CHECKED THE ${model?.make ?? ""} ${model?.model ?? ""} WITH ${supplier} PARTS, TPMS AND ECU`.replace(/\s+/g, " ");
check(`seed: a names line from the database (${namesLine.length} letters)`, !!cust && !!staffName && !!supplier && !!model, JSON.stringify({ cust: !!cust, staffName: !!staffName, supplier: !!supplier, model: !!model }));

/* 1. The server's answer */
const r1 = await spell("BRAKE PADS ADN DISCS, WDWDWDW");
const f1 = new Map((r1.flagged ?? []).map((f) => [f.word, f]));
check(`1: "ADN" is flagged with "AND" suggested (${f1.get("ADN")?.suggestions?.join(", ")})`, !!f1.get("ADN")?.suggestions?.includes("AND"));
check("1: keyboard mash is flagged as random typing", f1.get("WDWDWDW")?.kind === "mash");
const r2 = await spell(namesLine);
check(`1: the names line comes back clean (${(r2.flagged ?? []).map((f) => f.word).join(", ") || "nothing"})`, (r2.flagged ?? []).length === 0);
check("1: an advisor may add words", r2.canAdd === true);
check("1: a technician may not", (await spell("test", "technician")).canAdd === false);

/* 2. Typing in the quotation: the dotted underline, the tap, the suggestion */
const adv = await browserFor("service_advisor", { viewport: { width: 1366, height: 1000 } });
const page = adv.page;
await go(page, `${base}/jobs/${jobId}/quote/${qid}`);
const box = page.locator('textarea[id^="name-"]').first();
check("2: the line name box is checked by us (data-spell), the browser's red underline off", (await box.getAttribute("data-spell")) === "" && (await box.getAttribute("spellcheck")) === "false");
await box.click();
await box.fill("");
await box.pressSequentially("BRAKE PADS ADN DISCS", { delay: 30 });
const under = await until(async () => (await page.locator('[data-spell-overlay] [data-spell-word="ADN"]').count()) > 0, 30, 300);
check("2: a moment after typing, ADN has the dotted underline", !!under);
check("2: nothing else is underlined", (await page.locator("[data-spell-overlay] [data-spell-word]").count()) === 1);
const deco = await page.locator('[data-spell-word="ADN"]').evaluate((el) => getComputedStyle(el).textDecorationStyle).catch(() => "");
check(`2: the underline is dotted (${deco})`, deco === "dotted");
await page.screenshot({ path: shot("2-underline.png") });
// The caret into the word (as a tap does).
await box.evaluate((el) => { const i = el.value.indexOf("ADN") + 2; el.setSelectionRange(i, i); });
await box.press("ArrowRight");
const menu = page.locator('[data-spell-menu="ADN"]');
await menu.waitFor({ timeout: 5000 }).catch(() => {});
check("2: the tap shows the suggestions", (await menu.count()) === 1 && (await menu.locator('[data-spell-suggest="AND"]').count()) === 1);
check("2: an advisor sees Add to dictionary", (await menu.locator("[data-spell-add]").count()) === 1);
await page.screenshot({ path: shot("2-suggestions.png") });
await menu.locator('[data-spell-suggest="AND"]').click();
const fixed = await box.inputValue();
check(`2: "ADN" becomes "AND" (${fixed})`, /^BRAKE PADS AND DISCS$/i.test(fixed));
check("2: the underline is gone", !!(await until(async () => (await page.locator("[data-spell-overlay] [data-spell-word]").count()) === 0, 10, 200)));

/* 3. The names line: nothing underlined */
await box.fill("");
const answered = page.waitForResponse((r) => r.url().endsWith("/api/spell") && r.request().method() === "POST", { timeout: 15000 }).catch(() => null);
await box.pressSequentially(namesLine, { delay: 10 });
await answered;
await sleep(1500);
check("3: the names line (customer, staff, supplier, make, model, TPMS, ECU) has nothing underlined", (await page.locator("[data-spell-overlay] [data-spell-word]").count()) === 0);
await page.screenshot({ path: shot("3-names-line.png") });

/* 4. Add to dictionary: for everyone */
const WORD = `Zentrofix${String(Date.now()).slice(-3).replace(/\d/g, (d) => "abcdefghij"[Number(d)])}`;
await box.fill("");
await box.pressSequentially(`FIT THE ${WORD.toUpperCase()} BRACKET`, { delay: 20 });
await until(async () => (await page.locator(`[data-spell-overlay] [data-spell-word="${WORD.toUpperCase()}"]`).count()) > 0, 30, 300);
check(`4: a new word (${WORD.toUpperCase()}) is underlined`, (await page.locator(`[data-spell-word="${WORD.toUpperCase()}"]`).count()) === 1);
await box.evaluate((el, w) => { const i = el.value.indexOf(w) + 2; el.setSelectionRange(i, i); }, WORD.toUpperCase());
await box.press("ArrowRight");
await page.locator(`[data-spell-menu="${WORD.toUpperCase()}"] [data-spell-add]`).click();
check("4: Add to dictionary takes the underline away", !!(await until(async () => (await page.locator("[data-spell-overlay] [data-spell-word]").count()) === 0, 20, 300)));
const stored = (await sql("select value::text as v from public.settings where key = 'spell_words'"))[0]?.v ?? "";
check("4: the word is in the workshop dictionary", stored.toLowerCase().includes(WORD.toLowerCase()));
const own = await spell(`FIT THE ${WORD.toUpperCase()} BRACKET`, "owner");
check("4: the owner's check no longer flags it (everyone)", (own.flagged ?? []).length === 0, JSON.stringify(own.flagged));

/* 5. Boxes never checked: names, phones, plates, VINs, part numbers, addresses, amounts */
await go(page, `${base}/customers/new`);
const marks = await page.evaluate(() => Array.from(document.querySelectorAll("input[name], textarea[name]")).map((el) => ({ name: el.getAttribute("name"), spell: el.hasAttribute("data-spell"), native: el.getAttribute("spellcheck") })));
const wrong = marks.filter((m) => /name|phone|mobile|email|trn|address|plate|vin/i.test(m.name ?? "") && (m.spell || m.native === "true"));
check(`5: on the new customer form no name, phone, email, TRN, address, plate or VIN box is checked (${marks.length} boxes looked at)`, marks.length > 0 && wrong.length === 0, JSON.stringify(wrong));

/* 6. Sending never asks about spelling */
await sql("insert into public.settings (key, label, value) values ('spell_words', 'Workshop dictionary (spell check)', $1::jsonb) on conflict (key) do update set value = excluded.value", [wordsBefore]);
const acc = await browserFor("accounts", { viewport: { width: 1366, height: 1000 } });
await go(acc.page, `${base}/jobs/${jobId}`);
await acc.page.locator("[data-record-payment-open]").first().click();
const d = acc.page.locator("[data-record-payment-dialog]");
await until(async () => (await d.locator("[data-pay-targets]").count()) > 0, 40, 300);
const target = d.locator("[data-pay-target]").first();
if (await target.count()) await target.click();
await d.locator('[data-method="cash"]').click();
if (await d.locator("[data-amount-partial]").count()) await d.locator("[data-amount-partial]").click();
await d.locator("[data-amount-input]").pressSequentially("50");
if (await d.locator("[data-pay-for]").count()) await d.locator("[data-pay-for]").fill("Spelling test advance");
await d.locator("[data-record-payment]").click();
await acc.page.locator("[data-confirm-yes]").click();
await until(async () => (await d.locator("[data-send-receipt]").count()) > 0, 50, 500);
await d.locator("[data-send-receipt]").click();
await sleep(800);
check("6: the send window opens straight to Open WhatsApp / Copy, with no spelling question", (await acc.page.getByText("Open WhatsApp").count()) + (await acc.page.getByText("No phone number on file").count()) >= 1 && (await acc.page.locator("[data-spell-panel], [data-spell-state]").count()) === 0);
await acc.page.screenshot({ path: shot("6-send-no-question.png") });

await adv.browser.close();
await acc.browser.close();
await cleanupDb();
summary();
