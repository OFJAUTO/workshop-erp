// Proof for the labour estimate fix of 15 October 2026 (the "1400 h" bug): every hour-based labour line shows three
// labelled boxes (Hours, Est. h, AED/h), labour at cost is the Est. h boxes × the cost rate, the footer and the internal
// box agree, a rate typed into Est. h turns amber and the quoted hours stand in, and the customer PDF never changes.
// Run against `npx next dev -p 3100`:  node --env-file=.env.local tests/browser/test-j.mjs
import path from "node:path";
import { api, base, browserFor, cleanupDb, cookieHeader, go, makeChecks, projectRoot, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 10 * 60 * 1000).unref();
cleanupDb();

const until = async (fn, tries = 60, ms = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(ms); } return null; };
const shot = (page, name) => page.screenshot({ path: path.join(projectRoot, "tests", "browser", "shots", `${name}.png`) }).catch(() => null);
async function pdfText(buf) {
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  let text = "";
  for (let i = 0; i < doc.countPages(); i++) text += doc.loadPage(i).toStructuredText("preserve-whitespace").asText() + "\n";
  return text;
}
async function fetchPdf(pathname, role) {
  const res = await fetch(`${base}${pathname}`, { headers: { cookie: await cookieHeader(role) } });
  return { status: res.status, buf: res.ok ? Buffer.from(await res.arrayBuffer()) : null };
}
/** The customer-facing numbers of a page or PDF: every "n h" and every "AED n" in order, so two renders can be compared. */
const customerNumbers = (text) => (text.match(/\b\d+(?:\.\d+)? h\b|AED\s?[\d,]+(?:\.\d{2})?/g) ?? []).join(" | ");
const money = (n) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/[.,]/g, (c) => `\\${c}`);

