// JOBS TO DO (11 November 2026, Section 9): the grouping rules.
//   node --import ./tests/unit/register.mjs tests/unit/jobs-to-do.test.mjs        (npm run test:unit)
const { buildJobsToDo, guessJobForPart, progressWords, handoverWords } = await import("../../src/lib/jobs-to-do.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

const lines = [
  { id: "a", title: "Replace front brake pads", position: 1, line_type: "labour", team: null },
  { id: "b", title: "Paint front bumper", position: 2, line_type: "labour", team: "paint" },
  { id: "c", title: "Engine oil service", position: 3, line_type: "service", team: null, isNew: true },
  { id: "d", title: "Rear wiper", position: 4, line_type: "labour", team: null, customer_approved: false },
  { id: "p", title: "Brake pads", position: 5, line_type: "part", team: null },
];
const parts = [
  { id: "x1", name: "Front brake pads", lineId: "a", state: "here" },
  { id: "x2", name: "Clip", lineId: null, state: "not_ordered" },
];
const t = buildJobsToDo({ lines, parts, ticks: new Set(["b"]), declined: [], svcOf: () => undefined, department: "mechanical", viewerSide: "workshop" });
check("the workshop's jobs are mine, numbered, in capitals", t.mine.length === 2 && t.mine[0].title === "REPLACE FRONT BRAKE PADS" && t.mine[0].n === 1);
check("the paint job is the bodyshop's", t.others.length === 1 && t.others[0].side === "bodyshop");
check("a part under its job; one with no job in Other parts", t.mine[0].parts.length === 1 && t.otherParts.length === 1);
check("parts lines are never jobs", ![...t.mine, ...t.others].some((j) => j.lineId === "p"));
check("the customer's no goes in its own list", t.declined.includes("REAR WIPER") && ![...t.mine, ...t.others].some((j) => j.lineId === "d"));
check("NEW on a job a revision added", t.mine.find((j) => j.lineId === "c")?.isNew === true);
check("a department only guessed is marked", t.mine[0].guessed === true && t.others[0].guessed === false);
check(`the words (${t.words})`, t.words === "Bodyshop 1/1 done · Workshop 0/2");
check("progress words skip an empty side", progressWords({ workshop: { done: 1, total: 2 }, bodyshop: { done: 0, total: 0 } }) === "Workshop 1/2");
check("a part is guessed to the job sharing its words", guessJobForPart("FRONT BUMPER CLIP", [{ id: "a", title: "Replace brake pads" }, { id: "b", title: "Paint front bumper" }]) === "b");
check("no shared word: no guess", guessJobForPart("Clip", [{ id: "a", title: "Replace brake pads" }]) === null);
const done = buildJobsToDo({ lines, parts: [], ticks: new Set(["a", "c"]), declined: [], svcOf: () => undefined, department: "mechanical", viewerSide: "workshop" });
check("the handover words when my side is done and the other is open", /1 job still open in the Bodyshop: PAINT FRONT BUMPER/.test(handoverWords(done) ?? ""), handoverWords(done) ?? "");

if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log("all passed");
