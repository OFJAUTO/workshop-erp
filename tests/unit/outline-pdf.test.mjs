// THE car outline in a PDF renders with FRONT / REAR / LEFT / RIGHT and the damaged panels coloured (30 October 2026,
// night batch section 4). The picture is kept as proof: tests/browser/shots/damage/outline-pdf.png.
import fs from "node:fs";
import path from "node:path";
const React = (await import("react")).default;
const { Document, Page, renderToBuffer } = await import("@react-pdf/renderer");
const { CarOutlinePdf } = await import("../../src/lib/pdf/car-outline-pdf.tsx");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };
const doc = React.createElement(Document, null, React.createElement(Page, { size: "A5", style: { padding: 30, alignItems: "center" } }, React.createElement(CarOutlinePdf, { tones: { front_bumper: "red", headlight_r: "amber" }, width: 220 })));
const buf = await renderToBuffer(doc);
check(`the PDF renders (${buf.length} bytes)`, buf.length > 1000);
const mupdf = await import("mupdf");
const pdf = mupdf.Document.openDocument(buf, "application/pdf");
const text = pdf.loadPage(0).toStructuredText().asText();
check("FRONT, REAR, LEFT and RIGHT are printed on it", ["FRONT", "REAR", "LEFT", "RIGHT"].every((w) => text.includes(w)), text.replace(/\s+/g, " ").trim());
const out = path.join(process.cwd(), "tests", "browser", "shots", "damage");
fs.mkdirSync(out, { recursive: true });
const png = pdf.loadPage(0).toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false, true).asPNG();
fs.writeFileSync(path.join(out, "outline-pdf.png"), png);
console.log(failed ? `FAILED (${failed})` : "All passed");
process.exit(failed ? 1 : 0);
