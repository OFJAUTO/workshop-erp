import "server-only";
import { createAdminClient } from "./supabase/admin";
import { pageAll } from "./page-all";
import { schemaReady } from "./schema-ready";
import { logAppError } from "./app-errors";
import { endOfDubaiDay, lastMonthEnd, movementValue, stockAsOf, type StockItemFacts, type StockMovementFacts, type StockRow } from "./stock-report-rules";

/*
 * THE stock report (16 November 2026, Section 1; owner and accounts): the count and value as of any day, the movements
 * behind it, and a saved snapshot on the last day of each month (stock_snapshots, taken by the hourly job on the 1st).
 * The stock count and value live in the ERP only - Zoho gets the supplier bills for stock purchases.
 */

export const stockSnapshotsReady = () => schemaReady("stock_snapshots", "id, as_of, rows, total_value");

type Q = PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>;

async function readAll(): Promise<{ items: StockItemFacts[]; moves: StockMovementFacts[] }> {
  const admin = createAdminClient();
  const [items, moves] = await Promise.all([
    pageAll<Record<string, unknown>>((a, b) => admin.from("stock_items").select("id, name, part_number, item_type, unit, created_at, quantity, unit_cost, is_active").order("id").range(a, b) as unknown as Q),
    pageAll<Record<string, unknown>>((a, b) => admin.from("stock_movements").select("id, stock_item_id, kind, quantity, unit_cost, quantity_after, created_at, job_id, po_id, note").eq("is_active", true).order("created_at").order("id").range(a, b) as unknown as Q),
  ]);
  return {
    items: items.map((r) => ({ id: String(r.id), name: String(r.name ?? ""), part_number: (r.part_number as string | null) ?? null, item_type: (r.item_type as string | null) ?? null, unit: (r.unit as string | null) ?? null, created_at: String(r.created_at), quantity: Number(r.quantity) || 0, unit_cost: Number(r.unit_cost) || 0, is_active: r.is_active !== false })),
    moves: moves.map((m) => ({ id: String(m.id), stock_item_id: String(m.stock_item_id), kind: String(m.kind), quantity: Number(m.quantity) || 0, unit_cost: m.unit_cost == null ? null : Number(m.unit_cost), quantity_after: Number(m.quantity_after) || 0, created_at: String(m.created_at), job_id: (m.job_id as string | null) ?? null, po_id: (m.po_id as string | null) ?? null, note: (m.note as string | null) ?? null })),
  };
}

/** The stock as of a Dubai day. */
export async function stockAsOfDay(day: string): Promise<{ rows: StockRow[]; totalQuantity: number; totalValue: number }> {
  const { items, moves } = await readAll();
  return stockAsOf(items, moves, day);
}

export type MovementRow = { id: string; at: string; item: string; kind: string; quantity: number; unitCost: number; value: number; job: string | null; lpo: string | null; note: string | null };

/** The movements between two Dubai days (both included), newest first, with the job and LPO they belong to. */
export async function stockMovementsBetween(from: string, to: string): Promise<MovementRow[]> {
  const admin = createAdminClient();
  const start = new Date(Date.parse(`${from}T00:00:00Z`) - 4 * 3600000).toISOString();
  const end = endOfDubaiDay(to);
  const rows = await pageAll<Record<string, unknown>>((a, b) => admin.from("stock_movements").select("id, stock_item_id, kind, quantity, unit_cost, created_at, job_id, po_id, note").eq("is_active", true).gte("created_at", start).lte("created_at", end).order("created_at", { ascending: false }).order("id").range(a, b) as unknown as Q);
  const itemIds = Array.from(new Set(rows.map((r) => String(r.stock_item_id))));
  const jobIds = Array.from(new Set(rows.map((r) => r.job_id as string | null).filter((x): x is string => !!x)));
  const poIds = Array.from(new Set(rows.map((r) => r.po_id as string | null).filter((x): x is string => !!x)));
  const [{ data: items }, { data: jobs }, { data: pos }] = await Promise.all([
    itemIds.length ? admin.from("stock_items").select("id, name").in("id", itemIds) : Promise.resolve({ data: [] }),
    jobIds.length ? admin.from("jobs").select("id, job_number").in("id", jobIds) : Promise.resolve({ data: [] }),
    poIds.length ? admin.from("purchase_orders").select("id, number").in("id", poIds) : Promise.resolve({ data: [] }),
  ]);
  const nameOf = new Map(((items ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name]));
  const jobOf = new Map(((jobs ?? []) as { id: string; job_number: string }[]).map((x) => [x.id, x.job_number]));
  const poOf = new Map(((pos ?? []) as { id: string; number: string }[]).map((x) => [x.id, x.number]));
  return rows.map((r) => ({
    id: String(r.id), at: String(r.created_at), item: nameOf.get(String(r.stock_item_id)) ?? "", kind: String(r.kind),
    quantity: Number(r.quantity) || 0, unitCost: Number(r.unit_cost) || 0, value: movementValue({ quantity: Number(r.quantity) || 0, unit_cost: Number(r.unit_cost) || 0 }),
    job: r.job_id ? jobOf.get(String(r.job_id)) ?? null : null, lpo: r.po_id ? poOf.get(String(r.po_id)) ?? null : null, note: (r.note as string | null) ?? null,
  }));
}

