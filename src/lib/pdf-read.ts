import "server-only";

/**
 * Reading a supplier's PDF for the price import. A PDF with real text gives its table back as rows of cells with
 * their positions (src/lib/pdf-cells.ts), so the table reader can place every cell under its heading. A scanned PDF
 * (a picture, no text) is detected so it can go through the screenshot reader page by page.
 */
import { readPdfCells } from "./pdf-cells";
import type { PosCell, PosLine } from "./price-import";

export type PdfRead = {
  /** Rows of cells per page, in reading order. */
  pages: string[][][];
  /** The same rows with each cell's left and right edge, for the reader that goes by the headings. */
  cellPages: PosCell[][][];
  /** Every line of text, page after page, for the one-value-per-line reader when the cells did not line up. */
  text: string;
  scanned: boolean;
  pageCount: number;
  /** A chassis number written anywhere in the PDF ("VIN: …"), for the check against the car. */
  vin: string | null;
};

async function lib() {
  return await import("mupdf");
}

export async function readPdfRows(buffer: Buffer | Uint8Array): Promise<PdfRead> {
  const r = readPdfCells(await lib(), buffer);
  return { pages: r.rowPages, cellPages: r.cellPages, text: r.text, scanned: r.chars < 20, pageCount: r.pageCount, vin: r.vin };
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

/** How many pages a PDF has. */
export async function pdfPageCount(buffer: Buffer | Uint8Array): Promise<number> {
  const mupdf = await lib();
  return mupdf.Document.openDocument(buffer, "application/pdf").countPages();
}

/** One page of a PDF as a PNG at the given scale (2 = crisp on a phone), or null when the page does not exist. */
export async function renderPdfPage(buffer: Buffer | Uint8Array, index: number, scale = 2): Promise<Uint8Array | null> {
  const mupdf = await lib();
  const doc = mupdf.Document.openDocument(buffer, "application/pdf");
  if (index < 0 || index >= doc.countPages()) return null;
  return doc.loadPage(index).toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true).asPNG();
}

/** Every text line with its position, page by page: the dealer-block parser works off the geometry. */
export async function readPdfPositionedLines(buffer: Buffer | Uint8Array): Promise<PosLine[][]> {
  const mupdf = await lib();
  const doc = mupdf.Document.openDocument(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer), "application/pdf");
  const pages: PosLine[][] = [];
  for (let p = 0; p < doc.countPages(); p++) {
    const data = JSON.parse(doc.loadPage(p).toStructuredText("preserve-whitespace").asJSON()) as { blocks?: { lines?: { bbox: { x: number; y: number }; text: string }[] }[] };
    const lines: PosLine[] = [];
    for (const block of data.blocks ?? []) for (const line of block.lines ?? []) lines.push({ x: line.bbox.x, y: line.bbox.y, text: line.text });
    pages.push(lines);
  }
  return pages;
}
