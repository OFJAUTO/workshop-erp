import "server-only";
import { createAdminClient } from "./supabase/admin";
import { ensureQrLink } from "./stickers";
import type { StickerPlan } from "./handover";

/**
 * THE labels of one handover (13 November 2026, Section 10), shared by the print page and its PDF: the list saved on
 * the handover, or - for the handovers saved with an empty list between 18 October and 13 November - rebuilt from the
 * battery warranties that handover started. Every entry carries its QR code (made once, the warranty's own).
 */
export async function handoverLabelPlan(handoverId: string, jobId: string, saved: StickerPlan | null | undefined, by: string | null): Promise<[string, StickerPlan[string]][]> {
  let plan = Object.entries(saved ?? {});
  if (!plan.length) {
    const { data: bw } = await createAdminClient().from("battery_warranties").select("part_item_id, brand, model, serial_number").eq("handover_id", handoverId).eq("is_active", true);
    plan = ((bw ?? []) as { part_item_id: string; brand: string | null; model: string | null; serial_number: string | null }[]).map((b) => [b.part_item_id, { count: 1, code: "", kind: "battery" as const, brand: b.brand, model: b.model, serial: b.serial_number }]);
  }
  const out: [string, StickerPlan[string]][] = [];
  for (const [partId, s] of plan) out.push([partId, { ...s, code: s.code || (await ensureQrLink(s.kind === "battery" ? "battery" : "part", { jobId, vehicleId: null, refId: partId }, by)) }]);
  return out;
}
