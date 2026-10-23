// After a deploy: the LIVE site checked without signing in (23 October 2026, the Next.js 16.4.2 security upgrade).
// Test documents are made through the LOCAL test server (E2E_BASE, its /api/e2e routes are refused on the live site),
// opened on the LIVE site (LIVE_BASE), then removed with the shared clean-up. Real customers' links are never opened
// (opening one would tell its advisor the customer looked at it).
//   E2E_BASE=http://localhost:3100 node --env-file=.env.local tests/browser/live-probe.mjs [expected Next.js version]
// Pictures: tests/browser/shots/live/.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { api, cleanupDb, here, makeChecks, sleep, sql } from "./pw-lib.mjs";

const LIVE = process.env.LIVE_BASE ?? "https://erp.ofjauto.com";
const WANT = process.argv[2] ?? "16.4.2";
const EDGE = process.env.E2E_BROWSER ?? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const SHOTS = path.join(here, "shots", "live");
fs.mkdirSync(SHOTS, { recursive: true });
const { check, summary } = makeChecks();
const UA = "WhatsApp/2.23.20.0";
const codes = [];
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 6 * 60 * 1000).unref();

const pdfText = async (url) => {
  const r = await fetch(`${LIVE}${url}`);
  const type = r.headers.get("content-type") ?? "";
  if (!/pdf/.test(type)) return { status: r.status, type, text: "" };
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(Buffer.from(await r.arrayBuffer()), "application/pdf");
  let t = "";
  for (let i = 0; i < doc.countPages(); i++) t += doc.loadPage(i).toStructuredText("preserve-whitespace").asText();
  return { status: r.status, type, pages: doc.countPages(), text: t.replace(/\s+/g, " ") };
};
const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const pageAt = async (width, height) => {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return { page, errors };
};
const visit = async (page, url) => { const r = await page.goto(`${LIVE}${url}`, { waitUntil: "load", timeout: 60000 }); await sleep(1500); return r?.status() ?? 0; };
const textOf = async (page) => ((await page.textContent("body")) ?? "").replace(/\s+/g, " ");

