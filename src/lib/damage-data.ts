import "server-only";
import { buildCarDamage, cleanDamageAfter, type CarDamage } from "./damage";
import { CAR_PANELS, cleanPanelMarks } from "./car-outline";
import { GATE_IN_BUCKET } from "./media";
import { thumbsFor } from "./media-urls";
import { schemaReady } from "./schema-ready";
import { createAdminClient } from "./supabase/admin";

/** Section 4.5/4.6 (damage found after check-in, the approval snapshot): migration 20261201120000_damage_at_check_in. */
export const damageAfterReady = () => schemaReady("gate_ins", "damage_after");
export const damageSnapshotReady = () => schemaReady("approval_requests", "damage_snapshot");

type MediaRow = { id: string; kind: string; storage_path: string; caption: string | null; taken_at: string | null; removed_at?: string | null };

/**
 * THE damage model of one car's visit (src/lib/damage.ts), read with the master key: the screens that show it decide who
 * may see it (the customer's own link, staff on the job). Pass the media and addresses a page already has, or they are read here.
 */
export async function loadCarDamage(jobId: string, have?: { media?: MediaRow[]; urls?: Map<string, string> }): Promise<CarDamage & { marks: unknown }> {
  const admin = createAdminClient();
  const after = await damageAfterReady();
  const { data: gi } = await admin.from("gate_ins").select(after ? "damage_panels, damage_note, damage_after" : "damage_panels, damage_note").eq("job_id", jobId).maybeSingle();
  const row = (gi ?? {}) as { damage_panels?: unknown; damage_note?: string | null; damage_after?: unknown };
  let media = have?.media?.filter((m) => m.kind === "damage_photo");
  if (!media) {
    const { data } = await admin.from("gate_in_media").select("id, kind, storage_path, caption, taken_at, removed_at").eq("job_id", jobId).eq("kind", "damage_photo").is("removed_at", null);
    media = (data ?? []) as MediaRow[];
  }
  const paths = media.map((m) => m.storage_path);
  let urls: Map<string, string> = have?.urls ?? new Map();
  if (paths.some((p) => !urls.has(p))) {
    const { data: signed } = paths.length ? await admin.storage.from(GATE_IN_BUCKET).createSignedUrls(paths, 3600) : { data: [] };
    urls = new Map((signed ?? []).filter((s) => s.path && s.signedUrl).map((s) => [s.path as string, s.signedUrl as string]));
  }
  const thumbs = await thumbsFor(GATE_IN_BUCKET, paths);
  return { ...buildCarDamage({ marks: row.damage_panels, after: row.damage_after, note: row.damage_note ?? null, media, urls, thumbs }), marks: row.damage_panels ?? {} };
}

/** The panels marked damaged on a job, in outline order: the gate-in marks, what was found after, and the bodyshop findings (section 7.4). */
export async function damagedPanelsOf(jobId: string | null | undefined): Promise<string[]> {
  if (!jobId) return [];
  const admin = createAdminClient();
  const after = await damageAfterReady();
  const [{ data: gi }, { data: findings }] = await Promise.all([
    admin.from("gate_ins").select(after ? "damage_panels, damage_after" : "damage_panels").eq("job_id", jobId).maybeSingle(),
    admin.from("bodyshop_findings").select("panel").eq("job_id", jobId).eq("is_active", true),
  ]);
  const row = (gi ?? {}) as { damage_panels?: unknown; damage_after?: unknown };
  const keys = new Set<string>([
    ...Object.keys(cleanPanelMarks(row.damage_panels)),
    ...cleanDamageAfter(row.damage_after).map((a) => a.panel),
    ...((findings ?? []) as { panel: string }[]).map((f) => f.panel),
  ]);
  return CAR_PANELS.map((p) => p.key).filter((k) => keys.has(k));
}
