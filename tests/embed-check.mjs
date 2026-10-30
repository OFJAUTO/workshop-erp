// Every database read in the code that pulls a linked table ("customer:customers(...)") is asked of the database for ZERO
// rows (30 October 2026). Two tables joined by more than one foreign key make an unnamed link ambiguous: PostgREST
// refuses the whole read (PGRST201), supabase-js returns no data and the page says "Not here" - the calendar booking
// page broke that way when jobs.final_check_appointment_id joined appointments.job_id. Read-only: limit=0, nothing is
// written, so it may run against the live database as well as the test database.
//   node --env-file=.env.test.local tests/embed-check.mjs          (npm run test:embeds)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
  }
})(path.join(root, "src"));

// String constants (const X = "..." / `...` without ${}): select lists kept in one place. A file's own constants win;
// another file's constant counts only when it is exported there (an import).
const localOf = new Map();
const exported = new Map();
for (const f of files) {
  const s = fs.readFileSync(f, "utf8");
  const local = new Map();
  for (const m of s.matchAll(/(export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*=\s*\n?\s*(["`])([^"`]*)\3/g)) {
    if (m[4].includes("${")) continue;
    local.set(m[2], m[4]);
    if (m[1]) exported.set(m[2], m[4]);
  }
  localOf.set(f, local);
}

let consts = new Map();
const resolve = (raw) => raw.replace(/\$\{\s*([A-Z][A-Z0-9_]*)\s*\}/g, (_, n) => (consts.has(n) ? consts.get(n) : `\u0000${n}`));
const reads = new Map(); // key table|select -> first place
let skipped = 0;
for (const f of files) {
  const s = fs.readFileSync(f, "utf8");
  consts = new Map([...exported, ...localOf.get(f)]);
  for (const m of s.matchAll(/\.select\(\s*(?:(["`])([^"`]*)\1|([A-Z][A-Z0-9_]*))/g)) {
    let sel = m[2] !== undefined ? m[2] : consts.get(m[3]);
    if (sel === undefined) { skipped++; continue; }
    sel = resolve(sel);
    if (sel.includes("\u0000") || sel.includes("${")) { skipped++; continue; }
    if (!sel.includes("(")) continue; // no linked table: nothing to resolve
    // The table: the nearest .from("x") before this .select in the same statement.
    const before = s.slice(Math.max(0, m.index - 600), m.index);
    const froms = [...before.matchAll(/\.from\(\s*["']([a-z_]+)["']\s*\)/g)];
    if (!froms.length) { skipped++; continue; }
    const last = froms[froms.length - 1];
    const between = before.slice(last.index + last[0].length);
    if (/;\s*$|;\s*\n/.test(between) && between.includes(";")) { skipped++; continue; }
    const table = last[1];
    const line = s.slice(0, m.index).split("\n").length;
    const key = `${table}|${sel.replace(/\s+/g, " ").trim()}`;
    if (!reads.has(key)) reads.set(key, `${path.relative(root, f)}:${line}`);
  }
}

const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
let bad = 0;
const entries = [...reads.entries()];
for (let i = 0; i < entries.length; i += 8) {
  await Promise.all(entries.slice(i, i + 8).map(async ([k, where]) => {
    const [table, sel] = [k.slice(0, k.indexOf("|")), k.slice(k.indexOf("|") + 1)];
    const r = await fetch(`${base}/rest/v1/${table}?select=${encodeURIComponent(sel)}&limit=0`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (r.ok) return;
    bad++;
    const body = await r.json().catch(() => ({}));
    console.log(`FAIL ${where}  ${table}: ${body.code ?? r.status} ${body.message ?? ""}${body.hint ? ` - ${body.hint}` : ""}`);
  }));
}
console.log(`\n${reads.size} reads with linked tables checked, ${bad} refused by the database (${skipped} built at run time, not checked).`);
process.exit(bad ? 1 : 0);
