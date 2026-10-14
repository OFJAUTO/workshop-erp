import "server-only";

/**
 * Reading a supplier's PDF for the price import. A PDF with real text gives its table back as rows of cells:
 * the characters of each line are grouped into cells wherever the gap is wider than a character, and lines on
 * the same baseline (one text block per column, as most PDF generators write tables) are joined into one row.
 * A scanned PDF (a picture, no text) is detected so it can go through the screenshot reader page by page.
 */
export type PdfRead = {
  /** Rows of cells per page. */
  pages: string[][][];
  /** Every line of text, page after page, for the one-value-per-line reader when the cells did not line up. */
  text: string;
  scanned: boolean;
  pageCount: number;
  /** A chassis number written anywhere in the PDF ("VIN: …"), for the check against the car. */
  vin: string | null;
};

type Char = { c: string; x: number; x2: number; size: number };
type Line = { y: number; chars: Char[] };

async function lib() {
  return await import("mupdf");
}

/** "Net Amount: 2,398.00" written as one cell becomes a label and a value, so the totals check can find it. */
function splitLabelValue(cells: string[]): string[] {
  if (cells.length !== 1) return cells;
  const m = cells[0].match(/^(.{2,40}?):\s*(AED\s*)?([\d][\d.,]*)$/i);
  return m ? [m[1].trim(), m[3]] : cells;
}

export async function readPdfRows(buffer: Buffer | Uint8Array): Promise<PdfRead> {
  const mupdf = await lib();
  const doc = mupdf.Document.openDocument(buffer, "application/pdf");
  const pageCount = doc.countPages();
  const pages: string[][][] = [];
  const textLines: string[] = [];
  let chars = 0;
  for (let i = 0; i < pageCount; i++) {
    const page = doc.loadPage(i);
    const st = page.toStructuredText("preserve-whitespace");
    const lines: Line[] = [];
    let cur: Line | null = null;
    st.walk({
      beginLine(bbox: number[]) {
        cur = { y: (bbox[1] + bbox[3]) / 2, chars: [] };
      },
      onChar(c: string, _origin: unknown, _font: unknown, size: number, quad: number[]) {
        if (cur) cur.chars.push({ c, x: Math.min(quad[0], quad[4]), x2: Math.max(quad[2], quad[6]), size });
      },
      endLine() {
        if (cur && cur.chars.length) lines.push(cur);
        cur = null;
      },
    } as Parameters<typeof st.walk>[0]);
    const cellsOf = (ln: Line) => {
      const cells: { x: number; text: string }[] = [];
      let text = "";
      let x0: number | null = null;
      let prev: Char | null = null;
      for (const ch of ln.chars) {
        chars++;
        if (prev && ch.x - prev.x2 > Math.max(prev.size, ch.size) * 0.9 && text.trim()) {
          cells.push({ x: x0 ?? 0, text: text.trim() });
          text = "";
          x0 = null;
        }
        if (x0 === null) x0 = ch.x;
        text += ch.c;
        prev = ch;
      }
      if (text.trim()) cells.push({ x: x0 ?? 0, text: text.trim() });
      return cells;
    };
    const sorted = lines.map((l) => ({ y: l.y, size: Math.max(...l.chars.map((c) => c.size)), cells: cellsOf(l) })).sort((a, b) => a.y - b.y);
    const rows: { y: number; size: number; cells: { x: number; text: string }[] }[] = [];
    for (const l of sorted) {
      const last = rows[rows.length - 1];
      if (last && Math.abs(last.y - l.y) < Math.max(last.size, l.size) * 0.6) last.cells.push(...l.cells);
      else rows.push({ y: l.y, size: l.size, cells: [...l.cells] });
    }
    const pageRows = rows.map((r) => splitLabelValue(r.cells.sort((a, b) => a.x - b.x).map((c) => c.text))).filter((cells) => !(cells.length === 1 && /^page\s+\d+(\s+of\s+\d+)?$/i.test(cells[0])));
    pages.push(pageRows);
    for (const r of pageRows) textLines.push(r.join("\t"));
  }
  const text = textLines.join("\n");
  const vin = text.match(/\bVIN\b[^A-Z0-9]{0,6}([A-HJ-NPR-Z0-9]{17})\b/i)?.[1]?.toUpperCase() ?? text.match(/\b([A-HJ-NPR-Z0-9]{17})\b/)?.[1]?.toUpperCase() ?? null;
  return { pages, text, scanned: chars < 20, pageCount, vin };
}

/** The pages of a scanned PDF as PNG pictures for the screenshot reader (twice the size, for the small print). */
export async function renderPdfPages(buffer: Buffer | Uint8Array, maxPages = 8): Promise<Uint8Array[]> {
  const mupdf = await lib();
  const doc = mupdf.Document.openDocument(buffer, "application/pdf");
  const n = Math.min(doc.countPages(), maxPages);
  const out: Uint8Array[] = [];
  for (let i = 0; i < n; i++) {
    const pix = doc.loadPage(i).toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false, true);
    out.push(pix.asPNG());
  }
  return out;
}
