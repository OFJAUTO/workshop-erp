import "server-only";
import { formatDate } from "./format";
import { qtyWithUnit } from "./part-units";
import { stickerPosition } from "./parts-list";
import { partUnitsReady } from "./schema-ready";
import { ensureQrLink, qrUrl } from "./stickers";
import { createAdminClient } from "./supabase/admin";
import { formatPlate } from "./types";

/**
 * THE part label (6 November 2026, Section 8): what a 50 × 25 mm QR label carries, built once for the PDF and the print
 * points. A QR that opens the part (its trail for staff), the part name with its side, the job number and the plate (or
 * STOCK for a stock order), the make and model, the LPO number and the day it was received. Never a price or a customer.
 * One label per piece ("1 OF 2"); a fluid in litres is one label with its litres. `keys` ("<partId>-<n>") prints fewer.
 */
export type PartLabel = { key: string; qr: string; jobNumber: string; plate: string; car: string; name: string; side: string | null; lpo: string | null; received: string | null; index: number; count: number };

type PartRow = { id: string; job_id: string | null; description: string; positions: string[] | null; quantity: number | string; confirmed_quantity: number | string | null; received_qty: number | string; po_id: string | null; po_line_id: string | null; unit?: string | null };
type VehicleRow = { kind?: string | null; has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; variant?: string | null; make: { name: string } | null; model: { name: string } | null };

/** The start of today in Dubai, as a moment (the "today's deliveries" labels). */
export function dubaiDayStart(now = new Date()): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(now);
  return new Date(`${day}T00:00:00+04:00`).toISOString();
}

export async function partLabelsFor(opts: { jobId?: string | null; partIds?: string[]; poId?: string | null; keys?: string[]; today?: boolean }, staffId: string | null): Promise<PartLabel[]> {
  const admin = createAdminClient();
  const unitsReady = await partUnitsReady();
  const select = "id, job_id, description, positions, quantity, confirmed_quantity, received_qty, po_id, po_line_id" + (unitsReady ? ", unit" : "");
  // The day a part arrived is on its LPO line (the part keeps only how many arrived).
  let todayIds: string[] | null = null;
  if (opts.today) {
    const { data: lines } = await admin.from("purchase_order_lines").select("part_item_id").gte("received_at", dubaiDayStart()).not("part_item_id", "is", null);
    todayIds = Array.from(new Set(((lines ?? []) as { part_item_id: string }[]).map((l) => l.part_item_id)));
    if (!todayIds.length) return [];
  }
  let q = admin.from("part_items").select(select).eq("is_active", true).gt("received_qty", 0).order("created_at");
  if (opts.jobId) q = q.eq("job_id", opts.jobId);
  if (opts.poId) q = q.eq("po_id", opts.poId);
  if (opts.partIds?.length) q = q.in("id", opts.partIds);
  if (todayIds) q = q.in("id", todayIds);
  if (!opts.jobId && !opts.poId && !opts.partIds?.length && !opts.today) return [];
  const parts = ((await q).data ?? []) as unknown as PartRow[];
  const out: PartLabel[] = [];
  const jobIds = Array.from(new Set(parts.map((p) => p.job_id).filter((x): x is string => !!x)));
  const poIds = Array.from(new Set(parts.map((p) => p.po_id).filter((x): x is string => !!x)));
  const lineIds = Array.from(new Set(parts.map((p) => p.po_line_id).filter((x): x is string => !!x)));
  const [{ data: jobs }, { data: pos }, { data: lineRows }] = await Promise.all([
    jobIds.length ? admin.from("jobs").select("id, job_number, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, variant, make:vehicle_makes(name), model:vehicle_models(name))").in("id", jobIds) : Promise.resolve({ data: [] }),
    poIds.length ? admin.from("purchase_orders").select("id, number").in("id", poIds) : Promise.resolve({ data: [] }),
    lineIds.length ? admin.from("purchase_order_lines").select("id, received_at").in("id", lineIds) : Promise.resolve({ data: [] }),
  ]);
  const receivedOf = new Map(((lineRows ?? []) as { id: string; received_at: string | null }[]).map((l) => [l.id, l.received_at]));
  const jobOf = new Map(((jobs ?? []) as unknown as { id: string; job_number: string; vehicle: VehicleRow | null }[]).map((j) => [j.id, j]));
  const lpoOf = new Map(((pos ?? []) as { id: string; number: string }[]).map((p) => [p.id, p.number]));
  const wanted = opts.keys?.length ? new Set(opts.keys) : null;
  for (const p of parts) {
    const job = p.job_id ? jobOf.get(p.job_id) : null;
    const v = job?.vehicle ?? null;
    const code = await ensureQrLink("part", { jobId: p.job_id, refId: p.id }, staffId);
    const base = {
      qr: qrUrl(code),
      jobNumber: job?.job_number ?? "STOCK",
      plate: v ? formatPlate(v) : job ? "" : "STOCK",
      car: v ? [v.make?.name, v.model?.name].filter(Boolean).join(" ") : "",
      lpo: p.po_id ? (lpoOf.get(p.po_id) ?? null) : null,
      received: p.po_line_id && receivedOf.get(p.po_line_id) ? formatDate(receivedOf.get(p.po_line_id)!) : null,
    };
    const qty = Number(p.received_qty) || Number(p.confirmed_quantity ?? p.quantity) || 1;
    if (p.unit === "l") {
      const key = `${p.id}-1`;
      if (!wanted || wanted.has(key)) out.push({ key, ...base, name: `${p.description} · ${qtyWithUnit(qty, "l")}`, side: stickerPosition(p.positions, 1, 1), index: 1, count: 1 });
      continue;
    }
    const count = Math.max(1, Math.round(qty));
    for (let n = 1; n <= count; n++) {
      const key = `${p.id}-${n}`;
      if (wanted && !wanted.has(key)) continue;
      out.push({ key, ...base, name: p.description, side: stickerPosition(p.positions, n, count), index: n, count });
    }
  }
  return out;
}

/** One sample label (the test print): every field filled, with a border to check the label sits square on the roll. */
export function sampleLabel(): PartLabel {
  return { key: "test-1", qr: qrUrl("TESTCODE"), jobNumber: "J-00000", plate: "DUBAI A 12345", car: "MERCEDES-BENZ S 580", name: "FRONT BRAKE PADS SET", side: "FRONT LEFT", lpo: "LPO-00000-1", received: formatDate(new Date().toISOString()), index: 1, count: 2 };
}
