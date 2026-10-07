import "server-only";
import { randomBytes } from "node:crypto";
import { createAdminClient } from "./supabase/admin";
import type { GateInMediaRow, MediaKind } from "./types";

export const GATE_IN_BUCKET = "gate-in-media";

export const MEDIA_KIND_LABELS: Record<MediaKind, string> = {
  video: "Walk-around video",
  dashboard_photo: "Dashboard photo (mileage)",
  keys_photo: "Keys photo",
  damage_photo: "Damage close-up",
  gate_out_photo: "Gate-out photo",
};

export function newToken() {
  return randomBytes(24).toString("base64url");
}

/** Signed, time-limited links for a set of stored files. Uses the master key so public pages can show them too. */
export async function signMedia(rows: GateInMediaRow[], seconds = 3600): Promise<Map<string, string>> {
  if (rows.length === 0) return new Map();
  const admin = createAdminClient();
  const { data } = await admin.storage.from(GATE_IN_BUCKET).createSignedUrls(
    rows.map((r) => r.storage_path),
    seconds,
  );
  const pairs: [string, string][] = [];
  for (const s of data ?? []) if (s.path && s.signedUrl) pairs.push([s.path, s.signedUrl]);
  return new Map(pairs);
}

export async function loadMedia(jobId: string): Promise<GateInMediaRow[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("gate_in_media")
    .select("id, job_id, kind, storage_path, duration_s, caption, taken_at, uploaded_by")
    .eq("job_id", jobId)
    .order("taken_at", { ascending: true });
  return (data ?? []) as GateInMediaRow[];
}

export function mediaChecklist(media: GateInMediaRow[]) {
  const has = (k: MediaKind) => media.some((m) => m.kind === k);
  return {
    video: has("video"),
    dashboard: has("dashboard_photo"),
    keys: has("keys_photo"),
    complete: has("video") && has("dashboard_photo") && has("keys_photo"),
  };
}
