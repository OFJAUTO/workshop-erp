// The declined-work document rules (5 November 2026, J-00970): only real findings and parts, repeats
// removed with the worst severity kept, grouped Replace now → Replace → Advisory, and an old
// invoice's note block split out and read back.
import { strict as assert } from "node:assert";
import { cleanDeclined, declinedSummary, groupDeclined, isDocItem, splitDeclinedNotes } from "../../src/lib/declined-doc.ts";

let passed = 0;
const check = (name, fn) => { try { fn(); passed++; console.log(`OK   ${name}`); } catch (e) { console.error(`FAIL ${name}: ${e.message}`); process.exitCode = 1; } };

check("labour, consumables, bare Other and service packages are never on the document", () => {
  for (const t of ["LABOUR CHARGES – TURBOCHARGER ASSEMBLY REPLACEMENT", "Labour", "CONSUMABLES", "Consumable", "Other", "OTHER – replace", "MINOR SERVICE", "Major Service", "Service package Gold"]) {
    assert.equal(isDocItem(t), false, t);
  }
  for (const t of ["Rear brake pads", "FRONT LH HEAD LIGHT", "Engine oil leak – valve cover", "Battery", "Other noises from the rear"]) {
    assert.equal(isDocItem(t), true, t);
  }
});

check("repeats collapse to one, the worst severity wins, spacing and case never split them", () => {
  const out = cleanDeclined([
    { title: "Rear brake pads", severity: "Advisory" },
    { title: "REAR  BRAKE   PADS", severity: "Replace now" },
    { title: "rear brake pads", severity: "Replace" },
    { title: "CONSUMABLES", severity: "Replace" },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].severity, "Replace now");
  assert.equal(out[0].title, "Rear brake pads");
});

check("groups come Replace now → Replace → Advisory, items alphabetical, empty groups dropped", () => {
  const groups = groupDeclined([
    { title: "Wiper blades", severity: "Advisory" },
    { title: "Front brake pads", severity: "Replace" },
    { title: "Air filter", severity: "Advisory" },
    { title: "Tyre FL", severity: "Replace now" },
  ]);
  assert.deepEqual(groups.map((g) => g.label), ["Replace now", "Replace", "Advisory"]);
  assert.deepEqual(groups[2].items, ["Air filter", "Wiper blades"]);
});

check("the one-line summary reads naturally", () => {
  assert.equal(declinedSummary(38, "page 2"), "38 recommended items declined by the customer – listed on page 2");
  assert.equal(declinedSummary(1, "below"), "1 recommended item declined by the customer – listed below");
});

check("an old invoice's note block splits out whole and reads back as items", () => {
  const notes = "Please call us.\nRecommended work declined by the customer:\n• Rear brake pads – Replace now\n• Wiper blades – Advisory\n• LABOUR CHARGES – TURBO – Replace\nThank you.";
  const { rest, legacy } = splitDeclinedNotes(notes);
  assert.equal(rest, "Please call us.\nThank you.");
  assert.equal(legacy.length, 3);
  assert.equal(legacy[0].severity, "Replace now");
  assert.equal(cleanDeclined(legacy).length, 2, "the labour bullet is filtered for the document");
  assert.deepEqual(splitDeclinedNotes("Just a note."), { rest: "Just a note.", legacy: [] });
  assert.deepEqual(splitDeclinedNotes(null), { rest: null, legacy: [] });
});

console.log(process.exitCode ? "Some declined-doc checks failed" : `All passed (${passed})`);
