"use server";

import * as XLSX from "xlsx";
import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { ocrEnabled, ocrTable } from "@/lib/import-ocr";
import { readPdfPositionedLines, readPdfRows, renderPdfPages } from "@/lib/pdf-read";
import { loadPricingRows } from "@/lib/parts-pricing";
import { supplierDiscount, type RowValues, type SupplierOption } from "@/lib/parts-rows";
import { importLock, lineChecks, parsePaste, pdfImport, readTable, shortAed, type ApplyLine, type ColumnMapping, type ImportLine, type ImportResult, type ImportTotals, importAvailabilityNote } from "@/lib/price-import";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { autoSavePartRow, syncLineForPart, type RowSave } from "./actions";

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

/**
 * Excel, CSV or PDF files (one or several). Spreadsheets: every sheet is tried, the one with part lines is used.
 * PDFs: the text is read page by page into cells; a scanned PDF (a picture) goes through the screenshot reader
 * page by page and comes back marked `scanned`, so every line must be ticked.
 */
export async function parseImportUpload(jobId: string, formData: FormData): Promise<{ error?: string; result?: ImportResult; fileNames?: string[]; scanned?: boolean }> {
  if (!(await partsStaff())) return { error: "Not allowed." };
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return { error: "Choose a file first." };
  const mappings = await savedMappings();
  const results: ImportResult[] = [];
  const names: string[] = [];
  let scanned = false;
  for (const file of files) {
    if (file.size > 15 * 1024 * 1024) return { error: `${file.name} is over 15 MB.` };
    if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
      const buf = Buffer.from(await file.arrayBuffer());
      let read: Awaited<ReturnType<typeof readPdfRows>>;
      try {
        read = await readPdfRows(buf);
      } catch {
        return { error: `${file.name} could not be opened as a PDF.` };
      }
      if (!read.scanned) {
        // The dealer block layout (Mercedes) by position; otherwise the table read by its HEADINGS (every cell under
        // the heading it sits beneath, an empty column stays empty); the plain cells and lines only as a last resort.
        const r = pdfImport({ cellPages: read.cellPages, rowPages: read.pages, text: read.text, vin: read.vin }, await readPdfPositionedLines(buf), (rows) => withSaved(rows, mappings));
        if (r.format === "dealer" && r.customerId) {
          const memory = ((await getSettings()).import_supplier_memory ?? {}) as Record<string, string>;
          if (memory[r.customerId]) r.supplierHint = memory[r.customerId];
        }
        results.push(r);
        names.push(`${file.name} (${read.pageCount} page${read.pageCount === 1 ? "" : "s"})`);
        continue;
      }
      if (!ocrEnabled()) return { error: `${file.name} is a scan (a picture, no text). Reading scans needs the screenshot reader, which is not switched on yet. Ask the supplier for the file, or paste the text.` };
      const pngs = await renderPdfPages(buf, 8);
      for (const [i, png] of pngs.entries()) {
        const o = await ocrTable(png, "image/png");
        if (o.error || !o.result) return { error: `${file.name}, page ${i + 1}: ${o.error ?? "could not be read"}` };
        results.push(o.result);
      }
      scanned = true;
      names.push(`${file.name} (scan, ${pngs.length} page${pngs.length === 1 ? "" : "s"})`);
      continue;
    }
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
  return { result: merge(results), fileNames: names, scanned };
}

