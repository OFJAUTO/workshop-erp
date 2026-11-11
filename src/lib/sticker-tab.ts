import "server-only";
import { dubaiDayStart } from "./part-labels";
import { vehicleOrFilter } from "./plate-search";
import { plateHistoryReady } from "./schema-ready";
import { createAdminClient } from "./supabase/admin";
import { formatPlate } from "./types";

/**
 * THE STICKERS TAB's reads (11 November 2026, Section 12): the received parts to label (a search, or today's
 * arrivals), and the history of every sticker made, with what a reprint opens. Read through the admin client: the
 * page itself is gated by `printStickers`, and nothing here carries a customer, a price or a cost.
 */
export type StickerPart = { id: string; name: string; qty: number; jobId: string | null; jobNumber: string; plate: string; car: string };
type Veh = Parameters<typeof formatPlate>[0] & { make: { name: string } | null; model: { name: string } | null };
type PartRow = { id: string; job_id: string | null; description: string; received_qty: number | null; quantity: number | null; confirmed_quantity: number | null };

async function partsOf(filter: { ids?: string[]; jobIds?: string[]; text?: string }): Promise<StickerPart[]> {
  const admin = createAdminClient();
  let q = admin.from("part_items").select("id, job_id, description, received_qty, quantity, confirmed_quantity").eq("is_active", true).gt("received_qty", 0).order("created_at", { ascending: false }).limit(200);
  if (filter.ids) {
    if (!filter.ids.length) return [];
    q = q.in("id", filter.ids.slice(0, 500));
  } else {
    const ors: string[] = [];
    if (filter.jobIds?.length) ors.push(`job_id.in.(${filter.jobIds.join(",")})`);
    if (filter.text) ors.push(`description.ilike.%${filter.text.replace(/[%,()]/g, " ")}%`);
    if (!ors.length) return [];
    q = q.or(ors.join(","));
  }
  const rows = ((await q).data ?? []) as PartRow[];
  const jobIds = Array.from(new Set(rows.map((r) => r.job_id).filter((x): x is string => !!x)));
  const { data: jobs } = jobIds.length
    ? await admin.from("jobs").select("id, job_number, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, variant, make:vehicle_makes(name), model:vehicle_models(name))").in("id", jobIds)
    : { data: [] };
  const jobOf = new Map(((jobs ?? []) as unknown as { id: string; job_number: string; vehicle: Veh | null }[]).map((j) => [j.id, j]));
  return rows.map((r) => {
    const j = r.job_id ? jobOf.get(r.job_id) : null;
    return {
      id: r.id,
      name: r.description,
      qty: Number(r.received_qty) || Number(r.confirmed_quantity ?? r.quantity) || 1,
      jobId: r.job_id,
      jobNumber: j?.job_number ?? "STOCK",
      plate: j?.vehicle ? formatPlate(j.vehicle) : "",
      car: j?.vehicle ? [j.vehicle.make?.name, j.vehicle.model?.name].filter(Boolean).join(" ") : "",
    };
  });
}

/** Today's arrivals: every part with an LPO line received since the Dubai day began. */
export async function todaysArrivals(): Promise<StickerPart[]> {
  const admin = createAdminClient();
  const { data } = await admin.from("purchase_order_lines").select("part_item_id").gte("received_at", dubaiDayStart()).not("part_item_id", "is", null);
  return partsOf({ ids: Array.from(new Set(((data ?? []) as { part_item_id: string }[]).map((l) => l.part_item_id))) });
}

/** A search: job number, plate, VIN or the part's name. */
export async function searchStickerParts(raw: string): Promise<StickerPart[]> {
  const q = raw.trim();
  if (!q) return [];
  const admin = createAdminClient();
  const [{ data: byJob }, { data: byCar }] = await Promise.all([
    admin.from("jobs").select("id").ilike("job_number", `%${q.replace(/[%,()]/g, "")}%`).limit(20),
    admin.from("vehicles").select("id").or(vehicleOrFilter(q, { oldPlates: await plateHistoryReady() })).limit(20),
  ]);
  const carIds = ((byCar ?? []) as { id: string }[]).map((v) => v.id);
  const { data: carJobs } = carIds.length ? await admin.from("jobs").select("id").in("vehicle_id", carIds).limit(60) : { data: [] };
  const jobIds = Array.from(new Set([...((byJob ?? []) as { id: string }[]), ...((carJobs ?? []) as { id: string }[])].map((j) => j.id)));
  return partsOf({ jobIds, text: q.length >= 3 ? q : undefined });
}

export type StickerHistoryRow = { code: string; kind: string; what: string; jobNumber: string | null; plate: string; by: string | null; at: string; reprint: string | null };
type LinkRow = { code: string; kind: string; job_id: string | null; vehicle_id: string | null; ref_id: string | null; created_at: string; created_by: string | null };
const none = Promise.resolve({ data: [] as unknown[] });

