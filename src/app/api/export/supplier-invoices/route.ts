import { type NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/auth";
import { filterInvoices, invoiceFilterOf } from "@/lib/supplier-invoice-rows";
import { loadSupplierInvoices, supplierInvoiceSheet } from "@/lib/supplier-invoices";
import { buildXlsx, xlsxResponse } from "@/lib/xlsx";

export const dynamic = "force-dynamic";

/** The Supplier invoices tab as a real Excel file, with the same filters as the screen (accounts and the owner). */
export async function GET(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff || !["owner", "accounts"].includes(staff.role_id)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const p = request.nextUrl.searchParams;
  // Strict: a file is never made from a list that could not be read.
  const read = await loadSupplierInvoices({ strict: true }).catch(() => null);
  if (!read) return NextResponse.json({ error: "Couldn't read the supplier invoices just now. Try the export again." }, { status: 503 });
  // THE filter of the screen (invoiceFilterOf) and THE sheet (shared with Parts accounts' export, so both files read the same).
  const rows = filterInvoices(read.rows, invoiceFilterOf((k) => p.get(k)), read.partNames);
  const buf = await buildXlsx([supplierInvoiceSheet(rows)]);
  return xlsxResponse(buf, `OFJ supplier invoices ${new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10)}.xlsx`);
}
