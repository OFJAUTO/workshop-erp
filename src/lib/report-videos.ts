import "server-only";
import { panelLabel } from "@/lib/car-outline";
import { MEASUREMENTS, TYRE_POSITIONS, itemStatusLabel } from "@/lib/inspection";
import { INSPECTION_BUCKET, type InspectionBundle, type InspectionMediaRow } from "@/lib/inspection-data";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The inspection's videos as the customer sees them (23 October 2026): one list, read by the report link (the
 * players), its fresh-address route and the report PDF (picture, play sign and "Watch video"), each video labelled
 * with the place it was taken ("Engine mounts – Bad", "Front left tyre", "Bonnet – body"), in report order.
 */

export type ReportVideo = { id: string; label: string; itemKey: string | null; storagePath: string; posterPath: string | null; duration_s: number | null };

/** "Engine mounts – Bad": the item with its answer, a tyre, a measurement or a body panel. */
export function videoLabel(bundle: Pick<InspectionBundle, "items">, itemKey: string | null): string {
  if (!itemKey) return "Inspection video";
  const item = bundle.items.find((i) => i.item_key === itemKey);
  if (item) {
    const answer = itemStatusLabel(item.status, item.style);
    return answer ? `${item.item_label} – ${answer}` : item.item_label;
  }
  const [kind, key] = [itemKey.slice(0, itemKey.indexOf(".")), itemKey.slice(itemKey.indexOf(".") + 1)];
  if (kind === "tyre") return `${TYRE_POSITIONS.find((p) => p.key === key)?.label ?? (key === "spare" ? "Spare" : key)} tyre`;
  if (kind === "measure") return MEASUREMENTS.find((m) => m.key === key)?.label ?? "Measurement";
  if (kind === "body") return `${panelLabel(key)} – body`;
  return "Inspection video";
}

/** Every video of the report, in report order (checklist items first, by their position, then the rest by time). */
export function reportVideos(bundle: Pick<InspectionBundle, "items" | "media">): ReportVideo[] {
  const position = new Map(bundle.items.map((i, n) => [i.item_key, n]));
  const videos = bundle.media.filter((m: InspectionMediaRow) => m.kind === "video");
  return videos
    .map((m, n) => ({ m, n, at: m.item_key && position.has(m.item_key) ? (position.get(m.item_key) as number) : 100000 + n }))
    .sort((a, b) => a.at - b.at)
    .map(({ m }) => ({ id: m.id, label: videoLabel(bundle, m.item_key), itemKey: m.item_key, storagePath: m.storage_path, posterPath: m.poster_path ?? null, duration_s: m.duration_s }));
}

/** Fresh addresses (an hour) for a report's videos and their pictures, by the report link's token. Null when the link is not valid. */
export async function reportVideosByToken(token: string): Promise<{ id: string; url: string | null; poster: string | null }[] | null> {
  const admin = createAdminClient();
  const { data: link } = await admin.from("report_links").select("inspection_id").eq("token", token).maybeSingle();
  if (!link?.inspection_id) return null;
  const { data: insp } = await admin.from("inspections").select("status").eq("id", link.inspection_id).maybeSingle();
  if (insp?.status !== "approved") return null;
  const { data } = await admin.from("inspection_media").select("id, storage_path, poster_path").eq("inspection_id", link.inspection_id).eq("kind", "video").is("removed_at", null);
  const rows = (data ?? []) as { id: string; storage_path: string; poster_path: string | null }[];
  if (!rows.length) return [];
  const paths = [...rows.map((r) => r.storage_path), ...rows.map((r) => r.poster_path).filter((p): p is string => !!p)];
  const { data: signed } = await admin.storage.from(INSPECTION_BUCKET).createSignedUrls(paths, 3600);
  const url = new Map((signed ?? []).filter((s) => s.path && s.signedUrl).map((s) => [s.path as string, s.signedUrl]));
  return rows.map((r) => ({ id: r.id, url: url.get(r.storage_path) ?? null, poster: r.poster_path ? (url.get(r.poster_path) ?? null) : null }));
}
