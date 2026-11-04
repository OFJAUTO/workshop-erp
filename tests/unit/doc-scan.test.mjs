// The scanner's pixel work (4 November 2026): a synthetic photo like the bad GARGASH one - an angled white
// invoice on a dark desk WITH A KEYBOARD IN THE SHOT - must come out as a straight, clean page in one PDF.
//   node --import ./tests/unit/register.mjs tests/unit/doc-scan.test.mjs        (npm run test:unit)
const S = await import("../../src/lib/doc-scan.ts");
const { detectQuad, warp, enhance, pagesToPdf, outputSize, insetQuad, quadArea } = S;
const mupdf = await import("mupdf");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

/* ---- the synthetic photo: 320×240, dark desk, angled bright paper, a darker keyboard block ---- */
const W = 320, H = 240;
const img = { data: new Uint8ClampedArray(W * H * 4), width: W, height: H };
const put = (x, y, v) => { const p = (y * W + x) * 4; img.data[p] = img.data[p + 1] = img.data[p + 2] = v; img.data[p + 3] = 255; };
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) put(x, y, 55 + ((x * 7 + y * 13) % 10)); // the desk, slightly noisy
// The paper: a convex quad, visibly angled (like a photo taken from one side).
const TRUE = [{ x: 60, y: 30 }, { x: 270, y: 50 }, { x: 250, y: 210 }, { x: 40, y: 185 }];
const inQuad = (x, y, q) => {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (cross === 0) continue;
    if (!sign) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
};
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inQuad(x, y, TRUE)) put(x, y, 235 + ((x + y) % 2) * 8);
// "Text" on the paper: dark bars drawn ON THE PAPER'S OWN PLANE (like print), so they run straight once warped.
const sq = (() => {
  const [p0, p1, p2, p3] = TRUE;
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
  const det = dx1 * dy2 - dx2 * dy1;
  const a13 = (dx3 * dy2 - dx2 * dy3) / det, a23 = (dx1 * dy3 - dx3 * dy1) / det;
  return (u, v) => {
    const w = a13 * u + a23 * v + 1;
    return { x: ((p1.x - p0.x + a13 * p1.x) * u + (p3.x - p0.x + a23 * p3.x) * v + p0.x) / w, y: ((p1.y - p0.y + a13 * p1.y) * u + (p3.y - p0.y + a23 * p3.y) * v + p0.y) / w };
  };
})();
for (let row = 0; row < 6; row++) for (let dv = 0; dv < 20; dv++) for (let du = 0; du < 600; du++) {
  const p = sq(0.15 + (du / 600) * 0.7, 0.2 + row * 0.1 + dv / 1000);
  put(Math.round(p.x), Math.round(p.y), 30);
}
// The keyboard in the shot: a mid-grey block at the bottom, NOT part of the paper.
for (let y = 215; y < 240; y++) for (let x = 20; x < 300; x++) put(x, y, 95);

/* ---- 1. the paper is found despite the keyboard ---- */
const q = detectQuad(img);
check("the paper's corners are found", !!q);
const near = (a, b, tol = 10) => Math.hypot(a.x - b.x, a.y - b.y) <= tol;
check("all four corners land on the paper (±10 px)", !!q && q.every((p, i) => near(p, TRUE[i])), q ? q.map((p) => `${p.x},${p.y}`).join(" ") : "none");

/* ---- 2. the warp pulls it straight ---- */
const size = outputSize(q ?? insetQuad(W, H), 400);
const page = warp(img, q ?? insetQuad(W, H), size.w, size.h);
const grayAt = (im, x, y) => im.data[(y * im.width + x) * 4];
check("the straightened page is paper-bright at every corner (the desk is gone)", [[4, 4], [size.w - 5, 4], [size.w - 5, size.h - 5], [4, size.h - 5]].every(([x, y]) => grayAt(page, x, y) > 200));
// The text bars run straight now: one output row crossing a bar is dark across most of its width.
let darkRow = -1;
for (let y = 0; y < size.h; y++) {
  let dark = 0;
  for (let x = Math.floor(size.w * 0.3); x < Math.floor(size.w * 0.7); x++) if (grayAt(page, x, y) < 90) dark++;
  if (dark > size.w * 0.35) { darkRow = y; break; }
}
check("a text line runs straight across the page", darkRow > 0, `row ${darkRow}`);

/* ---- 3. black & white cleaning ---- */
const bw = { data: new Uint8ClampedArray(page.data), width: page.width, height: page.height };
enhance(bw, "bw");
const vals = new Set();
for (let i = 0; i < bw.data.length; i += 4) vals.add(bw.data[i]);
check("black & white is really two tones", vals.size <= 2 && vals.has(0) && vals.has(255), [...vals].join(","));
check("the paper is white and the text black after cleaning", grayAt(bw, 4, 4) === 255 && grayAt(bw, Math.floor(size.w / 2), darkRow) === 0);
const grey = { data: new Uint8ClampedArray(page.data), width: page.width, height: page.height };
enhance(grey, "grey");
check("greyscale keeps shades but stretches them", grayAt(grey, 4, 4) > 230);

/* ---- 4. two pages into ONE pdf that really opens ---- */
// A tiny valid JPEG of each page via mupdf is overkill here: the PDF wrapper is what we test, so a minimal
// JPEG (mupdf renders it) is made by mupdf itself from a pixmap... simpler: use a fixed 1×1 JPEG twice.
const JPEG_1PX = Uint8Array.from(Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64"));
const pdf = pagesToPdf([{ jpeg: JPEG_1PX, width: 1, height: 1 }, { jpeg: JPEG_1PX, width: 1, height: 1 }]);
const doc = mupdf.Document.openDocument(Buffer.from(pdf), "application/pdf");
check("the PDF opens with 2 pages", doc.countPages() === 2);
const p0 = doc.loadPage(0);
const pix = p0.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false, true);
check("page 1 renders", pix.getWidth() > 0 && pix.getHeight() > 0, `${pix.getWidth()}×${pix.getHeight()}`);

/* ---- 5. nothing found = the inset frame, never a crash ---- */
const flat = { data: new Uint8ClampedArray(64 * 64 * 4).fill(40), width: 64, height: 64 };
check("a photo with no paper gives null (the scanner shows the inset frame)", detectQuad(flat) === null);
check("the inset frame is a real page shape", quadArea(insetQuad(100, 100)) > 100 * 100 * 0.5);

console.log(failed ? `${failed} FAILED` : "all passed");
process.exit(failed ? 1 : 0);
