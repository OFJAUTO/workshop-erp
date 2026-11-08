/**
 * THE pre-made photo sizes (8 November 2026). Supabase Pro includes only 100 transformed images a month, so no page
 * asks Supabase to resize a photo any more. Every photo gets two smaller copies ONCE, when it arrives (or from the
 * backfill script for older ones), stored in the SAME bucket under `_sizes/`:
 *
 *   original   gate-in/<job>/<file>.jpg                      – never changed, never deleted (evidence); "download"
 *   thumb      _sizes/gate-in/<job>/<file>.jpg.w400.jpg       – lists, dashboards, grids
 *   medium     _sizes/gate-in/<job>/<file>.jpg.w1600.jpg      – the photo viewer
 *
 * Pure (no imports): the backfill script imports this file directly with Node's type stripping, so the app and the
 * script can never disagree about a name.
 */
export const PHOTO_SIZES = { thumb: 400, medium: 1600 } as const;
export type PhotoSize = keyof typeof PHOTO_SIZES;

/** The folder every pre-made size lives under, at the root of the original's own bucket. */
export const SIZES_FOLDER = "_sizes";

/** A year: the pre-made files never change once written. */
export const SIZED_CACHE_SECONDS = 31536000;

/** Where one size of one original lives. */
export function sizedPath(path: string, size: PhotoSize): string {
  return `${SIZES_FOLDER}/${path}.w${PHOTO_SIZES[size]}.jpg`;
}

/** A pre-made file itself (never sized again, never shown as an original). */
export function isSizedPath(path: string): boolean {
  return path.startsWith(`${SIZES_FOLDER}/`);
}

/** The size a page asking for `width` pixels gets: up to 480 the thumbnail, above it the medium copy. */
export function sizeForWidth(width: number): PhotoSize {
  return width <= 480 ? "thumb" : "medium";
}

const PHOTO_EXT = /\.(jpe?g|png|webp)$/i;
const PHOTO_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

/** Only real photos get sizes: never a PDF, a video, an SVG or a pre-made file. */
export function isSizablePhoto(path: string, contentType?: string | null): boolean {
  if (!path || isSizedPath(path)) return false;
  const t = (contentType ?? "").toLowerCase().split(";")[0].trim();
  if (t) return PHOTO_TYPES.has(t);
  return PHOTO_EXT.test(path);
}

/** The buckets whose photos get sizes (the backfill walks exactly these). */
export const SIZED_BUCKETS = ["gate-in-media", "inspection-media", "job-files", "vehicle-photos", "parts-diagrams"] as const;
