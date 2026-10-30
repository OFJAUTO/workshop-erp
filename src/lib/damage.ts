import { CAR_PANELS, cleanPanelMarks, damageWords, panelLabel, severityLabel, toneOf, type PanelMarks, type PanelTone } from "./car-outline";

/**
 * "Damage already on the car" (30 October 2026, night batch section 4): what the car came in with (the gate-in marks on
 * the outline, each panel's own photos), and what was found after check-in, kept apart. Pure: the customer's job card,
 * its PDF, the gate-in details page, the job card, the gate-out and the approval snapshot all read this one model.
 *
 * Photos are gate_in_media rows of kind damage_photo; the caption says where they belong:
 *   "panel:<key>"  a check-in photo of that panel,
 *   "after:<id>"   a photo of damage found after check-in (entry id in gate_ins.damage_after).
 * Any other damage photo (the older loose ones) shows under "Other damage photos".
 */

export const panelCaption = (key: string) => `panel:${key}`;
export const afterCaption = (id: string) => `after:${id}`;
export const captionPanel = (caption: string | null | undefined) => (caption?.startsWith("panel:") ? caption.slice(6) : null);
export const captionAfter = (caption: string | null | undefined) => (caption?.startsWith("after:") ? caption.slice(6) : null);

/** The words a gallery prints for a damage photo's caption ("Front bumper", "Found after check-in"). */
export function captionWords(caption: string | null | undefined): string | null {
  const panel = captionPanel(caption);
  if (panel) return panelLabel(panel);
  if (captionAfter(caption)) return "Found after check-in";
  return caption ?? null;
}

export type DamageAfter = { id: string; panel: string; damage: string[]; severity: string | null; note: string | null; at: string; by: string | null; by_name: string | null; sent_at: string | null };

const UUIDISH = /^[0-9a-f-]{8,40}$/i;
/** Cleans gate_ins.damage_after from the database or the browser: known panels and damage words only. */
export function cleanDamageAfter(input: unknown): DamageAfter[] {
  if (!Array.isArray(input)) return [];
  const out: DamageAfter[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const id = String(r.id ?? "");
    const panel = String(r.panel ?? "");
    if (!UUIDISH.test(id) || !CAR_PANELS.some((p) => p.key === panel)) continue;
    const marks = cleanPanelMarks({ [panel]: { damage: r.damage, note: r.note, severity: r.severity } });
    const m = marks[panel] ?? { damage: [], note: null, severity: null };
    out.push({ id, panel, damage: m.damage, severity: m.severity ?? null, note: m.note ?? null, at: String(r.at ?? ""), by: r.by ? String(r.by) : null, by_name: r.by_name ? String(r.by_name) : null, sent_at: r.sent_at ? String(r.sent_at) : null });
  }
  return out;
}

export type DamagePhoto = { id: string; url: string; thumb: string | null; label: string };
export type DamageItem = { key: string; label: string; words: string; severity: string; note: string | null; tone: PanelTone; photos: DamagePhoto[] };
export type DamageAfterItem = DamageItem & { id: string; at: string; sentAt: string | null };
export type CarDamage = {
  /** The panels marked at check-in, in the outline's order (front to back). */
  items: DamageItem[];
  /** Damage photos tied to no panel (taken before photos were per panel). */
  loose: DamagePhoto[];
  /** The gate-in's free damage note. */
  note: string | null;
  /** Found after check-in, oldest first. */
  after: DamageAfterItem[];
  /** The colours on the outline: check-in marks only (found-after damage has its own small outline). */
  tones: Record<string, PanelTone>;
  afterTones: Record<string, PanelTone>;
  /** Every check-in photo taken for a panel, marked or not yet (the marker shows them under the panel). */
  byPanel: Record<string, DamagePhoto[]>;
};

type MediaLike = { id: string; kind: string; storage_path: string; caption: string | null; taken_at?: string | null; removed_at?: string | null };

