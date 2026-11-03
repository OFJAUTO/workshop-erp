// Sections 9 and 10 of 2 November 2026 (built 3 November), one after the other on the TEST server: quantity + unit on
// every parts form (test-s9-qty.mjs) and "Pricing done – send to advisor" (test-s10-pricing.mjs). Never run beside
// another browser suite (each one's clean-up wipes the shared e2e rows).
// Run: npm run test:s9-s10   (test server on :3102, or E2E_BASE=http://localhost:3101 for the dev test server)
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
let failed = 0;
for (const f of ["test-s9-qty.mjs", "test-s10-pricing.mjs"]) {
  console.log(`\n===== ${f}`);
  const r = spawnSync(process.execPath, [...process.execArgv, path.join(here, f)], { stdio: "inherit", env: process.env });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n${failed} suite(s) failed` : "\nBoth suites passed");
process.exit(failed ? 1 : 0);
