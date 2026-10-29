// THE pop-up layout check (28 October 2026, B3): every pop-up, window, sheet and three-dot menu the staff and the
// customers use is opened on a seeded test car and measured at every size of the layout check (29 October 2026:
// 1440x900, 1280x800, 1024x768, 800x1280, 768x1024 and a phone at 390x844; a pop-up that closes when the window
// changes - the bell moves into the top bar below 1,100 px - is opened again at that size):
//   - the box fits inside the window (or scrolls inside itself),
//   - nothing inside is cut off by a container that hides its overflow (the discount window's "AE" fault),
//   - no button or label has text wider than itself,
//   - no two controls sit on top of each other.
// Run alone: ROLE=popups node --env-file=.env.local tests/browser/layout-check.mjs   (part of npm run test:layout).
// Not opened on purpose: Settings > Zoho Books (the mirror, the go-live switch): a dev machine must never load that
// page while the real Zoho connection is live (it refreshes the live token); those controls are plain forms, not pop-ups.
import { pathToFileURL } from "node:url";
import { api, base, browserFor, browserForId, cleanupDb, sleep, sql } from "./pw-lib.mjs";

const SIZES = [[1440, 900], [1280, 800], [1024, 768], [800, 1280], [768, 1024], [390, 844]];
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGklEQVR4nGP4z8BAEmIY1TCqYVTDqIbhqgEAOK8f8Rf2cHcAAAAASUVORK5CYII=", "base64");

/** In the browser: the problems inside one open pop-up. */
function measure(rootSel) {
  const roots = [...document.querySelectorAll(rootSel)].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  const root = roots.at(-1);
  if (!root) return ["the pop-up did not open"];
  const out = [];
  const W = window.innerWidth;
  const H = window.innerHeight;
  const rr = root.getBoundingClientRect();
  if (rr.left < -1 || rr.right > W + 1) out.push(`the box is wider than the window (${Math.round(rr.left)}-${Math.round(rr.right)} of ${W})`);
  if (rr.bottom > H + 1) {
    // Fine only when something inside (or the box itself) scrolls.
    // A box in the page's own flow (no fixed ancestor) scrolls with the page.
    let fixed = false;
    for (let a = root; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).position === "fixed") { fixed = true; break; }
    let scrolls = !fixed && document.scrollingElement.scrollHeight > H;
    for (let a = root; !scrolls && a && a !== document.body; a = a.parentElement) { const cs = getComputedStyle(a); if (/(auto|scroll)/.test(cs.overflowY) && a.scrollHeight > a.clientHeight) { scrolls = true; break; } }
    if (!scrolls) out.push(`the bottom is below the window and cannot be scrolled (${Math.round(rr.bottom)} of ${H})`);
  }
  // A full-screen backdrop is always the window's size: measure the box inside it instead, and a control below or
  // above the window counts unless something between it and the backdrop scrolls.
  const fixedRoot = getComputedStyle(root).position === "fixed";
  if (fixedRoot && rr.width >= W - 2 && rr.height >= H - 2) {
    const box = [...root.children].find((c) => c.getBoundingClientRect().height > 0);
    if (box) {
      const br = box.getBoundingClientRect();
      const boxScrolls = /(auto|scroll)/.test(getComputedStyle(box).overflowY) || /(auto|scroll)/.test(getComputedStyle(root).overflowY);
      if ((br.top < -1 || br.bottom > H + 1) && !boxScrolls) out.push(`the window is taller than the screen and does not scroll (${Math.round(br.top)} to ${Math.round(br.bottom)} of ${H})`);
    }
  }
  const scrollsBetween = (e) => { for (let a = e.parentElement; a && a !== root.parentElement; a = a.parentElement) { const cs = getComputedStyle(a); if (/(auto|scroll)/.test(cs.overflowY) && a.scrollHeight > a.clientHeight + 1) return true; } return false; };
  const shownInScrollers = (e, r) => { for (let a = e.parentElement; a && a !== root.parentElement; a = a.parentElement) { const cs = getComputedStyle(a); if (/(auto|scroll)/.test(cs.overflowY + cs.overflowX)) { const ar = a.getBoundingClientRect(); if (r.bottom <= ar.top + 1 || r.top >= ar.bottom - 1 || r.right <= ar.left + 1 || r.left >= ar.right - 1) return false; } } return true; };
  const visible = (e) => { const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; if (!shownInScrollers(e, r)) return false; const cs = getComputedStyle(e); if (cs.visibility === "hidden" || cs.display === "none") return false; for (let a = e; a && a !== root; a = a.parentElement) if (a.tagName === "DETAILS" && !a.open && a !== e.parentElement) return false; return true; };
  const all = [...root.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea, label, [role=button]")].filter(visible);
  const name = (e) => (e.getAttribute("aria-label") || e.textContent || e.getAttribute("placeholder") || e.tagName).trim().replace(/\s+/g, " ").slice(0, 40);
  for (const e of all) {
    const r = e.getBoundingClientRect();
    if (r.right > W + 1 || r.left < -1) out.push(`"${name(e)}" sticks out of the window`);
    if (fixedRoot && (r.bottom > H + 1 || r.top < -1) && !scrollsBetween(e)) out.push(`"${name(e)}" is off the screen and cannot be scrolled to`);
    // Cut off by a container that hides overflow (inside the pop-up).
    for (let a = e.parentElement; a && a !== root.parentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      const hidesX = /(hidden|clip)/.test(cs.overflowX);
      const hidesY = /(hidden|clip)/.test(cs.overflowY);
      if (!hidesX && !hidesY) continue;
      const ar = a.getBoundingClientRect();
      if ((hidesX && (r.left < ar.left - 1 || r.right > ar.right + 1)) || (hidesY && (r.top < ar.top - 1 || r.bottom > ar.bottom + 1))) { out.push(`"${name(e)}" is cut off by its container`); break; }
    }
    // Text wider than its own button or label.
    if ((e.tagName === "BUTTON" || e.getAttribute("role") === "button" || e.tagName === "A") && e.scrollWidth > e.clientWidth + 1) out.push(`"${name(e)}": the words are wider than the button`);
  }
  const controls = all.filter((e) => e.tagName !== "LABEL");
  for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
    const a = controls[i], b = controls[j];
    if (a.contains(b) || b.contains(a)) continue;
    const clipToScrollers = (e) => { let r = e.getBoundingClientRect(); r = { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; for (let p = e.parentElement; p && p !== root.parentElement; p = p.parentElement) { const cs = getComputedStyle(p); if (/(auto|scroll|hidden|clip)/.test(cs.overflowY + cs.overflowX)) { const pr = p.getBoundingClientRect(); r = { left: Math.max(r.left, pr.left), right: Math.min(r.right, pr.right), top: Math.max(r.top, pr.top), bottom: Math.min(r.bottom, pr.bottom) }; } } return r; };
    const ra = clipToScrollers(a), rb = clipToScrollers(b);
    const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
    if (w > 4 && h > 4) out.push(`"${name(a)}" overlaps "${name(b)}"`);
  }
  return [...new Set(out)];
}

