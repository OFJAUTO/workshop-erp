/**
 * The cells of a text PDF, page by page, with their positions. The characters of each text line are grouped into
 * cells wherever the gap is wider than a character; lines on the same baseline (one text block per column, as most
 * PDF generators write tables) are joined into one row. Kept free of server imports so the import tests can run it
 * straight on a supplier's PDF: the caller hands in the mupdf module.
 */
import type { PosCell } from "./price-import";

type Char = { c: string; x: number; x2: number; size: number };
type Line = { y: number; chars: Char[] };

export type PdfCells = {
  /** Every row of positioned cells, per page (the table reader places them under the headings). */
  cellPages: PosCell[][][];
  /** The same rows as plain text cells in reading order, per page. */
  rowPages: string[][][];
  text: string;
  chars: number;
  pageCount: number;
  vin: string | null;
};

/** "Net Amount: 2,398.00" written as one cell becomes a label and a value, so the totals check can find it. */
function splitLabelValue(cells: string[]): string[] {
  if (cells.length !== 1) return cells;
  const m = cells[0].match(/^(.{2,40}?):\s*(AED\s*)?([\d][\d.,]*)$/i);
  return m ? [m[1].trim(), m[3]] : cells;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function readPdfCells(mupdf: any, buffer: Uint8Array): PdfCells {
  const doc = mupdf.Document.openDocument(buffer, "application/pdf");
  const pageCount = doc.countPages();
  const cellPages: PosCell[][][] = [];
  const rowPages: string[][][] = [];
  const textLines: string[] = [];
  let chars = 0;
  for (let i = 0; i < pageCount; i++) {
    const st = doc.loadPage(i).toStructuredText("preserve-whitespace");
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
    });
    const cellsOf = (ln: Line) => {
      const cells: PosCell[] = [];
      let text = "";
      let x0: number | null = null;
      let x2 = 0;
      let prev: Char | null = null;
      for (const ch of ln.chars) {
        chars++;
        if (prev && ch.x - prev.x2 > Math.max(prev.size, ch.size) * 0.9 && text.trim()) {
          cells.push({ x: x0 ?? 0, x2, text: text.trim() });
          text = "";
          x0 = null;
        }
        if (x0 === null && ch.c.trim()) x0 = ch.x;
        text += ch.c;
        if (ch.c.trim()) x2 = ch.x2;
        prev = ch;
      }
      if (text.trim()) cells.push({ x: x0 ?? 0, x2, text: text.trim() });
      return cells;
    };
    const sorted = lines.map((l) => ({ y: l.y, size: Math.max(...l.chars.map((c) => c.size)), cells: cellsOf(l) })).sort((a, b) => a.y - b.y);
    const rows: { y: number; size: number; cells: PosCell[] }[] = [];
    for (const l of sorted) {
      const last = rows[rows.length - 1];
      if (last && Math.abs(last.y - l.y) < Math.max(last.size, l.size) * 0.6) last.cells.push(...l.cells);
      else rows.push({ y: l.y, size: l.size, cells: [...l.cells] });
    }
    const isFooter = (cells: string[]) => cells.length === 1 && /^page\s+\d+(\s+of\s+\d+)?$/i.test(cells[0]);
    const kept = rows.map((r) => ({ ...r, cells: r.cells.sort((a, b) => a.x - b.x) })).filter((r) => !isFooter(r.cells.map((c) => c.text)));
    cellPages.push(kept.map((r) => r.cells));
    const pageRows = kept.map((r) => splitLabelValue(r.cells.map((c) => c.text)));
    rowPages.push(pageRows);
    for (const r of pageRows) textLines.push(r.join("\t"));
  }
  const text = textLines.join("\n");
  const vin = text.match(/\bVIN\b(?:\s*(?:NO|NUMBER|#)\.?)?[^A-Z0-9]{0,6}([A-HJ-NPR-Z0-9]{17})\b/i)?.[1]?.toUpperCase() ?? text.match(/\b([A-HJ-NPR-Z0-9]{17})\b/)?.[1]?.toUpperCase() ?? null;
  return { cellPages, rowPages, text, chars, pageCount, vin };
}
