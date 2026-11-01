// Estimate back to the advisor (1 November 2026, E-00055). The advisor who STARTED an estimate stays in charge whoever
// edits it; the owner's approval or edit hands it back with what changed (notification + Waiting on you + banner);
// the list has the sections and every advisor sees every estimate, their own first; the migration's backfill fixes
// the estimates it already happened to.
// Run: node --env-file=.env.test.local tests/browser/test-handback.mjs   (test server on 3102)
import path from "node:path";
import { mkdirSync, readFileSync } from "node:fs";
import pg from "pg";
import { api, base, browserForId, cleanupDb, go, here, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const dir = path.join(here, "shots", "handback");
mkdirSync(dir, { recursive: true });
const shot = (name) => path.join(dir, name);
const text = async (loc) => ((await loc.first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };

cleanupDb();
const seed = await api("/api/e2e/stage", { stage: "quote" });
const job = (await sql("select customer_id, vehicle_id from public.jobs where id = $1", [seed.json.jobId]))[0];
const owner = (await sql("select id, display_name from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0];
const advisors = await sql("select id, display_name from public.staff where role_id = 'service_advisor' and is_active order by created_at limit 2");
const [A, C] = advisors;
const limitRow = (await sql("select value::text as v from public.settings where key = 'quote_owner_approval_above_aed'"))[0];
const made = [];

const mk = async (by, status, lines, extra = {}) => {
  const tok = `e2ehb${Math.random().toString(36).slice(2, 12)}`;
  const total = lines.reduce((s, l) => s + l.total, 0);
  const r = (await sql(`insert into public.quotations (kind, customer_id, vehicle_id, status, token, validity_days, sent_at, valid_until, subtotal_aed, vat_aed, total_aed, owner_approval_reason, created_by, updated_by) values ('estimate', $1, $2, $3, $4, 7, ${status === "sent" ? "now() - interval '1 hour'" : "null"}, now() + interval '7 days', $5, $6, $7, $8, $9, $9) returning id, number`, [job.customer_id, job.vehicle_id, status, tok, total, Math.round(total * 5) / 100, Math.round(total * 105) / 100, extra.reason ?? null, by]))[0];
  let pos = 1;
  for (const l of lines) {
    if (l.type === "part") await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, unit_cost, markup_percent, unit_price, line_total, created_by, updated_by) values ($1, $2, 'part', $3, 'manual', 1, 100, 10, 110, 110, $4, $4)", [r.id, pos++, l.title, by]);
    else await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, hours, labour_rate, line_total, created_by, updated_by) values ($1, $2, 'labour', $3, 'manual', 1, 2, 350, 700, $4, $4)", [r.id, pos++, l.title, by]);
  }
  made.push(r.id);
  return r;
};
const PARTS = [{ type: "part", title: "E2E OIL FILTER", total: 110 }, { type: "part", title: "E2E AIR FILTER", total: 110 }, { type: "labour", title: "E2E SERVICE LABOUR", total: 700 }];

try {
  /* ---------- A. sent for approval → edited by the owner → approved → back to the advisor ---------- */
  await sql("update public.settings set value = to_jsonb(500) where key = 'quote_owner_approval_above_aed'");
  const est1 = await mk(A.id, "pending_owner", PARTS, { reason: "total above AED 500" });
  const ownerB = await browserForId(owner.id, { viewport: { width: 1440, height: 900 } });
  await go(ownerB.page, `${base}/estimates/${est1.id}`);
  const partLines = await sql("select id from public.quotation_lines where quotation_id = $1 and line_type = 'part' order by position", [est1.id]);
  for (const l of partLines) {
    const res = await ownerB.page.evaluate(async ([qid, id]) => (await fetch("/api/quote/save", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quotationId: qid, opId: crypto.randomUUID(), patchLine: { id, markup_percent: 20 } }) })).status, [est1.id, l.id]);
    check(`A: the owner's markup change saves (${res})`, res === 200);
  }
  const base1 = (await sql("select handback_baseline is not null as kept, status from public.quotations where id = $1", [est1.id]))[0];
  check("A: the owner's first change keeps how it stood (baseline) and it still waits for him", base1?.kept === true && base1?.status === "pending_owner");
  await go(ownerB.page, `${base}/estimates/${est1.id}`);
  await ownerB.page.screenshot({ path: shot("a1-owner-approval.png"), fullPage: false });
  await ownerB.page.locator("[data-owner-approve]").first().click();
  const hb = await until(async () => (await sql("select status, handback_kind, handback_summary, handed_back_by from public.quotations where id = $1 and handed_back_at is not null", [est1.id]))[0]);
  check("A: approving hands it back: draft, kind approved, by the owner", hb?.status === "draft" && hb?.handback_kind === "approved" && hb?.handed_back_by === owner.id);
  check(`A: the summary says what changed ("${hb?.handback_summary}")`, /^Markup changed on 2 parts, total 966\.00 → 987\.00$/.test(hb?.handback_summary ?? ""));
  const still = (await sql("select created_by from public.quotations where id = $1", [est1.id]))[0];
  check("A: the estimate's starter is still the advisor", still?.created_by === A.id);
  const note1 = (await sql("select title, body, href from public.notifications where staff_id = $1 and type = 'quote_handed_back' and href = $2", [A.id, `/estimates/${est1.id}`]))[0];
  check(`A: the advisor is notified ("${note1?.title}")`, !!note1 && note1.title.startsWith(`Approved by ${owner.display_name} – ready to send`) && /Markup changed on 2 parts/.test(note1.body ?? ""));
  const ownerNote = (await sql("select count(*)::int as n from public.notifications where staff_id = $1 and type = 'quote_handed_back' and href = $2", [owner.id, `/estimates/${est1.id}`]))[0];
  check("A: the owner is not notified of his own handback", ownerNote?.n === 0);

  const advA = await browserForId(A.id, { viewport: { width: 1440, height: 900 } });
  await go(advA.page, `${base}/dashboard`);
  const wrow = advA.page.locator(`[data-waiting-job="quote:${est1.id}"]`);
  const wtext = await text(wrow);
  check(`A: the advisor's Waiting on you has the line ("${wtext.slice(0, 110)}")`, /Approved by .* – ready to send/.test(wtext) && /Markup changed on 2 parts, total 966\.00 → 987\.00/.test(wtext));
  await wrow.first().scrollIntoViewIfNeeded().catch(() => {});
  await advA.page.screenshot({ path: shot("a2-advisor-waiting.png") });
  await wrow.locator("a").first().click();
  await advA.page.waitForURL((u) => u.pathname === `/estimates/${est1.id}`, { timeout: 30000 }).catch(() => {});
  check("A: one tap opens the estimate", new URL(advA.page.url()).pathname === `/estimates/${est1.id}`);
  await sleep(800);
  const banner = await text(advA.page.locator("[data-handback-banner]"));
  check(`A: the estimate shows the banner ("${banner.slice(0, 100)}")`, /Approved by .* – ready to send/.test(banner) && /966\.00 → 987\.00/.test(banner) && banner.includes(A.display_name));
  await advA.page.screenshot({ path: shot("a3-advisor-estimate-banner.png") });
  await go(advA.page, `${base}/estimates`);
  const row1 = advA.page.locator(`[data-estimate-row="${est1.number}"]`);
  check("A: the list puts it under Ready to send, as the advisor's own", (await row1.getAttribute("data-list-section")) === "ready" && (await row1.getAttribute("data-mine")) === "true");
  check("A: the row says who it waits on and who started it", /Waiting on .*check and send/.test(await text(row1)) && (await text(row1.locator("[data-started-by]"))).includes(A.display_name));
  await row1.scrollIntoViewIfNeeded();
  await advA.page.screenshot({ path: shot("a4-advisor-list-ready.png") });

  /* ---------- B. the E-00055 shape: sent by the advisor, the owner starts v2 and completes it ---------- */
  const est2 = await mk(A.id, "sent", [{ type: "labour", title: "E2E BATTERY PROGRAMMING", total: 700 }]);
  await go(ownerB.page, `${base}/estimates/${est2.id}`);
  await ownerB.page.getByRole("button", { name: /Start version 2/ }).click();
  const v2 = await until(async () => (await sql("select id, created_by from public.quotations where number = $1 and version = 2", [est2.number]))[0]);
  made.push(v2?.id);
  check("B: the owner's new version is made by him", v2?.created_by === owner.id);
  await go(advA.page, `${base}/estimates`);
  const row2 = advA.page.locator(`[data-estimate-row="${est2.number}"]`);
  check("B: the advisor still sees it in their list (the cause of E-00055)", (await row2.count()) === 1);
  check("B: it is the advisor's own, started by them", (await row2.getAttribute("data-mine")) === "true" && (await text(row2.locator("[data-started-by]"))).includes(A.display_name));
  const opts = await row2.locator("[data-version-select] option").allTextContents();
  check(`B: the versions read "v2 · edited by ${owner.display_name}" (${opts.join(" | ")})`, opts.some((o) => o.includes(`v2 · edited by ${owner.display_name}`)));
  await row2.scrollIntoViewIfNeeded();
  await advA.page.screenshot({ path: shot("b1-advisor-list-v2.png") });
  const lab = (await sql("select id from public.quotation_lines where quotation_id = $1 and is_active order by position limit 1", [v2.id]))[0];
  await go(ownerB.page, `${base}/estimates/${v2.id}`);
  const st = await ownerB.page.evaluate(async ([qid, id]) => (await fetch("/api/quote/save", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quotationId: qid, opId: crypto.randomUUID(), patchLine: { id, labour_rate: 400 } }) })).status, [v2.id, lab.id]);
  check(`B: the owner changes the hourly rate (${st})`, st === 200);
  await go(ownerB.page, `${base}/estimates/${v2.id}`);
  await ownerB.page.getByRole("button", { name: "Estimate complete" }).click();
  for (const hook of ["[data-low-profit-send]", "[data-markup-continue]", "[data-deposit-skip]", "[data-parts-leave]"]) {
    const b = ownerB.page.locator(hook);
    if (await b.count().catch(() => 0)) await b.first().click().catch(() => {});
  }
  const hb2 = await until(async () => (await sql("select handback_kind, handback_summary from public.quotations where id = $1 and handed_back_at is not null", [v2.id]))[0], 60);
  check(`B: completing hands it back to the advisor ("${hb2?.handback_summary}")`, hb2?.handback_kind === "edited" && /^Hourly rate changed on 1 line, total 735\.00 → 840\.00$/.test(hb2?.handback_summary ?? ""));
  const note2 = (await sql("select title from public.notifications where staff_id = $1 and type = 'quote_handed_back' and href = $2", [A.id, `/estimates/${v2.id}`]))[0];
  check(`B: the advisor is told "Edited by … – check and send" (${note2?.title})`, !!note2 && note2.title.startsWith(`Edited by ${owner.display_name} – check and send`));
  await go(advA.page, `${base}/estimates`);
  const row2b = advA.page.locator(`[data-estimate-row="${est2.number}"]`);
  check("B: now under Ready to send with the change", (await row2b.getAttribute("data-list-section")) === "ready" && /Hourly rate changed on 1 line/.test(await text(row2b)));
  await row2b.scrollIntoViewIfNeeded();
  await advA.page.screenshot({ path: shot("b2-advisor-list-edited.png") });

  /* ---------- C. every advisor sees every estimate, their own first ---------- */
  const mineC = await mk(C.id, "draft", [{ type: "labour", title: "E2E C OWN WORK", total: 700 }]);
  await mk(A.id, "draft", [{ type: "labour", title: "E2E A OTHER WORK", total: 700 }]);
  const advC = await browserForId(C.id, { viewport: { width: 800, height: 1280 } });
  await go(advC.page, `${base}/estimates`);
  check("C: another advisor sees the first advisor's estimates", (await advC.page.locator(`[data-estimate-row="${est1.number}"]`).count()) === 1 && (await advC.page.locator(`[data-estimate-row="${est2.number}"]`).count()) === 1);
  const firstDraft = advC.page.locator('[data-estimates-section="draft"] [data-estimate-row]').first();
  check("C: their own come first in a section", (await firstDraft.getAttribute("data-estimate-row")) === mineC.number && (await firstDraft.getAttribute("data-mine")) === "true");
  const otherRow = advC.page.locator(`[data-estimate-row="${est1.number}"]`);
  check("C: someone else's row says whose it is", (await otherRow.getAttribute("data-mine")) === "false" && (await text(otherRow.locator("[data-started-by]"))).includes(A.display_name));
  await otherRow.locator("[data-quote-list-open]").click();
  await advC.page.waitForURL((u) => u.pathname === `/estimates/${est1.id}`, { timeout: 30000 }).catch(() => {});
  check("C: the whole row opens it", new URL(advC.page.url()).pathname === `/estimates/${est1.id}`);
  await go(advC.page, `${base}/estimates`);
  await advC.page.screenshot({ path: shot("c1-other-advisor-list-800.png"), fullPage: true });

  /* ---------- D. the quotations list has the same sections ---------- */
  await go(advA.page, `${base}/quotes`);
  check("D: the Quotations page opens with sections", (await advA.page.locator("[data-estimates-section], [data-estimates-closed]").count()) > 0 || (await advA.page.getByText("No quotations for the cars in the workshop").count()) === 1);
  await advA.page.screenshot({ path: shot("d1-quotations-list.png") });

  /* ---------- E. the migration's backfill (inside a transaction that is rolled back) ---------- */
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const ref = url.replace(/^https:\/\//, "").replace(/\.supabase\.co\/?$/, "");
  const c = new pg.Client({ host: `db.${ref}.supabase.co`, port: 5432, user: "postgres", password: process.env.SUPABASE_DB_PASSWORD, database: "postgres", ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query("begin");
    const v1 = (await c.query("insert into public.quotations (kind, customer_id, vehicle_id, status, token, validity_days, total_aed, created_by, updated_by) values ('estimate', $1, $2, 'superseded', 'e2ehbmig1', 7, 18850, $3, $3) returning id, number", [job.customer_id, job.vehicle_id, A.id])).rows[0];
    const v2m = (await c.query("insert into public.quotations (kind, number, version, parent_id, customer_id, vehicle_id, status, token, validity_days, total_aed, created_by, updated_by) values ('estimate', $1, 2, $2, $3, $4, 'draft', 'e2ehbmig2', 7, 16425.97, $5, $5) returning id", [v1.number, v1.id, job.customer_id, job.vehicle_id, owner.id])).rows[0];
    const mig = readFileSync(path.join(here, "..", "..", "supabase", "migrations", "20261202100000_quote_handback.sql"), "utf8");
    const stmt = mig.slice(mig.indexOf("with starters as ("), mig.indexOf("notify pgrst")).trim();
    await c.query(stmt);
    const got = (await c.query("select handback_kind, handback_summary, handed_back_by from public.quotations where id = $1", [v2m.id])).rows[0];
    check(`E: the backfill hands the stuck estimate back ("${got?.handback_summary}")`, got?.handback_kind === "edited" && got?.handback_summary === "Total 18,850.00 → 16,425.97" && got?.handed_back_by === owner.id);
    const n = (await c.query("select title from public.notifications where staff_id = $1 and href = $2", [A.id, `/estimates/${v2m.id}`])).rows[0];
    check(`E: and tells the advisor who started it (${n?.title})`, !!n && n.title.startsWith(`Edited by ${owner.display_name} – check and send`));
  } finally {
    await c.query("rollback").catch(() => {});
    await c.end();
  }
  await ownerB.browser.close();
  await advA.browser.close();
  await advC.browser.close();
} finally {
  await sql("update public.settings set value = $1::jsonb where key = 'quote_owner_approval_above_aed'", [limitRow?.v ?? "0"]);
  const ids = made.filter(Boolean);
  if (ids.length) {
    await sql("delete from public.notifications where href = any($1)", [ids.map((id) => `/estimates/${id}`)]);
  }
  cleanupDb();
}
summary();
