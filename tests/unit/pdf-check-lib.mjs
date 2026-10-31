// THE PDF layout check (30 October 2026, night batch section 6.2), for any PDF buffer: reads every text line with its box
// (mupdf's structured text) and the drawn marks (the green ticks, from the rendered picture), and reports
//   - text drawn on top of other text,
//   - text running off the page,
//   - a number split across two lines ("AED" at the end of one line and the digits on the next, "1," / "250.00"),
//   - a tick that is not level with the first line of its item.
// Used by tests/unit/pdf-layout.test.mjs (npm run test:unit and npm run test:pdf).
const mupdf = await import("mupdf");

const SCALE = 2;
const GREEN = [27, 107, 47];

function textLines(page) {
  const json = JSON.parse(page.toStructuredText("preserve-whitespace").asJSON());
  const out = [];
  for (const b of json.blocks ?? []) for (const l of b.lines ?? []) {
    const text = String(l.text ?? "").trim();
    if (!text) continue;
    out.push({ text, x0: l.bbox.x, y0: l.bbox.y, x1: l.bbox.x + l.bbox.w, y1: l.bbox.y + l.bbox.h, vertical: l.wmode === 1 || l.bbox.h > l.bbox.w * 2.5 && text.length > 2 });
  }
  return out;
}

/** Green marks that are not text: connected green areas of the picture that sit outside every text line. */
function greenMarks(page, lines) {
  const pix = page.toPixmap(mupdf.Matrix.scale(SCALE, SCALE), mupdf.ColorSpace.DeviceRGB, false, true);
  const w = pix.getWidth();
  const h = pix.getHeight();
  const px = pix.getPixels();
  const n = pix.getNumberOfComponents ? pix.getNumberOfComponents() : 3;
  const isGreen = (i) => { const r = px[i * n], g = px[i * n + 1], b = px[i * n + 2]; return Math.abs(r - GREEN[0]) < 60 && Math.abs(g - GREEN[1]) < 60 && Math.abs(b - GREEN[2]) < 60 && g > r + 25 && g > b + 25; };
  const seen = new Uint8Array(w * h);
  const marks = [];
  for (let i = 0; i < w * h; i++) {
    if (seen[i] || !isGreen(i)) continue;
    let minX = w, minY = h, maxX = 0, maxY = 0, count = 0;
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const k = stack.pop();
      const x = k % w, y = (k - x) / w;
      count++;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (!seen[j] && isGreen(j)) { seen[j] = 1; stack.push(j); }
      }
    }
    const box = { x0: minX / SCALE, y0: minY / SCALE, x1: (maxX + 1) / SCALE, y1: (maxY + 1) / SCALE, count };
    if (count < 6 || box.x1 - box.x0 > 16 || box.y1 - box.y0 > 16) continue;
    // A green letter sits inside a text line's box; a tick does not.
    if (lines.some((l) => box.x0 >= l.x0 - 0.5 && box.x1 <= l.x1 + 0.5 && box.y0 >= l.y0 - 0.5 && box.y1 <= l.y1 + 0.5)) continue;
    marks.push(box);
  }
  return marks;
}

const area = (a) => Math.max(0, a.x1 - a.x0) * Math.max(0, a.y1 - a.y0);
function overlap(a, b) {
  const x = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const y = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return x > 0 && y > 0 ? x * y : 0;
}

