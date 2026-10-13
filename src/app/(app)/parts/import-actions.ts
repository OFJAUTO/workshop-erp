"use server";

import * as XLSX from "xlsx";
import { getCurrentStaff } from "@/lib/auth";
import { dubaiDate } from "@/lib/jobs";
import { loadPricingRows } from "@/lib/parts-pricing";
import { supplierDiscount, type RowValues, type SupplierOption } from "@/lib/parts-rows";
import { parsePaste, readTable, type ApplyLine, type ColumnMapping, type ImportResult } from "@/lib/price-import";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { autoSavePartRow, type RowSave } from "./actions";

type SavedMapping = { headings: string[]; mapping: ColumnMapping };

async function partsStaff() {
  const staff = await getCurrentStaff();
  if (!staff || staff.viewingAs) return null;
  if (!can(staff.role_id as RoleId, "priceParts")) return null;
  return staff;
}

/** Every supplier's saved column mapping, so an unknown file is recognised the second time. */
async function savedMappings(): Promise<{ supplierId: string; name: string; saved: SavedMapping }[]> {
  const { data } = await createAdminClient().from("suppliers").select("id, name, import_mapping").eq("is_active", true).not("import_mapping", "is", null);
  return (data ?? []).filter((s) => s.import_mapping && typeof s.import_mapping === "object").map((s) => ({ supplierId: s.id as string, name: s.name as string, saved: s.import_mapping as SavedMapping }));
}

function withSaved(rows: string[][], mappings: { supplierId: string; name: string; saved: SavedMapping }[]): ImportResult {
  let result = readTable(rows);
  if (result.format === "unknown") {
    for (const m of mappings) {
      const tried = readTable(rows, { savedMapping: m.saved, supplierHint: m.name });
      if (tried.format === "mapped") {
        result = tried;
        break;
      }
    }
  }
  return result;
}

/** Excel or CSV files (one or several): every sheet is tried, the one with part lines is used. */
export async function parseImportUpload(jobId: string, formData: FormData): Promise<{ error?: string; result?: ImportResult; fileNames?: string[] }> {
  if (!(await partsStaff())) return { error: "Not allowed." };
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return { error: "Choose a file first." };
  const mappings = await savedMappings();
  const results: ImportResult[] = [];
  const names: string[] = [];
  for (const file of files) {
    if (file.size > 15 * 1024 * 1024) return { error: `${file.name} is over 15 MB.` };
    let wb: XLSX.WorkBook;
    try {
      wb = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: "buffer", cellText: true, cellDates: false });
    } catch {
      return { error: `${file.name} could not be opened. Save it as .xlsx or .csv and try again.` };
    }
    let best: ImportResult | null = null;
    for (const name of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[name], { header: 1, raw: false, defval: "" });
      const r = withSaved(rows.map((row) => row.map((c) => String(c ?? ""))), mappings);
      if (!best || (r.lines.length > best.lines.length && r.format !== "unknown") || (best.format === "unknown" && r.format !== "unknown")) best = r;
    }
    if (best) {
      results.push(best);
      names.push(file.name);
    }
  }
  if (!results.length) return { error: "Nothing readable was found in the file." };
  return { result: merge(results), fileNames: names };
}

/** Text pasted from an email or copied out of a spreadsheet. */
export async function parseImportText(jobId: string, text: string): Promise<{ error?: string; result?: ImportResult }> {
  if (!(await partsStaff())) return { error: "Not allowed." };
  const clean = String(text ?? "").slice(0, 200_000);
  if (!clean.trim()) return { error: "Paste the supplier's text first." };
  const rows = parsePaste(clean);
  return { result: withSaved(rows, await savedMappings()) };
}

/** Several files in one go: their lines one after another; the totals check holds only if every file's does. */
function merge(results: ImportResult[]): ImportResult {
  if (results.length === 1) return results[0];
  const first = results[0];
  const lines = results.flatMap((r, i) => r.lines.map((l) => ({ ...l, key: `f${i}-${l.key}` })));
  const matches = results.map((r) => r.totals.match).filter((m): m is boolean => m !== null);
  const sum = results.reduce((a, r) => a + (r.totals.sumLines ?? 0), 0);
  const exp = results.every((r) => r.totals.expected !== null) ? results.reduce((a, r) => a + (r.totals.expected ?? 0), 0) : null;
  return {
    ...first,
    lines,
    totals: { found: results.flatMap((r) => r.totals.found), sumLines: Math.round(sum * 100) / 100, expected: exp, match: matches.length ? matches.every(Boolean) : null },
    vin: results.map((r) => r.vin).find(Boolean) ?? null,
    warnings: results.flatMap((r, i) => r.warnings.map((w) => `${results.length > 1 ? `File ${i + 1}: ` : ""}${w}`)),
    format: results.every((r) => r.format === first.format) ? first.format : "generic",
  };
}

