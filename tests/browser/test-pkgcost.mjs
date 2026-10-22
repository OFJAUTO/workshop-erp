// Evening section 7 proof: a package line fills its own INTERNAL cost estimate - film by rolls (matte or
// gloss, big cars 1.5), tint and ceramic per car, the month's consumables share, installer labour at the
// bodyshop rate, recovery - and says the estimated profit. The advisor types only the package price (no
// our-cost box on package lines); the owner can set the rolls for one job.
// Run: node --env-file=.env.local tests/browser/test-pkgcost.mjs   (dev server on :3100)
import path from "node:path";
import { pathToFileURL } from "node:url";
import { api, base, browserFor, cleanupDb, go, here, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const shot = (name) => path.join(here, "shots", name);
const until = async (fn, tries = 30, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };

/* ---------------- 1. The pure numbers ---------------- */
const lib = await import(pathToFileURL(path.resolve(here, "../../src/lib/package-cost.ts")).href);
const base1 = { packagePrice: 22000, title: "OFJ Platinum (Gloss)", itemLabels: ["Full body PPF", "Window tint", "Ceramic coating on PPF", "Interior leather ceramic"], rolls: 1, filmRollPriceGloss: 1429, filmRollPriceMatte: 1524, tintPerCar: 120, ceramicExteriorPerCar: 75, ceramicInteriorPerCar: 55, consumablesPerCar: 100, hours: 80, ratePerHour: 50, recoveryCost: 300 };
const e1 = lib.packageCostEstimate(base1);
check("1: gloss film 1 roll = AED 1,429; ceramic ext+int = 130; labour 80 h = 4,000", e1.film.aed === 1429 && !e1.film.matte && e1.ceramic === 130 && e1.labour.aed === 4000, JSON.stringify(e1).slice(0, 180));
check("1: the one line reads as agreed", e1.words === "Estimated cost: film 1 roll AED 1,429 · tint AED 120 · ceramic AED 130 · consumables AED 100 · labour 80 h AED 4,000 · recovery AED 300 → estimated profit AED 15,921 (72%)", e1.words);
const e2 = lib.packageCostEstimate({ ...base1, title: "OFJ Platinum (Matte)", rolls: 1.5 });
check("1: matte and 1.5 rolls price the matte roll", e2.film.matte && e2.film.aed === 2286, JSON.stringify(e2.film));
check("1: a big car is told apart by the Settings list", lib.isBigCar("Lamborghini Urus 2024", ["G-Class", "Urus"]) && !lib.isBigCar("Porsche 911", ["G-Class", "Urus"]));

/* ---------------- 2. The editor fills the grey box by itself ---------------- */
cleanupDb();
const seed = await api("/api/e2e/stage", { stage: "quote" });
const jobId = seed.json?.jobId;
const qid = seed.json?.quotationId;
if (!jobId || !qid) { console.error("seed failed"); process.exit(1); }
const advisor = (await sql("select id from public.staff where role_id = 'service_advisor' and is_active limit 1"))[0].id;
await sql(`insert into public.quotation_lines (quotation_id, position, line_type, title, source_type, quantity, unit_price, package_key, package_items, created_by, updated_by)
  values ($1, 5, 'package', 'OFJ Platinum (Gloss)', 'manual', 1, 22000, 'ofj_platinum', '[{"label":"Full body PPF"},{"label":"Window tint"},{"label":"Ceramic coating on PPF"},{"label":"Interior leather ceramic"}]'::jsonb, $2, $2)`, [qid, advisor]);

const { browser, page } = await browserFor("owner", { viewport: { width: 1500, height: 1000 } });
await go(page, `${base}/jobs/${jobId}/quote/${qid}`);
const costLine = page.locator("[data-package-cost]");
check("2: the grey box carries the estimate line", (await costLine.count()) === 1);
const words = ((await costLine.textContent()) ?? "").replace(/\s+/g, " ");
check("2: film, tint, ceramic, consumables, labour, recovery and the profit are all in it", /Estimated cost: film 1 roll AED 1,429 · tint AED 120 · ceramic AED 130 · consumables AED [\d,]+ · labour 80 h AED 4,000/.test(words) && /estimated profit AED [\d,]+ \(\d+%\)/.test(words), words.slice(0, 220));
const pkgLineId = (await sql("select id from public.quotation_lines where quotation_id = $1 and position = 5", [qid]))[0].id;
check("2: the package line has NO our-cost box", (await page.locator(`#item-line-${pkgLineId} [data-our-cost]`).count()) === 0);
await costLine.scrollIntoViewIfNeeded();
await page.screenshot({ path: shot("pkg7-1-estimate-line.png"), clip: (await page.locator("[data-film-rolls-box]").locator("xpath=ancestor::dl[1]").boundingBox()) ?? undefined });

/* ---------------- 3. The owner's rolls for this one job ---------------- */
check("3: the rolls box is there for the owner", (await page.locator("[data-film-rolls]").count()) === 1);
await page.locator("[data-film-rolls]").click({ clickCount: 3 });
await page.locator("[data-film-rolls]").pressSequentially("1.5");
const saved = await until(async () => { const r = (await sql("select film_rolls_est::text as v from public.quotations where id = $1", [qid]))[0]; return r?.v === "1.5" ? 1 : null; });
check("3: the figure saves on the quotation", !!saved);
const words2 = await until(async () => { const w = ((await page.locator("[data-package-cost]").textContent()) ?? "").replace(/\s+/g, " "); return /film 1\.5 rolls/.test(w) ? w : null; }, 20, 400);
check("3: the line moves to 1.5 rolls at once", !!words2, (words2 ?? "").slice(0, 120));

/* ---------------- 4. An advisor sees the estimate but no rolls box ---------------- */
const { browser: ab, page: ap } = await browserFor("service_advisor", { viewport: { width: 1500, height: 1000 } });
await go(ap, `${base}/jobs/${jobId}/quote/${qid}`);
check("4: the advisor has no rolls box (owner only)", (await ap.locator("[data-film-rolls]").count()) === 0);
await ab.close();

await browser.close();
cleanupDb();
process.exit(summary() ? 1 : 0);