export type StockSnapshot = { id: string; asOf: string; totalValue: number; itemCount: number; rows: StockRow[]; createdAt: string };

export async function listStockSnapshots(): Promise<StockSnapshot[]> {
  if (!(await stockSnapshotsReady())) return [];
  const { data } = await createAdminClient().from("stock_snapshots").select("id, as_of, total_value, item_count, rows, created_at").eq("is_active", true).order("as_of", { ascending: false }).limit(36);
  return ((data ?? []) as { id: string; as_of: string; total_value: number | string; item_count: number; rows: StockRow[]; created_at: string }[]).map((s) => ({ id: s.id, asOf: String(s.as_of).slice(0, 10), totalValue: Number(s.total_value) || 0, itemCount: s.item_count, rows: s.rows ?? [], createdAt: s.created_at }));
}

/** The snapshot of one month end (the hourly job: last month's, once, on or after the 1st). Never twice for a day. */
export async function saveStockSnapshot(asOf: string, by: string | null): Promise<{ saved: boolean; error?: string }> {
  if (!(await stockSnapshotsReady())) return { saved: false };
  const admin = createAdminClient();
  const { data: have } = await admin.from("stock_snapshots").select("id").eq("as_of", asOf).maybeSingle();
  if (have) return { saved: false };
  const s = await stockAsOfDay(asOf);
  const { error } = await admin.from("stock_snapshots").insert({ as_of: asOf, rows: s.rows, total_value: s.totalValue, item_count: s.rows.length, created_by: by, updated_by: by });
  if (error) {
    if (!/duplicate|unique/i.test(error.message)) await logAppError("stock-report.snapshot", error, { detail: { asOf } });
    return { saved: false, error: error.message };
  }
  return { saved: true };
}

/** The hourly job's step: last month's closing snapshot, when it is not saved yet. */
export async function monthEndStockSnapshot(nowMs = Date.now()): Promise<boolean> {
  const today = new Date(nowMs + 4 * 3600000).toISOString().slice(0, 10);
  return (await saveStockSnapshot(lastMonthEnd(today), null)).saved;
}

/** THE Excel sheets of the stock report (the page's export): the stock as of the day, and the movements of the period. */
export function stockReportSheets(day: string, stock: { rows: StockRow[]; totalQuantity: number; totalValue: number }, moves: MovementRow[]): import("./xlsx").XlsxSheet[] {
  return [
    {
      name: `Stock ${day}`,
      columns: [
        { header: "Item", key: "name", width: 34 },
        { header: "Part number", key: "pn", width: 18 },
        { header: "Kind", key: "kind", width: 12 },
        { header: "Quantity", key: "qty", width: 10, numFmt: "#,##0.00" },
        { header: "Unit", key: "unit", width: 8 },
        { header: "Cost each (AED)", key: "cost", width: 14, numFmt: "#,##0.00" },
        { header: "Value (AED)", key: "value", width: 14, numFmt: "#,##0.00" },
      ],
      rows: stock.rows.map((r) => ({ name: r.name, pn: r.partNumber ?? "", kind: r.itemType ?? "", qty: r.quantity, unit: r.unit ?? "", cost: r.unitCost, value: r.value })),
      totals: { name: `${stock.rows.length} items as of ${day}`, qty: stock.totalQuantity, value: stock.totalValue },
    },
    {
      name: "Movements",
      columns: [
        { header: "When", key: "at", width: 18 },
        { header: "Item", key: "item", width: 30 },
        { header: "Movement", key: "kind", width: 24 },
        { header: "Quantity", key: "qty", width: 10, numFmt: "#,##0.00" },
        { header: "Cost each (AED)", key: "cost", width: 14, numFmt: "#,##0.00" },
        { header: "Value (AED)", key: "value", width: 14, numFmt: "#,##0.00" },
        { header: "Job", key: "job", width: 12 },
        { header: "LPO", key: "lpo", width: 14 },
        { header: "Note", key: "note", width: 30 },
      ],
      rows: moves.map((m) => ({ at: new Date(Date.parse(m.at) + 4 * 3600000).toISOString().slice(0, 16).replace("T", " "), item: m.item, kind: m.kind, qty: m.quantity, cost: m.unitCost, value: m.value, job: m.job ?? "", lpo: m.lpo ?? "", note: m.note ?? "" })),
      totals: { at: `${moves.length} movements`, value: Math.round(moves.reduce((a, m) => a + m.value, 0) * 100) / 100 },
    },
  ];
}
