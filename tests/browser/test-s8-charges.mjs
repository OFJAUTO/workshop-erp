// SECTION 8 of 2 November 2026 (built 3 November): THE CHARGES SECTION SHOWS THE QUOTATION'S CHARGES (J-00969, Q-00039).
// The problem: the job card's "CHARGES (RECOVERY, FUEL, OTHER)" said "No recovery, fuel or other charges on this car"
// although the approved quotation had "RECOVERY, FULL DOWN, TWO WAYS · AED 400.00". The section read only the charges
// typed on the job card. The test car is the stage seed's (J-xxxxx with Q-STAGE-1), never a real customer's.
//   A  8.1: the approved quotation's recovery and its Internal cost are listed, read-only, "on Q-STAGE-1 · approved";
//      Consumables is not a charge; a revision being prepared never lists the same line twice.
//   B  8.1: "Cost & bill": the real cost from the supplier's bill is saved on the charge side (one row, the locked
//      quotation line untouched) and the bill attaches to the line's first version.
//   C  8.2: adding a recovery on the job card while one is on a quotation shows the warning and asks once; without the
//      tick nothing is saved (the screen, then the server when the screen is bypassed); with it the charge is saved and logged.
//   D  every charge counts once: the section's cost and profit; with priced recovery trips the trips replace the
//      estimates trip for trip; advisors never see the trips' prices.
//   E  8.2 from the quotation side: an additional quotation shows the recovery already on the car instead of "+ Recovery";
//      the save route refuses a plain recovery and takes "+ Recovery – a different trip".
//   Review fixes (3 November 2026): the read-only words fit an approved quotation and accounts get the number as words
//      (no link back to the same page); "the owner was told" only once he was; the recovery cost line names the priced
//      trips and the estimate; our own truck's trip never replaces the towing company's charges; a charge on a version
//      still being prepared, or taken off, is not counted as charged.
// Needs migration 20261203150000_quote_charge_costs applied on the TEST database (section B).
// Run: node --env-file=.env.test.local tests/browser/test-s8-charges.mjs   (test server on 3102: npm run test:server)
import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { api, base, browserForId, cleanupDb, cookieHeader, go as goLib, here, makeChecks, pageReady, sleep, sql } from "./pw-lib.mjs";

// The same address with "#charges" again is a same-document jump in the browser (no reload, an open fold stays open):
// reload instead, so every visit reads the page afresh.
const go = async (page, url) => { if (page.url() === url) { await page.reload({ waitUntil: "load", timeout: 60000 }); await sleep(1500); } else await goLib(page, url); };

