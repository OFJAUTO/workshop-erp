import assert from "node:assert/strict";
import { test } from "node:test";
import { differenceChoices, checkDifference, DEFAULT_ROUNDING_LIMIT } from "../../src/lib/supplier-payment-rules.ts";

test("LPO-00111-2: 243.60 paid 243.50 - rounding allowed within AED 1.00, nothing pre-picked", () => {
  const c = differenceChoices(0.1, DEFAULT_ROUNDING_LIMIT);
  assert.deepEqual(c.map((x) => x.key), ["rounding", "owed", "discount"]);
  assert.ok(c.every((x) => x.allowed));
  assert.equal(checkDifference("rounding", 0.1, 1, ""), null);
});
test("above the limit: rounding greyed, discount or owed need a reason", () => {
  const c = differenceChoices(5, 1);
  assert.equal(c.find((x) => x.key === "rounding").allowed, false);
  assert.match(checkDifference("rounding", 5, 1, ""), /rounding limit/);
  assert.match(checkDifference("discount", 5, 1, ""), /Write why/);
  assert.match(checkDifference("owed", 5, 1, "x"), /Write why/);
  assert.equal(checkDifference("owed", 5, 1, "Supplier will collect it next week"), null);
});
test("no difference, or nothing picked", () => {
  assert.match(checkDifference("rounding", 0, 1, ""), /no difference/);
  assert.match(checkDifference("", 0.5, 1, ""), /Say what the difference is/);
});
