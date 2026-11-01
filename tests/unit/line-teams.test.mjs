// Departments per line (1 November 2026, J-00969): the default team of each line, the sides and the Work step words,
// the bodyshop stages the teams bring, the staff teams a side may offer, and the gate-in's real requests.
//   node --import ./tests/unit/register.mjs tests/unit/line-teams.test.mjs        (npm run test:unit)
const { defaultTeamOf, teamOfLine, teamsOf, sidesOfTeams, teamsWords, staffTeamsFor, teamWithCar, realRequests } = await import("../../src/lib/line-teams.ts");
const { sidesOfJob } = await import("../../src/lib/job-sides.ts");
const { stageKeysFor } = await import("../../src/lib/bodyshop-kinds.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

// J-00969's lines, as they were typed.
const J969 = [
  { line_type: "package", title: "night sky edition - painting of relative chrome parts" },
  { line_type: "labour", title: "front right fender pdr dent" },
  { line_type: "labour", title: "labour charges - remove and refit front end" },
  { line_type: "package", title: "programming & coding for light and radar" },
  { line_type: "package", title: "front bumper smart paint" },
  { line_type: "part", title: "Front LH light" },
  { line_type: "recovery", title: "Recovery, full down, two ways" },
];
const teams = J969.map((l) => defaultTeamOf(l, null, "both"));
check("J-00969 on Both: paint, outside (PDR), dismantle & refit, electrical, paint; parts and recovery none", teams.join(",") === "paint,outside,dismantle_refit,electrical,paint,,", teams.join(","));
const lines = J969.map((line) => ({ line }));
check("the car's teams in the order of work", teamsOf(lines, "both").join(",") === "dismantle_refit,paint,electrical,outside", teamsOf(lines, "both").join(","));
check("Both: the sides are the bodyshop and the mechanical side (electrical)", sidesOfJob("both", lines).join(",") === "mechanical,bodyshop", sidesOfJob("both", lines).join(","));
check(`the Work step reads "Bodyshop + Electrical + Outside work"`, teamsWords(teamsOf(lines, "both")) === "Bodyshop + Electrical + Outside work", teamsWords(teamsOf(lines, "both")));
const keys = stageKeysFor(teamsOf(lines, "both").filter((t) => t !== "outside").map((t) => `team:${t}`));
check("the bodyshop stages: strip, paint, refit, electrical, QC, handover", keys.join(",") === "strip,paint,refit,electrical,qc,handover", keys.join(","));

// A mechanical job never changes: "remove and refit" stays the technicians' work, coding stays electrical.
check("Mechanical job: remove and refit stays Mechanical", defaultTeamOf({ line_type: "labour", title: "Remove and refit gearbox" }, null, "mechanical") === "mechanical");
check("Mechanical job: the sides stay mechanical", sidesOfJob("mechanical", lines).join(",") === "mechanical");
check("Bodyshop job: plain labour belongs to dismantle & refit", defaultTeamOf({ line_type: "labour", title: "Labour" }, null, "bodyshop") === "dismantle_refit");
check("a chosen team wins over the default", teamOfLine({ line_type: "labour", title: "front right fender pdr dent", team: "dismantle_refit" }, null, "both") === "dismantle_refit");
check("an outside-work service is Outside work", defaultTeamOf({ line_type: "package", title: "Windscreen" }, { outside_work: true }, "both") === "outside");
check("a PPF package kind is the PPF team", defaultTeamOf({ line_type: "package", title: "Full front" }, { bodyshop_kind: "ppf" }, "both") === "ppf");

// Who may be picked.
const t969 = teamsOf(lines, "both");
check("the mechanical side offers the electricians only", (staffTeamsFor(t969, "mechanical") ?? []).join(",") === "electricians");
check("the bodyshop side offers dismantle & refit and painting", (staffTeamsFor(t969, "bodyshop") ?? []).join(",") === "dismantle_refit,painting");
check("no electricians in the workshop yet: the side falls back to anyone", staffTeamsFor(t969, "mechanical", new Set(["technicians", "painting", "dismantle_refit"])) === null);
check("a side with no team-known lines has no limit", staffTeamsFor([], "mechanical") === null);
check("sides of teams", sidesOfTeams(["paint", "electrical"]).join(",") === "mechanical,bodyshop");
check("the team with the car: the running stage's section", teamWithCar([{ section: "strip_refit", status: "done" }, { section: "paint", status: "active" }], false) === "paint");

// The gate-in's customer requests.
check('"." is not a request', realRequests(["."]).length === 0);
check("an empty box is not a request", realRequests(["", "  "]).length === 0);
check('"NO" (two letters) is not a request', realRequests(["NO"]).length === 0);
check("a real request counts", realRequests([".", "BRAKE NOISE WHEN STOPPING"]).join("|") === "BRAKE NOISE WHEN STOPPING");
check("Arabic words count as letters", realRequests(["صوت في الفرامل"]).length === 1);

console.log(failed ? `FAILED (${failed})` : "All passed");
process.exit(failed ? 1 : 0);
