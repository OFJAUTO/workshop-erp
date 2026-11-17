// THE part-number check (17 November 2026, Section 7): the owner's real cases and real numbers that must stay clean.
//   node --import ./tests/unit/register.mjs tests/unit/part-number-check.test.mjs        (npm run test:unit)
const { madeUpPartNumber, madeUpWords } = await import("../../src/lib/part-number-check.ts");
const { placeholderReason } = await import("../../src/lib/send-check-rules.ts");
const { partNumberLooksLikeName } = await import("../../src/lib/part-change-rules.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

const flagged = [
  ["BLADE78", "REAR WIPER BLADE"],
  ["FILTER69", "OIL FILTER"],
  ["FILTER859", "AIR FILTER"],
  ["FRONT PAD145", "FRONT BRAKE PADS"],
  ["SOLITE859", "BATTERY SOLITE 80AH"],
  ["78BLADE", "WIPER BLADE"],
  ["FILTER-69", "CABIN FILTER"],
  ["PAD", "FRONT BRAKE PADS"],
  ["1234AA", "HEADLIGHT"],
  ["OFJ1", "SPARK PLUG"],
];
for (const [pn, name] of flagged) check(`flagged: "${pn}" on ${name}`, !!madeUpPartNumber(pn, name), JSON.stringify(madeUpPartNumber(pn, name)));
check("word + digits says so", /name with a number added/.test(madeUpWords("BLADE78", "REAR WIPER BLADE") ?? ""));

const real = [
  ["A1673306800", "FRONT BRAKE PADS"],
  ["LR012345", "AIR FILTER"],
  ["04465-0K290", "FRONT BRAKE PADS"],
  ["5Q0698151", "REAR BRAKE PADS"],
  ["0W20", "ENGINE OIL 0W20"],
  ["31336-1HJ0A", "TRANSMISSION MOUNT"],
  ["NO NUMBER", "ANY PART"],
  ["", "ANY PART"],
];
for (const [pn, name] of real) check(`clean: "${pn}" on ${name}`, madeUpPartNumber(pn, name) === null, JSON.stringify(madeUpPartNumber(pn, name)));

check("the check-before-send window flags BLADE78", /name with a number added/.test(placeholderReason({ partNumber: "BLADE78", name: "REAR WIPER BLADE", noNumberTicked: false }) ?? ""));
check("the Parts page flags FRONT PAD145", /name with a number added/.test(partNumberLooksLikeName("FRONT PAD145", "FRONT BRAKE PADS") ?? ""));
check("\"No part number yet\" stays the honest answer (no name flag)", partNumberLooksLikeName("NO NUMBER", "OIL FILTER") === null);

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