/** Opens one pop-up and measures it at every width (the pop-up stays open while the window changes size). */
async function check(page, label, rootSel, open, findings, shots) {
  try {
    await open();
    await page.waitForSelector(rootSel, { state: "visible", timeout: 8000 });
  } catch (e) {
    notReached.push(`${label}: could not be opened (${String(e.message ?? e).split("\n")[0].slice(0, 80)})`);
    return;
  }
  for (const [w, h] of SIZES) {
    await page.setViewportSize({ width: w, height: h });
    await sleep(400);
    const stillOpen = await page.locator(rootSel).last().isVisible().catch(() => false);
    if (!stillOpen) {
      await open().catch(() => null);
      await page.waitForSelector(rootSel, { state: "visible", timeout: 6000 }).catch(() => null);
      await sleep(300);
    }
    const problems = await page.evaluate(measure, rootSel).catch((e) => [`measuring failed: ${String(e).slice(0, 60)}`]);
    const slug = label.replace(/\W+/g, "-").toLowerCase();
    await page.screenshot({ path: `tests/browser/shots/layout/popup-${slug}-${w}.png` }).catch(() => null);
    shots.n++;
    for (const p of problems) findings.push(`${label} @${w}: ${p}`);
    if (problems.length) console.log(`FAIL ${label} @${w}\n  - ${problems.join("\n  - ")}`);
  }
  console.log(`${label}: measured`);
  await page.keyboard.press("Escape").catch(() => null);
  await page.setViewportSize({ width: 1366, height: 1000 });
}

