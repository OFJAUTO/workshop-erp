// The production test server for the browser tests (29 October 2026, speed rules): builds the app ONCE into
// .next-test (its own folder, so the dev server's .next is never touched) and serves it on port 3102. A production
// build answers a page in a fraction of the dev server's time and never compiles on first visit.
//   npm run test:server              build, then serve on http://localhost:3102 (E2E_BASE=http://localhost:3102)
//   npm run test:server -- --no-build    serve the last build again
// E2E_LOCAL_SERVER=1 lets the local test routes (/api/e2e/*) answer on this server only: they still need the
// E2E_SECRET header and refuse on any Vercel deployment (src/lib/e2e-guard.ts).
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const env = {
  ...process.env,
  ERP_DIST_DIR: ".next-test",
  E2E_LOCAL_SERVER: "1",
  NGENIUS_ENV: process.env.NGENIUS_ENV ?? "mock",
  NGENIUS_WEBHOOK_SECRET: process.env.NGENIUS_WEBHOOK_SECRET ?? "e2e-hook",
};
const next = "node_modules/next/dist/bin/next";

if (!process.argv.includes("--no-build")) {
  // Next adds its build folder's type files to tsconfig.json; the repository keeps its own copy.
  const tsconfig = readFileSync("tsconfig.json", "utf8");
  const started = Date.now();
  const build = spawnSync(process.execPath, [next, "build"], { stdio: "inherit", env });
  writeFileSync("tsconfig.json", tsconfig);
  if (build.status) process.exit(build.status);
  console.log(`Build took ${Math.round((Date.now() - started) / 1000)} s`);
}
const server = spawn(process.execPath, [next, "start", "-p", "3102"], { stdio: "inherit", env });
server.on("exit", (code) => process.exit(code ?? 0));
