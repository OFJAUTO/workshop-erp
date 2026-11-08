import "server-only";
import { after } from "next/server";
import { createAdminClient } from "./supabase/admin";
import { logAppError } from "./app-errors";
import { PHOTO_SIZES, SIZED_CACHE_SECONDS, isSizablePhoto, sizedPath, type PhotoSize } from "./photo-size-rules";

/**
 * Makes the two pre-made sizes of one photo (8 November 2026) with sharp, a normal image library - never Supabase's
 * image transformations, never Vercel's image optimisation. The original is only READ. Safe to call again: an
 * existing size is overwritten with the same picture. Returns what it made; never throws.
 */
export async function makePhotoSizes(bucket: string, path: string, contentType?: string | null): Promise<{ made: PhotoSize[]; error?: string }> {
  if (!isSizablePhoto(path, contentType)) return { made: [] };
  try {
    const admin = createAdminClient();
    const { data: file, error } = await admin.storage.from(bucket).download(path);
    if (error || !file) return { made: [], error: "original not readable" };
    const sharp = (await import("sharp")).default;
    const input = Buffer.from(await file.arrayBuffer());
    const made: PhotoSize[] = [];
    for (const size of Object.keys(PHOTO_SIZES) as PhotoSize[]) {
      const out = await sharp(input, { failOn: "none" })
        .rotate()
        .resize({ width: PHOTO_SIZES[size], withoutEnlargement: true })
        .jpeg({ quality: size === "thumb" ? 70 : 80, mozjpeg: true })
        .toBuffer();
      const { error: upErr } = await admin.storage.from(bucket).upload(sizedPath(path, size), out, { contentType: "image/jpeg", upsert: true, cacheControl: String(SIZED_CACHE_SECONDS) });
      if (upErr) return { made, error: "size not saved" };
      made.push(size);
    }
    return { made };
  } catch (e) {
    return { made: [], error: e instanceof Error ? e.message.slice(0, 120) : "failed" };
  }
}

/** Makes the sizes after the answer has gone (the person never waits). A failure is logged, never shown. */
export function photoSizesLater(bucket: string, path: string | null | undefined, contentType?: string | null) {
  if (!path || !isSizablePhoto(path, contentType)) return;
  try {
    after(async () => {
      const r = await makePhotoSizes(bucket, path, contentType);
      if (r.error) logAppError("photo-sizes", new Error(`${bucket}/${path}: ${r.error}`));
    });
  } catch {
    /* outside a request (a script): nothing to schedule */
  }
}

/**
 * Signed addresses for one size of a set of photos, keyed by the ORIGINAL path. A photo whose pre-made size does not
 * exist yet (an older photo before the backfill, a PDF, a video) gets its ORIGINAL address - never a transformation.
 */
export async function photoUrls(bucket: string, paths: (string | null | undefined)[], size: PhotoSize, ttl = 3600): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = Array.from(new Set(paths.filter((p): p is string => !!p)));
  if (!unique.length) return out;
  const admin = createAdminClient();
  const sizable = unique.filter((p) => isSizablePhoto(p));
  if (sizable.length) {
    const { data } = await admin.storage.from(bucket).createSignedUrls(sizable.map((p) => sizedPath(p, size)), ttl);
    (data ?? []).forEach((d, i) => {
      if (d?.signedUrl && !d.error) out.set(sizable[i], d.signedUrl);
    });
  }
  const missing = unique.filter((p) => !out.has(p));
  if (missing.length) {
    const { data } = await admin.storage.from(bucket).createSignedUrls(missing, ttl);
    for (const d of data ?? []) if (d?.path && d.signedUrl) out.set(d.path, d.signedUrl);
  }
  return out;
}

/** Both sizes at once: the thumbnail for the page, the medium copy for the viewer. */
export async function photoSizesFor(bucket: string, paths: (string | null | undefined)[], ttl = 3600): Promise<{ thumb: Map<string, string>; medium: Map<string, string> }> {
  const [thumb, medium] = await Promise.all([photoUrls(bucket, paths, "thumb", ttl), photoUrls(bucket, paths, "medium", ttl)]);
  return { thumb, medium };
}
