// 15 November 2026 (Section 6): LABELS PRINT BLACK ONLY. The thermal printer prints black or nothing, and browsers drop
// background fills unless "Background graphics" is on - so every label template is black text on white: no fill other
// than white, no colour other than black for text or lines, no opacity, no shadows, no rgba. Fails with the file and line.
//   node --import ./tests/unit/register.mjs tests/unit/label-black.test.mjs        (npm run test:unit)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
// Every label template: the sticker components (up to the print-page chrome), the PDF labels, the item tags.
const TEMPLATES = [
  { file: "src/components/StickerArt.tsx", until: "export function stickerPageCss" },
  { file: "src/lib/pdf/sticker-pdf.tsx" },
  { file: "src/lib/pdf/part-label-pdf.tsx" },
  { file: "src/app/(print)/print/item-tags/[jobId]/page.tsx", until: "return (" },
];
const BAD = [
  { why: "a background fill that is not white", re: /background(Color)?\s*:\s*"(?!#fff"|#ffffff"|#FFF"|white"|none"|transparent")[^"]*"/ },
  { why: "text or line colour that is not black", re: /(?<![A-Za-z])color\s*:\s*"(?!#000"|#000000"|black")[^"]*"/ },
  { why: "a line colour that is not black", re: /borderColor\s*:\s*"(?!#000"|#000000"|black")[^"]*"/ },
  { why: "a border in a colour other than black", re: /border\s*:\s*[`"][^`"]*solid\s+(?!#000\b|black\b)#?[A-Za-z0-9]+/ },
  { why: "opacity", re: /opacity\s*:/ },
  { why: "a shadow", re: /(box|text)Shadow\s*:/ },
  { why: "a see-through colour", re: /rgba\(/ },
];

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };
for (const t of TEMPLATES) {
  let src = fs.readFileSync(path.join(root, t.file), "utf8");
  if (t.until && src.includes(t.until)) src = src.slice(0, src.indexOf(t.until));
  const hits = [];
  src.split("\n").forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    for (const b of BAD) if (b.re.test(line)) hits.push(`line ${i + 1}: ${b.why}`);
  });
  check(`${t.file}: black text on white only`, hits.length === 0, hits.slice(0, 5).join(" | "));
}
// The check catches what it must (a black band with white text, a grey, an opacity).
const sample = ['<div style={{ background: "#000", color: "#fff" }}>', '<span style={{ color: "#5F6368" }}>', '<i style={{ opacity: 0.6 }}>'];
check("the check catches a filled band, grey text and opacity", sample.every((l) => BAD.some((b) => b.re.test(l))));
console.log(failed ? `${failed} failed` : "All label-black checks passed");
process.exit(failed ? 1 : 0);