/** Text pasted from an email or copied out of a spreadsheet; `valuesPerRow` when Parts told us how many values make a line. */
export async function parseImportText(jobId: string, text: string, valuesPerRow: number | null = null): Promise<{ error?: string; result?: ImportResult }> {
  if (!(await partsStaff())) return { error: "Not allowed." };
  const clean = String(text ?? "").slice(0, 200_000);
  if (!clean.trim()) return { error: "Paste the supplier's text first." };
  const rows = parsePaste(clean, valuesPerRow);
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
/** The part columns an import may change; saved before and after so Undo can put them back. */
const SNAPSHOT = "id, description, part_number, part_type, list_price_aed, discount_percent, cost_aed, supplier, availability, delivery_date, confirmed_quantity, availability_note, is_active";

export type ApplyResult = { error?: string; applied?: number; charges?: number; failed?: { name: string; error: string }[]; importId?: string };

/**
 * The safety lock again on the server, whatever the screen did: every line that will be applied must add up
 * (qty × price = total) or carry Parts' "Checked" tick, unusual figures (qty over 50, a line over AED 500,000)
 * need the tick too, and lines that do not add up to the supplier's own total need a typed reason.
 */
function serverLock(lines: ApplyLine[], totals: ImportTotals | null | undefined, override: string | null | undefined): string | null {
  const used = lines.filter((l) => l.target !== "skip");
  const asLines: ImportLine[] = used.map((l) => {
    const c = lineChecks({ qty: l.qty, net: l.net, total: l.total ?? null });
    return { key: l.key, partNumber: l.partNumber, description: l.name, qty: l.qty, list: l.list, net: l.net, discount: l.discount, total: l.total ?? null, availability: l.availability, vin: null, raw: [], problem: c.problem, ask: c.ask };
  });
  const t: ImportTotals = totals ?? { found: [], sumLines: null, expected: null, match: null };
  // The match is worked out here from the two figures, never taken from the screen.
  const match = t.sumLines !== null && t.expected !== null ? Math.abs(t.sumLines - t.expected) <= Math.max(0.05, 0.01 * lines.length) : t.match === false ? false : null;
  const lock = importLock(asLines, { ...t, match }, { included: () => true, checked: (l) => !!used.find((u) => u.key === l.key)?.checked, totalsOverride: override, sourceWord: "supplier's" });
  return lock.blocked ? lock.message : null;
}

/**
 * Apply: every confirmed line goes through the same save as a hand-typed row (autoSavePartRow), so the supplier's
 * standard discount, the owner's approval limit, the row states and Pricing done all apply. Figures the import did
 * not bring keep the row's current values. The supplier's availability words become our choice (same day, n days)
 * or a note ("Back order", "Supplier to confirm") that never touches the price. Everything the import added or
 * changed is written down under one import, so "Undo last import" can take exactly that back.
 */
export async function applyImport(jobId: string, payload: { supplierId: string | null; defaultType: string | null; source: string; format?: string | null; customerId?: string | null; lines: ApplyLine[]; mapping?: { headings: string[]; mapping: ColumnMapping } | null; totals?: ImportTotals | null; totalsOverride?: string | null }): Promise<ApplyResult> {
  const staff = await partsStaff();
  if (!staff) return { error: "Not allowed." };
  const locked = serverLock(payload.lines, payload.totals, payload.totalsOverride);
  if (locked) return { error: `Not applied: ${locked}` };
  const chargeLines = payload.lines.filter((l) => l.kind === "charge" && l.target !== "skip");
  if (chargeLines.length && !payload.supplierId) return { error: "Choose the supplier first: the courier or freight charge goes on that supplier's LPO." };
  const admin = createAdminClient();
  const settings = await getSettings();
  const types = ((settings.part_types ?? []) as string[]).map((t) => t.toLowerCase());
  const pricing = await loadPricingRows(jobId, types[0] ?? "");
  let supplier: SupplierOption | undefined;
  if (payload.supplierId) {
    const { data: s } = await admin.from("suppliers").select("id, name, default_discount_percent, discount_by_type").eq("id", payload.supplierId).maybeSingle();
    if (!s) return { error: "Supplier not found." };
    supplier = { id: s.id as string, name: s.name as string, discount: Number(s.default_discount_percent) || 0, byType: (s.discount_by_type as Record<string, number> | null) ?? {} };
    // A mapping Parts set by hand is remembered for this supplier.
    if (payload.mapping && Object.keys(payload.mapping.mapping).length) await saveImportMapping(supplier.id, payload.mapping.headings, payload.mapping.mapping);
    // The dealer's customer id remembers which supplier this is, so the next file pre-fills it.
    if (payload.customerId) {
      const memory = ((settings.import_supplier_memory ?? {}) as Record<string, string>);
      if (memory[payload.customerId] !== supplier.name) {
        await admin.from("settings").upsert({ key: "import_supplier_memory", label: "Import supplier memory", value: { ...memory, [payload.customerId]: supplier.name }, updated_by: staff.id }, { onConflict: "key" });
      }
    }
  }
  const failed: { name: string; error: string }[] = [];
  const override = payload.totals?.match === false || (payload.totals?.sumLines !== null && payload.totals?.expected !== null && payload.totals?.sumLines !== undefined && payload.totals?.expected !== undefined && Math.abs(payload.totals.sumLines - payload.totals.expected) > 0.05) ? (payload.totalsOverride ?? "").trim().slice(0, 300) || null : null;
  const { data: imp } = await admin.from("price_imports").insert({ job_id: jobId, supplier_id: supplier?.id ?? null, source: payload.source.slice(0, 200), format: payload.format ?? null, line_count: payload.lines.length, totals_sum_aed: payload.totals?.sumLines ?? null, totals_expected_aed: payload.totals?.expected ?? null, totals_override: override, created_by: staff.id, updated_by: staff.id }).select("id").single();
  const importId = (imp?.id as string | undefined) ?? null;
  // Supplier charges (courier, freight): an internal cost on the supplier's LPO, never a parts line. The same
  // charge imported twice (same supplier, words and amount) is kept once.
  let charges = 0;
  if (supplier && chargeLines.length) {
    const { data: existingCharges } = await admin.from("supplier_charges").select("description, amount_aed, supplier_name").eq("job_id", jobId).eq("is_active", true);
    for (const c of chargeLines) {
      const amount = r2(c.total ?? (c.net ?? 0) * (c.qty ?? 1));
      const description = (c.name || "Supplier charge").trim().slice(0, 200);
      const dup = (existingCharges ?? []).some((e) => Number(e.amount_aed) === amount && String(e.description).toLowerCase() === description.toLowerCase() && String(e.supplier_name).toLowerCase() === supplier!.name.toLowerCase());
      if (dup) continue;
      const { error } = await admin.from("supplier_charges").insert({ job_id: jobId, supplier_id: supplier.id, supplier_name: supplier.name, description, amount_aed: amount, import_id: importId, created_by: staff.id, updated_by: staff.id });
      if (error) failed.push({ name: description, error: error.message });
      else charges++;
    }
  }
  const empty: RowValues = { part_number: "", part_type: types[0] ?? "", brand: "", list_price: "", discount: "", cost_aed: "", supplier: "", availability: "", days: "", qty: "1" };
  let applied = 0;
  const stamp = Date.now();
  const snapshot = async (partId: string) => (await admin.from("part_items").select(SNAPSHOT).eq("id", partId).maybeSingle()).data ?? null;
  for (const line of payload.lines) {
    if (line.target === "skip" || line.kind === "charge") continue;
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
    const a = line.availability;
    // "in stock" / "available" at the supplier = ordered today, here today (Same day); n days = to order; the rest is a note.
    const avail = a?.kind === "same_day" ? { availability: "to_order", days: "0" } : a?.kind === "days" && a.days !== null ? { availability: "to_order", days: String(a.days) } : { availability: base.availability, days: base.days };
    const note = importAvailabilityNote(a);
    const before = existing?.partId ? await snapshot(existing.partId) : null;
    const row: RowSave = {
      requestId: existing?.requestId ?? null,
      partId: existing?.partId ?? null,
      clientKey: existing ? undefined : `import:${stamp}:${line.key}`.slice(0, 80),
      name: (line.name || existing?.name || "").trim(),
      // A "part number" that is only a line number (1, 2, 19: an earlier screenshot read the Sl No. there) is cleared
      // when the supplier's paper leaves the part number blank; a real one is kept.
      part_number: line.partNumber ?? (/^\d{1,3}$/.test((base.part_number ?? "").trim()) ? "" : base.part_number),
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
    if (res.error || !res.partId) {
      failed.push({ name: line.name, error: res.error ?? "Could not save." });
      continue;
    }
    applied++;
    if (note !== null || a?.kind === "same_day" || a?.kind === "days") await admin.from("part_items").update({ availability_note: note, updated_by: staff.id }).eq("id", res.partId);
    if (importId) {
      const after = await snapshot(res.partId);
      await admin.from("price_import_lines").insert({ import_id: importId, part_id: res.partId, request_id: existing?.requestId ?? null, created: !existing?.partId, before, after });
    }
  }
  if (importId) await admin.from("price_imports").update({ applied_count: applied + charges, updated_by: staff.id }).eq("id", importId);
  const chargeWords = charges ? `; ${charges} supplier charge${charges === 1 ? "" : "s"} (internal cost, on the supplier's LPO)` : "";
  const overrideWords = override ? `; the totals did not match the supplier's (${shortAed(payload.totals?.sumLines ?? null)} against ${shortAed(payload.totals?.expected ?? null)}), applied with the reason: ${override}` : "";
  await admin.from("job_events").insert({ job_id: jobId, event_type: "parts_imported", note: `${applied} price${applied === 1 ? "" : "s"} imported from ${payload.source || "a supplier file"}${supplier ? ` (${supplier.name})` : ""} by ${staff.display_name}${chargeWords}${overrideWords}${failed.length ? `; ${failed.length} failed` : ""}`, created_by: staff.id });
  revalidatePath(`/parts/${jobId}`);
  return { applied, charges, failed, importId: importId ?? undefined };
}

/**
 * "Undo last import": only what that import did. Parts it created go inactive (they vanish from the list and the
 * quotation); parts it changed get their earlier figures back. Nothing else on the job is touched.
 */
export async function undoImport(jobId: string, importId: string): Promise<{ error?: string; restored?: number; removed?: number }> {
  const staff = await partsStaff();
  if (!staff) return { error: "Not allowed." };
  const admin = createAdminClient();
  const { data: imp } = await admin.from("price_imports").select("id, job_id, undone_at").eq("id", importId).maybeSingle();
  if (!imp || imp.job_id !== jobId) return { error: "Import not found." };
  if (imp.undone_at) return { error: "This import was already undone." };
  const { data: lines } = await admin.from("price_import_lines").select("part_id, request_id, created, before").eq("import_id", importId);
  let restored = 0;
  let removed = 0;
  const now = new Date().toISOString();
  for (const l of (lines ?? []) as { part_id: string | null; request_id: string | null; created: boolean; before: Record<string, unknown> | null }[]) {
    if (!l.part_id) continue;
    if (l.created) {
      // The part did not exist before the import: it goes, and its request opens again.
      await admin.from("part_items").update({ is_active: false, deleted_at: now, deleted_by: staff.id, updated_by: staff.id }).eq("id", l.part_id);
      if (l.request_id) await admin.from("part_requests").update({ status: "open", updated_by: staff.id }).eq("id", l.request_id).in("status", ["listed", "done"]);
      removed++;
    } else if (l.before) {
      const b = l.before;
      await admin.from("part_items").update({
        description: b.description, part_number: b.part_number, part_type: b.part_type, list_price_aed: b.list_price_aed, discount_percent: b.discount_percent, cost_aed: b.cost_aed, supplier: b.supplier, availability: b.availability, delivery_date: b.delivery_date, confirmed_quantity: b.confirmed_quantity, availability_note: b.availability_note ?? null, updated_by: staff.id,
      }).eq("id", l.part_id);
      restored++;
    }
    await syncLineForPart(jobId, l.part_id, staff.id);
  }
  // The supplier charges that import made go too (unless an LPO already carries them).
  const { data: gone } = await admin.from("supplier_charges").update({ is_active: false, removed_at: now, removed_by: staff.id, updated_by: staff.id }).eq("import_id", importId).eq("is_active", true).is("po_id", null).select("id");
  removed += (gone ?? []).length;
  await admin.from("price_imports").update({ undone_at: now, undone_by: staff.id, updated_by: staff.id }).eq("id", importId);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "parts_import_undone", note: `Import undone by ${staff.display_name}: ${removed} added part${removed === 1 ? "" : "s"} removed, ${restored} changed part${restored === 1 ? "" : "s"} put back`, created_by: staff.id });
  revalidatePath(`/parts/${jobId}`);
  return { restored, removed };
}
