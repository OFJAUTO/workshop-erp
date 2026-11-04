/**
 * "Scan document" (4 November 2026): the pixel work behind the scanner, PURE - no DOM, no server - so the
 * browser component and the unit tests run the same code. Finds the paper in a photo (the brightest big
 * region's corners, with a safe fallback), straightens it (square-to-quad projective warp with bilinear
 * sampling), cleans it for reading (black & white by Bradley's adaptive threshold, or greyscale by a
 * contrast stretch), and binds the finished JPEG pages into ONE small PDF.
 */

export type Pt = { x: number; y: number };
/** Four corners in order: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Pt, Pt, Pt, Pt];
/** What canvas getImageData gives: RGBA bytes. The lib never touches the DOM. */
export type Rgba = { data: Uint8ClampedArray; width: number; height: number };

const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);

/* ------------------------------------------------------------------------------------------------------------ */
/* Finding the paper                                                                                             */
/* ------------------------------------------------------------------------------------------------------------ */

function grayOf(img: Rgba): Uint8Array {
  const { data, width, height } = img;
  const g = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) g[i] = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
  return g;
}

/** Otsu's threshold: splits dark background from the bright paper. */
function otsu(g: Uint8Array): number {
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < g.length; i++) hist[g[i]]++;
  const total = g.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let best = 127;
  let max = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > max) {
      max = between;
      best = t;
    }
  }
  return best;
}

/**
 * The paper's four corners in a photo: the largest BRIGHT connected region (paper is brighter than the
 * desk, a keyboard or a hand) and its extreme points. Returns null when no clear paper is found - the
 * scanner then starts with an inset frame for the person to adjust. Coordinates are in the given image's
 * own pixels (the caller downsizes first; ~320 px wide is plenty and fast).
 */
