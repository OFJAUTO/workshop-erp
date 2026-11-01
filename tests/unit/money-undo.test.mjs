// Confirm + undo for money actions (1 November 2026, B3): the countdown, who may undo, and the Zoho rows held back
// during the undo window.
//   node --import ./tests/unit/register.mjs tests/unit/money-undo.test.mjs        (npm run test:unit)
const { DEFAULT_UNDO_MINUTES, undoSecondsLeft, undoLabel, mayUndo, heldForUndo } = await import("../../src/lib/money-undo.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

const now = Date.parse("2026-11-02T08:00:00Z");
const ago = (s) => new Date(now - s * 1000).toISOString();
const mathew = { id: "a", role_id: "accounts" };
const peter = { id: "b", role_id: "parts" };
const omar = { id: "o", role_id: "owner" };

check("the default window is 10 minutes", DEFAULT_UNDO_MINUTES === 10);
check("just recorded: 600 seconds left", undoSecondsLeft(ago(0), 10, now) === 600);
check("2 seconds later: 598", undoSecondsLeft(ago(2), 10, now) === 598);
check("after 10 minutes: 0", undoSecondsLeft(ago(600), 10, now) === 0 && undoSecondsLeft(ago(900), 10, now) === 0);
check("no time: 0", undoSecondsLeft(null, 10, now) === 0);
check("the label counts down", undoLabel(600) === "Undo (10:00)" && undoLabel(598) === "Undo (9:58)" && undoLabel(5) === "Undo (0:05)");
check("the one who did it may undo inside the window", mayUndo("a", mathew, ago(30), 10, now));
check("someone else may not", !mayUndo("a", peter, ago(30), 10, now));
check("the owner may undo anyone's", mayUndo("a", omar, ago(30), 10, now));
check("nobody after the window, not even the owner", !mayUndo("a", mathew, ago(601), 10, now) && !mayUndo("a", omar, ago(601), 10, now));
check("a shorter window from Settings (5 minutes)", mayUndo("a", mathew, ago(299), 5, now) && !mayUndo("a", mathew, ago(301), 5, now));
check("a payment row waits in the outbox during the window", heldForUndo("payment", ago(60), 10, now) && heldForUndo("deposit", ago(60), 10, now) && heldForUndo("billpayment", ago(60), 10, now));
check("after the window it posts", !heldForUndo("payment", ago(601), 10, now));
check("other documents are never held (invoices, bills, contacts)", !heldForUndo("invoice", ago(10), 10, now) && !heldForUndo("bill", ago(10), 10, now) && !heldForUndo("contact", ago(10), 10, now));

console.log(failed ? `FAILED (${failed})` : "All passed");
process.exit(failed ? 1 : 0);
