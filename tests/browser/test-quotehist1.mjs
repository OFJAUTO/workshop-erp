// Batch of 29 October 2026, section 1: every quotation and version stays visible.
//  A  a test car with an approved quotation gets an ADDITIONAL one through "New quotation": the job card lists both
//     (ORIGINAL / ADDITIONAL, amounts, status, money line), the Approval step stays done, the dashboard card shows
//     "Additional quotation not approved" and the "2 quotations" picker; the top search finds it by number.
//  B  the additional one is revised to v2: v1 opens read-only with "OLD VERSION – replaced by v2 on … by …"; the v1
//     customer link says "This quotation has been updated" with a button to v2, and v1 cannot be approved; the v2
//     link and PDF are titled ADDITIONAL QUOTATION with "In addition to quotation Q-… (approved …)".
//  C  J-00017 (real, read only): Q-00002 (approved) and Q-00033 (additional) on the job card, Q-00002 read-only, the
//     money page's invoice preview a copy of Q-00002 only (Q-00033 counts once approved).
//   E2E_BASE=http://localhost:3101 node --env-file=.env.local tests/browser/test-quotehist1.mjs
import path from "node:path";
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { api, base, browserFor, cleanupDb, cookieHeader, go, here, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const SHOTS = path.join(here, "shots", "quotehist1");
fs.mkdirSync(SHOTS, { recursive: true });
setTimeout(() => { console.log("TIMEOUT: stopping"); finish().then(() => process.exit(2)); }, 13 * 60 * 1000).unref();
const until = async (fn, tries = 40, gap = 400) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const text = async (loc) => ((await loc.textContent()) ?? "").replace(/\s+/g, " ").trim();

// The quotation counter is shared with the real workshop: a quotation made by the test burns a number, so the counter
// goes back to the highest real number at the end (no gap is left behind).
async function finish() {
  cleanupDb();
  await sql("select setval('public.quotation_number_seq', greatest(1, coalesce((select max(substring(number from 3)::int) from public.quotations where number ~ '^Q-[0-9]+$'), 1)))");
}

cleanupDb();
const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
const jobId = seed.jobId;
const origId = seed.quotationId;
const orig = (await sql("select number, status, approved_total_aed, total_aed from public.quotations where id = $1", [origId]))[0];
check("0 the test car's original quotation is approved", orig?.status === "approved", JSON.stringify(orig));

const pc = await browserFor("owner", { viewport: { width: 1366, height: 1000 } });
const p = pc.page;
let addId = null;
let addNumber = null;
let v2Id = null;
try {
  /* ---------------- A ---------------- */
  await go(p, `${base}/jobs/${jobId}`);
  check("A1 one quotation listed, marked ORIGINAL", (await p.locator("[data-quote-row]").count()) === 1 && (await p.locator("[data-quote-role=original]").count()) === 1);
  await p.locator("[data-new-quotation]").click();
  await p.waitForURL(/\/quote\/[0-9a-f-]{36}/, { timeout: 30000 });
  addId = p.url().split("/quote/")[1].split(/[?#]/)[0];
  addNumber = (await sql("select number from public.quotations where id = $1", [addId]))[0]?.number;
  check("A2 New quotation makes an ADDITIONAL quotation with its own number", !!addNumber && addNumber !== orig.number, `${addNumber}`);
  // The advisor's work on it, then sent (as Send does): one labour line, AED 400 + VAT.
  const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0].id;
  await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, quantity, hours, labour_rate, urgency, created_by, updated_by) values ($1, 0, 'labour', 'EXTRA WORK – TEST', 1, 1, 400, 'recommended', $2, $2)", [addId, owner]);
  const tok1 = randomBytes(16).toString("base64url");
  await sql("update public.quotations set status = 'sent', token = $2, sent_at = now(), sent_to_name = 'Stage Customer', subtotal_aed = 400, vat_aed = 20, total_aed = 420, rounded_total_aed = 420 where id = $1", [addId, tok1]);

  await go(p, `${base}/jobs/${jobId}`);
  const rows = await p.locator("[data-quote-row]").evaluateAll((els) => els.map((e) => `${e.getAttribute("data-quote-row")}:${e.getAttribute("data-quote-role")}:${e.getAttribute("data-quote-status")}`));
  check("A3 the job card lists both, oldest first: ORIGINAL approved, ADDITIONAL sent", rows.length === 2 && rows[0] === `${orig.number}:original:approved` && rows[1] === `${addNumber}:additional:sent`, rows.join(" | "));
  const money = await text(p.locator("[data-quote-money]"));
  check("A4 the money line: approved so far, waiting for approval, declined", /Approved so far AED [\d,.]+/.test(money) && /Waiting for approval AED 420\.00/.test(money) && /Declined AED 0\.00/.test(money), money);
  check("A5 the Approval step stays done while the additional quotation waits", (await p.locator("[data-stage-card=quotation]").getAttribute("data-state")) === "done");
  await p.locator("[data-quotation-list]").scrollIntoViewIfNeeded();
  await p.screenshot({ path: path.join(SHOTS, "A-job-card-two-quotations.png") });

  const hits = await (await fetch(`${base}/api/search?q=${encodeURIComponent(addNumber.replace("-", "").replace(/^Q0+/, "Q"))}`, { headers: { cookie: await cookieHeader("owner") } })).json();
  check("A6 the top search finds the quotation by its number (typed short)", hits.hits?.[0]?.href === `/jobs/${jobId}/quote/${addId}`, JSON.stringify(hits.hits?.[0] ?? null));

  await go(p, `${base}/dashboard`);
  const card = p.locator(`[data-flash-id="${jobId}"]`);
  check("A7 the dashboard card says the additional quotation is not approved yet", /Additional quotation not approved · \d+ h/.test(await text(card.locator("[data-extra-quote-chip]"))), await text(card.locator("[data-extra-quote-chip]")));
  await card.locator("[data-quote-picker='2']").click();
  const menu = p.locator("[data-quote-picker-menu]");
  await menu.waitFor({ timeout: 5000 });
  check("A8 the '2 quotations' picker lists both", (await menu.locator("[data-quote-pick]").count()) === 2 && p.url().endsWith("/dashboard"));
  await card.scrollIntoViewIfNeeded();
  await p.screenshot({ path: path.join(SHOTS, "A-dashboard-card-picker.png") });
  await p.keyboard.press("Escape");

  /* ---------------- B ---------------- */
  await go(p, `${base}/jobs/${jobId}`);
  await p.locator(`[data-quote-revise="${addNumber}"]`).click();
  await p.waitForURL((u) => /\/quote\//.test(u.toString()) && !u.toString().includes(addId), { timeout: 30000 });
  v2Id = p.url().split("/quote/")[1].split(/[?#]/)[0];
  const v = await sql("select id, version, status from public.quotations where number = $1 order by version", [addNumber]);
  check("B1 Revise made v2 of the SAME number; v1 is kept, replaced", v.length === 2 && v[0].status === "superseded" && v[1].version === 2 && v[1].id === v2Id, JSON.stringify(v));
  await go(p, `${base}/jobs/${jobId}/quote/${addId}`);
  const banner = await text(p.locator("[data-old-version-banner], [data-lock-banner]").first());
  check("B2b the old-version words show once", (await p.locator("[data-old-version-banner], [data-lock-banner]").count()) === 1);
  check("B2 v1 opens read-only with 'OLD VERSION – replaced by v2 on … by …'", /^OLD VERSION – replaced by v2 on \d+ \w+ by \S+/.test(banner) && (await p.locator("[data-quote-locked]").count()) > 0, banner);
  check("B3 the versions dropdown lists v1 and v2 (current)", (await p.locator("[data-version-select] option").allTextContents()).join("|").includes("v2 (current)"));
  await p.screenshot({ path: path.join(SHOTS, "B-v1-read-only.png") });

  const phone = await browserFor("owner", { viewport: { width: 390, height: 844 }, mobile: true, touch: true });
  await go(phone.page, `${base}/quote/${tok1}`);
  check("B4 while v2 is being prepared, the v1 link says it is being updated", /being updated/i.test(await text(phone.page.locator("body"))));
  const tok2 = randomBytes(16).toString("base64url");
  await sql("update public.quotations set status = 'sent', token = $2, sent_at = now(), sent_to_name = 'Stage Customer', subtotal_aed = 400, vat_aed = 20, total_aed = 420, rounded_total_aed = 420 where id = $1", [v2Id, tok2]);
  await go(phone.page, `${base}/quote/${tok1}`);
  const latestHref = await phone.page.locator("[data-quote-latest]").getAttribute("href");
  check("B5 the v1 link says 'This quotation has been updated' with a button to the latest version", /This quotation has been updated/.test(await text(phone.page.locator("[data-quote-updated]"))) && latestHref === `/quote/${tok2}`, latestHref ?? "");
  await phone.page.screenshot({ path: path.join(SHOTS, "B-v1-link-updated.png") });
  const form = new FormData();
  form.set("action", "approve");
  form.set("approver_name", "Stage Customer");
  form.set("agree", "on");
  await fetch(`${base}/api/quote/${tok1}`, { method: "POST", body: form, redirect: "manual" });
  const after = await sql("select version, status from public.quotations where number = $1 order by version", [addNumber]);
  check("B6 the old version cannot be approved (v1 stays replaced, v2 still waits)", after[0].status === "superseded" && after[1].status === "sent", JSON.stringify(after));
  await go(phone.page, `${base}/quote/${tok2}`);
  const h1 = await text(phone.page.locator("h1"));
  const addsTo = await text(phone.page.locator("[data-additional-to]"));
  check("B7 the customer's copy is titled Additional quotation, 'In addition to quotation <original> (approved …)'", /additional quotation/i.test(h1) && addsTo.startsWith(`In addition to quotation ${orig.number} (approved`), `${h1} · ${addsTo}`);
  await phone.page.screenshot({ path: path.join(SHOTS, "B-additional-link-phone.png"), fullPage: true });
  await phone.browser.close();
  const pdf = await fetch(`${base}/api/pdf/quote/${tok2}`);
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(Buffer.from(await pdf.arrayBuffer()), "application/pdf");
  const pdfText = doc.loadPage(0).toStructuredText().asText().replace(/\s+/g, " ");
  check("B8 the PDF too: ADDITIONAL QUOTATION, 'In addition to quotation …', no staff name", /ADDITIONAL QUOTATION/.test(pdfText) && pdfText.includes(`In addition to quotation ${orig.number} (approved`) && !/Prepared by/i.test(pdfText), pdfText.slice(0, 160));
  fs.writeFileSync(path.join(SHOTS, "B-additional-pdf.png"), doc.loadPage(0).toPixmap(mupdf.Matrix.scale(1.4, 1.4), mupdf.ColorSpace.DeviceRGB, false, true).asPNG());

  /* ---------------- C: J-00017, read only ---------------- */
  const j17 = (await sql("select id from public.jobs where job_number = 'J-00017'"))[0]?.id;
  if (j17) {
    await go(p, `${base}/jobs/${j17}`);
    const rows17 = await p.locator("[data-quote-row]").evaluateAll((els) => els.map((e) => `${e.getAttribute("data-quote-row")}:${e.getAttribute("data-quote-role")}:${e.getAttribute("data-quote-status")}`));
    check("C1 J-00017 lists Q-00002 (original, approved) and Q-00033 (additional)", rows17[0] === "Q-00002:original:approved" && rows17[1]?.startsWith("Q-00033:additional:"), rows17.join(" | "));
    check("C2 J-00017's Approval step stays done", (await p.locator("[data-stage-card=quotation]").getAttribute("data-state")) === "done");
    await p.locator("[data-quotation-list]").scrollIntoViewIfNeeded();
    await p.screenshot({ path: path.join(SHOTS, "C-J-00017-job-card.png") });
    const q2 = (await sql("select id from public.quotations where number = 'Q-00002' and job_id = $1 order by version desc limit 1", [j17]))[0]?.id;
    await go(p, `${base}/jobs/${j17}/quote/${q2}`);
    check("C3 Q-00002 opens, read-only (approved and locked)", (await p.locator("[data-quote-locked]").count()) > 0);
    await p.screenshot({ path: path.join(SHOTS, "C-Q-00002-read-only.png") });
    await go(p, `${base}/jobs/${j17}/invoice`);
    const body = await text(p.locator("main"));
    check("C4 the invoice preview is a copy of Q-00002 (Q-00033 joins once approved)", /a copy of Q-00002/i.test(body) && !/a copy of Q-00002, Q-00033|Q-00033, Q-00002/.test(body), (body.match(/a copy of [^A-Z]*Q-[^ ]+( Q-\d+)?/i) ?? [""])[0]);
    await p.locator("text=/a copy of/i").first().scrollIntoViewIfNeeded().catch(() => null);
    await p.screenshot({ path: path.join(SHOTS, "C-J-00017-invoice-preview.png") });
  } else check("C J-00017 exists", false);
} catch (e) {
  check("walked without a crash", false, (e?.message ?? String(e)).slice(0, 300));
} finally {
  await pc.browser.close();
  await finish();
}
process.exit(summary() ? 1 : 0);
