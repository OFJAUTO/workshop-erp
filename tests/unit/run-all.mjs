// Every unit test (tests/unit/*.test.mjs): our TypeScript run directly, no database, no server (30 October 2026).
//   npm run test:unit
import { readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
let failed = 0;
for (const f of readdirSync(here).filter((n) => n.endsWith(".test.mjs")).sort()) {
  const r = spawnSync(process.execPath, ["--import", "./tests/unit/register.mjs", path.join("tests", "unit", f)], { cwd: root, encoding: "utf8" });
  const last = (r.stdout ?? "").trim().split("\n").slice(-1)[0];
  if (r.status !== 0) {
    failed++;
    console.log(`FAIL ${f}\n${r.stdout}\n${r.stderr}`);
  } else console.log(`OK   ${f} · ${last}`);
}
console.log(failed ? `\n${failed} test file(s) failed` : "\nAll unit tests passed");
process.exit(failed ? 1 : 0);
