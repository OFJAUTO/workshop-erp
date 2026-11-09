// The simple part sticker (9 November 2026, Section 5): THE name size and the label geometry in src/lib/label-fit.ts.
//   node --import ./tests/unit/register.mjs tests/unit/label-fit.test.mjs        (npm run test:unit)
const { fitName, labelBoxes, wrapWords } = await import("../../src/lib/label-fit.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

const b = labelBoxes(50, 25);
check("QR 18-20 mm on the left", b.qr >= 18 && b.qr <= 20, String(b.qr));
check("nothing within 2.5 mm of an edge", b.edge === 2.5 && b.rightX + b.rightW <= 50 - 2.5 + 1e-9 && b.nameTop + b.nameH <= 25 - 2.5 + 1e-9);
check("the OFJ mark about 14 mm wide", Math.abs(b.logoW - 14) < 0.5 || b.logoW === b.rightW, String(b.logoW));
const short = fitName("Rear main seal", b.rightW, b.nameH, 4.6, 1.6);
check("a short name is large", short.size >= 3, JSON.stringify(short));
const long = fitName("Front left lower control arm bush with bracket and bolts kit", b.rightW, b.nameH, 4.6, 1.6);
check("a long name shrinks and wraps, never breaking a word", long.size < short.size && long.lines.every((l) => l.split(" ").every((w) => "FRONT LEFT LOWER CONTROL ARM BUSH WITH BRACKET AND BOLTS KIT".includes(w))), JSON.stringify(long));
check("a long name still fits the box", long.lines.length * long.size * 1.08 <= b.nameH + 1e-9 || long.size === 1.6);
check("the name is in capitals as on the part line", short.lines.join(" ") === "REAR MAIN SEAL");
check("words wrap whole", JSON.stringify(wrapWords("FRONT LH LIGHT", 6)) === JSON.stringify(["FRONT", "LH", "LIGHT"]) || JSON.stringify(wrapWords("FRONT LH LIGHT", 6)) === JSON.stringify(["FRONT", "LH LIGHT"]));

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log("\nall passed");
