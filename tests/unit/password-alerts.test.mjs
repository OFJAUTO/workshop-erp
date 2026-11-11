import assert from "node:assert/strict";
import { summaryWords, dubaiClock, isNewDevice } from "../../src/lib/password-alert-rules.ts";

assert.equal(summaryWords([]), null);
assert.equal(summaryWords([{ name: "Mert" }, { name: "Adarsh" }, { name: "adarsh" }, { name: "Adarsh" }]), "Password sign-ins today: ADARSH 3, MERT 1");
const c = dubaiClock(Date.parse("2026-11-11T17:30:00Z"));
assert.equal(c.hour, 21);
assert.equal(c.dayStartIso, "2026-11-10T20:00:00.000Z");
assert.equal(dubaiClock(Date.parse("2026-11-11T20:30:00Z")).dayStartIso, "2026-11-11T20:00:00.000Z");
assert.equal(isNewDevice("Mozilla/5.0 A", ["Mozilla/5.0 A"]), false);
assert.equal(isNewDevice("Mozilla/5.0 B", ["Mozilla/5.0 A"]), true);
assert.equal(isNewDevice("Mozilla/5.0 B", []), true);
assert.equal(isNewDevice(null, []), false);
console.log("password-alerts: ok");
