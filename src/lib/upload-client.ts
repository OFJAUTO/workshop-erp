/** Browser-side upload steps shared by the photo and video capture components. */

export type UploadKind =
  | "video"
  | "video_exterior"
  | "video_interior"
  | "dashboard_photo"
  | "keys_photo"
  | "keys_photo_front"
  | "keys_photo_back"
  | "damage_photo"
  | "gate_out_photo"
  | "wheel_fl"
  | "wheel_fr"
  | "wheel_rl"
  | "wheel_rr"
  | "car_picture";

export async function prepareUpload(jobId: string, kind: UploadKind, contentType: string, token?: string) {
  const res = await fetch("/api/media/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, kind, contentType, token }),
  });
  const data = (await res.json()) as { path?: string; url?: string; error?: string };
  if (!res.ok || !data.path || !data.url) throw new Error(data.error ?? "Could not prepare the upload.");
  return { path: data.path, url: data.url };
}

/** Sends the file and reports progress from 0 to 1. */
export function putWithProgress(url: string, file: Blob, contentType: string, onProgress: (p: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.setRequestHeader("x-upsert", "false");
    const apikey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (apikey) xhr.setRequestHeader("apikey", apikey);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status}).`)));
    xhr.onerror = () => reject(new Error("Upload failed. Check the connection."));
    xhr.send(file);
  });
}

export async function registerMedia(
  jobId: string,
  kind: UploadKind,
  path: string,
  extra: { duration?: number; caption?: string; token?: string } = {},
) {
  const res = await fetch("/api/media/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, kind, path, ...extra }),
  });
  const data = (await res.json()) as { ok?: boolean; error?: string; checklist?: Record<string, boolean> };
  if (!res.ok || !data.ok) throw new Error(data.error ?? "Could not record the file.");
  return data.checklist ?? {};
}

export async function uploadFile(
  jobId: string,
  kind: UploadKind,
  file: Blob,
  contentType: string,
  onProgress: (p: number) => void,
  extra: { duration?: number; caption?: string; token?: string } = {},
) {
  const { path, url } = await prepareUpload(jobId, kind, contentType, extra.token);
  await putWithProgress(url, file, contentType, onProgress);
  return registerMedia(jobId, kind, path, extra);
}

/** Records the wheel condition under a wheel photo, or the damage note. Works with a login or a phone upload link. */
export async function saveMediaDetails(
  jobId: string,
  details: { wheel?: { kind: UploadKind; conditions: string[] }; damageNote?: string },
  token?: string,
) {
  const res = await fetch("/api/media/details", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, token, ...details }),
  });
  const data = (await res.json()) as { ok?: boolean; error?: string };
  if (!res.ok || !data.ok) throw new Error(data.error ?? "Could not save.");
}
