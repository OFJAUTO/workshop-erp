import "server-only";
import { photoUrls } from "./photo-sizes";
import { sizeForWidth } from "./photo-size-rules";

/**
 * Small pictures for a page. Since 8 November 2026 these are the PRE-MADE sizes (src/lib/photo-sizes.ts), never a
 * Supabase image transformation (Pro includes only 100 a month). `width` picks the size: up to 480 px the 400 px
 * thumbnail, above it the 1600 px medium copy. A photo with no pre-made size yet gets its original address.
 */
export async function thumbsFor(bucket: string, paths: (string | null | undefined)[], width = 480, ttl = 3600): Promise<Map<string, string>> {
  return photoUrls(bucket, paths, sizeForWidth(width), ttl);
}
