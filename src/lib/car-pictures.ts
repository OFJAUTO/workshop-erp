import "server-only";
import { createAdminClient } from "./supabase/admin";

/** Signed links for a set of car pictures, keyed by storage path. */
export async function signCarPictures(paths: (string | null | undefined)[]): Promise<Map<string, string>> {
  const list = Array.from(new Set(paths.filter((p): p is string => !!p)));
  if (list.length === 0) return new Map();
  const admin = createAdminClient();
  const { data } = await admin.storage.from("vehicle-photos").createSignedUrls(list, 3600);
  const out = new Map<string, string>();
  for (const s of data ?? []) if (s.path && s.signedUrl) out.set(s.path, s.signedUrl);
  return out;
}
