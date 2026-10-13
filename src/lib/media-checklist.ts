import type { Checklist } from "./media";

/**
 * The gate-in checklist in words, shared by the browser and the server: which items are still missing,
 * the button that names them and the grey line under the list. Nothing here touches the database.
 */
export type MissingItem = {
  /** The item's key on the page (`data-media-item`), so "Go to next" can scroll to it. */
  key: string;
  /** Short name in the button and the line: "car picture", "keys back". */
  name: string;
};

export function missingItems(check: Checklist): MissingItem[] {
  const out: MissingItem[] = [];
  if (!check.carPicture) out.push({ key: "car_picture", name: "car picture" });
  if (!check.videoExterior) out.push({ key: "video_exterior", name: "exterior video" });
  if (!check.videoInterior) out.push({ key: "video_interior", name: "interior video" });
  if (!check.dashboard) out.push({ key: "dashboard_photo", name: "dashboard photo" });
  if (!check.keysFront) out.push({ key: "keys_photo_front", name: "keys front" });
  if (!check.keysBack) out.push({ key: "keys_photo_back", name: "keys back" });
  if (check.wheelsRequired) {
    for (const w of check.wheels) {
      if (!w.photo) out.push({ key: w.kind, name: `${w.label.toLowerCase()} wheel photo` });
      else if (!w.done) out.push({ key: w.kind, name: `${w.label.toLowerCase()} wheel condition` });
    }
  }
  if (check.majorDamage && check.damageCount === 0) out.push({ key: "damage_photo", name: "damage photos" });
  return out;
}

/** "Finish later: car picture missing" / "2 items missing: car picture, keys back". Only when something is missing. */
export function missingButtonLabel(missing: MissingItem[]): string {
  if (missing.length === 0) return "";
  if (missing.length === 1) return `Finish later: ${missing[0].name} missing`;
  return `${missing.length} items missing: ${missing.map((m) => m.name).join(", ")}`;
}

/** "1 item left: car picture" / "3 items left: car picture, keys back, damage photos". */
export function itemsLeftLine(missing: MissingItem[]): string {
  if (missing.length === 0) return "";
  return `${missing.length} item${missing.length === 1 ? "" : "s"} left: ${missing.map((m) => m.name).join(", ")}`;
}

/** The browser event the finish button fires so the checklist shows the missing items in red. */
export const GATE_IN_ATTEMPT_EVENT = "erp-gatein-attempt";
