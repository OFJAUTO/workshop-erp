// THE passkey and password rules (7 November 2026, the owner's login security upgrade).
//   node --import ./tests/unit/register.mjs tests/unit/passkey-rules.test.mjs        (npm run test:unit)
const pk = await import("../../src/lib/passkey-rules.ts");
const pw = await import("../../src/lib/password-rules.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

// Who gets passkeys.
for (const role of ["owner", "service_advisor", "parts", "gate_in", "accounts", "qc_inspector"]) check(`${role} is a passkey role`, pk.passkeyRole({ role_id: role }));
check("the mechanical workshop manager is a passkey role", pk.passkeyRole({ role_id: "workshop_manager", team: null, department_id: null }) && pk.passkeyRole({ role_id: "workshop_manager", department_id: "mechanical" }));
check("the bodyshop manager (Dismantle & refit team) is NOT", !pk.passkeyRole({ role_id: "workshop_manager", team: "dismantle_refit" }));
check("a workshop manager of a bodyshop department is NOT", !pk.passkeyRole({ role_id: "workshop_manager", department_id: "paint" }));
check("team leaders are NOT", !pk.passkeyRole({ role_id: "team_leader", team: "ppf" }));
check("technicians are NOT", !pk.passkeyRole({ role_id: "technician" }));

// The rollout.
check("rollout 'owner': only the owner", pk.passkeyPerson({ role_id: "owner" }, "owner") && !pk.passkeyPerson({ role_id: "service_advisor" }, "owner"));
check("rollout 'all': every passkey role", pk.passkeyPerson({ role_id: "service_advisor" }, "all") && !pk.passkeyPerson({ role_id: "technician" }, "all"));
check("a missing or odd rollout reads 'owner'", pk.rolloutOf(undefined) === "owner" && pk.rolloutOf("everyone") === "owner" && pk.rolloutOf("all") === "all");

// 12 hours.
const now = Date.parse("2026-11-07T08:00:00Z");
check("a 30-day sign-in is cut back", pk.sessionNeedsCap(now + 30 * 86400_000, now));
check("a 12-hour sign-in is left alone", !pk.sessionNeedsCap(now + 12 * 3600_000, now));
check("a sign-in a few minutes over 12 hours is left alone", !pk.sessionNeedsCap(now + 12 * 3600_000 + 60_000, now));
check("a missing limit is left to the default rule", !pk.sessionNeedsCap(NaN, now));

// Names of phones.
const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
const edge = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0";
const android = "Mozilla/5.0 (Linux; Android 15; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
check("an iCloud passkey made from a PC is an iPhone", pk.defaultPasskeyName(edge, "fbfc3007-154e-4ecc-8c0b-6e020557d7bd") === "iPhone");
check("a Google passkey made on the phone is an Android phone", pk.defaultPasskeyName(android, "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4") === "Android phone");
check("Windows Hello is this Windows PC", pk.defaultPasskeyName(edge, "08987058-cadc-4b81-b6e1-30de50dcbe96") === "This Windows PC");
check("an unknown provider falls back to the device", pk.defaultPasskeyName(iphone, "00000000-0000-0000-0000-000000000000") === "iPhone");
check("a typed name is trimmed and capped at 60", pk.cleanPasskeyName("  Peter's   iPhone ") === "Peter's iPhone" && pk.cleanPasskeyName("x".repeat(80)).length === 60 && pk.cleanPasskeyName("   ") === null);

// The password rule: at least 10, a small letter, a capital, a number; symbols allowed, never needed.
check("the rule words", pw.PASSWORD_RULE_WORDS === "At least 10 characters, with a small letter, a capital letter and a number. Symbols are allowed but not needed.");
check("a good password passes", pw.passwordProblem("Kq7mWz2pLx") === null);
check("symbols are allowed", pw.passwordProblem("Kq7m-Wz2p!Lx") === null);
check("9 characters is refused with the length words", pw.passwordProblem("Kq7mWz2pL") === "Use at least 10 characters.");
check("no capital", pw.passwordProblem("kq7mwz2plx") === "Add a capital letter (A–Z).");
check("no small letter", pw.passwordProblem("KQ7MWZ2PLX") === "Add a small letter (a–z).");
check("no number", pw.passwordProblem("KqmWzpLxab") === "Add a number (0–9).");
check("several missing are named together", pw.passwordProblem("abc") === "The password needs at least 10 characters, a capital letter, a number.", pw.passwordProblem("abc") ?? "");
check("ticks follow the typing", pw.passwordChecks("Ab1").map((c) => c.ok).join() === "false,true,true,true");

// Supabase's answers, in our words.
check("a leaked password", pw.supabasePasswordWords({ code: "weak_password", reasons: ["pwned"], message: "Password is known to be weak and easy to guess" }) === pw.PASSWORD_LEAKED_WORDS);
check("too short at Supabase", pw.supabasePasswordWords({ code: "weak_password", reasons: ["length"], message: "Password should be at least 10 characters." }) === pw.PASSWORD_RULE_WORDS);
check("the same password", pw.supabasePasswordWords({ code: "same_password", message: "New password should be different from the old password." }) === "That is your current password. Choose a new one.");
check("anything else is not ours to word", pw.supabasePasswordWords({ code: "unexpected_failure", message: "boom" }) === null);

console.log(`\n${failed ? `${failed} FAILED` : "all passed"}`);
process.exit(failed ? 1 : 0);
