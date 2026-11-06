// Number plates (6 November 2026, the AL TAMIMI Audi A8): THE plate rules.
//   node --import ./tests/unit/register.mjs tests/unit/plate-rules.test.mjs        (npm run test:unit)
const { checkPlateInput, plateFieldsOf, plateChanged, oldPlateEntry, appendOldPlates, editCarTitle, friendlyVehicleError, NO_PLATE_REASONS } = await import("../../src/lib/plate-rules.ts");
const { EMIRATES } = await import("../../src/lib/types.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };
const uae = (emirate, code, number) => ({ noPlate: false, country: "UAE", emirate, code, number });

// Every emirate, letter and number codes alike.
for (const e of EMIRATES) check(`${e}: letter code saves (DD 23864)`, checkPlateInput(uae(e, "DD", "23864")) === null);
check("Abu Dhabi: a NUMBER code saves (16 / 94155)", checkPlateInput(uae("Abu Dhabi", "16", "94155")) === null);
check("Sharjah: a one-digit code saves (1 / 555)", checkPlateInput(uae("Sharjah", "1", "555")) === null);
check("Dubai: one letter code (F 60238)", checkPlateInput(uae("Dubai", "F", "60238")) === null);
check("no code at all is fine", checkPlateInput(uae("Dubai", "", "23864")) === null);
check("number 1 digit and 5 digits are fine, 6 is refused in plain words", checkPlateInput(uae("Dubai", "A", "7")) === null && checkPlateInput(uae("Dubai", "A", "12345")) === null && /1 to 5 digits/.test(checkPlateInput(uae("Dubai", "A", "123456")) ?? ""));
check("a 3-character code is refused in plain words", /1 or 2 letters or digits/.test(checkPlateInput(uae("Dubai", "ABC", "23864")) ?? ""));
check("letters typed in the Number box are refused in plain words", /digits/.test(checkPlateInput(uae("Dubai", "DD", "23A64")) ?? ""));
check("UAE without an emirate is refused", /emirate/i.test(checkPlateInput({ noPlate: false, country: "UAE", emirate: "", code: "DD", number: "23864" }) ?? ""));
check("other country: free format with dashes (OM-1234-X)", checkPlateInput({ noPlate: false, country: "Oman", emirate: "", code: "", number: "OM-1234-X" }) === null);
check("no plate ticked: nothing checked", checkPlateInput({ noPlate: true, country: "", emirate: "", code: "", number: "" }) === null);

// THE fix: plateFieldsOf writes has_plate (the save used to leave it behind - the whole cause).
const f = plateFieldsOf(uae("Dubai", "dd", "23 864"));
check("a typed plate stores has_plate TRUE with tidy fields", f.has_plate === true && f.plate_code === "DD" && f.plate_number === "23864" && f.plate_emirate === "Dubai");
const n = plateFieldsOf({ noPlate: true, country: "UAE", emirate: "Dubai", code: "DD", number: "23864" });
check("No number plate stores has_plate FALSE with every plate field null (the database rule's shape)", n.has_plate === false && n.plate_number === null && n.plate_code === null && n.plate_emirate === null);
check("a non-UAE plate stores no emirate", plateFieldsOf({ noPlate: false, country: "Oman", emirate: "Dubai", code: "", number: "123" }).plate_emirate === null);

// A change of an existing plate needs the remark; adding one to a no-plate car never does.
const noPlateCar = { has_plate: false, plate_country: "UAE", plate_emirate: null, plate_code: null, plate_number: null };
const dubaiDd = { has_plate: true, plate_country: "UAE", plate_emirate: "Dubai", plate_code: "DD", plate_number: "23864" };
check("adding a plate to a no-plate car is not a change", plateChanged(noPlateCar, plateFieldsOf(uae("Dubai", "DD", "23864"))) === false);
check("a different number IS a change", plateChanged(dubaiDd, plateFieldsOf(uae("Dubai", "DD", "99999"))) === true);
check("a different emirate IS a change", plateChanged(dubaiDd, plateFieldsOf(uae("Sharjah", "DD", "23864"))) === true);
check("the same plate re-saved is not a change", plateChanged(dubaiDd, plateFieldsOf(uae("Dubai", "DD", "23864"))) === false);
check("taking the plate OFF is a change", plateChanged(dubaiDd, plateFieldsOf({ noPlate: true, country: "UAE", emirate: "", code: "", number: "" })) === true);

// Old plates: formatted + compact so both search spellings hit; appended once.
const entry = oldPlateEntry(dubaiDd);
check(`the old-plate entry carries words and the compact form ("${entry}")`, entry === "Dubai DD 23864 DD23864");
check("appended once, never twice", appendOldPlates(null, entry) === "Dubai DD 23864 DD23864" && appendOldPlates("Dubai DD 23864 DD23864", entry) === "Dubai DD 23864 DD23864" && appendOldPlates("Dubai DD 23864 DD23864", "Dubai F 1 F1") === "Dubai DD 23864 DD23864 · Dubai F 1 F1");
check("a no-plate car makes no entry", oldPlateEntry(noPlateCar) === null);

// The page title and the plain-words database refusals.
check("title with a plate", editCarTitle("Audi A8", dubaiDd) === "Edit car · AUDI A8 · DUBAI DD 23864");
check("title without one", editCarTitle("Audi A8", noPlateCar) === "Edit car · AUDI A8 · No plate yet");
check("the old raw error reads as plain words", /Untick/.test(friendlyVehicleError('new row for relation "vehicles" violates check constraint "vehicles_plate_rules"') ?? ""));
check("a duplicate plate reads as plain words", friendlyVehicleError("duplicate key value violates unique constraint \"vehicles_active_plate_idx\"") === "A car with this plate already exists.");
check("an unknown error is NOT worded here (the caller logs it and shows SAVE_FAILED)", friendlyVehicleError("something odd") === null);
check("the no-plate reasons exist for the gate-in form", NO_PLATE_REASONS.length === 4 && NO_PLATE_REASONS[0].startsWith("New car"));

console.log(failed ? `\n${failed} check(s) failed` : "\nAll plate-rules checks passed");
process.exit(failed ? 1 : 0);