export function detectQuad(img: Rgba): Quad | null {
  const { width: w, height: h } = img;
  if (w < 20 || h < 20) return null;
  const g = grayOf(img);
  const t = Math.min(otsu(g), 235);
  const bright = new Uint8Array(w * h);
  for (let i = 0; i < g.length; i++) bright[i] = g[i] > t ? 1 : 0;
  // The largest bright connected region (4-way flood fill with an explicit stack).
  const seen = new Uint8Array(w * h);
  let bestPixels: Int32Array | null = null;
  let bestCount = 0;
  const stack = new Int32Array(w * h);
  for (let start = 0; start < bright.length; start++) {
    if (!bright[start] || seen[start]) continue;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    const mine = new Int32Array(w * h);
    let count = 0;
    while (top > 0) {
      const i = stack[--top];
      mine[count++] = i;
      const x = i % w;
      if (x > 0 && bright[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack[top++] = i - 1; }
      if (x < w - 1 && bright[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack[top++] = i + 1; }
      if (i >= w && bright[i - w] && !seen[i - w]) { seen[i - w] = 1; stack[top++] = i - w; }
      if (i < w * (h - 1) && bright[i + w] && !seen[i + w]) { seen[i + w] = 1; stack[top++] = i + w; }
    }
    if (count > bestCount) {
      bestCount = count;
      bestPixels = mine.slice(0, count);
    }
  }
  // Too small to be a document in the frame (under 12% of the photo): let the person frame it by hand.
  if (!bestPixels || bestCount < w * h * 0.12) return null;
  // The region's extreme points are the paper's corners (robust to perspective).
  let tl = 0, tr = 0, br = 0, bl = 0;
  let tlV = Infinity, trV = -Infinity, brV = -Infinity, blV = Infinity;
  for (let k = 0; k < bestPixels.length; k++) {
    const i = bestPixels[k];
    const x = i % w;
    const y = (i - x) / w;
    if (x + y < tlV) { tlV = x + y; tl = i; }
    if (x - y > trV) { trV = x - y; tr = i; }
    if (x + y > brV) { brV = x + y; br = i; }
    if (x - y < blV) { blV = x - y; bl = i; }
  }
  const pt = (i: number): Pt => ({ x: i % w, y: Math.floor(i / w) });
  const quad: Quad = [pt(tl), pt(tr), pt(br), pt(bl)];
  // A degenerate quad (all corners in a line, or a sliver) is no document.
  if (quadArea(quad) < w * h * 0.1) return null;
  return quad;
}

export function quadArea(q: Quad): number {
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const p = q[i];
    const n = q[(i + 1) % 4];
    a += p.x * n.y - n.x * p.y;
  }
  return Math.abs(a / 2);
}

/** The straightened page's size: the quad's own side lengths, capped, A4-ish aspect kept from the photo. */
export function outputSize(q: Quad, maxSide = 1700): { w: number; h: number } {
  const len = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
  const w = Math.max(len(q[0], q[1]), len(q[3], q[2]));
  const h = Math.max(len(q[0], q[3]), len(q[1], q[2]));
  const scale = Math.min(1 * maxSide / Math.max(w, h, 1), 4);
  return { w: Math.max(16, Math.round(w * scale)), h: Math.max(16, Math.round(h * scale)) };
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Straightening                                                                                                 */
/* ------------------------------------------------------------------------------------------------------------ */

type H8 = { a11: number; a12: number; a13: number; a21: number; a22: number; a23: number; a31: number; a32: number };

/** The projective map taking the unit square's corners to the quad (top-left → (0,0) … bottom-left → (0,1)). */
function squareToQuad(q: Quad): H8 {
  const [p0, p1, p2, p3] = q;
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
  const det = dx1 * dy2 - dx2 * dy1 || 1e-9;
  const a13 = (dx3 * dy2 - dx2 * dy3) / det;
  const a23 = (dx1 * dy3 - dx3 * dy1) / det;
  return {
    a11: p1.x - p0.x + a13 * p1.x,
    a21: p3.x - p0.x + a23 * p3.x,
    a31: p0.x,
    a12: p1.y - p0.y + a13 * p1.y,
    a22: p3.y - p0.y + a23 * p3.y,
    a32: p0.y,
    a13,
    a23,
  };
}

/** The photo's quad pulled straight into a w×h page (bilinear sampling; edges clamp). */
export function warp(src: Rgba, quad: Quad, w: number, h: number): Rgba {
  const m = squareToQuad(quad);
  const out = new Uint8ClampedArray(w * h * 4);
  const sw = src.width;
  const sh = src.height;
  const d = src.data;
  let o = 0;
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h;
    for (let x = 0; x < w; x++, o += 4) {
      const u = (x + 0.5) / w;
      const den = m.a13 * u + m.a23 * v + 1;
      const sx = clamp((m.a11 * u + m.a21 * v + m.a31) / den, 0, sw - 1.001);
      const sy = clamp((m.a12 * u + m.a22 * v + m.a32) / den, 0, sh - 1.001);
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + sw * 4;
      const i11 = i01 + 4;
      for (let c = 0; c < 3; c++) {
        const top = d[i00 + c] * (1 - fx) + d[i10 + c] * fx;
        const bot = d[i01 + c] * (1 - fx) + d[i11 + c] * fx;
        out[o + c] = top * (1 - fy) + bot * fy;
      }
      out[o + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Cleaning for reading                                                                                          */
/* ------------------------------------------------------------------------------------------------------------ */

export type EnhanceMode = "bw" | "grey" | "colour";

/** Cleans the page in place: "bw" = crisp black & white (adaptive threshold), "grey" = stretched greyscale. */
export function enhance(img: Rgba, mode: EnhanceMode): void {
  if (mode === "colour") return;
  const { data, width: w, height: h } = img;
  const g = grayOf(img);
  if (mode === "grey") {
    // Stretch between the 2nd and 98th percentile: faint print darkens, the paper goes white.
    const sorted = Uint8Array.from(g).sort();
    const lo = sorted[Math.floor(sorted.length * 0.02)];
    const hi = Math.max(lo + 1, sorted[Math.floor(sorted.length * 0.98)]);
    for (let i = 0, p = 0; i < g.length; i++, p += 4) {
      const v = clamp(((g[i] - lo) * 255) / (hi - lo), 0, 255);
      data[p] = data[p + 1] = data[p + 2] = v;
    }
    return;
  }
  // Bradley's adaptive threshold: each pixel against the average of its neighbourhood (window w/8, t = 0.19).
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += g[y * w + x];
      integral[(y + 1) * (w + 1) + (x + 1)] = integral[y * (w + 1) + (x + 1)] + rowSum;
    }
  }
  const s = Math.max(8, Math.floor(w / 8));
  const half = s >> 1;
  const t = 0.19;
  for (let y = 0; y < h; y++) {
    const y1 = clamp(y - half, 0, h - 1);
    const y2 = clamp(y + half, 0, h - 1);
    for (let x = 0; x < w; x++) {
      const x1 = clamp(x - half, 0, w - 1);
      const x2 = clamp(x + half, 0, w - 1);
      const count = (x2 - x1 + 1) * (y2 - y1 + 1);
      const sum = integral[(y2 + 1) * (w + 1) + (x2 + 1)] - integral[y1 * (w + 1) + (x2 + 1)] - integral[(y2 + 1) * (w + 1) + x1] + integral[y1 * (w + 1) + x1];
      const v = g[y * w + x] * count <= sum * (1 - t) ? 0 : 255;
      const p = (y * w + x) * 4;
      data[p] = data[p + 1] = data[p + 2] = v;
    }
  }
}

/* ------------------------------------------------------------------------------------------------------------ */
/* The one PDF                                                                                                   */
/* ------------------------------------------------------------------------------------------------------------ */

export type PdfPage = { jpeg: Uint8Array; width: number; height: number };

const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);

/**
 * Binds the finished JPEG pages into one PDF (each page sized to the image, A4 width). Plain PDF 1.4 with
 * DCTDecode images - small, opens everywhere, and the same file the LPO page, Zoho and the reader get.
 */
export function pagesToPdf(pages: PdfPage[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (b: Uint8Array) => {
    parts.push(b);
    length += b.length;
  };
  const object = (body: Uint8Array) => {
    offsets.push(length);
    push(body);
  };
  push(ascii("%PDF-1.4\n%\xb5\xb5\n"));
  // Object numbers: 1 catalog, 2 pages, then per page i: page (3+3i), image (4+3i), contents (5+3i).
  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(" ");
  object(ascii(`1 0 obj\n<</Type /Catalog /Pages 2 0 R>>\nendobj\n`));
  object(ascii(`2 0 obj\n<</Type /Pages /Kids [${kids}] /Count ${pages.length}>>\nendobj\n`));
  pages.forEach((p, i) => {
    const pw = 595;
    const ph = Math.max(1, Math.round((595 * p.height) / Math.max(1, p.width)));
    const pageN = 3 + i * 3;
    const imageN = 4 + i * 3;
    const contentN = 5 + i * 3;
    object(ascii(`${pageN} 0 obj\n<</Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources <</XObject <</Im${i} ${imageN} 0 R>>>> /Contents ${contentN} 0 R>>\nendobj\n`));
    offsets.push(length);
    push(ascii(`${imageN} 0 obj\n<</Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length}>>\nstream\n`));
    push(p.jpeg);
    push(ascii(`\nendstream\nendobj\n`));
    const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im${i} Do Q`;
    object(ascii(`${contentN} 0 obj\n<</Length ${content.length}>>\nstream\n${content}\nendstream\nendobj\n`));
  });
  const xrefAt = length;
  const count = offsets.length + 1;
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, "0")} 00000 n \n`;
  push(ascii(xref));
  push(ascii(`trailer\n<</Size ${count} /Root 1 0 R>>\nstartxref\n${xrefAt}\n%%EOF\n`));
  const out = new Uint8Array(length);
  let at = 0;
  for (const b of parts) {
    out.set(b, at);
    at += b.length;
  }
  return out;
}

/** The default frame when no paper was found: a page-shaped inset the person drags into place. */
export function insetQuad(w: number, h: number): Quad {
  const mx = w * 0.08;
  const my = h * 0.08;
  return [
    { x: mx, y: my },
    { x: w - mx, y: my },
    { x: w - mx, y: h - my },
    { x: mx, y: h - my },
  ];
}
