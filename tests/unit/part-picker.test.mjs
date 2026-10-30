// "+ Add a part" (30 October 2026, night batch section 7): Body (with the lights), Glass and Interior in the one picker,
// sided parts split into one line per side, a search that forgives spelling, and the damage list as suggestions.
//   node --import ./tests/unit/register.mjs tests/unit/part-picker.test.mjs        (npm run test:unit)
const { withBuiltInParts, searchParts, splitSided, sidesOf, damagePartSuggestions, BUILT_IN_PARTS } = await import("../../src/lib/body-parts.ts");
const { sortCategories } = await import("../../src/lib/parts-list.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

const owner = [
  { id: "11111111-1111-4111-8111-111111111111", category: "Brakes", name: "Brake pads", needs_position: true, usage_count: 40, unit: "set" },
  { id: "22222222-2222-4222-8222-222222222222", category: "Body", name: "headlight", needs_position: false, usage_count: 3 },
];
const pool = withBuiltInParts(owner);
check("Body, Glass and Interior join the pool", ["Body", "Glass", "Interior"].every((c) => pool.some((p) => p.category === c)), Array.from(new Set(pool.map((p) => p.category))).join(", "));
check("the owner's own row wins over the built-in one of the same name", pool.filter((p) => p.name.toLowerCase() === "headlight").length === 1 && pool.find((p) => p.name.toLowerCase() === "headlight").id === owner[1].id);
check("every part the owner asked for is there", ["front bumper", "rear bumper", "bumper grille", "radiator grille", "bonnet", "wing", "door", "tailgate", "roof panel", "side skirt", "wheel arch liner", "mirror (complete)", "mirror housing", "mirror glass", "door handle", "spoiler", "badge", "mouldings", "bumper bracket", "fog light cover", "tow hook cover", "washer jet", "number plate holder", "headlight", "tail light", "fog light", "indicator", "side repeater", "third brake light", "windscreen", "rear screen", "door glass", "quarter glass", "sunroof", "seat", "door card", "dashboard trim", "steering wheel", "centre console", "carpet", "headliner", "seat belt"].every((w) => /bumper$/.test(w) ? pool.some((p) => p.name === "Bumper") : pool.some((p) => p.name.toLowerCase().includes(w))));
check("the new categories sit before Other", sortCategories(["Other", "Interior", "Brakes", "Glass", "Body"]).join(",") === "Brakes,Body,Glass,Interior,Other");

check("\"grill\" finds the radiator grille", searchParts("grill", pool)[0]?.name === "Radiator grille", searchParts("grill", pool).map((p) => p.name).slice(0, 3).join(", "));
check("\"head light\" finds the headlight", searchParts("head light", pool)[0]?.name.toLowerCase() === "headlight");
check("\"bumpr\" (a letter missing) still finds the bumper", searchParts("bumpr", pool).some((p) => p.name === "Bumper"));
check("\"windshield\" finds the windscreen", searchParts("windshield", pool)[0]?.name === "Windscreen");
check("\"fender\" finds the front wing / fender", searchParts("fender", pool)[0]?.name === "Front wing / fender");
check("nonsense finds nothing", searchParts("xqzw", pool).length === 0);

check("a headlight comes in front left / front right", (sidesOf({ name: "Headlight" }) ?? []).join(",") === "Front left,Front right");
const split = splitSided([{ id: "e1", catalogue_id: null, name: "Headlight", qty: 2, positions: ["Front left", "Front right"], item_key: null, source: "custom", note: null }, { id: "e2", catalogue_id: null, name: "Door", qty: 1, positions: ["Rear left"], item_key: null, source: "custom", note: null }, { id: "e3", catalogue_id: owner[0].id, name: "Brake pads", qty: 1, positions: ["Front"], item_key: null, source: "custom", note: null }]);
check("two sides of a headlight become two lines", split.filter((e) => /^Headlight – /.test(e.name)).map((e) => `${e.name}×${e.qty}`).join(" | ") === "Headlight – front left×1 | Headlight – front right×1", split.map((e) => e.name).join(" | "));
check("one side keeps its quantity and reads \"Door – rear left\"", split.some((e) => e.name === "Door – rear left" && e.qty === 1 && e.positions.join() === "Rear left"));
check("a part with no sides is left as picked", split.some((e) => e.name === "Brake pads" && e.positions.join() === "Front"));

const sug = damagePartSuggestions(["headlight_r", "front_bumper", "door_rl", "chassis", "headlight_r"]);
check("the damage list offers the parts with their side", sug.map((s) => s.name).join(" | ") === "Headlight – front right | Bumper – front | Door – rear left", sug.map((s) => s.name).join(" | "));
check("every built-in part has a category the picker knows", BUILT_IN_PARTS.every((p) => ["Body", "Glass", "Interior"].includes(p.category)));
console.log(failed ? `FAILED (${failed})` : "All passed");
process.exit(failed ? 1 : 0);