const { check, summary } = makeChecks();
const dir = path.join(here, "shots", "s8-charges");
mkdirSync(dir, { recursive: true });
const shot = (name) => path.join(dir, name);
const text = async (loc) => ((await loc.first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
const until = async (fn, tries = 60, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
const png = path.join(dir, "bill.png");
writeFileSync(png, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAEklEQVR4nGNoaGjAgxhGpbFIAwDdcwIBtxZC4AAAAABJRU5ErkJggg==", "base64"));

const owner = (await sql("select id from public.staff where role_id = 'owner' and is_active order by created_at limit 1"))[0];
const advisor = (await sql("select id from public.staff where role_id = 'service_advisor' and is_active order by created_at limit 1"))[0];
const accounts = (await sql("select id from public.staff where role_id = 'accounts' and is_active order by created_at limit 1"))[0];
const browsers = [];
const open = async (id, w = 1440, h = 1000) => { const b = await browserForId(id, { viewport: { width: w, height: h } }); browsers.push(b); return b; };
const card = (page) => page.locator("[data-charges-card]");
const item = (page, id) => page.locator(`[data-charge-line="${id}"]`);

cleanupDb();
try {
  /* ---------- Seed: a car with an approved quotation carrying a recovery, an internal cost and consumables ---------- */
  const seed = (await api("/api/e2e/stage", { stage: "quote" })).json;
  const jobId = seed.jobId;
  const q1 = seed.quotationId;
  const qNumber = (await sql("select number from public.quotations where id = $1", [q1]))[0]?.number;
  const ins = async (o) => (await sql(
    "insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, unit_cost, unit_price, markup_percent, recovery_trips, recovery_type, recovery_provider_kind, recovery_provider, recovery_paid_by, visible_to_customer, revised_from_line_id, created_by, updated_by) values ($1, $2, $3, $4, 'manual', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16) returning id",
    [o.q, o.pos, o.type, o.title, o.qty, o.cost, o.price, o.markup ?? null, o.trips ?? null, o.rtype ?? null, o.pkind ?? null, o.provider ?? null, o.paidBy ?? null, o.visible ?? true, o.from ?? null, advisor.id],
  ))[0]?.id;
  const L1 = await ins({ q: q1, pos: 5, type: "recovery", title: "RECOVERY, FULL DOWN, TWO WAYS", qty: 2, cost: 250, price: 200, trips: 2, rtype: "full_down", pkind: "external", provider: "E2E TOWING CO", paidBy: "customer" });
  const WASH = await ins({ q: q1, pos: 6, type: "other", title: "CAR WASH", qty: 1, cost: 50, price: null, visible: false });
  await ins({ q: q1, pos: 7, type: "other", title: "CONSUMABLES", qty: 1, cost: null, price: 150 });
  // Approved by the customer: the lines are in first (an approved quotation refuses new lines).
  await sql("update public.quotations set status = 'approved', responded_at = now(), approver_name = 'E2E CUSTOMER' where id = $1", [q1]);
  check(`Seed: ${qNumber} approved with a recovery (2 trips × AED 200, cost 250 a trip), an internal car wash and consumables`, !!L1 && !!WASH);

  /* ---------- A. 8.1: the quotation's charges are listed ---------- */
  const adv = await open(advisor.id);
  await go(adv.page, `${base}/jobs/${jobId}#charges`);
  await pageReady(adv.page);
  check("A: the Charges section is on the job card", (await card(adv.page).count()) === 1);
  check("A: it no longer says \"No recovery, fuel or other charges on this car\"", (await adv.page.locator("[data-charges-empty]").count()) === 0);
  const rec = item(adv.page, L1);
  check(`A: the quotation's recovery is listed ("${await text(rec.locator("[data-charge-description]"))}")`, (await text(rec.locator("[data-charge-description]"))) === "RECOVERY, FULL DOWN, TWO WAYS" && (await rec.getAttribute("data-charge-source")) === "quotation");
  const where = await text(rec.locator("[data-charge-where]"));
  check(`A: … "on ${qNumber} · approved" (${where})`, where === `on ${qNumber} · approved`);
  check(`A: … AED 400.00 + VAT charged, the quoted cost an estimate (${await text(rec.locator("[data-charge-figures]"))})`, (await text(rec.locator("[data-charge-amount]"))) === "AED 400.00 + VAT" && (await text(rec.locator("[data-charge-cost]"))) === "est. AED 500.00");
  check("A: read-only here, with the way to the quotation", (await rec.locator("[data-charge-read-only]").count()) === 1 && ((await rec.locator("[data-charge-open-quote]").getAttribute("href")) ?? "").endsWith(`/quote/${q1}`));
  // Review fix: an approved quotation changes only through a revision the owner allows - the words say so.
  const roWords = await text(rec.locator("[data-charge-read-only]"));
  check(`A: the words fit an approved quotation ("${roWords}")`, roWords === `Read-only – it changes only with a revised ${qNumber}, which the owner allows.`);
  // Review fix: Q-STAGE-1 quoted the recovery below its cost (500 against 400) before anybody told the owner - the
  // screen no longer claims "the owner is told".
  const below = rec.locator("[data-charge-below-cost]");
  check(`A: below cost, said plainly ("${await text(below)}")`, (await below.getAttribute("data-charge-below-cost")) === "none" && (await text(below)) === "Costs more than it is charged.");
  check(`A: the internal cost shows "Internal – not charged" (${await text(item(adv.page, WASH).locator("[data-charge-amount]"))})`, (await text(item(adv.page, WASH).locator("[data-charge-amount]"))) === "Internal – not charged");
  check("A: Consumables is not a charge", !(await text(card(adv.page))).includes("CONSUMABLES"));
  await card(adv.page).scrollIntoViewIfNeeded();
  await adv.page.screenshot({ path: shot("a1-quotation-charges-1440.png") });
  // Review fix: accounts cannot open quotations (the quote page sends them back to the job card), so for them the
  // quotation's number is plain words, never a link that only reloads the same page.
  if (accounts) {
    const acc = await open(accounts.id);
    await go(acc.page, `${base}/jobs/${jobId}#charges`);
    await pageReady(acc.page);
    const accRec = item(acc.page, L1);
    check(`A: accounts see the quotation's number as words, not a link (${await text(accRec.locator("[data-charge-quote-number]"))})`, (await accRec.locator("[data-charge-open-quote]").count()) === 0 && (await text(accRec.locator("[data-charge-quote-number]"))) === qNumber);
    await card(acc.page).scrollIntoViewIfNeeded();
    await acc.page.screenshot({ path: shot("a2-accounts-1440.png") });
  } else check("A: an active accounts login exists on the TEST database", false);
  // A revision being prepared copies the recovery (with a new price): the section still lists it ONCE, at the approved figures.
  const v2 = (await sql("insert into public.quotations (kind, number, version, job_id, customer_id, vehicle_id, status, created_by, updated_by) select kind, number, 2, job_id, customer_id, vehicle_id, 'draft', created_by, updated_by from public.quotations where id = $1 returning id", [q1]))[0]?.id;
  const L2 = v2 ? await ins({ q: v2, pos: 5, type: "recovery", title: "RECOVERY, FULL DOWN, TWO WAYS", qty: 2, cost: 250, price: 260, trips: 2, rtype: "full_down", pkind: "external", provider: "E2E TOWING CO", paidBy: "customer", from: L1 }) : null;
  await go(adv.page, `${base}/jobs/${jobId}#charges`);
  const recRows = await adv.page.locator("[data-charge-line] [data-charge-description]").allTextContents();
  check(`A: a revision being prepared never lists the same line twice (${recRows.filter((t) => t.includes("RECOVERY")).length} recovery row)`, !!L2 && recRows.filter((t) => t.trim() === "RECOVERY, FULL DOWN, TWO WAYS").length === 1 && (await item(adv.page, L2).count()) === 0 && (await text(item(adv.page, L1).locator("[data-charge-amount]"))) === "AED 400.00 + VAT");

  /* ---------- B. 8.1: the real cost from the bill, and the bill ---------- */
  const migrated = (await sql("select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'charge_lines' and column_name = 'origin'"))[0]?.n === 1;
  check("B: migration 20261203150000_quote_charge_costs is applied on the TEST database", migrated);
  const fold = adv.page.locator(`[data-charge-cost="${L1}"]`);
  await fold.locator("[data-charge-cost-open]").click();
  await fold.locator("[data-charge-cost-input]").fill("480");
  await fold.locator("[data-charge-cost-input]").blur();
  await fold.locator("[data-charge-cost-provider]").fill("E2E TOWING CO");
  await adv.page.screenshot({ path: shot("b1-cost-and-bill-1440.png") });
  await fold.locator("[data-charge-cost-save]").click();
  const costRow = await until(async () => (await sql("select id, cost_aed::float as cost, provider from public.charge_lines where quotation_line_id = $1 and origin = 'quotation' and is_active", [L1]))[0]);
  check(`B: the cost is saved on the charge side (${costRow?.cost}, ${costRow?.provider})`, costRow?.cost === 480 && costRow?.provider === "E2E TOWING CO");
  check(`B: the answer appears in the box ("${await text(fold.locator("text=saved"))}")`, (await fold.getByText(/saved ✓/).count()) === 1);
  const locked = (await sql("select unit_cost::float as cost, unit_price::float as price from public.quotation_lines where id = $1", [L1]))[0];
  check("B: the approved quotation's line is untouched (cost 250, price 200 a trip)", locked?.cost === 250 && locked?.price === 200);
  await fold.locator('input[type="file"]').first().setInputFiles(png);
  const bill = await until(async () => (await sql("select id from public.job_files where job_id = $1 and kind = 'supplier_invoice' and ref_id = $2 and removed_at is null", [jobId, L1]))[0], 60, 500);
  check("B: the supplier's bill attaches to the line's first version", !!bill);
  await go(adv.page, `${base}/jobs/${jobId}#charges`);
  check(`B: the bill's figure counts (${await text(item(adv.page, L1).locator("[data-charge-cost]"))}), the estimate shown beside it`, (await text(item(adv.page, L1).locator("[data-charge-cost]"))) === "AED 480.00 (bill)" && (await text(item(adv.page, L1).locator("[data-charge-quoted]"))).includes("AED 500.00"));
  // The advisor's bill (480) is still above the charge (400): the save told the owner, and now the screen may say so.
  const toldOwner = (await sql("select count(*)::int as n from public.notifications n join public.staff s on s.id = n.staff_id where s.role_id = 'owner' and n.job_id = $1 and n.title like 'Charge below its cost%'", [jobId]))[0]?.n ?? 0;
  const belowB = item(adv.page, L1).locator("[data-charge-below-cost]");
  check(`B: the owner was told (${toldOwner} notice), and only now the words say so ("${await text(belowB)}")`, toldOwner >= 1 && (await belowB.getAttribute("data-charge-below-cost")) === "told" && (await text(belowB)) === "Costs more than it is charged – the owner was told.");
  // Saved again: still one cost row.
  const fold2 = adv.page.locator(`[data-charge-cost="${L1}"]`);
  await fold2.locator("[data-charge-cost-open]").click();
  await fold2.locator("[data-charge-cost-input]").fill("480");
  await fold2.locator("[data-charge-cost-input]").blur();
  await fold2.locator("[data-charge-cost-save]").click();
  await sleep(2500);
  check("B: saving again keeps ONE cost row", (await sql("select count(*)::int as n from public.charge_lines where quotation_line_id = $1 and origin = 'quotation' and is_active", [L1]))[0]?.n === 1);

  /* ---------- C. 8.2: a recovery while one is on a quotation ---------- */
  await go(adv.page, `${base}/jobs/${jobId}#charges`);
  await adv.page.locator("[data-charge-open]").click();
  const row = adv.page.locator('[data-charge-row="0"]');
  await row.locator('[data-charge-kind="recovery"]').click();
  const warn = await text(row.locator("[data-charge-recovery-warning]"));
  check(`C: the warning shows next to the recovery being added ("${warn.slice(0, 120)}")`, warn.includes(`RECOVERY, FULL DOWN, TWO WAYS · AED 400.00 · on ${qNumber} · approved`) && warn.includes("charges the customer twice"));
  await row.locator("[data-charge-provider]").fill("E2E TOWING CO");
  await row.locator("[data-charge-recovery-type]").selectOption("full_down");
  await row.locator("[data-charge-trips]").fill("1");
  await row.locator("[data-charge-cost]").fill("300");
  await row.locator("[data-charge-charge]").fill("350");
  await row.locator("[data-charge-charge]").blur();
  await adv.page.screenshot({ path: shot("c1-recovery-warning-1440.png") });
  const before = (await sql("select count(*)::int as n from public.charge_lines where job_id = $1 and kind = 'recovery' and origin = 'charge' and is_active", [jobId]))[0]?.n ?? 0;
  await adv.page.locator("[data-charge-save]").click();
  await sleep(3000);
  check("C: without \"Yes, it is a different trip\" nothing is saved (the screen asks)", ((await sql("select count(*)::int as n from public.charge_lines where job_id = $1 and kind = 'recovery' and origin = 'charge' and is_active", [jobId]))[0]?.n ?? 0) === before);
  // The screen bypassed: the server asks the same question.
  await adv.page.evaluate(() => document.querySelector("[data-charge-recovery-different]")?.removeAttribute("required"));
  await sleep(5200); // FormGuard swallows a second tap within five seconds.
  await adv.page.locator("[data-charge-save]").click();
  await adv.page.waitForURL(/charge_error=/, { timeout: 25000 }).catch(() => null);
  await pageReady(adv.page);
  const refused = await text(card(adv.page).locator("text=Recovery already on this car"));
  check(`C: … and the server refuses it too, the words in the Charges section ("${refused.slice(0, 90)}")`, refused.includes("Recovery already on this car") && ((await sql("select count(*)::int as n from public.charge_lines where job_id = $1 and kind = 'recovery' and origin = 'charge' and is_active", [jobId]))[0]?.n ?? 0) === before);
  // Fuel never asks.
  // The refusal reopens the add box by itself; open it only if it is closed (a tap on an open one closes it).
  if (!(await adv.page.locator("[data-charge-add]").evaluate((d) => d.open).catch(() => false))) await adv.page.locator("[data-charge-open]").click();
  const row2 = adv.page.locator('[data-charge-row="0"]');
  await row2.locator('[data-charge-kind="fuel"]').click();
  check("C: a fuel charge never asks", (await row2.locator("[data-charge-recovery-warning]").count()) === 0);
  await row2.locator('[data-charge-kind="recovery"]').click();
  await row2.locator("[data-charge-provider]").fill("E2E TOWING CO");
  await row2.locator("[data-charge-recovery-type]").selectOption("full_down");
  await row2.locator("[data-charge-trips]").fill("1");
  await row2.locator("[data-charge-cost]").fill("300");
  await row2.locator("[data-charge-charge]").fill("350");
  await row2.locator("[data-charge-charge]").blur();
  await row2.locator("[data-charge-recovery-different]").check();
  await sleep(5200); // FormGuard swallows a second tap within five seconds of the last submit.
  await adv.page.locator("[data-charge-save]").click();
  const added = await until(async () => (await sql("select id, cost_aed::float as cost, charge_aed::float as charge from public.charge_lines where job_id = $1 and kind = 'recovery' and origin = 'charge' and is_active order by created_at desc limit 1", [jobId]))[0]);
  check(`C: with the tick the second recovery is saved (cost ${added?.cost}, charge ${added?.charge})`, added?.cost === 300 && added?.charge === 350);
  const note = (await sql("select note from public.job_events where job_id = $1 and event_type = 'charge_added' order by created_at desc limit 1", [jobId]))[0]?.note ?? "";
  check(`C: the history says it is a different trip and who confirmed it ("${note.slice(0, 140)}")`, note.includes("a different trip from") && note.includes(`on ${qNumber} · approved`));

  /* ---------- D. Every charge counts once ---------- */
  const own = await open(owner.id);
  await go(own.page, `${base}/jobs/${jobId}#charges`);
  await pageReady(own.page);
  const head = await text(card(own.page).locator("span.text-muted").first());
  // Cost: the bill 480 (recovery on the quotation) + 50 (internal car wash) + 300 (the second recovery); the v2 copy never again.
  // Charged (review fix): only what the customer is really charged - the quotation's 400. The second recovery went into
  // v2, which is still being prepared: its cost counts at once, its 350 only once v2 is approved.
  const headAll = await text(card(own.page));
  check(`D: the section counts each charge once: cost AED 830.00 · charged AED 400.00 + VAT (${head || headAll.slice(0, 120)})`, headAll.includes("cost AED 830.00 · charged AED 400.00 + VAT"));
  check(`D: profit on the charges AED -430.00 (${await text(own.page.locator("[data-charges-profit]"))})`, (await text(own.page.locator("[data-charges-profit]"))).includes("AED -430.00"));
  const secondRow = item(own.page, added?.id ?? "none");
  check(`D: the second recovery says when it is charged ("${await text(secondRow.locator("[data-charge-not-billed]"))}")`, (await text(secondRow.locator("[data-charge-not-billed]"))) === `Charged to the customer once ${qNumber} v2 is approved; its cost counts already.`);
  await card(own.page).scrollIntoViewIfNeeded();
  await own.page.screenshot({ path: shot("d1-counted-once-owner-1440.png") });
  // Two trips priced by the towing company: the trips ARE its recovery cost, trip for trip (2 of the 3 trips its charges stand for).
  for (const price of [220, 240]) await sql("insert into public.recovery_trips (job_id, kind, company, driver_name, price_aed, price_at, delivered_at, status) values ($1, 'pickup', 'E2E TOWING CO', 'E2e Driver', $2, now(), now(), 'claimed')", [jobId, price]);
  await go(own.page, `${base}/jobs/${jobId}#charges`);
  const trips = await text(own.page.locator("[data-charges-trips]"));
  // Review fix: the words name what is priced and what is an estimate (it used to read "AED 720.00 from 2 trips (2 priced)").
  check(`D: with priced trips the recovery costs the trips + the estimate for the trip not priced: 220 + 240 + 260 = AED 720.00 ("${trips}")`, trips.includes("Recovery cost AED 720.00: AED 460.00 from 2 priced trips + AED 260.00 estimated for 1 trip still to price") && trips.includes("recovery: 2 of 3 trips priced"));
  check("D: the recovery rows read \"from the trips\" (never the trips plus the estimate)", (await text(item(own.page, L1).locator("[data-charge-cost]"))) === "from the trips" && (await text(card(own.page))).includes("cost AED 770.00 · charged AED 400.00 + VAT"));
  await own.page.locator(`[data-charge-cost="${L1}"] [data-charge-cost-open]`).click();
  check("D: the recovery's Cost & bill takes the bill for the paper only once the car has its trips", (await own.page.locator(`[data-charge-cost="${L1}"] [data-charge-cost-trips]`).count()) === 1 && (await own.page.locator(`[data-charge-cost="${L1}"] [data-charge-cost-input]`).count()) === 0);
  await own.page.screenshot({ path: shot("d2-trips-owner-1440.png") });
  // Review fix: our own truck's trip (no company) is not the towing company's trip - it never replaces their charges,
  // it counts on its own once priced: 720 + 150 = 870.
  await sql("insert into public.recovery_trips (job_id, kind, company, driver_name, price_aed, price_at, delivered_at, status) values ($1, 'delivery', null, 'E2e Own Driver', 150, now(), now(), 'claimed')", [jobId]);
  await go(own.page, `${base}/jobs/${jobId}#charges`);
  const tripsOwn = await text(own.page.locator("[data-charges-trips]"));
  check(`D: our own delivery trip adds to the towing company's charges, never replaces them ("${tripsOwn}")`, tripsOwn.includes("Recovery cost AED 870.00: AED 610.00 from 3 priced trips + AED 260.00 estimated for 1 trip still to price") && (await text(card(own.page))).includes("cost AED 920.00 · charged AED 400.00 + VAT"));
  await go(adv.page, `${base}/jobs/${jobId}#charges`);
  const advHead = await text(card(adv.page));
  check("D: an advisor never sees the trips' prices (no cost total, no profit line, \"with accounts\")", !advHead.includes("cost AED 920.00") && advHead.includes("charged AED 400.00 + VAT") && (await adv.page.locator("[data-charges-profit]").count()) === 0 && (await text(adv.page.locator("[data-charges-trips]"))).includes("with accounts"));
  // Review fix: the advisor takes the second recovery off v2 - the row says "not charged" and nothing counts it as charged.
  await sql("update public.quotation_lines set is_active = false where id = (select quotation_line_id from public.charge_lines where id = $1)", [added?.id ?? null]);
  await go(own.page, `${base}/jobs/${jobId}#charges`);
  const offRow = item(own.page, added?.id ?? "none");
  check(`D: taken off the quotation: "${await text(offRow.locator("[data-charge-where]"))}", "${await text(offRow.locator("[data-charge-amount]"))}", charged still AED 400.00`, (await text(offRow.locator("[data-charge-where]"))) === `taken off ${qNumber} – not charged` && (await text(offRow.locator("[data-charge-amount]"))) === "Not charged" && (await text(card(own.page))).includes("charged AED 400.00 + VAT"));
  // Phone-width proof of the section.
  const small = await open(owner.id, 800, 1280);
  await go(small.page, `${base}/jobs/${jobId}#charges`);
  await card(small.page).scrollIntoViewIfNeeded();
  await small.page.screenshot({ path: shot("d3-charges-800.png") });
  check("D: at 800 px the section does not scroll sideways", await small.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

  /* ---------- E. 8.2 from the quotation side ---------- */
  const q2 = (await sql("insert into public.quotations (kind, number, version, job_id, customer_id, vehicle_id, status, created_by, updated_by) select kind, 'Q-STAGE-2', 1, job_id, customer_id, vehicle_id, 'draft', created_by, updated_by from public.quotations where id = $1 returning id", [q1]))[0]?.id;
  await go(adv.page, `${base}/jobs/${jobId}/quote/${q2}`);
  await pageReady(adv.page);
  const elsewhere = await text(adv.page.locator("[data-recovery-elsewhere]"));
  check(`E: an additional quotation shows the recovery already on the car ("${elsewhere.slice(0, 120)}")`, elsewhere.includes(`on ${qNumber} · approved`));
  check("E: … instead of the plain \"+ Recovery\" button", (await adv.page.getByRole("button", { name: "+ Recovery", exact: true }).count()) === 0 && (await adv.page.locator("[data-recovery-different]").count()) === 1);
  await adv.page.locator("[data-recovery-elsewhere]").scrollIntoViewIfNeeded();
  await adv.page.screenshot({ path: shot("e1-editor-recovery-elsewhere-1440.png") });
  const plain = await api("/api/quote/save", { quotationId: q2, addLine: { line_type: "recovery" } }, await cookieHeader(advisor.id));
  check(`E: the save route refuses a plain second recovery (${plain.status}: ${String(plain.json?.error ?? "").slice(0, 80)})`, plain.status === 400 && String(plain.json?.error ?? "").includes("Recovery already on this car"));
  await adv.page.locator("[data-recovery-different]").click();
  const q2rec = await until(async () => (await sql("select id from public.quotation_lines where quotation_id = $1 and line_type = 'recovery' and is_active", [q2]))[0]);
  check("E: \"+ Recovery – a different trip\" adds it", !!q2rec);
} catch (e) {
  check(`no crash (${String(e?.message ?? e).slice(0, 200)})`, false);
} finally {
  for (const b of browsers) await b.browser.close().catch(() => {});
  if (!process.env.KEEP) cleanupDb();
}
process.exit(summary() ? 1 : 0);