/** The stickers made, newest first, each with the page a reprint opens (null when it cannot be printed again here). */
export async function stickerHistory(limit = 80): Promise<StickerHistoryRow[]> {
  const admin = createAdminClient();
  const { data } = await admin.from("qr_links").select("code, kind, job_id, vehicle_id, ref_id, created_at, created_by").order("created_at", { ascending: false }).limit(limit);
  const links = (data ?? []) as LinkRow[];
  const refs = links.map((l) => l.ref_id).filter((x): x is string => !!x);
  const batteries = links.filter((l) => l.kind === "battery").map((l) => l.code);
  const jobIds = Array.from(new Set(links.map((l) => l.job_id).filter((x): x is string => !!x)));
  const staffIds = Array.from(new Set(links.map((l) => l.created_by).filter((x): x is string => !!x)));
  const [{ data: parts }, { data: items }, { data: events }, { data: bw }, { data: jobs }, { data: people }] = await Promise.all([
    refs.length ? admin.from("part_items").select("id, description").in("id", refs) : none,
    refs.length ? admin.from("job_items").select("id, description").in("id", refs) : none,
    jobIds.length ? admin.from("job_events").select("note, from_stage").in("job_id", jobIds).eq("event_type", "warranty_sticker") : none,
    batteries.length ? admin.from("battery_warranties").select("qr_code, handover_id, brand").in("qr_code", batteries) : none,
    jobIds.length ? admin.from("jobs").select("id, job_number, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, variant)").in("id", jobIds) : none,
    staffIds.length ? admin.from("staff").select("id, display_name").in("id", staffIds) : none,
  ]);
  const nameOf = new Map([...((parts ?? []) as { id: string; description: string }[]), ...((items ?? []) as { id: string; description: string }[])].map((p) => [p.id, p.description]));
  const eventOf = new Map(((events ?? []) as { note: string | null; from_stage: string | null }[]).map((e) => [new URLSearchParams(e.from_stage ?? "").get("ref") ?? "", e.note ?? ""]));
  const bwOf = new Map(((bw ?? []) as { qr_code: string; handover_id: string | null; brand: string | null }[]).map((b) => [b.qr_code, b]));
  const jobOf = new Map(((jobs ?? []) as unknown as { id: string; job_number: string; vehicle: Parameters<typeof formatPlate>[0] | null }[]).map((j) => [j.id, j]));
  const who = new Map(((people ?? []) as { id: string; display_name: string }[]).map((p) => [p.id, p.display_name]));
  const out: StickerHistoryRow[] = [];
  for (const l of links) {
    const job = l.job_id ? jobOf.get(l.job_id) : null;
    const base = { code: l.code, kind: l.kind, jobNumber: job?.job_number ?? null, plate: job?.vehicle ? formatPlate(job.vehicle) : "", by: l.created_by ? (who.get(l.created_by) ?? null) : null, at: l.created_at };
    if (l.kind === "part") out.push({ ...base, what: nameOf.get(l.ref_id ?? "") ?? "Part", reprint: l.ref_id ? `/api/pdf/part-labels?parts=${l.ref_id}` : null });
    else if (l.kind === "battery") {
      const b = bwOf.get(l.code);
      out.push({ ...base, what: `Battery warranty${b?.brand ? ` · ${b.brand}` : ""}`, reprint: b?.handover_id ? `/print/stickers/${b.handover_id}?reprint=1` : null });
    } else if (l.kind === "service") out.push({ ...base, what: "Oil service sticker", reprint: l.job_id ? `/print/service-sticker/${l.job_id}` : null });
    else if (l.kind === "item" && l.ref_id && eventOf.has(l.ref_id)) out.push({ ...base, kind: "warranty", what: eventOf.get(l.ref_id)!.replace(/^Warranty sticker printed: /, ""), reprint: l.job_id ? `/print/warranty-sticker/${l.job_id}?ref=${l.ref_id}` : null });
    else if (l.kind === "item" && l.ref_id) out.push({ ...base, what: nameOf.get(l.ref_id) ?? "Item tag", reprint: l.job_id ? `/print/item-tags/${l.job_id}` : null });
  }
  return out;
}

/** Open cars for a warranty sticker: the job picker on the Stickers tab (job number and plate only). */
export async function openCarsForStickers(raw: string): Promise<{ id: string; jobNumber: string; plate: string; car: string }[]> {
  const admin = createAdminClient();
  const q = raw.trim();
  let jq = admin.from("jobs").select("id, job_number, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, variant, make:vehicle_makes(name), model:vehicle_models(name))").order("gated_in_at", { ascending: false }).limit(30);
  if (q) {
    const { data: cars } = await admin.from("vehicles").select("id").or(vehicleOrFilter(q, { oldPlates: await plateHistoryReady() })).limit(20);
    const carIds = ((cars ?? []) as { id: string }[]).map((c) => c.id);
    jq = jq.or([`job_number.ilike.%${q.replace(/[%,()]/g, "")}%`, carIds.length ? `vehicle_id.in.(${carIds.join(",")})` : null].filter(Boolean).join(","));
  } else jq = jq.eq("is_open", true);
  const rows = ((await jq).data ?? []) as unknown as { id: string; job_number: string; vehicle: Veh | null }[];
  return rows.map((j) => ({ id: j.id, jobNumber: j.job_number, plate: j.vehicle ? formatPlate(j.vehicle) : "", car: j.vehicle ? [j.vehicle.make?.name, j.vehicle.model?.name].filter(Boolean).join(" ") : "" }));
}
