/**
 * One-tap remarks on the road test (evening list of 12 October 2026, item 1). Each item has short rows of chips
 * (what, where, when); one tap from each row writes the sentence, several chips per row allowed, the sentence stays
 * editable. The lists live in Settings (`road_test_chips`), most used first (`road_test_chip_usage`).
 */
export type ChipRow = { label: string; chips: string[] };
export type RoadTestChips = Record<string, ChipRow[]>;

export const DEFAULT_ROAD_TEST_CHIPS: RoadTestChips = {
  noises: [
    { label: "What", chips: ["Knocking", "Clunk", "Rattle", "Squeak", "Creak", "Grinding", "Whining", "Humming", "Droning", "Clicking", "Hissing", "Whistling", "Scraping", "Popping"] },
    { label: "Where", chips: ["Front left", "Front right", "Rear left", "Rear right", "Front", "Rear", "Underneath", "Engine bay", "Dashboard", "Roof / pillars", "Exhaust"] },
    { label: "When", chips: ["Over bumps", "Turning", "Turning at full lock", "Braking", "Accelerating", "Decelerating", "At idle", "Cold start", "At speed", "Reversing", "Gear change", "All the time"] },
  ],
  vibration: [
    { label: "Felt in", chips: ["Steering wheel", "Seat / floor", "Brake pedal", "Gear lever", "Whole car"] },
    { label: "When", chips: ["Above 80 km/h", "Above 100 km/h", "Above 120 km/h", "At a steady speed", "Braking", "Accelerating", "Decelerating", "At idle", "In gear when stopped"] },
  ],
  pulling: [
    { label: "What", chips: ["Pulls left", "Pulls right", "Wanders"] },
    { label: "When", chips: ["Driving straight", "Braking", "Accelerating", "Over uneven road"] },
    { label: "Also", chips: ["Steering wheel off-centre", "Needs alignment"] },
  ],
  braking: [{ label: "What", chips: ["Soft pedal", "Long pedal", "Pulsating pedal", "Squeal", "Grinding", "Pulls when braking", "Judder when braking", "Long stopping distance", "ABS or brake warning light", "Parking brake weak"] }],
  steering: [{ label: "What", chips: ["Heavy", "Light / loose", "Play in the steering", "Noise when turning", "Knock at full lock", "Does not return to centre", "Steering warning light"] }],
  gearbox: [
    { label: "What", chips: ["Harsh shift", "Delayed engagement", "Slipping", "Flare between gears", "Jerk when shifting", "Shudder at low speed", "Stuck in gear", "Transmission warning"] },
    { label: "Gear", chips: ["1-2", "2-3", "3-4", "4-5", "5-6", "6-7", "7-8", "Reverse"] },
  ],
  engine: [{ label: "What", chips: ["Lack of power", "Hesitation", "Misfire", "Rough idle", "Stalls", "White smoke", "Blue smoke", "Black smoke", "Overheating", "Engine warning light", "Unusual smell"] }],
  suspension: [{ label: "What", chips: ["Bouncy", "Body roll", "Nose dive under braking", "Uneven ride height", "Air suspension fault / car lowered", "Knock over bumps", "Hard ride"] }],
};

/** The rows of one item from Settings, each row's chips sorted most used first; the defaults when nothing was saved. */
export function chipRowsFor(settings: { road_test_chips?: unknown; road_test_chip_usage?: unknown }, itemKey: string): ChipRow[] {
  const raw = (settings.road_test_chips ?? {}) as Record<string, unknown>;
  const saved = Array.isArray(raw[itemKey]) ? (raw[itemKey] as ChipRow[]).filter((r) => r && typeof r.label === "string" && Array.isArray(r.chips)) : null;
  const rows = (saved && saved.length ? saved : DEFAULT_ROAD_TEST_CHIPS[itemKey]) ?? [];
  const usage = (settings.road_test_chip_usage ?? {}) as Record<string, number>;
  return rows.map((r) => ({ label: r.label, chips: [...r.chips.map(String)].sort((a, b) => (usage[`${itemKey}|${b}`] ?? 0) - (usage[`${itemKey}|${a}`] ?? 0)) }));
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const joinAnd = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/**
 * The sentence from the chips picked, row by row. Noises: "Clunk from the front left over bumps."; vibration:
 * "Vibration in the steering wheel above 100 km/h."; the rest: the chips in order, "Soft pedal, squeal."
 */
export function chipSentence(itemKey: string, rows: ChipRow[], picked: string[][]): string {
  const sel = rows.map((_, i) => picked[i] ?? []);
  if (!sel.some((s) => s.length)) return "";
  const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  if (itemKey === "noises") {
    const [what, where, when] = sel;
    const parts = [joinAnd(what ?? []), where?.length ? `from the ${joinAnd(where.map(lower))}` : "", when?.length ? joinAnd(when.map(lower)) : ""].filter(Boolean);
    return `${cap(parts.join(" "))}.`;
  }
  if (itemKey === "vibration") {
    const [where, when] = sel;
    const parts = ["Vibration", where?.length ? `in the ${joinAnd(where.map(lower))}` : "", when?.length ? joinAnd(when.map(lower)) : ""].filter(Boolean);
    return `${parts.join(" ")}.`;
  }
  if (itemKey === "gearbox") {
    const [what, gear] = sel;
    const parts = [joinAnd(what ?? []), gear?.length ? `(${joinAnd(gear)})` : ""].filter(Boolean);
    return `${cap(parts.join(" "))}.`;
  }
  const flat = sel.flat();
  return `${cap(flat.map((c, i) => (i === 0 ? c : lower(c))).join(", "))}.`;
}
