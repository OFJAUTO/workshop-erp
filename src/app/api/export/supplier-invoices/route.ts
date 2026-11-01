import { type NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { MATCH_WORDS, STATUS_WORDS, filterInvoices } from "@/lib/supplier-invoice-rows";
import { loadSupplierInvoices } from "@/lib/supplier-invoices";
import { buildXlsx, xlsxResponse } from "@/lib/xlsx";

export const dynamic = "force-dynamic";

/** The Supplier invoices tab as a real Excel file, with the same filters as the screen (accounts and the owner). */
export async function GET(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff || !["owner", "accounts"].includes(staff.role_id)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const p = request.nextUrl.searchParams;
  const { rows: all, partNames } = await loadSupplierInvoices();
  const rows = filterInvoices(all, { supplier: p.get("supplier") ?? undefined, from: p.get("from") ?? undefined, to: p.get("to") ?? undefined, status: p.get("status") ?? undefined, unpaid: p.get("unpaid") === "1", problems: p.get("problems") === "1", q: p.get("q") ?? undefined, job: p.get("job") ?? undefined }, partNames);
  const buf = await buildXlsx([
    {
      name: "Supplier invoices",
      columns: [
        { header: "Supplier", key: "supplier", width: 28 },
        { header: "Invoice no.", key: "number", width: 16 },
        { header: "Date", key: "date", width: 12 },
        { header: "TRN", key: "trn", width: 18 },
        { header: "Before VAT (AED)", key: "before", width: 15, numFmt: "#,##0.00" },
        { header: "VAT (AED)", key: "vat", width: 12, numFmt: "#,##0.00" },
        { header: "Total (AED)", key: "total", width: 14, numFmt: "#,##0.00" },
        { header: "LPO(s)", key: "lpos", width: 22 },
        { header: "Car(s) / job(s)", key: "cars", width: 34 },
        { header: "Parts", key: "parts", width: 8 },
        { header: "Match", key: "match", width: 24 },
        { header: "Status", key: "status", width: 20 },
      ],
      rows: rows.map((r) => ({
        supplier: r.supplier,
        number: r.number ?? "Invoice missing",
        date: r.date ? new Date(`${r.date}T12:00:00Z`) : "",
        trn: r.trn ?? "",
        before: r.beforeVat,
        vat: r.vat,
        total: r.total,
        lpos: r.shares.map((s) => s.poNumber).join(", "),
        cars: r.shares.map((s) => [s.jobNumber, s.plate, s.car].filter(Boolean).join(" ")).filter(Boolean).join("; ") || "Stock order",
        parts: r.parts,
        match: [...r.match.map((m) => MATCH_WORDS[m]), r.duplicateOf ? `Possible duplicate of ${r.duplicateOf}` : ""].filter(Boolean).join(", "),
        status: STATUS_WORDS[r.status],
      })),
      totals: { supplier: `${rows.length} invoices`, before: Math.round(rows.reduce((a, r) => a + r.beforeVat, 0) * 100) / 100, vat: Math.round(rows.reduce((a, r) => a + r.vat, 0) * 100) / 100, total: Math.round(rows.reduce((a, r) => a + r.total, 0) * 100) / 100 },
    },
  ]);
  return xlsxResponse(buf, `OFJ supplier invoices ${new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10)}.xlsx`);
}
