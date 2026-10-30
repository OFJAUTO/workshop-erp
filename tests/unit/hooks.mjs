// Module hooks for the unit tests (30 October 2026, night batch): our TypeScript files run directly in Node, compiled
// by Next's own compiler (SWC) - no database, no server. "@/x" is src/x, extensionless imports find .ts/.tsx, and
// "server-only" is an empty module. Registered by tests/unit/register.mjs.
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(path.join(root, "package.json"));
let swc = null;
async function compiler() {
  if (!swc) {
    swc = require("next/dist/build/swc");
    await swc.loadBindings();
  }
  return swc;
}
const STUB = "data:text/javascript,export {};";

function findFile(base) {
  for (const c of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (existsSync(c) && !c.endsWith(path.sep)) {
      try { if (!require("node:fs").statSync(c).isDirectory()) return c; } catch { /* next */ }
    }
  }
  return null;
}

export async function resolve(specifier, context, next) {
  if (specifier === "server-only" || specifier === "client-only") return { url: STUB, shortCircuit: true };
  if (specifier.startsWith("@/")) {
    const f = findFile(path.join(root, "src", specifier.slice(2)));
    if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
  }
  // Next's own subpaths are files without an exports map: "next/headers" is next/headers.js.
  if (/^next\/[a-z-]+$/.test(specifier)) {
    const f = path.join(root, "node_modules", `${specifier}.js`);
    if (existsSync(f)) return { url: pathToFileURL(f).href, shortCircuit: true };
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    const f = findFile(path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier));
    if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.startsWith("file:") && /\.(ts|tsx)$/.test(url)) {
    const file = fileURLToPath(url);
    const source = await readFile(file, "utf8");
    const s = await compiler();
    const out = await s.transform(source, { filename: file, jsc: { parser: { syntax: "typescript", tsx: file.endsWith(".tsx") }, transform: { react: { runtime: "automatic" } }, target: "es2022" }, module: { type: "es6" }, sourceMaps: false });
    return { format: "module", source: out.code, shortCircuit: true };
  }
  return next(url, context);
}
