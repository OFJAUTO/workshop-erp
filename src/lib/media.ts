import "server-only";
import { randomBytes } from "node:crypto";
import { createAdminClient } from "./supabase/admin";
import type { GateInMediaRow, MediaKind } from "./types";

export const GATE_IN_BUCKET = "gate-in-media";

export const MEDIA_KIND_LABELS: Record<MediaKind, string> = {
  video: "Walk-around video",
  video_exterior: "Exterior video",
  video_interior: "Interior video",
  dashboard_photo: "Dashboard photo (mileage)",
  keys_photo: "Keys photo",
  keys_photo_front: "Keys, front",
  keys_photo_back: "Keys, back",
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

export type Checklist = {
  videoExterior: boolean;
  videoInterior: boolean;
  dashboard: boolean;
  keysFront: boolean;
  keysBack: boolean;
  damageCount: number;
  majorDamage: boolean;
  complete: boolean;
};

/** What is still missing. Both videos, the dashboard photo and both keys photos are always required; damage photos when major damage was ticked. */
export function mediaChecklist(media: GateInMediaRow[], majorDamage = false): Checklist {
  const has = (k: MediaKind) => media.some((m) => m.kind === k);
  const damageCount = media.filter((m) => m.kind === "damage_photo").length;
  const c = {
    videoExterior: has("video_exterior"),
    videoInterior: has("video_interior"),
    dashboard: has("dashboard_photo"),
    keysFront: has("keys_photo_front"),
    keysBack: has("keys_photo_back"),
    damageCount,
    majorDamage,
  };
  return { ...c, complete: c.videoExterior && c.videoInterior && c.dashboard && c.keysFront && c.keysBack && (!majorDamage || damageCount > 0) };
}

export async function loadMajorDamage(jobId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin.from("gate_ins").select("major_damage").eq("job_id", jobId).maybeSingle();
  return !!data?.major_damage;
}