cleanupDb();
try {
  /* 1. The new version is the one serving, and the sign-in page works at PC and tablet width. */
  for (const [w, h] of [[1366, 900], [800, 1100]]) {
    const { page, errors } = await pageAt(w, h);
    const status = await visit(page, "/login");
    const version = await page.evaluate(() => window.next?.version ?? null);
    check(`1: ${w}px sign-in page answers 200 and runs Next.js ${WANT}`, status === 200 && version === WANT, `${status} ${version}`);
    check(`1: ${w}px shows Sign in with the email and password boxes, no page errors`, /Sign in/i.test(await textOf(page)) && (await page.locator("input[type=password]").count()) >= 1 && errors.length === 0, errors.join(" | ").slice(0, 200));
    await page.screenshot({ path: path.join(SHOTS, `live-login-${w}.png`) });
    await page.context().close();
  }

  /* 2. A car at Ready: the approved quotation and the proforma invoice, as the customer gets them. */
  const s = (await api("/api/e2e/stage", { stage: "ready" })).json;
  const q = (await sql("select token, number from public.quotations where id = $1", [s.quotationId]))[0];
  const inv = s.invoice;
  check("2: test documents made (quotation and proforma with their links)", !!q?.token && !!inv?.token, JSON.stringify({ q: q?.number, inv: inv?.number }));

  // Private screens send a signed-out visitor to the sign-in page (the proxy runs on the new build).
  for (const p of ["/dashboard", `/jobs/${s.jobId}`, `/jobs/${s.jobId}/quote/${s.quotationId}`, `/my-jobs/${s.jobId}`, "/scans"]) {
    const r = await fetch(`${LIVE}${p}`, { redirect: "manual" });
    check(`2: ${p.replace(/[0-9a-f-]{36}/g, "<id>")} sends a signed-out visitor to sign in`, r.status >= 300 && r.status < 400 && /\/login/.test(r.headers.get("location") ?? ""), `${r.status} ${r.headers.get("location")}`);
  }

  {
    const { page, errors } = await pageAt(390, 844);
    const status = await visit(page, `/quote/${q.token}`);
    const t = await textOf(page);
    check("2: the quotation link opens on a phone (200, the car and the total)", status === 200 && /Dubai S 30303|Porsche/i.test(t) && /AED|د\.إ/.test(t) && errors.length === 0, `${status} ${t.slice(0, 160)} ${errors.join(" | ").slice(0, 120)}`);
    await page.screenshot({ path: path.join(SHOTS, "live-quote-link.png"), fullPage: true });
    const pdf = await pdfText(`/api/pdf/quote/${q.token}`);
    check("2: the quotation PDF is a real PDF with its number", pdf.status === 200 && /QUOTATION/i.test(pdf.text) && pdf.text.includes(q.number), `${pdf.status} ${pdf.type} ${pdf.text.slice(0, 120)}`);

    const st2 = await visit(page, `/proforma/${inv.token}`);
    const t2 = await textOf(page);
    check("2: the proforma invoice link opens on a phone with its number", st2 === 200 && t2.includes(inv.number) && errors.length === 0, `${st2} ${t2.slice(0, 160)}`);
    await page.screenshot({ path: path.join(SHOTS, "live-invoice-link.png"), fullPage: true });
    const ipdf = await pdfText(`/api/pdf/invoice/${inv.token}`);
    check("2: the invoice PDF is a real PDF with its number", ipdf.status === 200 && ipdf.text.includes(inv.number), `${ipdf.status} ${ipdf.type} ${ipdf.text.slice(0, 120)}`);
    await page.context().close();
  }

  /* 3. WhatsApp previews: the short links of those two documents answer WhatsApp with the logo card. */
  {
    const tag = `lv${Date.now().toString(36).slice(-5)}`;
    const rows = [[`${tag}q`, `https://erp.ofjauto.com/quote/${q.token}`, "q", "Your quotation"], [`${tag}i`, `https://erp.ofjauto.com/proforma/${inv.token}`, "i", "Your invoice"]];
    for (const [code, url] of rows) { await sql("insert into public.short_links (code, url, kind) values ($1, $2, 'page') on conflict do nothing", [code, url]); codes.push(code); }
    for (const [code, url, prefix, title] of rows) {
      const r = await fetch(`${LIVE}/${prefix}/${code}`, { headers: { "user-agent": UA }, redirect: "manual" });
      const html = await r.text();
      check(`3: /${prefix}/… answers WhatsApp 200 with "${title}" and the square logo`, r.status === 200 && html.includes(`og:title" content="OFJ Automotive – ${title}"`) && html.includes('og:image" content="https://erp.ofjauto.com/og/ofj-square-600.png"'), `${r.status}`);
      const human = await fetch(`${LIVE}/${prefix}/${code}`, { redirect: "manual" });
      const body = await human.text();
      check(`3: /${prefix}/… takes a person on to the document`, (human.status >= 300 && human.status < 400 && human.headers.get("location") === url) || (human.status === 200 && body.includes(url)), `${human.status}`);
    }
    const img = await fetch(`${LIVE}/og/ofj-square-600.png`);
    check("3: the preview logo is public", img.status === 200 && /image\/png/.test(img.headers.get("content-type") ?? ""), `${img.status}`);
  }

  /* 4. A bodyshop car at Ready: the warranty card and certificate, and the handover page. */
  {
    const b = (await api("/api/e2e/stage", { stage: "bodyshop", at: "ready" })).json;
    const wtok = `e2elive${Date.now().toString(36)}`;
    await sql("update public.jobs set warranty_token = $1 where id = $2", [wtok, b.jobId]);
    const { page, errors } = await pageAt(390, 844);
    const st = await visit(page, `/warranty/${wtok}`);
    const t = await textOf(page);
    check("4: the warranty link opens on a phone with the car's VIN", st === 200 && /warranty/i.test(t) && /WDC1234567E2E0001/.test(t) && errors.length === 0, `${st} ${t.slice(0, 160)}`);
    await page.screenshot({ path: path.join(SHOTS, "live-warranty-link.png"), fullPage: true });
    const st2 = await visit(page, `/handover/${b.handoverToken}`);
    check("4: the handover page opens", st2 === 200 && /handover/i.test(await textOf(page)), String(st2));
    const wpdf = await pdfText(`/api/pdf/warranty/${b.handoverToken}`);
    check("4: the warranty certificate PDF is a real PDF", wpdf.status === 200 && /WARRANTY CERTIFICATE/i.test(wpdf.text) && /WDC1234567E2E0001/.test(wpdf.text), `${wpdf.status} ${wpdf.type} ${wpdf.text.slice(0, 120)}`);
    await page.context().close();
  }

  /* 5. The scans mailbox: the live five-minute check (read-only Gmail), run once as Vercel's scheduler calls it. */
  {
    const r = await fetch(`${LIVE}/api/cron/mailbox`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` } });
    const j = await r.json().catch(() => ({}));
    check("5: the live mailbox check reads scans@ofjauto.com without a problem", r.status === 200 && j.ok === true, JSON.stringify(j));
    const unauth = await fetch(`${LIVE}/api/cron/mailbox`);
    check("5: without the secret it is refused", unauth.status === 401, String(unauth.status));
  }
} catch (e) {
  check("walked without a crash", false, (e?.message ?? String(e)).slice(0, 300));
} finally {
  await browser.close();
  for (const c of codes) await sql("delete from public.short_links where code = $1", [c]);
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
