// Overnight 22-23 October 2026, section 5: spell check everywhere. Text boxes carry the browser and phone keyboard
// spell check (spellcheck, autocorrect, sentence capitals); before a report, quotation, estimate or invoice goes to a
// customer, the send window lists suspicious words (misspellings with suggestions, keyboard mash such as "afqghjk")
// with one-tap fix / Keep as is - never a block; the workshop dictionary (built in + Settings + makes and models)
// is never flagged; the owner adds words.
// Run: node --env-file=.env.local tests/browser/test-spell5.mjs   (dev server; E2E_BASE for another port)
import path from "node:path";
import { api, base, browserFor, cleanupDb, cookieHeader, go, here, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shot = (name) => path.join(here, "shots", name);
const text = async (loc) => ((await loc.first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const spell = async (body, role = "service_advisor") => (await fetch(`${base}/api/spell`, { method: "POST", headers: { "content-type": "application/json", cookie: await cookieHeader(role) }, body: JSON.stringify(body) })).json();

cleanupDb();
const wordsBefore = (await sql("select value::text as v from public.settings where key = 'spell_words'"))[0]?.v ?? "[]";
const seed = await api("/api/e2e/stage", { stage: "quote" });
const jobId = seed.json.jobId;
const qid = seed.json.quotationId;

/* 1. The check itself */
const r1 = await spell({ message: "Dear customer, your car is ready to recieve. The Urus PPF, stabiliser, wishbone, R1234yf, TPMS, ODIS and PIWIS work on the Cullinan and Brabus is done. wdwdwdw" });
const words = (r1.issues ?? []).map((i) => i.word);
check("1: 'recieve' is flagged with 'receive' suggested", (r1.issues ?? []).some((i) => i.word === "recieve" && i.suggestions.includes("receive")), JSON.stringify(r1.issues));
check("1: keyboard mash 'wdwdwdw' is flagged as random typing", (r1.issues ?? []).some((i) => i.word === "wdwdwdw" && i.kind === "mash"));
check("1: workshop words are never flagged (Urus, PPF, stabiliser, wishbone, R1234yf, TPMS, ODIS, PIWIS, Cullinan, Brabus)", !words.some((w) => /urus|ppf|stabiliser|wishbone|r1234yf|tpms|odis|piwis|cullinan|brabus/i.test(w)), words.join(", "));
const caps = await spell({ message: "REPLACE DUE TO EXCESSIVE TEMPERATURE AFQGHJK" });
check("1: text typed in capitals is checked too (AFQGHJK flagged, the rest fine)", (caps.issues ?? []).length === 1 && caps.issues[0].word === "AFQGHJK", JSON.stringify(caps.issues));

/* 2. The inspection report: the remark the example quoted */
const item = (await sql("select i.id, i.item_label from public.inspection_items i join public.inspections n on n.id = i.inspection_id where n.job_id = $1 and i.status = 'bad' limit 1", [jobId]))[0];
await sql("update public.inspection_items set remarks = 'replace due to excessive temperature afqghjk' where id = $1", [item.id]);
await sql("update public.inspections set status = 'approved', approved_at = coalesce(approved_at, now()) where job_id = $1", [jobId]);
const r2 = await spell({ message: "Your report: link", source: { kind: "report", jobId } });
check(`2: the report's remark is read: 'afqghjk' found under '${item.item_label}'`, (r2.issues ?? []).some((i) => i.word === "afqghjk" && i.kind === "mash" && i.label === item.item_label), JSON.stringify(r2.issues));

const { browser, page } = await browserFor("service_advisor", { viewport: { width: 1366, height: 1000 } });
await go(page, `${base}/jobs/${jobId}`);
const sendBtn = page.getByRole("button", { name: "Send to customer" }).first();
await sendBtn.click();
const panel = page.locator("[data-spell-panel]");
await panel.waitFor({ timeout: 30000 });
check("2: the link in the message and real words like 'slight' are never flagged", !(await page.locator("[data-spell-issue=https], [data-spell-issue=erp], [data-spell-issue=ofjauto], [data-spell-issue=slight]").count()));
check("2: the send window lists the word before sending", /afqghjk/.test(await text(panel)) && /looks like random typing/.test(await text(panel)));
check("2: never a block: WhatsApp and Copy are still there", (await page.getByText("Open WhatsApp").count()) + (await page.getByText("Copy message and link").count()) >= 1);
await page.screenshot({ path: shot("spell5-1-report-check.png") });
await page.locator('[data-spell-issue="afqghjk"] [data-spell-remove]').click();
const fixed = await until(async () => { const r = (await sql("select remarks from public.inspection_items where id = $1", [item.id]))[0]; return r && !/afqghjk/.test(r.remarks) ? r.remarks : null; });
check("2: one tap removes it from the stored remark ('replace due to excessive temperature')", fixed === "replace due to excessive temperature", fixed ?? "");
await browser.close();

/* 3. The quotation: a misspelt line fixed in one tap where it is stored */
const line = (await sql("select id from public.quotation_lines where quotation_id = $1 and is_active order by position limit 1", [qid]))[0];
await sql("update public.quotation_lines set title = 'Brake pad replacment' where id = $1", [line.id]);
const r3 = await spell({ message: "Here is your quotation", source: { kind: "quotation", id: qid } });
const iss = (r3.issues ?? []).find((i) => i.word === "replacment");
check("3: the quotation line 'replacment' is flagged with 'replacement' suggested", !!iss && iss.suggestions.includes("replacement"), JSON.stringify(r3.issues));
const fx = await (await fetch(`${base}/api/spell/fix`, { method: "POST", headers: { "content-type": "application/json", cookie: await cookieHeader("service_advisor") }, body: JSON.stringify({ key: iss?.key, word: "replacment", replacement: "replacement" }) })).json();
check("3: the one-tap fix writes 'Brake pad replacement' on the line", fx.ok && (await sql("select title from public.quotation_lines where id = $1", [line.id]))[0].title === "Brake pad replacement", JSON.stringify(fx));

/* 4. The owner's dictionary */
const before = await spell({ message: "Ziebart treatment" }, "owner");
check("4: an unknown word is flagged before it is added ('Ziebart')", (before.issues ?? []).some((i) => i.word === "Ziebart") && before.canAddWords === true);
const { browser: ob, page: op } = await browserFor("owner", { viewport: { width: 1366, height: 1000 } });
await go(op, `${base}/settings`);
const box = op.locator("[data-spell-words]");
await box.fill("Ziebart, Xpel");
await box.scrollIntoViewIfNeeded();
await op.screenshot({ path: shot("spell5-2-dictionary.png") });
await op.getByRole("button", { name: /^Save/ }).first().click();
await until(async () => /Ziebart/.test((await sql("select value::text as v from public.settings where key = 'spell_words'"))[0]?.v ?? ""));
const after = await spell({ message: "Ziebart treatment" }, "owner");
check("4: after Settings > Workshop dictionary, 'Ziebart' is never flagged", !(after.issues ?? []).some((i) => i.word === "Ziebart"), JSON.stringify(after.issues));

/* 5. The text boxes: browser and keyboard spell check on */
const { browser: tb, page: tp } = await browserFor("owner", { viewport: { width: 1366, height: 1000 } });
await go(tp, `${base}/my-jobs/${jobId}`);
const area = tp.locator("textarea").first();
const attrs = await area.evaluate((el) => ({ spell: el.getAttribute("spellcheck"), cap: el.getAttribute("autocapitalize"), correct: el.getAttribute("autocorrect"), lang: el.getAttribute("lang") })).catch(() => null);
check("5: a remark box has spellcheck, autocorrect and sentence capitals on (English)", !!attrs && attrs.spell === "true" && attrs.cap === "sentences" && attrs.correct === "on" && attrs.lang === "en", JSON.stringify(attrs));
await tb.close();
await ob.close();

await sql("update public.settings set value = $1::jsonb where key = 'spell_words'", [wordsBefore]);
cleanupDb();
process.exit(summary() ? 1 : 0);