try {
  const seed = await api("/api/e2e/stage", { stage: "quote" });
  const { jobId, quotationId } = seed.json;
  check("seed: a quotation at the Quote stage", !!jobId && !!quotationId, JSON.stringify(seed.json ?? seed.text).slice(0, 120));
  const rates = (await sql("select (select value from public.settings where key = 'technician_cost_rate_aed') as cost, (select value from public.settings where key = 'labour_rate_aed') as rate"))[0];
  const costRate = Number(rates?.cost ?? 90);
  const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0]?.id;

  // Four labour lines at AED 350: 3 h, 3 h, 2 h and 1.5 h (the seed's own labour lines are set aside).
  await sql("update public.quotation_lines set is_active = false where quotation_id = $1 and line_type = 'labour'", [quotationId]);
  const hoursList = [3, 3, 2, 1.5];
  for (const [i, h] of hoursList.entries()) {
    await sql("insert into public.quotation_lines (quotation_id, position, line_type, title, hours, labour_rate, quantity, line_total, source_type, urgency, created_by, updated_by) values ($1, $2, 'labour', $3, $4, 350, 1, $5, 'manual', 'recommended', $6, $6)", [quotationId, 100 + i, `E2e labour job ${i + 1}`, h, h * 350, owner]);
  }

  const { browser, page } = await browserFor("owner", { viewport: { width: 1366, height: 900 } });
  await go(page, `${base}/jobs/${jobId}/quote/${quotationId}`);
  await until(async () => ((await page.locator("[data-labour-boxes]").count()) >= 4 ? 1 : null), 30, 500);

  // 1. Three labelled boxes on every hour-based line.
  const rows = page.locator("[data-labour-boxes]");
  check("1: every labour line shows three boxes: Hours, Est. h and the rate", (await rows.count()) === 4 && (await page.locator("[data-estimate]").count()) === 4 && (await page.locator("[data-rate]").count()) === 4, `${await rows.count()} rows, ${await page.locator("[data-estimate]").count()} estimates, ${await page.locator("[data-rate]").count()} rates`);
  const rowText = (await rows.first().textContent()) ?? "";
  check("1: the labels read Hours, Est. h and AED/h; 'est.' never sits on the rate box", /Hours/.test(rowText) && /Est\. h/.test(rowText) && /AED\/h/.test(rowText) && !/est\.\s*AED/.test(rowText), rowText.trim());
  check("1: the rate box holds 350 and Est. h defaults to the quoted hours", (await page.locator("[data-rate]").first().inputValue()) === "350" && (await page.locator("[data-estimate]").first().inputValue()) === "3" && (await page.locator("[data-estimate]").nth(3).inputValue()) === "1.5");

  // 2 and 6. Labour at cost = 9.5 h × the cost rate (AED 855 at AED 90).
  const label = async () => (await page.locator("[data-labour-cost-label]").textContent().catch(() => "")) ?? "";
  const cost = async () => (await page.locator("[data-labour-cost]").textContent().catch(() => "")) ?? "";
  const footer = async () => (await page.locator("[data-estimate-footer]").textContent().catch(() => "")) ?? "";
  check(`2/6: labour at cost reads 9.5 h estimate × AED ${costRate} = AED ${9.5 * costRate}`, /9\.5 h estimate × AED/.test(await label()) && new RegExp(money(9.5 * costRate)).test(await cost()), `${await label()} = ${await cost()}`);
  check("2: the Est. h boxes, not the rate, make the cost (never 1400 h)", !/1400|1,400/.test(await label()));
  check("3: the footer and the internal box use the same numbers", /Workshop estimate 9\.5 h · quoted 9\.5 h/.test(await footer()), (await footer()).trim());

  // The customer PDF before any estimate change.
  const pdfBefore = await fetchPdf(`/api/pdf/quotation/${quotationId}`, "owner");
  const textBefore = pdfBefore.buf ? await pdfText(pdfBefore.buf) : "";
  check("6: the customer PDF renders and carries no estimate or cost rate", pdfBefore.status === 200 && !/estimate|est\. h|AED\/h/i.test(textBefore) && !new RegExp(`\\b${costRate}\\b`).test(textBefore), `status ${pdfBefore.status}`);

  // 6. One estimate changed to 2.5 h: 9.0 h × rate.
  const est1 = page.locator("[data-estimate]").first();
  await est1.fill("2.5");
  await page.keyboard.press("Tab");
  const saved = await until(async () => { const r = (await sql("select hours_estimate from public.quotation_lines where quotation_id = $1 and line_type = 'labour' and is_active and title ilike 'E2e labour job 1' limit 1", [quotationId]))[0]; return Number(r?.hours_estimate) === 2.5 ? r : null; }, 30, 500);
  check("6: the estimate saves on the line", !!saved);
  const updated = await until(async () => (/9\.0 h estimate/.test(await label()) ? 1 : null), 30, 500);
  check(`6: labour at cost updates to 9.0 h × AED ${costRate} = AED ${9 * costRate}`, !!updated && new RegExp(money(9 * costRate)).test(await cost()), `${await label()} = ${await cost()}`);
  check("3: the footer follows: Workshop estimate 9.0 h · quoted 9.5 h", /Workshop estimate 9\.0 h · quoted 9\.5 h/.test(await footer()), (await footer()).trim());
  check("6: the quoted hours and the line totals did not move", (await page.locator("[data-amount]").first().inputValue()) === "3" && (await page.locator("[data-rate]").first().inputValue()) === "350");

  // 5. The rate typed into Est. h on the second line: an amber warning on that line, the quoted hours stand in (2.5 + 3 + 2 + 1.5 = 9.0 h).
  const est2 = page.locator("[data-estimate]").nth(1);
  await est2.fill("350");
  await page.keyboard.press("Tab");
  const warned = await until(async () => ((await page.locator("[data-estimate-warning]").count()) ? 1 : null), 30, 500);
  check("5: an amber warning appears on the line whose Est. h is over 50 h", !!warned, (await page.locator("[data-estimate-warning]").first().textContent().catch(() => "")) ?? "");
  check("5: the Est. h box itself is marked amber", (await page.locator("[data-estimate-suspect='1']").count()) === 1);
  await until(async () => (/9\.0 h estimate/.test(await label()) && (await page.locator("[data-estimate-cost-warning]").count()) ? 1 : null), 20, 500);
  check("5: labour at cost keeps the quoted hours for that line (9.0 h, not 357 h) and says why", /9\.0 h estimate/.test(await label()) && (await page.locator("[data-estimate-cost-warning]").count()) === 1 && !/357/.test(await label()), (await label()).trim());
  await shot(page, "09-labour-line-three-boxes");
  // Back to a sensible figure: the warning goes.
  await est2.fill("3");
  await page.keyboard.press("Tab");
  const cleared = await until(async () => ((await page.locator("[data-estimate-warning]").count()) === 0 ? 1 : null), 30, 500);
  check("5: the warning clears once the estimate is hours again", !!cleared);

  // 6. The customer PDF is unchanged by every internal change.
  await sleep(1000);
  const pdfAfter = await fetchPdf(`/api/pdf/quotation/${quotationId}`, "owner");
  const textAfter = pdfAfter.buf ? await pdfText(pdfAfter.buf) : "";
  check("6: the customer PDF is byte-for-byte the same text after the estimate changes", pdfAfter.status === 200 && textBefore.length > 0 && customerNumbers(textAfter) === customerNumbers(textBefore) && textAfter.replace(/\s+/g, " ") === textBefore.replace(/\s+/g, " "), `${customerNumbers(textBefore).slice(0, 160)} vs ${customerNumbers(textAfter).slice(0, 160)}`);

  // The customer link (the quotation is sent for this check only) shows the quoted hours and totals, never an estimate.
  const tok = (await sql("update public.quotations set status = 'sent', sent_at = coalesce(sent_at, now()), token = coalesce(token, 'e2eest' || substr(md5(random()::text), 1, 20)) where id = $1 returning token", [quotationId]))[0]?.token;
  const link = tok ? await fetch(`${base}/quote/${tok}`) : null;
  const linkHtml = link ? await link.text() : "";
  // React splits "Total" and " including VAT" with a comment node, so the whitespace is collapsed before reading.
  const linkText = linkHtml.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  // The link is the short first page: the total including VAT (the same figure the editor saved) and the PDF button; the lines live in the PDF.
  const linkAmounts = linkText.match(/AED\s?[\d,]+(?:\.\d{2})?/g) ?? [];
  const linkTotal = (linkAmounts[linkAmounts.length - 1] ?? "").replace(/^AED\s?/, "");
  check("6: the customer link shows the same total as the PDF and never an estimate or the cost rate", !!link && link.status === 200 && /Total including VAT/i.test(linkText) && !!linkTotal && textAfter.replace(/\s+/g, " ").includes(linkTotal) && !/Est\. h|AED\/h|\bestimate\b/.test(linkText), `status ${link?.status} · link ${linkAmounts.join(", ")} · pdf has ${linkTotal}: ${textAfter.includes(linkTotal)} · total-words ${/Total including VAT/i.test(linkText)} · leak ${JSON.stringify(linkText.match(/.{30}(?:Est\. h|AED\/h|\bestimate\b).{30}/g) ?? [])}`);

  await browser.close();
} catch (e) {
  check("no crash", false, String(e?.message ?? e).slice(0, 300));
} finally {
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
