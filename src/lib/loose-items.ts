import "server-only";
import type { Stage } from "./jobs";
import { createAdminClient } from "./supabase/admin";

/** Items that arrive without a car: a set of wheels, an engine on a pallet, a bumper for paint. */
export const ITEM_TYPES = ["Wheel", "Tyre", "Engine", "Gearbox", "Bumper", "Bonnet", "Door", "Seat", "Headlight", "Part"] as const;

export type JobItemRow = {
  id: string;
  job_id: string;
  position: number;
  item_type: string;
  description: string | null;
  quantity: number;
  notes: string | null;
  damage_note: string | null;
  qr_code: string | null;
  collected_at: string | null;
  collected_by: string | null;
  collector_name: string | null;
  is_active: boolean;
  created_at: string;
};

export const JOB_ITEM_SELECT = "id, job_id, position, item_type, description, quantity, notes, damage_note, qr_code, collected_at, collected_by, collector_name, is_active, created_at";

/** The steps a loose item never goes through: there is no inspection report and no wash. */
export const LOOSE_SKIP_STAGES: Stage[] = ["inspection", "wash"];

export const LOOSE_MAKE_NAME = "Loose items";

export async function loadJobItems(jobId: string): Promise<JobItemRow[]> {
  const { data } = await createAdminClient().from("job_items").select(JOB_ITEM_SELECT).eq("job_id", jobId).eq("is_active", true).order("position");
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({ ...r, quantity: Number(r.quantity) || 1 })) as JobItemRow[];
}

/** "4 wheels, 1 bumper": the short line that stands in for the plate on lists and documents. */
export function itemSummary(items: { item_type: string; quantity: number }[]): string {
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i.item_type, (counts.get(i.item_type) ?? 0) + (Number(i.quantity) || 1));
  const parts = Array.from(counts.entries()).map(([t, n]) => `${n} ${plural(t, n)}`);
  return parts.join(", ").slice(0, 80) || "Loose items";
}

function plural(word: string, n: number) {
  if (n === 1) return word.toLowerCase();
  const w = word.toLowerCase();
  if (w.endsWith("y") && !/[aeiou]y$/.test(w)) return w.slice(0, -1) + "ies";
  if (w.endsWith("s") || w.endsWith("x") || w.endsWith("ch") || w.endsWith("sh")) return w + "es";
  return w + "s";
}

/** The one vehicle make every loose-item "car" hangs on, so the rest of the system keeps working. */
export async function ensureLooseMake(): Promise<string> {
  const admin = createAdminClient();
  const { data: existing } = await admin.from("vehicle_makes").select("id").ilike("name", LOOSE_MAKE_NAME).limit(1).maybeSingle();
  if (existing) return existing.id;
  const { data } = await admin.from("vehicle_makes").insert({ name: LOOSE_MAKE_NAME, needs_review: false }).select("id").single();
  return data!.id;
}

/** "3 of 4 items collected", or null when nothing has been collected yet. */
export function collectionLine(items: JobItemRow[]): string | null {
  const done = items.filter((i) => i.collected_at).length;
  if (!done) return null;
  return done === items.length ? "All items collected" : `${done} of ${items.length} items collected`;
}
