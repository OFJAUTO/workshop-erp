/*
 * THE part sticker's name size (9 November 2026, Section 5): the part name, large and bold, shrinks or wraps to fit
 * the box under the logo and is NEVER cut. Pure, no imports: the PDF label and the on-screen sticker read the same
 * numbers. Sizes are in the box's own unit (points for the PDF, mm for the screen).
 */

/** Average width of a bold capital in Helvetica / Plus Jakarta Sans, as a share of the font size. */
export const CAP_WIDTH = 0.72;
export const LINE_HEIGHT = 1.08;

/** The words wrapped into lines of at most `maxChars` characters (a word longer than a line stays whole). */
export function wrapWords(text: string, maxChars: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= maxChars || !cur) cur = next;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * The largest font size (from `max` down to `min`, in steps of 0.25) at which the name fits `width` × `height` without
 * breaking a word; at `min` it fits whatever it takes (the box is never cut: the caller makes the box the rest of the
 * label). Returns the size and the lines.
 */
export function fitName(name: string, width: number, height: number, max: number, min: number): { size: number; lines: string[] } {
  const text = name.trim().toUpperCase();
  for (let size = max; size >= min - 1e-9; size = Math.round((size - 0.25) * 100) / 100) {
    const perLine = Math.max(1, Math.floor(width / (size * CAP_WIDTH)));
    const lines = wrapWords(text, perLine);
    const longest = Math.max(...lines.map((l) => l.length));
    if (longest <= perLine && lines.length * size * LINE_HEIGHT <= height) return { size, lines };
  }
  const perLine = Math.max(1, Math.floor(width / (min * CAP_WIDTH)));
  return { size: min, lines: wrapWords(text, perLine) };
}

/** The label's fixed geometry in mm (50 × 25 by default): nothing within 2.5 mm of an edge. */
export function labelBoxes(w: number, h: number) {
  const edge = 2.5;
  const qr = Math.min(19, h - 2 * edge, w * 0.42);
  const gap = 1.6;
  const rightX = edge + qr + gap;
  const rightW = w - edge - rightX;
  const logoW = Math.min(14, rightW);
  const logoH = logoW * (106 / 264);
  const nameTop = edge + logoH + 1.2;
  return { edge, qr, gap, rightX, rightW, logoW, logoH, nameTop, nameH: h - edge - nameTop };
}
