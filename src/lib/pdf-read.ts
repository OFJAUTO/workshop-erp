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

/**
 * How full the last page of one of our A4 documents is (0 to 1): the lowest text or picture between the compact
 * header and the footer, as a share of the body's height. The report uses it to avoid a nearly empty last page.
 */
export async function pdfLastPageFill(buffer: Buffer | Uint8Array, body: { top: number; bottom: number } = { top: 66, bottom: 732 }): Promise<{ pages: number; fill: number }> {
  const mupdf = await lib();
  const doc = mupdf.Document.openDocument(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer), "application/pdf");
  const pages = doc.countPages();
  const data = JSON.parse(doc.loadPage(pages - 1).toStructuredText("preserve-images").asJSON()) as { blocks?: { bbox: { y: number; h: number } }[] };
  let lowest = body.top;
  for (const b of data.blocks ?? []) if (b.bbox.y >= body.top && b.bbox.y < body.bottom) lowest = Math.max(lowest, Math.min(body.bottom, b.bbox.y + b.bbox.h));
  return { pages, fill: (lowest - body.top) / (body.bottom - body.top) };
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

/**
 * Where a money document's totals block landed (31 October 2026): the page holding "AMOUNT IN WORDS", whether anything
 * of the document sits above it on that page (below the small page-2 header), and pages with nothing between the
 * header and the footer. Used to draw a document again so the totals travel with the last lines and no page is empty.
 */
export async function pdfTailFacts(buffer: Buffer | Uint8Array, marker = "AMOUNT IN WORDS"): Promise<{ pages: number; tailPage: number | null; tailAlone: boolean; emptyPages: number[] }> {
  const mupdf = await lib();
  const doc = mupdf.Document.openDocument(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer), "application/pdf");
  const pages = doc.countPages();
  let tailPage: number | null = null;
  let tailAlone = false;
  const emptyPages: number[] = [];
  for (let p = 0; p < pages; p++) {
    const page = doc.loadPage(p);
    const [, , , height] = page.getBounds();
    const data = JSON.parse(page.toStructuredText("preserve-whitespace").asJSON()) as { blocks?: { lines?: { bbox: { y: number; h: number }; text: string }[] }[] };
    const lines = (data.blocks ?? []).flatMap((b) => b.lines ?? []).filter((l) => String(l.text ?? "").trim());
    // Page 2+ carries a small header (logo + title) above y 40 and the footer row in the bottom 70 points.
    const body = lines.filter((l) => l.bbox.y > 40 && l.bbox.y + l.bbox.h < height - 70);
    if (p > 0 && body.length === 0) emptyPages.push(p);
    const m = lines.find((l) => String(l.text).toUpperCase().includes(marker));
    if (m && tailPage === null) {
      tailPage = p;
      tailAlone = p > 0 && !body.some((l) => l.bbox.y + l.bbox.h < m.bbox.y - 1);
    }
  }
  return { pages, tailPage, tailAlone, emptyPages };
}

/**
 * Draws a document by the page rules (31 October 2026): normally; when it runs onto a second page, again with tight
 * spacing (kept when it saves a page); and when the totals block would start a page alone, again with the last two
 * lines moved over with it. `draw` builds the document for the given look.
 */
export async function renderByPageRules(draw: (look: { tight: boolean; keepLast: boolean }) => Promise<Buffer>): Promise<Buffer> {
  let tight = false;
  let buf = await draw({ tight, keepLast: false });
  let facts = await pdfTailFacts(buf);
  if (facts.pages > 1 || facts.emptyPages.length) {
    const t = await draw({ tight: true, keepLast: false });
    const tf = await pdfTailFacts(t);
    if (tf.pages < facts.pages || (tf.pages === facts.pages && !tf.tailAlone && facts.tailAlone)) {
      buf = t;
      facts = tf;
      tight = true;
    }
  }
  if (facts.tailAlone) {
    const k = await draw({ tight, keepLast: true });
    const kf = await pdfTailFacts(k);
    if (!kf.tailAlone && !kf.emptyPages.length) return k;
  }
  return buf;
}
