import "server-only";
import { cleanUnit, lastQuantity, qtyMemoryWords, type QtyMemory, type QtyMemoryRow } from "./part-units";
import { partUnitsReady } from "./schema-ready";
import { createAdminClient } from "./supabase/admin";
import { chunks, pageAll, pageAllIn } from "./page-all";

/**
 * 9.3 (3 November 2026): the quantity used last time for the same part on the same model - a job's priced parts and an
 * estimate's priced part lines (so E-00058's 7 L counts for the next Cullinan) - else on the same make, naming that
 * model. Read once per page for every row (two narrow reads), never per row. Offered as a one-tap chip on the row;
 * never filled in by itself.
 */
export type QtySuggestion = QtyMemory & { words: string };

type Car = { id: string; make_id: string | null; model_id: string | null; model_year: number | null; make: { name: string } | null; model: { name: string } | null };

export async function lastQuantitiesFor(vehicleId: string | null, wants: { key: string; name: string; catalogueId?: string | null }[], excludeRefs: string[] = []): Promise<Record<string, QtySuggestion>> {
  const out: Record<string, QtySuggestion> = {};
  if (!vehicleId || !wants.length) return out;
  const admin = createAdminClient();
  const { data: me } = await admin.from("vehicles").select("id, make_id, model_id").eq("id", vehicleId).maybeSingle();
  if (!me?.make_id) return out;
  // Every car of the same make (the same model is picked first from these), page by page.
  const carRows = await pageAll<Car>((from, to) => admin.from("vehicles").select("id, make_id, model_id, model_year, make:vehicle_makes(name), model:vehicle_models(name)").eq("make_id", me.make_id).order("id").range(from, to) as unknown as PromiseLike<{ data: Car[] | null; error: { message: string } | null }>).catch(() => [] as Car[]);
  const cars = new Map(carRows.map((c) => [c.id, c]));
  const carIds = Array.from(cars.keys());
  if (!carIds.length) return out;
  const carWords = (c: Car | undefined) => [c?.make?.name, c?.model?.name, c?.model_year].filter(Boolean).join(" ");
  const unitsReady = await partUnitsReady();
  const rows: QtyMemoryRow[] = [];
  // Review of 3 November 2026: every id list goes in short pieces (an address of 1,000 car ids failed silently, so the
  // chip vanished for the busiest makes), and each piece keeps only its newest; the newest 300 overall are used.
  const newest = <T extends { created_at: string }>(list: T[], n: number) => [...list].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0)).slice(0, n);
  // 1. Jobs' priced parts (the newest 300 jobs of the make).
  type JobRow = { id: string; job_number: string; vehicle_id: string; created_at: string };
  const jobPieces = await Promise.all(chunks(carIds).map(async (piece) => ((await admin.from("jobs").select("id, job_number, vehicle_id, created_at").in("vehicle_id", piece).order("created_at", { ascending: false }).limit(300)).data ?? []) as JobRow[]));
  const jobOf = new Map(newest(jobPieces.flat(), 300).map((j) => [j.id, j]));
  if (jobOf.size) {
    type PartRow = { job_id: string; description: string; quantity: number | string; confirmed_quantity: number | string | null; priced_at: string | null; created_at: string; part_request_id: string | null; unit?: string | null };
    const parts = await pageAllIn<PartRow>(Array.from(jobOf.keys()), (piece, from, to) => admin.from("part_items").select(`job_id, description, quantity, confirmed_quantity, priced_at, created_at, part_request_id, cost_aed, confirm_status, is_active${unitsReady ? ", unit" : ""}`).in("job_id", piece).eq("is_active", true).not("cost_aed", "is", null).neq("confirm_status", "rejected").order("created_at").range(from, to) as unknown as PromiseLike<{ data: PartRow[] | null; error: { message: string } | null }>).catch(() => [] as PartRow[]);
    const reqIds = Array.from(new Set(parts.map((p) => p.part_request_id).filter((x): x is string => !!x)));
    const reqs = await pageAllIn<{ id: string; catalogue_id: string | null }>(reqIds, (piece, from, to) => admin.from("part_requests").select("id, catalogue_id").in("id", piece).order("id").range(from, to)).catch(() => [] as { id: string; catalogue_id: string | null }[]);
    const catOf = new Map(reqs.map((r) => [r.id, r.catalogue_id ?? null]));
    for (const p of parts) {
      const j = jobOf.get(p.job_id);
      const c = j ? cars.get(j.vehicle_id) : undefined;
      if (!j || !c) continue;
      rows.push({ name: p.description, catalogueId: p.part_request_id ? (catOf.get(p.part_request_id) ?? null) : null, qty: Number(p.confirmed_quantity ?? p.quantity) || 0, unit: cleanUnit(p.unit) ?? "pc", ref: j.job_number, at: p.priced_at ?? p.created_at, makeId: c.make_id, modelId: c.model_id, car: carWords(c) });
    }
  }
  // 2. Estimates' priced part lines (the car may never have come in).
  type EstRow = { id: string; number: string; vehicle_id: string; created_at: string };
  const estPieces = await Promise.all(chunks(carIds).map(async (piece) => ((await admin.from("quotations").select("id, number, vehicle_id, created_at").eq("kind", "estimate").eq("is_active", true).in("vehicle_id", piece).not("status", "in", "(superseded,cancelled)").order("created_at", { ascending: false }).limit(300)).data ?? []) as EstRow[]));
  const estOf = new Map(newest(estPieces.flat(), 300).map((q) => [q.id, q]));
  if (estOf.size) {
    type LineRow = { quotation_id: string; title: string; quantity: number | string; priced_at: string | null; created_at: string; unit?: string | null };
    const lines = await pageAllIn<LineRow>(Array.from(estOf.keys()), (piece, from, to) => admin.from("quotation_lines").select(`quotation_id, title, quantity, priced_at, created_at${unitsReady ? ", unit" : ""}`).in("quotation_id", piece).eq("line_type", "part").is("part_item_id", null).eq("is_active", true).not("unit_cost", "is", null).order("created_at").range(from, to) as unknown as PromiseLike<{ data: LineRow[] | null; error: { message: string } | null }>).catch(() => [] as LineRow[]);
    for (const l of lines) {
      const q = estOf.get(l.quotation_id);
      const c = q ? cars.get(q.vehicle_id) : undefined;
      if (!q || !c) continue;
      rows.push({ name: l.title, catalogueId: null, qty: Number(l.quantity) || 0, unit: cleanUnit(l.unit) ?? "pc", ref: q.number, at: l.priced_at ?? l.created_at, makeId: c.make_id, modelId: c.model_id, car: carWords(c) });
    }
  }
  for (const w of wants) {
    const m = lastQuantity(rows, { name: w.name, catalogueId: w.catalogueId }, { makeId: me.make_id as string, modelId: (me.model_id as string | null) ?? null }, excludeRefs);
    if (m) out[w.key] = { ...m, words: qtyMemoryWords(m) };
  }
  return out;
}
