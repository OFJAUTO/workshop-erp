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

/** Seconds without any progress before an upload is given up and offered again with Retry. */
const STALL_SECONDS = 90;

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

/**
 * Sends the file and reports progress from 0 to 1. An upload that makes no progress for a minute and a half
 * (phone asleep, signal gone) is given up with a clear error instead of hanging for ever.
 */
export function putWithProgress(url: string, file: Blob, contentType: string, onProgress: (p: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let stall: ReturnType<typeof setTimeout> | null = null;
    const armStall = () => {
      if (stall) clearTimeout(stall);
      stall = setTimeout(() => {
        xhr.abort();
        reject(new Error("The upload stopped (no connection, or the phone went to sleep). Tap Retry."));
      }, STALL_SECONDS * 1000);
    };
    const done = () => { if (stall) clearTimeout(stall); };
    xhr.open("PUT", url, true);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.setRequestHeader("x-upsert", "false");
    const apikey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (apikey) xhr.setRequestHeader("apikey", apikey);
    xhr.upload.onprogress = (e) => {
      armStall();
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => { done(); if (xhr.status >= 200 && xhr.status < 300) resolve(); else reject(new Error(`Upload failed (${xhr.status}).`)); };
    xhr.onerror = () => { done(); reject(new Error("Upload failed. Check the connection.")); };
    xhr.onabort = () => { done(); };
    armStall();
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
  const data = (await res.json()) as { ok?: boolean; error?: string; checklist?: Record<string, unknown> };
  if (!res.ok || !data.ok) throw new Error(data.error ?? "Could not record the file.");
  // The server's own checklist, computed from the recorded files: the one truth every tick follows.
  return data.checklist ?? {};
}

export type UploadStep = "prepare" | "upload" | "register" | "camera" | "decode";

/**
 * Writes a failed upload to the server's log (device, person, step, error, browser), so the cause can be found
 * afterwards. Never throws and never blocks the Retry button.
 */
export function reportUploadFailure(info: { jobId?: string | null; inspectionId?: string | null; kind: string; step: UploadStep; error: unknown; token?: string; sizeBytes?: number | null; contentType?: string | null; extra?: Record<string, unknown> }) {
  const message = info.error instanceof Error ? info.error.message : String(info.error ?? "Unknown error");
  const payload = { jobId: info.jobId ?? null, inspectionId: info.inspectionId ?? null, kind: info.kind, step: info.step, error: message.slice(0, 500), token: info.token ?? null, sizeBytes: info.sizeBytes ?? null, contentType: info.contentType ?? null, extra: { ...(info.extra ?? {}), online: typeof navigator !== "undefined" ? navigator.onLine : null, visible: typeof document !== "undefined" ? document.visibilityState : null } };
  try {
    const body = JSON.stringify(payload);
    if (typeof navigator !== "undefined" && "sendBeacon" in navigator) {
      navigator.sendBeacon("/api/media/failure", new Blob([body], { type: "application/json" }));
      return;
    }
    void fetch("/api/media/failure", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => undefined);
  } catch {
    // Nothing to do: the log is best effort.
  }
}

/** Prepare, send, record. A failure at any step is logged with the step it failed at, then thrown for the Retry button. */
export async function uploadFile(
  jobId: string,
  kind: UploadKind,
  file: Blob,
  contentType: string,
  onProgress: (p: number) => void,
  extra: { duration?: number; caption?: string; token?: string } = {},
) {
  let step: UploadStep = "prepare";
  try {
    const { path, url } = await prepareUpload(jobId, kind, contentType, extra.token);
    step = "upload";
    await putWithProgress(url, file, contentType, onProgress);
    step = "register";
    return await registerMedia(jobId, kind, path, extra);
  } catch (err) {
    reportUploadFailure({ jobId, kind, step, error: err, token: extra.token, sizeBytes: file.size, contentType });
    throw err;
  }
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