/** The column mapping Parts chose for a supplier whose format is not recognised: kept on the supplier and reused. */
export async function saveImportMapping(supplierId: string, headings: string[], mapping: ColumnMapping): Promise<{ error?: string; ok?: boolean }> {
  const staff = await partsStaff();
  if (!staff) return { error: "Not allowed." };
  if (!supplierId) return { error: "Choose the supplier first." };
  const clean: ColumnMapping = {};
  for (const [k, v] of Object.entries(mapping)) if (typeof v === "number" && v >= 0 && k !== "ignore") (clean as Record<string, number>)[k] = v;
  const { error } = await createAdminClient().from("suppliers").update({ import_mapping: { headings: headings.map((h) => String(h).slice(0, 80)).slice(0, 40), mapping: clean }, updated_by: staff.id }).eq("id", supplierId);
  return error ? { error: error.message } : { ok: true };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Apply: every confirmed line goes through the same save as a hand-typed row (autoSavePartRow), so the supplier's
 * standard discount, the owner's approval limit, the row states and Pricing done all apply. Figures the import did
 * not bring keep the row's current values; a "Supplier to confirm" availability leaves the box as it is.
 */
export async function applyImport(jobId: string, payload: { supplierId: string | null; defaultType: string | null; source: string; lines: ApplyLine[] }): Promise<{ error?: string; applied?: number; failed?: { name: string; error: string }[] }> {
  const staff = await partsStaff();
  if (!staff) return { error: "Not allowed." };
  const admin = createAdminClient();
  const settings = await getSettings();
  const types = ((settings.part_types ?? []) as string[]).map((t) => t.toLowerCase());
  const pricing = await loadPricingRows(jobId, types[0] ?? "");
  let supplier: SupplierOption | undefined;
  if (payload.supplierId) {
    const { data: s } = await admin.from("suppliers").select("id, name, default_discount_percent, discount_by_type").eq("id", payload.supplierId).maybeSingle();
    if (!s) return { error: "Supplier not found." };
    supplier = { id: s.id as string, name: s.name as string, discount: Number(s.default_discount_percent) || 0, byType: (s.discount_by_type as Record<string, number> | null) ?? {} };
  }
  const today = dubaiDate();
  void today;
  const empty: RowValues = { part_number: "", part_type: types[0] ?? "", brand: "", list_price: "", discount: "", cost_aed: "", supplier: "", availability: "", days: "", qty: "1" };
  let applied = 0;
  const failed: { name: string; error: string }[] = [];
  const stamp = Date.now();
  for (const line of payload.lines) {
    if (line.target === "skip") continue;
    const existing = line.target === "new" ? null : pricing.rows.find((r) => (line.target !== "new" && line.target !== "skip" && line.target.partId ? r.partId === line.target.partId : line.target !== "new" && line.target !== "skip" && !!line.target.requestId && r.requestId === line.target.requestId && !r.partId)) ?? null;
    if (line.target !== "new" && !existing) {
      failed.push({ name: line.name, error: "The row it was matched to is no longer on the list." });
      continue;
    }
    const base = existing?.values ?? empty;
    const partType = base.part_type || (payload.defaultType && types.includes(payload.defaultType) ? payload.defaultType : types[0] ?? "");
    const list = line.list;
    let net = line.net;
    let discount = line.discount;
    if (net === null && list !== null && supplier) {
      // A list price with no net: the supplier's standard discount gives the net, as a typed row would.
      discount = supplierDiscount(supplier, partType);
      net = r2(list * (1 - discount / 100));
    }
    if (discount === null && list !== null && net !== null && list > 0) discount = r2((1 - net / list) * 100);
    const avail = line.availability?.kind === "in_stock" ? { availability: "in_stock", days: "" } : line.availability?.kind === "days" && line.availability.days !== null ? { availability: "to_order", days: String(line.availability.days) } : { availability: base.availability, days: base.days };
    const row: RowSave = {
      requestId: existing?.requestId ?? null,
      partId: existing?.partId ?? null,
      clientKey: existing ? undefined : `import:${stamp}:${line.key}`.slice(0, 80),
      name: (line.name || existing?.name || "").trim(),
      part_number: line.partNumber ?? base.part_number,
      part_type: partType,
      brand: base.brand,
      list_price: list !== null ? String(list) : base.list_price,
      discount: discount !== null ? String(discount) : base.discount,
      cost_aed: net !== null ? String(net) : base.cost_aed,
      supplier: supplier?.name ?? base.supplier,
      ...avail,
      quantity: line.qty ?? base.qty,
    };
    const res = await autoSavePartRow(jobId, row);
    if (res.error) failed.push({ name: line.name, error: res.error });
    else applied++;
  }
  await admin.from("job_events").insert({ job_id: jobId, event_type: "parts_imported", note: `${applied} price${applied === 1 ? "" : "s"} imported from ${payload.source || "a supplier file"}${supplier ? ` (${supplier.name})` : ""} by ${staff.display_name}${failed.length ? `; ${failed.length} failed` : ""}`, created_by: staff.id });
  return { applied, failed };
}
