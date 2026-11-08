import "server-only";
import { photoUrls } from "./photo-sizes";

/** Signed links for a set of car pictures, keyed by storage path: the pre-made thumbnail (lists and dashboards), the original until it exists. */
export async function signCarPictures(paths: (string | null | undefined)[]): Promise<Map<string, string>> {
  return photoUrls("vehicle-photos", paths, "thumb");
}
