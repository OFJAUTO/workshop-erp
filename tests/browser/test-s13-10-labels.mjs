// 13 November 2026, Section 10: Labels (renamed from Stickers) and the battery warranty label - a battery handed to
// the technician always has its label ready to print (the handover saved an empty list since 18 October), old
// handovers print from their battery warranty, the battery label takes the service label's size. TEST only.
//   node --env-file=.env.test.local tests/browser/test-s13-10-labels.mjs
import fs from "node:fs";
import { api, base, browserFor, browserForId, cleanupDb, freeTech, makeChecks, pageReady, setPin, sleep } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const OUT = "docs/proof/2026-11-13-labels";
fs.mkdirSync(OUT, { recursive: true });
async function q(text, params = []) {
  const r = await api("/api/e2e/sql", { sql: text, params });
  if (r.status !== 200) throw new Error(`SQL failed: ${JSON.stringify(r.json ?? r.text).slice(0, 300)}\n${text.slice(0, 200)}`);
  return r.json.rows ?? [];
}
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const txt = async (loc) => ((await loc.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
const JOB = "22222222-0000-4000-8000-00000000e303";
const PA = "22222222-0000-4000-8000-00000000e306";

try {
  cleanupDb();
  const st = await api("/api/e2e/stage", { stage: "approved" });
  if (st.status !== 200) throw new Error(`stage: ${st.status}`);
  // The approved part becomes a battery, received at the desk and ready for the technician.
  await q("update public.part_items set description = 'main battery', brand = 'VARTA', order_status = 'received', received_qty = 1, ready_for_handover_at = now() where id = $1", [PA]);
  const tech = await freeTech(JOB);
  await setPin(tech, "1234");

  // 1. The technician receives the battery: its warranty label is on the handover, ready to print.
  const t = await browserForId(tech, { viewport: { width: 800, height: 1280 }, touch: true });
  await t.page.goto(`${base}/my-jobs/${JOB}`, { waitUntil: "domcontentloaded" });
  await pageReady(t.page);
  for (let i = 0; i < 5 && (await t.page.locator("[data-part-take][data-ticked='0'] button").count()); i++) { await t.page.locator("[data-part-take][data-ticked='0'] button").first().click(); await sleep(300); }
  await t.page.locator("[data-receive-pin]").fill("1234");
  await t.page.locator("[data-receive-parts]").click();
  const h = await until(async () => (await q("select id, stickers from public.part_handovers where job_id = $1 order by created_at desc limit 1", [JOB]))[0], 40);
  await t.browser.close();
  check("the handover carries the battery's warranty label (never an empty list)", !!h && h.stickers && h.stickers[PA]?.kind === "battery", JSON.stringify(h?.stickers));

  const o = await browserFor("owner", { viewport: { width: 1366, height: 900 } });
  await o.page.goto(`${base}/print/stickers/${h.id}`, { waitUntil: "domcontentloaded" });
  await pageReady(o.page);
  const body = await txt(o.page.locator("body"));
  check("the print page shows the battery label (no 'No stickers were asked for')", !/No stickers were asked for/.test(body) && /1 label/.test(body), body.slice(0, 160));
  await o.page.screenshot({ path: `${OUT}/s10-battery-label-print-1366.png` });

  // 2. An old handover saved with an empty list prints from its battery warranty.
  await q("update public.part_handovers set stickers = '{}'::jsonb where id = $1", [h.id]);
  await o.page.goto(`${base}/print/stickers/${h.id}?reprint=0`, { waitUntil: "domcontentloaded" });
  await pageReady(o.page);
  check("an old handover (empty list) still prints its battery label", /1 label/.test(await txt(o.page.locator("body"))));

  // 3. The battery label is the same size as the service label (one setting), not the 50 × 25 part label.
  await o.page.goto(`${base}/print/sticker-test?kind=battery`, { waitUntil: "domcontentloaded" });
  const bar1 = await txt(o.page.locator(".bar"));
  await o.page.screenshot({ path: `${OUT}/s10-test-battery-1366.png` });
  await o.page.goto(`${base}/print/sticker-test?kind=service`, { waitUntil: "domcontentloaded" });
  const bar2 = await txt(o.page.locator(".bar"));
  await o.page.screenshot({ path: `${OUT}/s10-test-service-1366.png` });
  const size = (b) => (b.match(/(\d+(?:\.\d+)?) × (\d+(?:\.\d+)?) mm/) ?? []).slice(1).join("x");
  check("battery and service labels are the same size", size(bar1) && size(bar1) === size(bar2) && size(bar1) !== "50x25", `${bar1} | ${bar2}`);

  // 4. Labels everywhere: menu, tabs; the printer setup has a test print per label type.
  await o.page.goto(`${base}/stickers?tab=warranty`, { waitUntil: "domcontentloaded" });
  await pageReady(o.page);
  check("the page and its tabs say Labels", /Labels/.test(await txt(o.page.locator("h1"))) && /Part labels/.test(await txt(o.page.locator("[data-stickers-tabs]"))) && /Warranty labels/.test(await txt(o.page.locator("[data-stickers-tabs]"))));
  const brow = o.page.locator("[data-battery-row]").first();
  check("battery rows show plate, car and battery brand", /VARTA/.test(await txt(brow)), (await txt(brow)).slice(0, 160));
  await o.page.screenshot({ path: `${OUT}/s10-warranty-labels-1366.png` });
  await o.page.goto(`${base}/stickers?tab=printer`, { waitUntil: "domcontentloaded" });
  await pageReady(o.page);
  check("printer setup: a test print for each label type", (await o.page.locator("[data-test-print='part']").count()) === 1 && (await o.page.locator("[data-test-print='battery']").count()) === 1 && (await o.page.locator("[data-test-print='service']").count()) === 1);
  await o.browser.close();

  // 5. The gate-in role: Warranty labels and History only.
  const g = await browserFor("gate_in", { viewport: { width: 800, height: 1280 } }).catch(() => null);
  if (g) {
    await g.page.goto(`${base}/stickers`, { waitUntil: "domcontentloaded" });
    await pageReady(g.page);
    const tabs = await txt(g.page.locator("[data-stickers-tabs]"));
    check("gate-in sees Warranty labels and History, not Part labels", /Warranty labels/.test(tabs) && /History/.test(tabs) && !/Part labels/.test(tabs), tabs);
    await g.page.screenshot({ path: `${OUT}/s10-gate-in-800.png` });
    await g.browser.close();
  } else check("a gate-in login is available on TEST", false);
} catch (e) {
  check("the test ran to the end", false, String(e?.message ?? e).slice(0, 300));
} finally {
  cleanupDb();
}
process.exit(summary() ? 1 : 0);
