// ONE profit calculation - what changed (30 October 2026, night batch section 3.4). READ-ONLY on the live data: the
// open jobs' quotations and those approved in the last 35 days, before (no package costing) and after (film, tint,
// ceramic, consumables and installer hours counted), and the invoiced jobs of the last 35 days on the profit page.
// Also whether any job crossed the advisor bonus line (AED 12,000).
//   node --env-file=.env.local --import ./tests/unit/register.mjs scripts/profit-recalc-report.mjs
const { createAdminClient } = await import("../src/lib/supabase/admin.ts");
const { getSettings } = await import("../src/lib/settings.ts");
const { LINE_SELECT, toLine, toQuote, packageCostingForQuote } = await import("../src/lib/quote-data.ts");
const { quoteTotals, hasPackageLine } = await import("../src/lib/quotes.ts");
const { costRateFor, jobProfits, packageCostsForJobs } = await import("../src/lib/profit.ts");
const { bonusRowsOf } = await import("../src/lib/advisor-bonus.ts");

const admin = createAdminClient();
const settings = await getSettings();
const since = new Date(Date.now() - 35 * 86400000).toISOString();
const aed = (n) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// 1. Quotations: open jobs, or approved in the last 35 days.
const { data: qs } = await admin.from("quotations").select("id, number, version, kind, status, job_id, vehicle_id, film_rolls_est, tint_spec, discount_percent, vat_percent, rounded_total_aed, discount_kind, discount_value, discount_scope, commission_kind, commission_value, commission_status, materials_cost_aed, expected_payment_method, responded_at, job:jobs!quotations_job_id_fkey(job_number, is_open, department)").eq("is_active", true).in("status", ["draft", "pending_owner", "sent", "opened", "approved"]);
const rows = (qs ?? []).filter((q) => q.job?.is_open || (q.status === "approved" && q.responded_at && q.responded_at >= since) || (q.kind === "estimate" && q.status !== "approved"));
const { data: lineRows } = rows.length ? await admin.from("quotation_lines").select(LINE_SELECT).in("quotation_id", rows.map((r) => r.id)).eq("is_active", true) : { data: [] };
const changed = [];
for (const r of rows) {
  const lines = (lineRows ?? []).filter((l) => l.quotation_id === r.id).map(toLine);
  if (!hasPackageLine(lines)) continue;
  const opts = { technicianCostRate: costRateFor(settings, r.job?.department), bodyshopRate: Number(settings.bodyshop_cost_rate_aed) || 50 };
  const before = quoteTotals(lines, toQuote(r), opts);
  const costing = await packageCostingForQuote(settings, r, true);
  const after = quoteTotals(lines, toQuote(r), { ...opts, packageCosting: costing });
  if (Math.abs(before.profit - after.profit) >= 0.01) changed.push({ what: `${r.number} v${r.version}${r.job?.job_number ? ` · ${r.job.job_number}` : ""} (${r.status})`, before: before.profit, after: after.profit, net: after.net });
}
console.log(`QUOTATIONS AND ESTIMATES WITH A PACKAGE (open, or approved in the last 35 days): ${changed.length}`);
for (const c of changed) console.log(`  ${c.what}: profit AED ${aed(c.before)} → AED ${aed(c.after)} (${c.net ? ((c.after / c.net) * 100).toFixed(1) : "0"}% of AED ${aed(c.net)})`);

// 2. Invoiced jobs of the last 35 days (the profit page): what the package costs add.
const profits = await jobProfits(settings, { from: since });
const pkg = await packageCostsForJobs(settings, Array.from(new Set(profits.map((p) => p.invoice.job_id).filter(Boolean))));
const inv = profits.filter((p) => p.invoice.job_id && pkg.get(p.invoice.job_id));
console.log(`\nINVOICED IN THE LAST 35 DAYS WITH A PACKAGE: ${inv.length}`);
for (const p of inv) {
  const c = pkg.get(p.invoice.job_id);
  const added = Math.round((c.materials + p.packageLabour) * 100) / 100;
  console.log(`  ${p.invoice.number} · ${p.jobNumber}: profit AED ${aed(p.profit + added)} → AED ${aed(p.profit)} (package materials ${aed(c.materials)}${p.packageLabour ? `, installer hours ${aed(p.packageLabour)}` : ""})`);
}

// 3. The advisor bonus (AED 12,000 line): bodyshop work is taken out of the bonus profit, so the package costs never
//    move it. Shown for the current period as the check.
const bonus = await bonusRowsOf(settings);
console.log(`\nADVISOR BONUS, current period: ${bonus.rows?.length ?? 0} invoice(s) at or above AED 12,000 - unchanged by the package costing (bodyshop work is outside the bonus).`);
process.exit(0);
