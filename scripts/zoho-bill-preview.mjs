// The side-by-side for accounts (13 November 2026, Section 7): how chosen supplier bills looked in Zoho (one summary
// line) and how they post now (one line per part, THE rule in src/lib/zoho-bill-lines.ts). READ-ONLY: a read-only
// session on the database, no Zoho call. Writes Markdown to stdout.
//   node --env-file=.env.local scripts/zoho-bill-preview.mjs LPO-00076-2 LPO-00045-1 ...
import pg from "pg";
import { pathToFileURL } from "node:url";
import path from "node:path";

const { billLines } = await import(pathToFileURL(path.resolve("src/lib/zoho-bill-lines.ts")).href);
const numbers = process.argv.slice(2);
const ref = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/^https:\/\//, "").replace(/\.supabase\.co\/?$/, "");
const client = new pg.Client({ host: `db.${ref}.supabase.co`, port: 5432, user: "postgres", password: process.env.SUPABASE_DB_PASSWORD, database: "postgres", ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query("set session characteristics as transaction read only");
const money = (n) => Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (n) => Math.round((n + Math.sign(n) * 1e-9) * 100) / 100;
const out = [];
try {
  for (const num of numbers) {
    const { rows: [po] } = await client.query(
      `select po.id, po.number, po.kind, po.status, po.supplier_name, po.supplier_invoice_number, po.supplier_invoice_amount, po.supplier_invoice_vat_aed, po.zoho_bill_taxed, s.vat_registered, j.job_number,
              v.has_plate, v.plate_emirate, v.plate_code, v.plate_number
         from public.purchase_orders po left join public.suppliers s on s.id = po.supplier_id left join public.jobs j on j.id = po.job_id left join public.vehicles v on v.id = j.vehicle_id where po.number = $1`, [num]);
    if (!po) { out.push(`## ${num}\n\nNot found.\n`); continue; }
    const { rows: lines } = await client.query("select description, part_number, list_price, discount_percent, quantity, received_qty, unit_cost, invoice_unit_cost from public.purchase_order_lines where po_id = $1 order by position", [po.id]);
    const { rows: charges } = await client.query("select description, amount_aed from public.supplier_charges where po_id = $1 and is_active and removed_at is null", [po.id]);
    const full = po.status !== "partly_received";
    const ls = lines.map((l) => ({ description: l.description, partNumber: l.part_number && !/^(\d{1,3}|ofj.*|no number)$/i.test(l.part_number.trim()) ? l.part_number : null, listPrice: l.list_price == null ? null : Number(l.list_price), discountPercent: l.discount_percent == null ? null : Number(l.discount_percent), quantity: l.received_qty != null ? Number(l.received_qty) : full ? Number(l.quantity) : 0, unit: Number(l.invoice_unit_cost ?? l.unit_cost) }));
    const cs = charges.map((c) => ({ description: c.description, amount: r2(Number(c.amount_aed)) }));
    const partsNet = r2(ls.reduce((a, l) => a + l.quantity * l.unit, 0));
    const chargesSum = r2(cs.reduce((a, c) => a + c.amount, 0));
    const linesTotal = r2(partsNet + chargesSum);
    const entered = po.supplier_invoice_amount == null ? null : Number(po.supplier_invoice_amount);
    const net = entered && entered > 0 && Math.abs(entered - linesTotal) > 0.004 ? r2(entered) : linesTotal;
    const taxed = po.zoho_bill_taxed ?? po.vat_registered !== false;
    const vat = taxed ? (po.supplier_invoice_vat_aed != null ? r2(Number(po.supplier_invoice_vat_aed)) : r2(net * 0.05)) : 0;
    const plate = po.has_plate ? [po.plate_emirate, po.plate_code, po.plate_number].filter(Boolean).join(" ") : null;
    const b = billLines({ lines: ls, charges: cs, expectedNet: net, expectedVat: vat, taxed, ref: { lpo: po.number, job: po.job_number, plate }, accounts: { parts: po.kind === "stock" ? "Stock value" : "Parts purchases", courier: "Courier / freight" }, taxId: taxed ? "VAT 5%" : null });
    const delivered = ls.filter((l) => l.quantity > 0).length;
    out.push(`## ${po.number} · bill ${po.supplier_invoice_number ?? "(no invoice yet)"} · ${po.supplier_name}${po.job_number ? ` · ${po.job_number}` : ""}\n`);
    out.push("**Before (one summary line):**\n");
    out.push("| Line | Qty | Rate | Account | VAT |\n|---|---|---|---|---|");
    out.push(`| Parts per ${po.number} – ${delivered} item${delivered === 1 ? "" : "s"} | 1 | ${money(r2(net - chargesSum))} | ${po.kind === "stock" ? "Stock value" : "Parts purchases"} | ${taxed ? "5%" : "none"} |`);
    for (const c of cs) out.push(`| ${c.description} | 1 | ${money(c.amount)} | Courier / freight | ${taxed ? "5%" : "none"} |`);
    out.push("\n**Now (one line per part):**\n");
    out.push("| Line | Description | Qty | Rate | Amount | Account | VAT |\n|---|---|---|---|---|---|---|");
    for (const i of b.items) out.push(`| ${i.name} | ${i.description} | ${i.quantity} | ${money(i.rate)} | ${money(r2(i.quantity * i.rate))} | ${i.account_id} | ${i.tax_id ? "5%" : "none"} |`);
    out.push(`\nOrder number (reference): **${po.number}**. Before VAT **${money(b.zohoNet)}**, VAT **${money(r2(b.zohoVat + b.adjustment))}**${b.adjustment ? ` (5% per line ${money(b.zohoVat)}, rounding ${money(b.adjustment)} in the adjustment as printed on the paper)` : ""}, total **${money(r2(b.zohoNet + b.zohoVat + b.adjustment))}** – the same total as before.\n`);
  }
} finally {
  await client.end();
}
console.log(out.join("\n"));
