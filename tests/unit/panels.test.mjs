// Every panel's name matches where it is drawn (30 October 2026, night batch section 4.1). With the front at the top,
// the car's own RIGHT is on the right of the picture (as if sitting in the driver's seat): a "right" panel's middle is
// right of the centre line, a "left" one left of it; a "front" panel in the front half, a "rear" one in the rear half.
const { CAR_PANELS, OUTLINE_LABELS } = await import("../../src/lib/car-outline.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };
/** The middle of a shape: rect/circle exactly, a path from the average of its numbers (x, y pairs). */
function middle(s) {
  if (s.kind === "rect") return { x: s.x + s.w / 2, y: s.y + s.h / 2 };
  if (s.kind === "circle") return { x: s.cx, y: s.cy };
  const nums = (s.d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  const xs = nums.filter((_, i) => i % 2 === 0);
  const ys = nums.filter((_, i) => i % 2 === 1);
  return { x: xs.reduce((a, b) => a + b, 0) / xs.length, y: ys.reduce((a, b) => a + b, 0) / ys.length };
}
const wrong = [];
for (const p of CAR_PANELS.filter((x) => x.shape)) {
  const m = middle(p.shape);
  const words = p.label.toLowerCase();
  const side = p.place?.side;
  const end = p.place?.end;
  const okSide = !side || (side === "right" ? m.x > 120 : m.x < 120);
  const okEnd = !end || (end === "front" ? m.y < 240 : m.y > 240);
  const okWords = (!side || words.includes(side)) && !(side === "left" && words.includes("right")) && !(side === "right" && words.includes("left"));
  if (!okSide || !okEnd || !okWords) wrong.push(`${p.key} "${p.label}" at x ${Math.round(m.x)}, y ${Math.round(m.y)}`);
}
check(`every panel's name matches its position (${CAR_PANELS.filter((x) => x.shape).length} panels)`, wrong.length === 0, wrong.join("; "));
check("the headlight on the picture's right is \"Headlight – front right\"", CAR_PANELS.find((p) => p.key === "headlight_r").label === "Headlight – front right");
check("FRONT above the front bumper, REAR below the rear bumper, LEFT and RIGHT on the sides", OUTLINE_LABELS.find((l) => l.text === "FRONT").y < 6 && OUTLINE_LABELS.find((l) => l.text === "REAR").y > 476 && OUTLINE_LABELS.find((l) => l.text === "LEFT").x < 14 && OUTLINE_LABELS.find((l) => l.text === "RIGHT").x > 226);
const bonnet = CAR_PANELS.find((p) => p.key === "bonnet").shape;
const boot = CAR_PANELS.find((p) => p.key === "boot").shape;
const span = (s) => { const ys = (s.d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number).filter((_, i) => i % 2 === 1); return Math.max(...ys) - Math.min(...ys); };
check(`the bonnet is longer than the boot (${span(bonnet)} vs ${span(boot)})`, span(bonnet) > span(boot));
console.log(failed ? `FAILED (${failed})` : "All passed");
process.exit(failed ? 1 : 0);