/** Checks one PDF; returns the problems in plain words (empty = clean). */
export function checkPdf(buf, name = "PDF") {
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  const problems = [];
  for (let p = 0; p < doc.countPages(); p++) {
    const page = doc.loadPage(p);
    const [, , pw, ph] = page.getBounds();
    const lines = textLines(page);
    for (let i = 0; i < lines.length; i++) {
      const a = lines[i];
      if (a.x0 < -0.5 || a.x1 > pw + 0.5 || a.y0 < -0.5 || a.y1 > ph + 0.5) problems.push(`${name} p${p + 1}: "${a.text.slice(0, 40)}" runs off the page`);
      for (let j = i + 1; j < lines.length; j++) {
        const b = lines[j];
        if (a.vertical || b.vertical) continue;
        const o = overlap(a, b);
        // Two lines whose boxes share more than a quarter of the smaller one are drawn on top of each other.
        if (o > 0.25 * Math.min(area(a), area(b))) problems.push(`${name} p${p + 1}: "${a.text.slice(0, 40)}" and "${b.text.slice(0, 40)}" are drawn on top of each other`);
      }
    }
    // A number split across lines: the next line (below, starting at the same left edge or right under it) carries the rest.
    for (const a of lines) {
      const next = lines.filter((b) => b !== a && b.y0 >= a.y1 - 1 && b.y0 - a.y1 < 6 && (Math.abs(b.x0 - a.x0) < 2 || Math.abs(b.x1 - a.x1) < 2)).sort((x, y) => x.y0 - y.y0)[0];
      if (!next) continue;
      if (/(AED|−AED|-AED)$/.test(a.text) && /^[\d−-]/.test(next.text)) problems.push(`${name} p${p + 1}: an amount is split: "${a.text.slice(-20)}" / "${next.text.slice(0, 20)}"`);
      if (/\d,$/.test(a.text) && /^\d{3}/.test(next.text)) problems.push(`${name} p${p + 1}: a number is split: "${a.text.slice(-20)}" / "${next.text.slice(0, 20)}"`);
    }
    // A tick is level with the first line of its item: the nearest text to its right that overlaps it vertically.
    for (const m of greenMarks(page, lines)) {
      const right = lines.filter((l) => l.x0 >= m.x1 - 1 && l.x0 - m.x1 < 24 && l.y1 > m.y0 - 6 && l.y0 < m.y1 + 6).sort((x, y) => Math.abs((x.y0 + x.y1) / 2 - (m.y0 + m.y1) / 2) - Math.abs((y.y0 + y.y1) / 2 - (m.y0 + m.y1) / 2))[0];
      if (!right) continue;
      const dy = (m.y0 + m.y1) / 2 - (right.y0 + right.y1) / 2;
      if (Math.abs(dy) > 2.6) problems.push(`${name} p${p + 1}: the tick before "${right.text.slice(0, 40)}" sits ${dy < 0 ? "higher" : "lower"} than its text by ${Math.abs(dy).toFixed(1)} pt`);
    }
  }
  return problems;
}

/** The picture of page n, for the proof screenshots. */
export function pagePng(buf, n = 0, scale = 1.5) {
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  return doc.loadPage(n).toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true).asPNG();
}

/** The ticks found on page n and how far each sits from its line (for the test's own sanity check). */
export function ticksOf(buf, n = 0) {
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  const page = doc.loadPage(n);
  const lines = textLines(page);
  return greenMarks(page, lines).map((m) => {
    const right = lines.filter((l) => l.x0 >= m.x1 - 1 && l.x0 - m.x1 < 24 && l.y1 > m.y0 - 6 && l.y0 < m.y1 + 6).sort((x, y) => Math.abs((x.y0 + x.y1) / 2 - (m.y0 + m.y1) / 2) - Math.abs((y.y0 + y.y1) / 2 - (m.y0 + m.y1) / 2))[0];
    return { text: right?.text ?? null, dy: right ? (m.y0 + m.y1) / 2 - (right.y0 + right.y1) / 2 : null };
  });
}

/* ---------------------------------------------------------------------------------------------------------------
 * The money rules of the owner's mockup (31 October 2026): every amount printed once, a subtotal only where it adds
 * something, no page holding only the totals or bank details, "AED" on every amount of the totals box.
 * --------------------------------------------------------------------------------------------------------------- */
const MONEY = /(?:AED\s*)?−?\s*([\d,]+\.\d{2})\b/;
const LABELS = /(subtotal|total incl\. vat|before vat|package price|balance due)/i;

function linesOf(page) {
  const json = JSON.parse(page.toStructuredText("preserve-whitespace").asJSON());
  return (json.blocks ?? []).flatMap((b) => b.lines ?? []).map((l) => ({ text: String(l.text ?? "").trim(), x0: l.bbox.x, y0: l.bbox.y, x1: l.bbox.x + l.bbox.w, y1: l.bbox.y + l.bbox.h })).filter((l) => l.text);
}

