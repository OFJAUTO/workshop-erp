import "server-only";
import { createAdminClient } from "./supabase/admin";
import { GATE_IN_BUCKET } from "./media";
import type { GateInMediaRow } from "./types";

export type JobMediaSummary = {
  pictureUrl: string | null;
  thumbs: { id: string; url: string; label: string }[];
  videoCount: number;
  photoCount: number;
};

const LABEL: Record<string, string> = {
  dashboard_photo: "Dashboard",
  keys_photo_front: "Keys front",
  keys_photo_back: "Keys back",
  keys_photo: "Keys",
  damage_photo: "Damage",
  gate_out_photo: "Gate-out",
};

/** Car picture and photo thumbnails for a list of jobs, for the dashboard and job lists. */
export async function loadJobMediaSummaries(
  jobs: { id: string; photo_path: string | null }[],
): Promise<Map<string, JobMediaSummary>> {
  const out = new Map<string, JobMediaSummary>();
  if (jobs.length === 0) return out;
  const admin = createAdminClient();

  const picturePaths = jobs.map((j) => j.photo_path).filter((p): p is string => !!p);
  const { data: pictureSigned } = picturePaths.length
    ? await admin.storage.from("vehicle-photos").createSignedUrls(picturePaths, 3600)
    : { data: [] };
  const pictureUrl = new Map<string, string>();
  for (const s of pictureSigned ?? []) if (s.path && s.signedUrl) pictureUrl.set(s.path, s.signedUrl);

  const { data: media } = await admin
    .from("gate_in_media")
    .select("id, job_id, kind, storage_path, duration_s, caption, taken_at, uploaded_by")
    .in("job_id", jobs.map((j) => j.id))
    .order("taken_at", { ascending: true });
  const rows = (media ?? []) as GateInMediaRow[];
  const photoRows = rows.filter((m) => !m.kind.startsWith("video"));
  const { data: mediaSigned } = photoRows.length
    ? await admin.storage.from(GATE_IN_BUCKET).createSignedUrls(photoRows.map((m) => m.storage_path), 3600)
    : { data: [] };
  const mediaUrl = new Map<string, string>();
  for (const s of mediaSigned ?? []) if (s.path && s.signedUrl) mediaUrl.set(s.path, s.signedUrl);

  for (const j of jobs) {
    const mine = rows.filter((m) => m.job_id === j.id);
    out.set(j.id, {
      pictureUrl: j.photo_path ? (pictureUrl.get(j.photo_path) ?? null) : null,
      thumbs: mine
        .filter((m) => !m.kind.startsWith("video") && mediaUrl.has(m.storage_path))
        .map((m) => ({ id: m.id, url: mediaUrl.get(m.storage_path)!, label: LABEL[m.kind] ?? m.kind })),
      videoCount: mine.filter((m) => m.kind.startsWith("video")).length,
      photoCount: mine.filter((m) => !m.kind.startsWith("video")).length,
    });
  }
  return out;
}
