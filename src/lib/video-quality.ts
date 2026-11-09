/*
 * Gate-in videos much clearer (9 November 2026, Section 7). The videos taken through the phone's camera app from the
 * page came out at 480 × 360, 24 fps, 0.85 Mbps (iPhone Safari's "medium" quality for web uploads). Now the page
 * records itself at 1920 × 1080, 30 fps, and the file is stored EXACTLY as recorded (no shrinking, no re-compression).
 * Anything below 720p is refused with a message. Pure, no imports.
 */

export const VIDEO_TARGET = { width: 1920, height: 1080, fps: 30 } as const;
/** About 60 MB a minute: sharp enough to read a scratch at arm's length, small enough for a 4-minute walk-around. */
export const VIDEO_BITRATE = 8_000_000;
export const MIN_SHORT_SIDE = 720;

/** "1920 × 1080 · 30 fps" for the recorder's screen. */
export function qualityWords(width: number, height: number, fps?: number | null): string {
  return `${width} × ${height}${fps ? ` · ${Math.round(fps)} fps` : ""}`;
}

/** Below 720p is refused (the short side under 720 pixels). Null = fine. */
export function qualityProblem(width: number | null | undefined, height: number | null | undefined, from: "camera" | "file"): string | null {
  if (!width || !height) return null;
  if (Math.min(width, height) >= MIN_SHORT_SIDE) return null;
  return from === "camera"
    ? `This camera only gives ${width} × ${height}: the video would be blurry. Use the phone's back camera (or another phone) – at least 1280 × 720.`
    : `This video is only ${width} × ${height}, too blurry for the record. Record it again here with "Record video" (1080p).`;
}

/** The recorder's file type: MP4 (H.264) where the browser makes it (iPhone, new Chrome), else WebM. */
export function recorderType(isSupported: (t: string) => boolean): { mimeType: string; contentType: string; ext: string } {
  for (const t of ["video/mp4;codecs=avc1.640028,mp4a.40.2", "video/mp4;codecs=avc1,mp4a.40.2", "video/mp4"]) if (isSupported(t)) return { mimeType: t, contentType: "video/mp4", ext: "mp4" };
  for (const t of ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]) if (isSupported(t)) return { mimeType: t, contentType: "video/webm", ext: "webm" };
  return { mimeType: "", contentType: "video/webm", ext: "webm" };
}

/** Supabase storage (USD per GB a month) for the storage line in Settings. */
export const STORAGE_USD_PER_GB = 0.021;
export function storageCostWords(bytes: number): string {
  const gb = bytes / 1073741824;
  return `${gb.toFixed(2)} GB · about USD ${(gb * STORAGE_USD_PER_GB).toFixed(2)} a month`;
}
