// Section 1 of 29 October 2026: the bank fee per payment method, as Network International charges it.
// The ONE fee box (Card settlements, also behind the money list) for owner and accounts: MSF % before VAT, the fee per
// transaction, VAT on the fees and the terminal IDs; its worked examples match the two real transactions to the fils;
// a deposit by payment link (AED 10,000) and by card machine (AED 1,470) store MSF, fee and VAT apart, the job's
// cost being MSF + fee. Real settings are snapshotted and put back exactly.
//   E2E_BASE=http://localhost:3101 node --env-file=.env.local tests/browser/test-fees1.mjs
import path from "node:path";
import fs from "node:fs";
import { api, base, browserFor, browserForId, cleanupDb, go, here, makeChecks, sleep, sql } from "./pw-lib.mjs";

const { check, summary } = makeChecks();
const SHOTS = path.join(here, "shots", "fees");
fs.mkdirSync(SHOTS, { recursive: true });
const until = async (fn, tries = 40, gap = 500) => { for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await sleep(gap); } return null; };
setTimeout(() => { console.log("TIMEOUT: stopping"); cleanupDb(); process.exit(2); }, 14 * 60 * 1000).unref();
const MATHEW = "e9894031-e253-4fc0-9552-026d3eaf6e88";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGklEQVR4nGP4z8BAEmIY1TCqYVTDqIbhqgEAOK8f8Rf2cHcAAAAASUVORK5CYII=", "base64");
const KEYS = ["bank_charge_card_percent", "bank_fee_card_txn_aed", "bank_terminal_ids_card", "bank_charge_link_percent", "bank_fee_link_txn_aed", "bank_terminal_ids_link", "bank_fee_vat_percent", "bank_charge_cash_percent", "bank_charge_cheque_percent", "bank_charge_transfer_percent", "bank_charge_fee_percent"];
const snapshot = await sql("select key, value::text as v from public.settings where key = any($1)", [KEYS]);
const restore = async () => { for (const r of snapshot) await sql("update public.settings set value = $2::jsonb where key = $1", [r.key, r.v]); };

