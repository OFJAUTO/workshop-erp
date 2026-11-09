// "Require passkey" per role and the lost-phone code (9 November 2026, Section 4): THE rules in src/lib/passkey-rules.ts.
//   node --import ./tests/unit/register.mjs tests/unit/passkey-require.test.mjs        (npm run test:unit)
const { requiredRolesOf, passwordRefusedFor, PASSWORD_REFUSED_WORDS, RESET_CODE_MINUTES, RESET_CODE_MAX_TRIES, METHOD_WORDS, CHANGE_WORDS } = await import("../../src/lib/passkey-rules.ts");
const { PASSKEY_SLOW_MS, PASSKEY_SLOW_WORDS } = await import("../../src/components/PasskeySlowHelp.tsx").catch(() => ({}));

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

check("off by default: no role required", requiredRolesOf(undefined).length === 0 && requiredRolesOf(null).length === 0);
check("only passkey roles can be required", JSON.stringify(requiredRolesOf(["accounts", "technician", "owner"])) === JSON.stringify(["accounts", "owner"]));
check("required + a passkey: the password is refused", passwordRefusedFor("accounts", ["accounts"], 1) === true);
check("required + no passkey yet: the password still works (never locked out)", passwordRefusedFor("accounts", ["accounts"], 0) === false);
check("not required: the password works", passwordRefusedFor("accounts", [], 2) === false);
check("the refusal names the way out", PASSWORD_REFUSED_WORDS.includes("Sign in with passkey") && PASSWORD_REFUSED_WORDS.includes("one-time sign-in code"));
check("the code lasts 15 minutes, 5 tries", RESET_CODE_MINUTES === 15 && RESET_CODE_MAX_TRIES === 5);
check("the log has words for the code", !!METHOD_WORDS.owner_code && !!CHANGE_WORDS.one_time_code && !!CHANGE_WORDS.require_passkey);
if (PASSKEY_SLOW_MS) check("the slow help after 30 seconds, in the owner's words", PASSKEY_SLOW_MS === 30000 && PASSKEY_SLOW_WORDS.startsWith("Your phone and this computer can't find each other."));

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log("\nall passed");
