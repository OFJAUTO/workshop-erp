import "server-only";
import { randomBytes } from "node:crypto";
import { createAdminClient } from "./supabase/admin";
import type { GateInMediaRow, MediaKind } from "./types";
import { WHEEL_KINDS, WHEEL_LABELS, type WheelKind } from "./wheels";

export const GATE_IN_BUCKET = "gate-in-media";

export const MEDIA_KIND_LABELS: Record<MediaKind, string> = {
  car_picture: "Car picture",
  video: "Walk-around video",
  video_exterior: "Exterior video",
  video_interior: "Interior video",
  dashboard_photo: "Dashboard photo (mileage)",
  keys_photo: "Keys photo",
  keys_photo_front: "Keys, front",
  keys_photo_back: "Keys, back",
  damage_photo: "Damage close-up",
  gate_out_photo: "Gate-out photo",
  wheel_fl: "Front left wheel",
  wheel_fr: "Front right wheel",
  wheel_rl: "Rear left wheel",
  wheel_rr: "Rear right wheel",
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
    .select("id, job_id, kind, storage_path, duration_s, caption, wheel_condition, taken_at, uploaded_by")
    .eq("job_id", jobId)
    .order("taken_at", { ascending: true });
  return (data ?? []) as GateInMediaRow[];
}

export type WheelState = { kind: WheelKind; label: string; photo: boolean; conditions: string[]; done: boolean };

export type Checklist = {
  carPicture: boolean;
  videoExterior: boolean;
  videoInterior: boolean;
  dashboard: boolean;
  keysFront: boolean;
  keysBack: boolean;
  damageCount: number;
  majorDamage: boolean;
  wheelsRequired: boolean;
  wheels: WheelState[];
  damageNote: string;
  complete: boolean;
};

export type GateInFlags = { majorDamage: boolean; wheelsRequired: boolean; damageNote: string; hasCarPicture: boolean };

/** The newest photo of one wheel; a retaken wheel photo needs its condition chosen again. */
export function latestWheel(media: GateInMediaRow[], kind: WheelKind): GateInMediaRow | undefined {
  return media.filter((m) => m.kind === kind).sort((a, b) => (a.taken_at < b.taken_at ? 1 : -1))[0];
}

/**
 * What is still missing. Both videos, the dashboard photo and both keys photos are always required;
 * damage photos when major damage was ticked; four wheel photos with a condition each for jobs gated in
 * from 8 October 2026.
 */
export function mediaChecklist(media: GateInMediaRow[], flags: GateInFlags | boolean = false): Checklist {
  const f: GateInFlags = typeof flags === "boolean" ? { majorDamage: flags, wheelsRequired: false, damageNote: "", hasCarPicture: false } : flags;
  const has = (k: MediaKind) => media.some((m) => m.kind === k);
  const damageCount = media.filter((m) => m.kind === "damage_photo").length;
  // Jobs gated in before 7 October 2026 have a single walk-around video and one keys photo; those still count.
  const legacyVideo = has("video");
  const legacyKeys = has("keys_photo");
  const wheels: WheelState[] = WHEEL_KINDS.map((kind) => {
    const row = latestWheel(media, kind);
    const conditions = row?.wheel_condition ?? [];
    return { kind, label: WHEEL_LABELS[kind], photo: !!row, conditions, done: !!row && conditions.length > 0 };
  });
  const c = {
    // The car's picture for our dashboard: a returning car already has one.
    carPicture: has("car_picture") || f.hasCarPicture,
    videoExterior: has("video_exterior") || legacyVideo,
    videoInterior: has("video_interior") || legacyVideo,
    dashboard: has("dashboard_photo"),
    keysFront: has("keys_photo_front") || legacyKeys,
    keysBack: has("keys_photo_back") || legacyKeys,
    damageCount,
    majorDamage: f.majorDamage,
    wheelsRequired: f.wheelsRequired,
    wheels,
    damageNote: f.damageNote,
  };
  return {
    ...c,
    complete:
      c.carPicture &&
      c.videoExterior &&
      c.videoInterior &&
      c.dashboard &&
      c.keysFront &&
      c.keysBack &&
      (!f.majorDamage || damageCount > 0) &&
      (!f.wheelsRequired || wheels.every((w) => w.done)),
  };
}

export async function loadGateInFlags(jobId: string): Promise<GateInFlags> {
  const admin = createAdminClient();
  const [{ data }, { data: job }] = await Promise.all([
    admin.from("gate_ins").select("major_damage, wheels_required, damage_note").eq("job_id", jobId).maybeSingle(),
    admin.from("jobs").select("vehicle:vehicles(photo_path)").eq("id", jobId).maybeSingle(),
  ]);
  const photo = (job?.vehicle as unknown as { photo_path: string | null } | null)?.photo_path ?? null;
  return { majorDamage: !!data?.major_damage, wheelsRequired: data?.wheels_required ?? false, damageNote: data?.damage_note ?? "", hasCarPicture: !!photo };
}