/** The labelled amounts of a document (Subtotal, PACKAGE PRICE, TOTAL INCL. VAT…), with the page they are on. */
export function labelledAmounts(buf) {
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  const out = [];
  for (let p = 0; p < doc.countPages(); p++) {
    const lines = linesOf(doc.loadPage(p));
    for (const l of lines) {
      if (!LABELS.test(l.text)) continue;
      const own = l.text.match(MONEY);
      const cy = (l.y0 + l.y1) / 2;
      // The amount on the same row (to the right), or right under a label like PACKAGE PRICE.
      const right = lines.filter((r) => r !== l && r.x0 > l.x0 && Math.abs((r.y0 + r.y1) / 2 - cy) < 4 && MONEY.test(r.text)).sort((a, b) => a.x0 - b.x0)[0];
      const below = /package price/i.test(l.text) ? lines.filter((r) => r.y0 > l.y1 - 1 && r.y0 - l.y1 < 14 && Math.abs(r.x1 - l.x1) < 30 && MONEY.test(r.text))[0] : null;
      const src = own ? l.text : (right ?? below)?.text;
      if (!src) continue;
      const m = src.match(MONEY);
      out.push({ page: p, label: l.text.replace(MONEY, "").trim(), value: Number(m[1].replace(/,/g, "")), aed: /AED/.test(src) || /AED/.test(l.text), y: l.y0 });
    }
  }
  return out;
}

/** The money rules; `taxDocument` allows the taxable amount ("Subtotal before VAT") that UAE tax invoices must carry. */
export function moneyProblems(buf, name = "PDF", { taxDocument = false } = {}) {
  const problems = [];
  const amounts = labelledAmounts(buf);
  // 1. A total or subtotal printed twice (or a package price printed again as a subtotal or total).
  for (let i = 0; i < amounts.length; i++) {
    for (let j = i + 1; j < amounts.length; j++) {
      const a = amounts[i], b = amounts[j];
      if (Math.abs(a.value - b.value) > 0.004 || a.value === 0) continue;
      if (taxDocument && [a, b].some((x) => /before vat/i.test(x.label))) continue;
      if (/balance due/i.test(a.label + b.label) && [a, b].some((x) => /total incl/i.test(x.label))) continue;
      problems.push(`${name}: AED ${a.value.toFixed(2)} is printed twice ("${a.label}" and "${b.label}")`);
    }
  }
  // 2. "AED" on every amount of the totals box.
  for (const a of amounts) if (!/subtotal$/i.test(a.label) && !/(labour|parts|charges) subtotal/i.test(a.label) && !a.aed) problems.push(`${name}: "${a.label}" has no AED`);
  // 3. A section subtotal under a single line, and a page holding only the totals / bank details / footer.
  const doc = mupdf.Document.openDocument(buf, "application/pdf");
  for (let p = 0; p < doc.countPages(); p++) {
    const page = doc.loadPage(p);
    const [, , , height] = page.getBounds();
    const lines = linesOf(page);
    const bars = lines.filter((l) => /^(LABOUR AND SERVICES|PARTS|OTHER CHARGES)$/.test(l.text));
    for (const sub of lines.filter((l) => /(labour|parts|other charges) subtotal/i.test(l.text))) {
      const bar = bars.filter((b) => b.y0 < sub.y0).sort((a, b) => b.y0 - a.y0)[0];
      const top = bar ? bar.y0 : 0;
      // A row number may come out joined to its description ("34 Part 34"): count every line that starts with one.
      const numbers = lines.filter((l) => /^\d+(\s|$)/.test(l.text) && l.y0 > top && l.y0 < sub.y0 && l.x0 < (bar ? bar.x0 + 24 : 80));
      // The owner's rule: a subtotal that equals the ONLY line above it - a box of one line (numbered 1). A box that
      // continues from the page before (its first number here is above 1) carries the whole box's sum, which is new.
      if (numbers.length === 1 && /^1(\s|$)/.test(numbers[0].text)) problems.push(`${name} p${p + 1}: "${sub.text}" repeats the only line above it`);
    }
    if (p > 0) {
      const body = lines.filter((l) => l.y0 > 40 && l.y1 < height - 70);
      const words = body.find((l) => /AMOUNT IN WORDS|BANK DETAILS/i.test(l.text));
      if (!body.length) problems.push(`${name} p${p + 1}: an empty page (header and footer only)`);
      else if (words && !body.some((l) => l.y1 < words.y0 - 1)) problems.push(`${name} p${p + 1}: the totals or bank details sit alone on this page`);
    }
  }
  return problems;
}
