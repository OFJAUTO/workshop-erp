// "Damage already on the car" (30 October 2026, night batch section 4): the one model, the customer's section (English
// and Arabic, "No damage noted at check-in"), the customer's confirmation line and the PDF block. No database: the
// photos are the repository's own preview picture. Proof pictures: tests/browser/shots/damage/.
import fs from "node:fs";
import path from "node:path";
const React = (await import("react")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const { Document, Page, renderToBuffer } = await import("@react-pdf/renderer");
const { buildCarDamage, damageCountWords, damageSnapshot, captionWords, cleanDamageAfter, DAMAGE_WORDS_AR, DAMAGE_CONFIRM_EN } = await import("../../src/lib/damage.ts");
const { DamageSection } = await import("../../src/components/DamageSection.tsx");
const { DamagePdf } = await import("../../src/lib/pdf/damage-pdf.tsx");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

const after1 = "11111111-2222-4333-8444-555555555555";
const media = [
  { id: "m1", kind: "damage_photo", storage_path: "j/a.jpg", caption: "panel:headlight_r", taken_at: "2026-10-30T08:00:00Z" },
  { id: "m2", kind: "damage_photo", storage_path: "j/b.jpg", caption: "panel:headlight_r", taken_at: "2026-10-30T08:01:00Z" },
  { id: "m3", kind: "damage_photo", storage_path: "j/c.jpg", caption: "panel:front_bumper", taken_at: "2026-10-30T08:02:00Z" },
  { id: "m4", kind: "damage_photo", storage_path: "j/d.jpg", caption: null, taken_at: "2026-10-30T08:03:00Z" },
  { id: "m5", kind: "damage_photo", storage_path: "j/e.jpg", caption: `after:${after1}`, taken_at: "2026-10-31T08:00:00Z" },
  { id: "m6", kind: "damage_photo", storage_path: "j/f.jpg", caption: "panel:roof", taken_at: "2026-10-30T08:04:00Z" },
  { id: "m7", kind: "dashboard_photo", storage_path: "j/g.jpg", caption: null, taken_at: "2026-10-30T08:05:00Z" },
];
const urls = Object.fromEntries(media.map((m) => [m.storage_path, `https://example.test/${m.storage_path}`]));
const marks = { headlight_r: { damage: ["crack"], severity: "moderate", note: "Lens cracked at the corner" }, front_bumper: { damage: ["scratch", "dent"], severity: "minor" }, bogus: { damage: ["scratch"] } };
const after = [{ id: after1, panel: "door_rl", damage: ["dent"], severity: "minor", note: "Small dent under the handle", at: "2026-10-31T09:00:00Z", by: null, by_name: "X", sent_at: null }, { id: "not-a-uuid!", panel: "door_rl" }];
const d = buildCarDamage({ marks, after, note: "Stone chips on the bonnet", media, urls });

check("two panels marked (an unknown panel is dropped), front to back", d.items.map((i) => i.key).join(",") === "front_bumper,headlight_r", d.items.map((i) => i.key).join(","));
check("each panel carries its own photos", d.items.find((i) => i.key === "headlight_r").photos.length === 2 && d.items.find((i) => i.key === "front_bumper").photos.length === 1);
check("a moderate crack is red, a minor scratch amber", d.tones.headlight_r === "red" && d.tones.front_bumper === "amber");
check("a photo with no panel, or of an unmarked panel, stays as a loose damage photo", d.loose.map((p) => p.id).sort().join(",") === "m4,m6", d.loose.map((p) => p.id).join(","));
check("found after check-in is kept apart, with its own photo; a bad entry is dropped", d.after.length === 1 && d.after[0].photos.length === 1 && d.after[0].label === "Door – rear left");
check("the details line says \"2 panels (see above)\"", damageCountWords(d) === "2 panels (see above)");
check("no panels, no photos: \"None noted\"", damageCountWords({ items: [], loose: [] }) === "None noted");
check("a gallery caption reads the panel's name", captionWords("panel:headlight_r") === "Headlight – front right" && captionWords(`after:${after1}`) === "Found after check-in");
const snap = damageSnapshot(d, "2026-10-30T10:00:00Z", marks);
check("the approval snapshot keeps the marks, the photo ids and a line per panel", Object.keys(snap.marks).length === 2 && snap.photos.length === 5 && snap.lines[1].startsWith("Headlight – front right: Crack (Moderate)"), JSON.stringify(snap.lines));
check("cleanDamageAfter refuses unknown panels", cleanDamageAfter([{ id: after1, panel: "wing_x", damage: ["dent"] }]).length === 0);

const html = renderToStaticMarkup(React.createElement(DamageSection, { damage: d }));
check("the customer's section has its English and Arabic title", html.includes("Damage already on the car") && html.includes(DAMAGE_WORDS_AR.title));
check("the outline is labelled FRONT / REAR / LEFT / RIGHT", ["FRONT", "REAR", "LEFT", "RIGHT"].every((w) => html.includes(`data-outline-label="${w}"`)));
check("the written list names \"Headlight – front right\" with its two photos next to it", /data-damage-item="headlight_r"[\s\S]*?Headlight – front right[\s\S]*?data-damage-photo="m1"[\s\S]*?data-damage-photo="m2"/.test(html));
check("found after check-in shows with its date", html.includes("data-damage-after") && html.includes("Found after check-in · 31 Oct"));
const none = renderToStaticMarkup(React.createElement(DamageSection, { damage: buildCarDamage({ marks: {}, media: [], urls: {} }) }));
check("no damage: \"No damage noted at check-in\" in English and Arabic", none.includes("No damage noted at check-in") && none.includes(DAMAGE_WORDS_AR.none) && !none.includes("data-car-outline"));
check("the confirmation words for the approval box exist in both languages", DAMAGE_CONFIRM_EN.includes("confirm the damage shown above was on the vehicle when it arrived") && DAMAGE_WORDS_AR.confirm.length > 20);

// The PDF block, with the preview picture standing in for the photos.
const jpg = { data: fs.readFileSync(path.join(process.cwd(), "public", "preview.jpg")), format: "jpg" };
const pdfData = {
  rows: d.items.map((i) => ({ label: i.label, words: [i.words, i.severity].filter(Boolean).join(" · "), note: i.note, tone: i.tone, photos: i.photos.map(() => jpg) })),
  loose: [jpg],
  note: d.note,
  after: d.after.map((a) => ({ label: a.label, words: a.words, note: a.note, tone: a.tone, photos: [jpg], when: "31 Oct 2026" })),
  tones: d.tones,
};
const buf = await renderToBuffer(React.createElement(Document, null, React.createElement(Page, { size: "A4", style: { padding: 36 } }, React.createElement(DamagePdf, { d: pdfData }))));
const mupdf = await import("mupdf");
const pdf = mupdf.Document.openDocument(buf, "application/pdf");
const text = Array.from({ length: pdf.countPages() }, (_, i) => pdf.loadPage(i).toStructuredText().asText()).join("\n");
check("the PDF block prints the title, the panels and the found-after line", /damage already on the car/i.test(text) && text.includes("Headlight – front right") && text.includes("Front bumper") && /Found after check-in · 31 Oct 2026/.test(text), text.replace(/\s+/g, " ").slice(0, 200));
check("the PDF outline carries FRONT / REAR / LEFT / RIGHT", ["FRONT", "REAR", "LEFT", "RIGHT"].every((w) => text.includes(w)));
const out = path.join(process.cwd(), "tests", "browser", "shots", "damage");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "damage-pdf.png"), pdf.loadPage(0).toPixmap(mupdf.Matrix.scale(1.5, 1.5), mupdf.ColorSpace.DeviceRGB, false, true).asPNG());
fs.writeFileSync(path.join(out, "damage-section.html"), `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="about:blank"><body style="font-family:sans-serif;max-width:640px;margin:20px">${html}</body>`);
console.log(failed ? `FAILED (${failed})` : "All passed");
process.exit(failed ? 1 : 0);