const { browser, page } = await browserForId(MATHEW, { viewport: { width: 1366, height: 1000 } });
try {
  /* A. The one fee box, as accounts. */
  await go(page, `${base}/card-settlements#fees`);
  const box = page.locator("[data-bank-fees]");
  check("A1 accounts see the bank fee box on Card settlements", (await box.count()) === 1);
  check("A2 card machine: 2.15% before VAT, no fee per transaction", (await box.locator('[data-fee-msf="card"]').inputValue()) === "2.15" && Number(await box.locator('[data-fee-txn="card"]').inputValue()) === 0);
  check("A3 payment link: 1.75% + AED 1.00, VAT 5%", (await box.locator('[data-fee-msf="link"]').inputValue()) === "1.75" && Number(await box.locator('[data-fee-txn="link"]').inputValue()) === 1 && Number(await box.locator("[data-fee-vat]").inputValue()) === 5);
  const exCard = (await box.locator('[data-fee-example="card"]').textContent()) ?? "";
  const exLink = (await box.locator('[data-fee-example="link"]').textContent()) ?? "";
  check("A4 the card machine example matches the bank's report: MSF 31.61 + VAT 1.58, net 1,436.81", /MSF 31\.61 \+ fee 0\.00 \+ VAT 1\.58 = 33\.19 kept, net 1,436\.81/.test(exCard), exCard);
  check("A5 the payment link example matches the bank's report: MSF 175.00 + fee 1.00 + VAT 8.80, net 9,815.20", /MSF 175\.00 \+ fee 1\.00 \+ VAT 8\.80 = 184\.80 kept, net 9,815\.20/.test(exLink), exLink);
  await box.screenshot({ path: path.join(SHOTS, "1-fee-box.png") });
  // Accounts save terminal IDs; the answer shows under the button.
  await box.locator('[data-fee-terminals="card"]').fill("E2E-CARD-1");
  await box.locator('[data-fee-terminals="link"]').fill("e2e-link-1, E2E-LINK-2");
  await box.locator("[data-fee-save]").click();
  const saved = await until(async () => ((await page.locator("[data-fee-saved]").count()) ? (await page.locator("[data-fee-saved]").textContent()) : null));
  const stored = await sql("select key, value #>> '{}' as v from public.settings where key in ('bank_terminal_ids_card', 'bank_terminal_ids_link') order by key");
  check("A6 saved by accounts: the answer under the button, terminal IDs stored upper-case", !!saved && /Bank fees saved/.test(saved) && stored[0]?.v === "E2E-CARD-1" && stored[1]?.v === "E2E-LINK-1, E2E-LINK-2", JSON.stringify(stored));
  // A terminal on both methods is refused in words.
  await box.locator('[data-fee-terminals="card"]').fill("E2E-LINK-1");
  await box.locator("[data-fee-save]").click();
  const refused = await until(async () => /listed for both methods/.test((await box.textContent()) ?? ""));
  check("A7 one terminal on both methods is refused", !!refused);
  await restore();

  /* B. A deposit by payment link and by card machine: MSF, fee and VAT apart. */
  for (const [method, amount, want] of [["link", 10000, { msf: 175, txn: 1, vat: 8.8, cost: 176 }], ["card", 1470, { msf: 31.61, txn: 0, vat: 1.58, cost: 31.61 }]]) {
    cleanupDb();
    const seed = (await api("/api/e2e/stage", { stage: "approved" })).json;
    await sql("update public.quotations set deposit_aed = $2 where job_id = $1 and status = 'approved'", [seed.jobId, amount]);
    await go(page, `${base}/dashboard`);
    const row = page.locator("[data-waiting-row]", { hasText: "Dubai S 30303" }).filter({ hasText: "Deposit to record" }).first();
    await row.locator("[data-record-deposit-open]").click();
    const panel = page.locator("[data-record-deposit-panel]");
    await panel.waitFor();
    await panel.locator(`[data-deposit-method="${method}"]`).click();
    const auth = panel.locator("[data-auth-code]");
    // Test codes of its own: a real code (756117 is on RCT-00036) would be refused as a duplicate.
    if (await auth.count()) await auth.fill(`F${method === "link" ? "L" : "C"}${String(Date.now()).slice(-4)}`);
    await panel.locator('input[type="file"]').first().setInputFiles({ name: `${method}.png`, mimeType: "image/png", buffer: png });
    await until(async () => (await sql("select count(*)::int as n from public.job_files where job_id = $1 and kind = 'payment_proof' and removed_at is null", [seed.jobId]))[0].n >= 1);
    const words = (await panel.locator("[data-deposit-fee]").textContent().catch(() => "")) ?? "";
    check(`B ${method}: the panel shows the bank's rule and the estimate`, method === "link" ? /1\.75% \+ AED 1\.00 \+ VAT 5%/.test(words) && /estimated 176\.00 \+ VAT 8\.80/.test(words) : /2\.15% \+ VAT 5%/.test(words) && /estimated 31\.61 \+ VAT 1\.58/.test(words), words);
    if (method === "link") await panel.screenshot({ path: path.join(SHOTS, "2-deposit-link-fee.png") });
    await panel.locator("[data-deposit-record]").click();
    await panel.locator("[data-deposit-confirm-yes]").click();
    const p = await until(async () => (await sql("select number, bank_charge_aed::float8 c, fee_msf_aed::float8 m, fee_txn_aed::float8 t, fee_vat_aed::float8 v from public.payments where job_id = $1 and is_active", [seed.jobId]))[0] ?? null);
    check(`B ${method}: AED ${amount} stores MSF ${want.msf}, fee ${want.txn}, VAT ${want.vat}; the job's cost ${want.cost} (no VAT)`, !!p && p.m === want.msf && p.t === want.txn && p.v === want.vat && p.c === want.cost, JSON.stringify(p));
  }
} finally {
  await restore();
  await browser.close();
}

/* C. Settings points at the one box; the quotation shows the new words. */
{
  const { browser: ob, page: op } = await browserFor("owner", { viewport: { width: 1366, height: 1000 } });
  await go(op, `${base}/settings`);
  check("C1 Settings has no bank charge boxes of its own, only the link to the one box", (await op.locator('input[name="bank_charge_card_percent"]').count()) === 0 && (await op.locator("[data-settings-bank-fees-link]").count()) === 1);
  cleanupDb();
  const seed = (await api("/api/e2e/stage", { stage: "quote" })).json;
  await sql("update public.quotations set expected_payment_method = 'link' where id = $1", [seed.quotationId]);
  await go(op, `${base}/jobs/${seed.jobId}/quote/${seed.quotationId}`);
  const label = (await op.locator("[data-bank-fee-label]").textContent().catch(() => "")) ?? "";
  check("C2 the quotation's internal box: 'Bank fee (1.75% + AED 1.00 … before VAT, estimated)'", /1\.75% \+ AED 1\.00/.test(label) && /before VAT/.test(label), label);
  await ob.close();
}

cleanupDb();
process.exit(summary() ? 1 : 0);
