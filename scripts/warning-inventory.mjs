// The list of every warning and blocker message on the staff screens (13 November 2026, Section 4): each with its file,
// its words, and whether a fix sits beside it (a button, a link, a form, a FixIt panel or "Remind"). Read-only, no database.
//   node scripts/warning-inventory.mjs > docs/warnings-list-13-nov.md
import fs from "node:fs";
import path from "node:path";
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const files = [...walk("src/app/(app)"), ...walk("src/components")].filter((f) => f.endsWith(".tsx"));
const WARN = /(Notice tone="(error|warning)"|text-red font-(semibold|bold|extrabold)|text-amber-text font-(semibold|bold))/;
const WORDS = /(missing|not set|blocked|Not possible|cannot|can't|incomplete|still to|waiting for|no invoice|not handed|not ready|overdue|locked)/i;
const FIX = /(<Button|<LinkButton|<a |href=|<form|FixIt|RecordPaymentButton|Remind|onClick|BackOrderSection|data-[a-z-]*fix|ReleaseForm|ReasonChips|unpaid_confirmed|owner_release)/;
const rows = [];
for (const f of files) {
  const lines = fs.readFileSync(f, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!WARN.test(l)) continue;
    // The words: the JSX text of the line (or the next one), never class names.
    const plain = (l + " " + (lines[i + 1] ?? "")).replace(/className={?`[^`]*`}?|className="[^"]*"/g, "");
    if (!WORDS.test(plain)) continue;
    const near = lines.slice(Math.max(0, i - 2), i + 10).join("\n");
    const text = ((plain.match(/>([^<>]{8,200})</) ?? [null, plain])[1] ?? "").replace(/{[^}]*}/g, "…").replace(/\s+/g, " ").trim().slice(0, 150);
    rows.push({ file: f.replace(/\\/g, "/").replace("src/app/(app)/", "").replace("src/components/", "components/"), line: i + 1, text, fix: FIX.test(near) || /FixIt/.test(l) });
  }
}
const withFix = rows.filter((r) => r.fix).length;
console.log("# Warnings and blockers on the staff screens (13 November 2026)\n");
console.log(`Found by \`scripts/warning-inventory.mjs\` (it reads the screens' code): **${rows.length} warnings**, **${withFix} with a fix beside them**, **${rows.length - withFix} with words only**.\n`);
console.log("A fix is a button, a link, a form or panel on the same spot, or \"Remind <name>\". Lines marked **words only** are the ones still to give a button.\n");
console.log("| Screen (file:line) | Warning | Fix beside it |\n|---|---|---|");
for (const r of rows.sort((a, b) => Number(a.fix) - Number(b.fix) || a.file.localeCompare(b.file))) console.log(`| \`${r.file}:${r.line}\` | ${r.text.replace(/\|/g, "/")} | ${r.fix ? "yes" : "**words only**"} |`);