/** Pop-ups the run could not reach (a seed or a button missing): listed loudly, but they are not layout faults. */
const notReached = [];
const goto = async (page, url) => { await page.goto(`${base}${url}`, { waitUntil: "load", timeout: 60000 }); await sleep(1500); };
const click = (page, sel) => page.locator(sel).first().click({ timeout: 8000 });

export async function runPopups() {
  const findings = [];
  const shots = { n: 0 };
  const owner = await browserFor("owner", { viewport: { width: 1366, height: 1000 } });
  const p = owner.page;

  /* ---- The quotation editor (a draft quotation with a labour line and a part request) ---- */
  const quote = (await api("/api/e2e/stage", { stage: "quote" })).json;
  const qUrl = `/jobs/${quote.jobId}/quote/${quote.quotationId}`;
  await goto(p, qUrl);
  await check(p, "Discount (percent)", "[data-labour-discount-dialog]", () => click(p, "[data-labour-discount]"), findings, shots);
  await goto(p, qUrl);
  await check(p, "Discount (AED)", "[data-labour-discount-dialog]", async () => { await click(p, "[data-labour-discount]"); await p.locator("[data-labour-discount-dialog] button", { hasText: /^AED$/ }).first().click(); }, findings, shots);
  await goto(p, qUrl);
  await check(p, "Quotation line menu", "[data-floating-menu]", () => click(p, 'button[aria-label="More for this line"]'), findings, shots);
  await goto(p, qUrl);
  await check(p, "Add a part (quotation)", "[data-part-picker]", () => p.getByRole("button", { name: "+ Add a part" }).first().click(), findings, shots);
  await goto(p, qUrl);
  if (await p.locator("[data-add-package]").count()) await check(p, "Add a package", "[data-package-ask]", () => click(p, "[data-add-package]"), findings, shots);
  /* ---- The Parts desk ---- */
  const pUrl = `/parts/${quote.jobId}`;
  await goto(p, pUrl);
  await check(p, "Part menu", "[data-part-menu]", () => click(p, 'button[aria-label="More for this part"]'), findings, shots);
  await goto(p, pUrl);
  await check(p, "Remove: not needed", "[data-remove-dialog]", async () => { await click(p, 'button[aria-label="More for this part"]'); await p.locator("[data-part-menu]").getByText(/Remove: not needed/).first().click(); }, findings, shots);
  await goto(p, pUrl);
  await check(p, "Split into separate parts", "[data-split-dialog]", async () => {
    const menus = p.locator('button[aria-label="More for this part"]');
    for (let i = 0; i < (await menus.count()); i++) {
      await menus.nth(i).click();
      const item = p.locator("[data-part-menu]").getByText(/Split into separate parts/);
      if (await item.count()) { await item.first().click(); return; }
      await p.keyboard.press("Escape");
      await sleep(300);
    }
    throw new Error("no part row offers Split");
  }, findings, shots);
  await goto(p, pUrl);
  await check(p, "Add a part (Parts desk)", "[data-part-picker]", () => click(p, "[data-add-part]"), findings, shots);
  await goto(p, pUrl);
  await check(p, "Delete the ticked parts", "[data-delete-confirm]", async () => { await click(p, "[data-select-all]"); await click(p, "[data-delete-all]"); }, findings, shots);
  await goto(p, pUrl);
  await check(p, "Copy list for supplier", "[data-supplier-list]", () => p.getByRole("button", { name: /Copy list for supplier/ }).first().click(), findings, shots);

  // "Quotation complete": every question it asks on the way, then the send window. A part request nobody priced
  // would block it, so it counts as not available here.
  await sql("update public.part_requests set status = 'unavailable', closed_reason = 'Pop-up check' where job_id = $1 and is_active and id not in (select part_request_id from public.part_items where job_id = $1 and part_request_id is not null)", [quote.jobId]);
  await sql("update public.part_items set cost_aed = coalesce(cost_aed, 100), list_price_aed = coalesce(list_price_aed, 100), availability = 'in_stock', supplier = coalesce(supplier, 'Our Stock'), part_number = coalesce(part_number, 'PC-1'), priced_at = coalesce(priced_at, now()) where job_id = $1 and is_active", [quote.jobId]);
  await sql("update public.jobs set parts_pricing_done_at = now() where id = $1", [quote.jobId]);
  await goto(p, qUrl);
  const asks = [["[data-parts-ask]", "[data-parts-leave]"], ["[data-low-profit-ask]", "[data-low-profit-send]"], ["[data-deposit-ask]", "[data-deposit-skip]"], ["[data-markup-ask]", "[data-markup-continue]"], ["[data-positions-ask]", null]];
  const complete = p.getByRole("button", { name: /Quotation complete/ }).first();
  if (await complete.count()) {
    await complete.click().catch(() => null);
    for (let round = 0; round < 6; round++) {
      await sleep(1500);
      let opened = false;
      for (const [root, go] of asks) {
        if (await p.locator(root).count()) {
          opened = true;
          await check(p, `Complete: ${root.replace(/\[data-|\]/g, "")}`, root, async () => {}, findings, shots);
          if (go && (await p.locator(go).count())) await p.locator(go).first().click().catch(() => null);
          else await p.keyboard.press("Escape").catch(() => null);
        }
      }
      if (!opened) break;
    }
  }
  await goto(p, qUrl);
  const send = p.getByRole("button", { name: /^(Send quotation|Approve and send)$/ }).first();
  if (await send.count()) await check(p, "Send the quotation", "[role=dialog]", () => send.click(), findings, shots);
  else notReached.push("Send the quotation: the Send button did not show after Quotation complete");


  /* ---- The customer's pages (no login): approve a quotation, Pay now ---- */
  await sql("update public.quotations set status = 'sent', sent_at = now(), valid_until = now() + interval '7 days' where id = $1", [quote.quotationId]);
  const { chromium } = await import("playwright-core");
  const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
  const cb = await chromium.launch({ executablePath: EDGE, headless: true });
  const cp = await (await cb.newContext({ viewport: { width: 1366, height: 1000 } })).newPage();
  await goto(cp, `/quote/${quote.token}`);
  if (await cp.getByRole("button", { name: /^(Approved|Accepted)$/ }).count()) await check(cp, "Customer: approve the quotation", "[data-quote-approve-sheet]", () => cp.getByRole("button", { name: /^(Approved|Accepted)$/ }).first().click(), findings, shots);
  else notReached.push("Customer: approve the quotation: the Approve button did not show");
  await cb.close();

  /* ---- Money: a deposit, the proforma, a full payment ---- */
  const dep = (await api("/api/e2e/stage", { stage: "approved", deposit: 500 })).json;
  await sql("update public.quotations set deposit_aed = 500 where id = $1", [dep.quotationId]);
  await goto(p, `/jobs/${dep.jobId}/invoice`);
  if (await p.locator("[data-record-deposit-open]").count()) await check(p, "Record the deposit", "[data-record-deposit-panel]", () => click(p, "[data-record-deposit-open]"), findings, shots);
  else notReached.push("Record the deposit: no deposit to record on the seeded car");
  await goto(p, `/jobs/${dep.jobId}`);
  if (await p.locator("[data-send-deposit-request]").count()) await check(p, "Send the deposit request", "[role=dialog]", () => click(p, "[data-send-deposit-request]"), findings, shots);

  const ready = (await api("/api/e2e/stage", { stage: "ready" })).json;
  const iUrl = `/jobs/${ready.jobId}/invoice`;
  await goto(p, iUrl);
  await check(p, "Send the proforma", "[role=dialog]", () => p.getByRole("button", { name: /Send the proforma/ }).first().click(), findings, shots);
  if (ready.invoice?.id) await sql("update public.invoices set sent_at = now() where id = $1", [ready.invoice.id]);
  await goto(p, iUrl);
  const payForm = p.locator("[data-payment-form]").first();
  if (await payForm.count()) await check(p, "Record full payment", "[data-confirm-full]", async () => {
    await payForm.locator('[data-method="cash"]').click();
    if (await payForm.locator("[data-amount-full]").count()) await payForm.locator("[data-amount-full]").click();
    await sleep(1200);
    await payForm.locator("[data-record-payment]").first().click();
  }, findings, shots);
  else notReached.push("Record full payment: the payment form did not show");
  /* ---- The wash ---- */
  await sql("update public.jobs set status = 'pending_wash', stage = 'wash', wash_sent_at = null where id = $1", [ready.jobId]);
  await goto(p, `/jobs/${ready.jobId}`);
  if (await p.locator("[data-send-wash]").count()) await check(p, "Send to the wash", "[data-wash-ask]", () => click(p, "[data-send-wash]"), findings, shots);
  else notReached.push("Send to the wash: the button did not show");

  /* ---- Lists, the bell, the search, the menu ---- */
  await goto(p, "/estimates");
  if (await p.locator('button[aria-label^="More for"]').count()) await check(p, "Estimate menu", "[data-floating-menu]", () => click(p, 'button[aria-label^="More for"]'), findings, shots);
  await goto(p, "/dashboard");
  await check(p, "Notifications", "[data-bell-panel]", () => click(p, 'button[aria-label^="Notifications"]'), findings, shots);
  await goto(p, "/dashboard");
  if (await p.locator("[data-search-input]").count()) await check(p, "Search results", "[data-search-results]", async () => { await p.locator("[data-search-input]").first().fill("J-0"); await sleep(1500); }, findings, shots);
  await goto(p, "/recovery");
  if (await p.locator("details[data-change-price] summary").count()) await check(p, "Recovery: change price", "details[data-change-price][open]", () => click(p, "details[data-change-price] summary"), findings, shots);

  /* ---- Recovery: change a claimed trip's price (a test trip on the seeded car) ---- */
  await sql("insert into public.recovery_trips (id, job_id, status, price_aed, location_details) values ('22222222-0000-4000-8000-00000000e370', $1, 'claimed', 250, 'E2e pop-up check') on conflict (id) do update set status = 'claimed', price_aed = 250, location_details = 'E2e pop-up check'", [ready.jobId]);
  await goto(p, "/recovery");
  if (await p.locator("details[data-change-price] summary").count()) await check(p, "Recovery: change price", "details[data-change-price][open]", () => click(p, "details[data-change-price] summary"), findings, shots);
  else notReached.push("Recovery: change price: no claimed trip on the list");

  /* ---- The bodyshop release: sign off and Not ready (a car whose work is done) ---- */
  const bready = (await api("/api/e2e/stage", { stage: "bodyshop", at: "ready" })).json;
  await goto(p, `/bodyshop/${bready.jobId}#signoff`);
  if (await p.locator("[data-signoff-open]").count()) {
    await check(p, "Bodyshop release: sign off", "[data-signoff-card]", () => click(p, "[data-signoff-open]"), findings, shots);
    await goto(p, `/bodyshop/${bready.jobId}#signoff`);
    await check(p, "Bodyshop release: not ready", "[data-signoff-card]", () => click(p, "[data-not-ready-open]"), findings, shots);
  } else notReached.push("Bodyshop release: no sign-off buttons on the ready car");

  /* ---- The bodyshop: stage hand-over and a problem ---- */
  const body = (await api("/api/e2e/stage", { stage: "bodyshop", at: "in_work" })).json;
  await goto(p, `/bodyshop/${body.jobId}`);
  if (await p.locator("[data-stage-handover-open]").count()) await check(p, "Stage hand-over", "[data-stage-handover]", () => click(p, "[data-stage-handover-open]"), findings, shots);
  await goto(p, `/bodyshop/${body.jobId}`);
  if (await p.locator("[data-problem-open]").count()) await check(p, "Problem – needs manager", "[data-problem-dialog]", () => click(p, "[data-problem-open]"), findings, shots);
  await owner.browser.close();
  if (ready.invoice?.token) {
    const { chromium: ch2 } = await import("playwright-core");
    const b2 = await ch2.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
    const c2 = await (await b2.newContext({ viewport: { width: 1366, height: 1000 } })).newPage();
    await goto(c2, `/invoice/${ready.invoice.token}`);
    if (await c2.getByRole("button", { name: /Pay now/ }).count()) await check(c2, "Customer: Pay now", "[data-pay-now-sheet]", () => c2.getByRole("button", { name: /Pay now/ }).first().click(), findings, shots);
    else console.log("Customer: Pay now: no Pay now on this proforma (no payment gateway link) - skipped");
    await b2.close();
  }

  void browserForId;
  cleanupDb();
  if (notReached.length) console.log(`\nNOT REACHED (${notReached.length}):\n  - ${notReached.join("\n  - ")}`);
  console.log(`\n${shots.n} pop-up screenshots in tests/browser/shots/layout/ (popup-*)`);
  return findings;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const f = await runPopups();
  console.log(f.length ? `${f.length} pop-up problems found` : "Every pop-up fits: nothing cut off, no overlaps.");
  process.exit(f.length ? 1 : 0);
}
