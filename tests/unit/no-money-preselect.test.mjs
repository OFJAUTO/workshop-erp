// 15 November 2026 (Section 5): NOTHING THAT AFFECTS MONEY IS EVER PRE-SELECTED ON A FORM. A quick check over the source:
// no payment method, refund method, "who pays" or lathe shop starts chosen. Fails with the file and line.
//   node --import ./tests/unit/register.mjs tests/unit/no-money-preselect.test.mjs        (npm run test:unit)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const files = [];
const walk = (d) => { for (const n of fs.readdirSync(d)) { const p = path.join(d, n); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(n)) files.push(p); } };
walk(path.join(root, "src"));

const RULES = [
  { why: "a payment method chip pre-chosen", re: /name="(method|refund_method|excess_kind)"[^>]*defaultValue="[a-z]+"/ },
  { why: "a payment method chip pre-chosen", re: /defaultValue="(transfer|cash|card|cheque|link|advance)"[^>]*name="(method|refund_method|excess_kind)"/ },
  { why: "a payment method state starting chosen", re: /const \[method, setMethod\] = useState(<[^>]*>)?\("(cash|card|transfer|cheque|link)"\)/ },
  { why: "who carries a cost pre-chosen", re: /name="cost_to"[^>]*defaultValue="(overhead|job)"/ },
  { why: "the lathe shop pre-chosen", re: /data-lathe-bill-supplier|name="supplier"[^>]*defaultValue=\{suppliers\[0\]/ },
];
let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };
const hits = [];
for (const f of files) {
  const lines = fs.readFileSync(f, "utf8").split("\n");
  lines.forEach((line, i) => {
    for (const r of RULES) {
      if (!r.re.test(line)) continue;
      if (r.why === "the lathe shop pre-chosen" && !/defaultValue=\{suppliers\[0\]/.test(line)) continue;
      hits.push(`${path.relative(root, f)}:${i + 1} (${r.why})`);
    }
  });
}
check("no money choice is pre-selected anywhere in src", hits.length === 0, hits.slice(0, 8).join(" | "));
check("the check really reads the source", files.length > 300, String(files.length));
console.log(failed ? `${failed} failed` : "All no-money-preselect checks passed");
process.exit(failed ? 1 : 0);
