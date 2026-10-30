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
 * Sends the file straight to storage and reports progress from 0 to 1 (30 October 2026, batch 2 section 5.2): a file
 * of one 6 MB piece or less goes in one PUT; anything bigger - every video - goes in resumable 6 MB pieces, so a
 * dropped signal costs one piece, never the whole file. ONE door for every upload screen.
 */
export function putWithProgress(url: string, file: Blob, contentType: string, onProgress: (p: number) => void): Promise<void> {
  // Resumable sends are switched on by NEXT_PUBLIC_RESUMABLE_UPLOADS=1 once proven on the test database (30 October 2026);
  // until then every file goes in one PUT, as before.
  const resumable = process.env.NEXT_PUBLIC_RESUMABLE_UPLOADS === "1";
  return resumable && file.size > TUS_CHUNK && signedParts(url) && tusEndpoint() ? resumableUpload(url, file, contentType, onProgress) : putSingle(url, file, contentType, onProgress);
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Resumable sends: Supabase's resumable endpoint (TUS) with the same one-time upload address - its token goes in */
/* the x-signature header. A piece that fails is sent again from where storage says it stopped (HEAD), and the     */
/* place reached is remembered in the browser, so a later try of the same address carries on from there.         */
/* ------------------------------------------------------------------------------------------------------------ */
export const TUS_CHUNK = 6 * 1024 * 1024;

/** The bucket, the object and the token of a one-time upload address (createSignedUploadUrl). */
export function signedParts(url: string): { bucket: string; object: string; token: string } | null {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/storage\/v1\/object\/upload\/sign\/([^/]+)\/(.+)$/);
    const token = u.searchParams.get("token");
    return m && token ? { bucket: decodeURIComponent(m[1]), object: decodeURIComponent(m[2]), token } : null;
  } catch {
    return null;
  }
}

/** The project's direct storage address for resumable sends (recommended by Supabase for large files). */
function tusEndpoint(): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `https://${new URL(base).hostname.split(".")[0]}.storage.supabase.co/storage/v1/upload/resumable`;
}

const b64 = (v: string) => btoa(unescape(encodeURIComponent(v)));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One request with the stall detector; progress of the body as 0..1. */
function xhrRequest(method: string, url: string, headers: Record<string, string>, body: Blob | null, onProgress?: (p: number) => void): Promise<{ status: number; header: (name: string) => string | null }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let stall: ReturnType<typeof setTimeout> | null = null;
    const armStall = () => {
      if (stall) clearTimeout(stall);
      stall = setTimeout(() => {
        xhr.abort();
        reject(new Error("The upload stopped (no connection, or the phone went to sleep). Tap Retry."));
      }, STALL_SECONDS * 1000);
    };
    xhr.open(method, url, true);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      armStall();
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (stall) clearTimeout(stall);
      resolve({ status: xhr.status, header: (n) => xhr.getResponseHeader(n) });
    };
    xhr.onerror = () => {
      if (stall) clearTimeout(stall);
      reject(new Error("Upload failed. Check the connection."));
    };
    xhr.onabort = () => { if (stall) clearTimeout(stall); };
    armStall();
    xhr.send(body);
  });
}

export async function resumableUpload(url: string, file: Blob, contentType: string, onProgress: (p: number) => void): Promise<void> {
  const parts = signedParts(url);
  const endpoint = tusEndpoint();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!parts || !endpoint) return putSingle(url, file, contentType, onProgress);
  const auth = { authorization: `Bearer ${anon}`, apikey: anon, "x-signature": parts.token, "Tus-Resumable": "1.0.0" };
  const key = `erp-tus:${parts.bucket}/${parts.object}:${file.size}`;
  const remembered = (() => { try { return localStorage.getItem(key); } catch { return null; } })();
  const where = async (loc: string) => {
    const r = await xhrRequest("HEAD", loc, auth, null);
    if (r.status === 404 || r.status === 410) return null;
    return Number(r.header("Upload-Offset") ?? 0);
  };
  let location = remembered;
  const resumedAt = location ? await where(location).catch(() => null) : null;
  let offset: number = resumedAt ?? 0;
  if (resumedAt === null) {
    const created = await xhrRequest("POST", endpoint, { ...auth, "Upload-Length": String(file.size), "Upload-Metadata": `bucketName ${b64(parts.bucket)},objectName ${b64(parts.object)},contentType ${b64(contentType)},cacheControl ${b64("3600")}`, "x-upsert": "false" }, null);
    const loc = created.header("Location");
    if (created.status !== 201 || !loc) throw Object.assign(new Error(`Upload failed (${created.status}).`), { status: created.status });
    location = new URL(loc, endpoint).toString();
    offset = 0;
    try { localStorage.setItem(key, location); } catch { /* the browser may refuse: the send still works */ }
  }
  let failures = 0;
  while (offset < file.size) {
    const piece = file.slice(offset, offset + TUS_CHUNK);
    const from: number = offset;
    try {
      const r = await xhrRequest("PATCH", location!, { ...auth, "Upload-Offset": String(from), "Content-Type": "application/offset+octet-stream" }, piece, (p) => onProgress((from + p * piece.size) / file.size));
      if (r.status === 204 || r.status === 200) {
        offset = Number(r.header("Upload-Offset") ?? from + piece.size);
        failures = 0;
        continue;
      }
      if (r.status === 409) {
        offset = (await where(location!)) ?? from;
        continue;
      }
      if (r.status === 404 || r.status === 410) {
        try { localStorage.removeItem(key); } catch { /* nothing */ }
      }
      throw Object.assign(new Error(`Upload failed (${r.status}).`), { status: r.status });
    } catch (err) {
      failures++;
      // Offline, or tried enough: the caller decides (Retry, or the queue that sends when the signal is back).
      if (failures > 5 || (typeof navigator !== "undefined" && navigator.onLine === false) || (err as { status?: number }).status === 404 || (err as { status?: number }).status === 410) throw err;
      await wait(Math.min(30_000, 2000 * failures));
      offset = (await where(location!).catch(() => null)) ?? from;
    }
  }
  try { localStorage.removeItem(key); } catch { /* nothing */ }
  onProgress(1);
}

