import "server-only";
import ExcelJS from "exceljs";

/**
 * Every export in the system is a real .xlsx file: a bold frozen header, fitted columns, real dates,
 * amounts as numbers, and a bold total row. Never CSV.
 */

export type XlsxColumn = { header: string; key: string; width?: number; numFmt?: string };
export type XlsxSheet = {
  name: string;
  columns: XlsxColumn[];
  rows: Record<string, unknown>[];
  /** A bold row at the bottom ({ key: value }); strings land as labels, numbers as numbers. */
  totals?: Record<string, unknown> | null;
};

export async function buildXlsx(sheets: XlsxSheet[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name.slice(0, 31) || "Sheet", { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = sheet.columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? Math.max(12, c.header.length + 4), style: c.numFmt ? { numFmt: c.numFmt } : undefined }));
    ws.getRow(1).font = { bold: true };
    for (const r of sheet.rows) ws.addRow(r);
    if (sheet.totals) {
      const row = ws.addRow(sheet.totals);
      row.font = { bold: true };
    }
  }
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

export function xlsxResponse(buffer: Buffer, fileName: string): Response {
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName.replace(/[^\w .()-]/g, "")}"`,
      "Cache-Control": "no-store",
    },
  });
}
