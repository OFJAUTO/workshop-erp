import assert from "node:assert/strict";
import { test } from "node:test";
import { returnEndingsFor, returnEndingRefusal, invoiceStillExpected, legacyEndingOf, historyWords, returnedOnInvoiceWarning } from "../../src/lib/return-ending-rules.ts";

const base = { invoiced: false, paid: 0, value: 47.25, withTech: false, hasReplacement: false, creditIn: false };

test("LPO-00103-1: no invoice, nothing paid -> RETURNED BEFORE INVOICING suggested, credit note not offered", () => {
  const c = returnEndingsFor(base, "parts");
  assert.equal(c.suggested, "before_invoice");
  assert.equal(c.options.find((o) => o.key === "credit_note").allowed, false);
  assert.match(c.options.find((o) => o.key === "credit_note").why, /no supplier invoice/);
  assert.equal(c.options.find((o) => o.key === "before_invoice").allowed, true);
  assert.equal(returnEndingRefusal(base, "parts", "credit_note") !== null, true);
});
test("invoiced -> credit note suggested; accounts only", () => {
  const f = { ...base, invoiced: true };
  assert.equal(returnEndingsFor(f, "accounts").suggested, "credit_note");
  assert.equal(returnEndingsFor(f, "accounts").options.find((o) => o.key === "credit_note").allowed, true);
  assert.equal(returnEndingsFor(f, "parts").options.find((o) => o.key === "credit_note").allowed, false);
  assert.equal(returnEndingsFor(f, "parts").options.find((o) => o.key === "before_invoice").allowed, false);
});
test("paid, no invoice -> advance suggested, parts may ask", () => {
  const f = { ...base, paid: 47.25 };
  const c = returnEndingsFor(f, "parts");
  assert.equal(c.suggested, "advance");
  assert.equal(c.options.find((o) => o.key === "advance").allowed, true);
  assert.equal(c.options.find((o) => o.key === "refund").allowed, false);
  assert.equal(returnEndingsFor(f, "accounts").options.find((o) => o.key === "refund").allowed, true);
});
test("with the technician -> nothing until handed back", () => {
  assert.match(returnEndingsFor({ ...base, withTech: true }, "parts").refusal, /hands it back/);
});
test("nothing pre-selected in the options list (suggested is words only)", () => {
  const c = returnEndingsFor(base, "parts");
  assert.ok(c.suggestedWords.includes("RETURNED BEFORE INVOICING"));
});
test("invoice still expected", () => {
  assert.equal(invoiceStillExpected([{ id: "a", isActive: true, disposition: "returned", returnEnding: "before_invoice", removed: false }]), false);
  assert.equal(invoiceStillExpected([{ id: "a", isActive: true, disposition: "returned", returnEnding: "before_invoice", removed: false }, { id: "b", isActive: true, disposition: null, returnEnding: null, removed: false }]), true);
  assert.equal(invoiceStillExpected([{ id: "a", isActive: true, disposition: "returned", returnEnding: "credit_note", removed: false }]), true);
});
test("legacy ending + history words + warning", () => {
  assert.equal(legacyEndingOf({ disposition: "returned", disposition_note: "WIP - 58399" }), "credit_note");
  assert.equal(legacyEndingOf({ disposition: "returned", return_ending: "before_invoice" }), "before_invoice");
  const w = historyWords({ at: "2026-11-20T08:00:00Z", by: "Mathew", from: "credit_note", to: "before_invoice", reason: "No invoice ever came", voided: { creditNote: "WIP - 58399", amount: null, note: null } }, () => "20 Nov");
  assert.match(w, /Supplier's credit note → RETURNED BEFORE INVOICING \(credit note WIP - 58399 voided, kept\): No invoice ever came/);
  assert.match(returnedOnInvoiceWarning(["Bleeding screw"]), /BLEEDING SCREW went back/);
});