/** One PUT of the whole file (photos and other small files). */
function putSingle(url: string, file: Blob, contentType: string, onProgress: (p: number) => void) {
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
    xhr.onload = () => {
      done();
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      // The status rides on the error, so the plain words (uploadProblem) can tell an expired address from a server fault.
      reject(Object.assign(new Error(`Upload failed (${xhr.status}).`), { status: xhr.status }));
    };
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
  // Photos are shrunk on the phone first (30 October 2026): about 0.5 MB instead of 5-12 MB on 4G.
  if (contentType.startsWith("image/")) {
    const small = await shrinkPhoto(file);
    file = small.blob;
    contentType = small.type;
  }
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

/* ------------------------------------------------------------------------------------------------------------ */
/* One way to send a photo (30 October 2026): shrunk on the phone, straight to storage, never through a server   */
/* function (Vercel refuses anything above 4.5 MB before our code runs - the recovery drivers' 413s).             */
/* ------------------------------------------------------------------------------------------------------------ */

/** Every photo is sent at most this long on its longer side, as a JPEG at this quality: about 0.5 MB, a plate and an odometer still sharp. */
export const PHOTO_MAX_SIDE = 2000;
export const PHOTO_QUALITY = 0.8;

/**
 * Shrinks a phone photo before it is sent (12 MB → about 0.5 MB), turned the right way up. A file that is not a photo,
 * one the browser cannot read (HEIC on some phones) or one already small is sent as it is - it still goes straight to
 * storage, so its size never blocks it.
 */
export async function shrinkPhoto(file: Blob, opts: { maxSide?: number; quality?: number } = {}): Promise<{ blob: Blob; type: string; shrunk: boolean }> {
  const type = file.type || "image/jpeg";
  if (!type.startsWith("image/") || type === "image/gif" || type === "image/svg+xml" || typeof document === "undefined") return { blob: file, type, shrunk: false };
  const maxSide = opts.maxSide ?? PHOTO_MAX_SIDE;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size <= 900 * 1024 && type === "image/jpeg") {
      bmp.close();
      return { blob: file, type, shrunk: false };
    }
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bmp.close();
      return { blob: file, type, shrunk: false };
    }
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", opts.quality ?? PHOTO_QUALITY));
    canvas.width = 0;
    canvas.height = 0;
    if (!blob || (scale === 1 && blob.size >= file.size)) return { blob: file, type, shrunk: false };
    return { blob, type: "image/jpeg", shrunk: true };
  } catch {
    return { blob: file, type, shrunk: false };
  }
}

/** What went wrong with a send, in plain words, and whether trying again by itself can help. */
export type UploadProblem = { words: string; retry: boolean; reason: "offline" | "stalled" | "server" | "link" | "too_big" | "storage" | "unknown" };

/**
 * Plain words for a failed send instead of "It did not go through": no internet (retried by itself), the signal
 * dropping mid-way, OFJ's server not answering, a link that expired (call OFJ), a storage address that expired
 * (a fresh one is asked for by itself).
 */
export function uploadProblem(err: unknown, status: number | null, opts: { phone?: string | null; linkError?: boolean } = {}): UploadProblem {
  const message = err instanceof Error ? err.message : String(err ?? "");
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  if (opts.linkError) return { words: `Link expired – call OFJ${opts.phone ? ` ${opts.phone}` : ""}`, retry: false, reason: "link" };
  if (offline || /failed to fetch|networkerror|network error|load failed|connection/i.test(message)) return { words: "No internet – will retry automatically", retry: true, reason: "offline" };
  if (/stopped|stall|timeout|timed out|abort/i.test(message)) return { words: "The signal dropped while sending – will retry automatically", retry: true, reason: "stalled" };
  if (status === 413) return { words: "The photo was too big – it is made smaller and sent again", retry: true, reason: "too_big" };
  if (status !== null && status >= 500) return { words: "OFJ's server did not answer – will retry automatically", retry: true, reason: "server" };
  if (status === 400 || status === 401 || status === 403) return { words: "The upload address expired – a new one is asked for automatically", retry: true, reason: "storage" };
  return { words: "Could not send yet – will retry automatically", retry: true, reason: "unknown" };
}
