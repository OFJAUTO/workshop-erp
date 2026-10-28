import "server-only";
import { createAdminClient } from "./supabase/admin";

/**
 * Small pictures for a page (29 October 2026, section 7): Supabase resizes a stored photo on the fly, so a page loads
 * a thumbnail of a few dozen KB while the viewer opens the sharp original. `width` is in pixels: 480 for a grid
 * thumbnail, 960 for a picture across a phone screen. A path that cannot be signed is simply missing (the page then
 * shows the sharp address).
 */
export async function thumbsFor(bucket: string, paths: (string | null | undefined)[], width = 480, ttl = 3600): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = Array.from(new Set(paths.filter((p): p is string => !!p)));
  if (!unique.length) return out;
  const admin = createAdminClient();
  await Promise.all(
    unique.map(async (p) => {
      const { data } = await admin.storage.from(bucket).createSignedUrl(p, ttl, { transform: { width, quality: 70 } });
      if (data?.signedUrl) out.set(p, data.signedUrl);
    }),
  );
  return out;
}