/** Builds the one model from the gate-in marks, the found-after list and the gate-in photos (with their addresses). */
export function buildCarDamage(input: { marks: unknown; after?: unknown; note?: string | null; media: MediaLike[]; urls: Map<string, string> | Record<string, string>; thumbs?: Map<string, string> | Record<string, string> }): CarDamage {
  const marks: PanelMarks = cleanPanelMarks(input.marks);
  const after = cleanDamageAfter(input.after);
  const get = (m: Map<string, string> | Record<string, string> | undefined, k: string) => (!m ? undefined : m instanceof Map ? m.get(k) : m[k]);
  const photos = input.media
    .filter((m) => m.kind === "damage_photo" && !m.removed_at)
    .sort((a, b) => String(a.taken_at ?? "").localeCompare(String(b.taken_at ?? "")))
    .map((m) => ({ row: m, url: get(input.urls, m.storage_path) ?? "", thumb: get(input.thumbs, m.storage_path) ?? null }))
    .filter((p) => p.url);
  const photo = (p: (typeof photos)[number], label: string): DamagePhoto => ({ id: p.row.id, url: p.url, thumb: p.thumb, label });
  const order = new Map(CAR_PANELS.map((p, i) => [p.key, i]));
  const items: DamageItem[] = Object.entries(marks)
    .sort(([a], [b]) => (order.get(a) ?? 99) - (order.get(b) ?? 99))
    .map(([key, m]) => ({
      key,
      label: panelLabel(key),
      words: damageWords(m.damage),
      severity: severityLabel(m.severity),
      note: m.note ?? null,
      tone: toneOf(m) ?? "amber",
      photos: photos.filter((p) => captionPanel(p.row.caption) === key).map((p) => photo(p, panelLabel(key))),
    }));
  const marked = new Set(items.map((i) => i.key));
  const afterIds = new Set(after.map((a) => a.id));
  // A photo of a panel that is no longer marked still shows (as a loose damage photo), never vanishes.
  const loose = photos
    .filter((p) => { const k = captionPanel(p.row.caption); const a = captionAfter(p.row.caption); return a ? !afterIds.has(a) : !k || !marked.has(k); })
    .map((p) => photo(p, captionWords(p.row.caption) ?? "Damage"));
  const afterItems: DamageAfterItem[] = after.map((a) => ({
    id: a.id,
    key: a.panel,
    label: panelLabel(a.panel),
    words: damageWords(a.damage),
    severity: severityLabel(a.severity),
    note: a.note,
    tone: toneOf(a) ?? "amber",
    at: a.at,
    sentAt: a.sent_at,
    photos: photos.filter((p) => captionAfter(p.row.caption) === a.id).map((p) => photo(p, `${panelLabel(a.panel)} – found after check-in`)),
  }));
  return {
    items,
    loose,
    note: input.note?.trim() || null,
    after: afterItems,
    tones: Object.fromEntries(items.map((i) => [i.key, i.tone])),
    afterTones: Object.fromEntries(afterItems.map((i) => [i.key, i.tone])),
    byPanel: photos.reduce<Record<string, DamagePhoto[]>>((acc, p) => {
      const k = captionPanel(p.row.caption);
      if (k) (acc[k] ??= []).push(photo(p, panelLabel(k)));
      return acc;
    }, {}),
  };
}

/** "Damage noted: 2 panels (see above)" / "No damage noted" - the check-in details line. */
export function damageCountWords(d: Pick<CarDamage, "items" | "loose">): string {
  const n = d.items.length;
  if (n) return `${n} panel${n === 1 ? "" : "s"} (see above)`;
  return d.loose.length ? "Yes, see the damage photos above" : "None noted";
}

/** "Front bumper: Scratch, Dent (Minor) – note": one line per panel, for messages and the snapshot. */
export const itemLine = (i: Pick<DamageItem, "label" | "words" | "severity" | "note">) => `${i.label}: ${[i.words, i.severity ? `(${i.severity})` : "", i.note ? `– ${i.note}` : ""].filter(Boolean).join(" ")}`;

/** What the customer confirmed at approval (approval_requests.damage_snapshot). */
export type DamageSnapshot = { at: string; marks: PanelMarks; photos: string[]; lines: string[] };
export function damageSnapshot(d: CarDamage, at: string, marks: unknown): DamageSnapshot {
  return { at, marks: cleanPanelMarks(marks), photos: [...d.items.flatMap((i) => i.photos.map((p) => p.id)), ...d.loose.map((p) => p.id)], lines: d.items.map(itemLine) };
}

export const DAMAGE_WORDS_AR = {
  title: "الأضرار الموجودة على السيارة عند الاستلام",
  none: "لم يتم تسجيل أي أضرار عند الاستلام",
  after: "أضرار اكتُشفت بعد الاستلام",
  confirm: "وأؤكد أن الأضرار الموضحة أعلاه كانت موجودة على المركبة عند وصولها.",
} as const;
export const DAMAGE_CONFIRM_EN = "…and I confirm the damage shown above was on the vehicle when it arrived.";

/** The WhatsApp message for damage found after check-in (the Settings default; the owner edits it in Settings). */
export const DEFAULT_DAMAGE_FOUND = "Dear [name],\n\nWhile working on your *[make model]* ([plate]) we found damage that could not be seen when the car arrived:\n[damage]\n\nThe photos are on your job card:\n[link]\n\nOFJ Automotive";
