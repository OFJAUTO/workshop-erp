// 12 November 2026, the inspection uploads fix: the idle lock's "not now" (a camera open, files being got ready) and the
// words for files still on a tablet ("4 files still uploading from Mech 3").
//   node --import ./tests/unit/register.mjs tests/unit/upload-hold.test.mjs        (npm run test:unit)
const H = await import("../../src/lib/screen-hold.ts");
const W = await import("../../src/lib/upload-pending-words.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

check("no hold: the idle lock may lock", H.idleLockHeld() === null);
const a = H.holdIdleLock("recording a video");
const b = H.holdIdleLock("getting files ready");
check("a camera open: the idle lock waits, and says why", H.idleLockHeld() === "recording a video");
a();
check("one hold gone, the other still holds", H.idleLockHeld() === "getting files ready");
b();
check("all holds gone: the lock may lock again", H.idleLockHeld() === null);
H.holdIdleLock("a picker that never answered", 1000);
check("a hold that was never released runs out by itself", H.idleLockHeld(Date.now() + 5000) === null);

check("nothing on the way: no words", W.pendingFilesWords(null) === null && W.pendingFilesWords({ count: 0, stopped: 0, devices: [], oldest: null }) === null);
check("4 files still uploading from Mech 3", W.pendingFilesWords({ count: 4, stopped: 0, devices: ["Mech 3"], oldest: null }) === "4 files still uploading from Mech 3");
check("one file, two tablets", W.pendingFilesWords({ count: 1, stopped: 0, devices: ["Mech 3", "Mechanic 1"], oldest: null }) === "1 file still uploading from Mech 3 and Mechanic 1");
check("a file that could not be sent is named", /1 could not be sent – Try again on that tablet/.test(W.pendingFilesWords({ count: 2, stopped: 1, devices: ["Mech 3"], oldest: null }) ?? ""));
check("the report waits, in plain words", W.reportWaitsWords({ count: 3, stopped: 0, devices: ["Mech 3"], oldest: null }) === "3 files still uploading from Mech 3. The report can go to the customer once they have arrived.");

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
