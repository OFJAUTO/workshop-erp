// The softer staff look (9 November 2026): every text colour keeps 4.5:1 on every background it sits on, read from
// THE theme file (src/app/theme.css) and the base tokens (src/app/globals.css). Darken text, never lighten a background.
//   node tests/unit/theme-contrast.test.mjs        (npm run test:unit)
import { readFileSync } from "node:fs";

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

const css = (p) => readFileSync(new URL(`../../src/app/${p}`, import.meta.url), "utf8");
const vars = (text) => Object.fromEntries([...text.matchAll(/--color-([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2].toLowerCase()]));
const base = { white: "#ffffff", ...vars(css("globals.css")) };
const themeText = css("theme.css");
const staffBlock = themeText.slice(themeText.indexOf(":root:has([data-erp-staff])"));
const staff = { ...base, ...vars(themeText.slice(0, themeText.indexOf(":root:has"))), ...vars(staffBlock.slice(0, staffBlock.indexOf("}"))) };

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// The owner's values are what the theme says.
const want = { white: "#f6f5f1", canvas: "#e6e5e1", line: "#d6d5d0", "line-strong": "#c9c8c3", chip: "#dcdbd6", track: "#d6d5d0", "on-dark": "#f3f2ee", "sidebar-text": "#ecebe7", pill: "#f1f0ec" };
for (const [k, v] of Object.entries(want)) check(`staff ${k} = ${v}`, staff[k] === v, staff[k]);
// Unchanged colours.
for (const k of ["ink", "muted", "sidebar", "green", "red", "amber", "amber-bar", "red-bar"]) check(`${k} unchanged`, staff[k] === base[k]);

staff["white-on-red"] = "#ffffff"; // [class~="bg-red-bar"] keeps its words pure white
// Text on each background (the pairs the screens use).
const pairs = [
  ...["ink", "muted", "faint", "red", "green-text", "amber-text"].flatMap((t) => ["white", "canvas", "chip"].map((b) => [t, b])),
  ["ink", "pill"], ["sidebar-text", "sidebar"], ["on-dark", "sidebar"], ["on-dark", "ink"], ["white-on-red", "red-bar"], ["on-dark", "green"],
  ["amber-text", "amber-soft"], ["red", "red-soft"], ["green-text", "green-soft"],
];
for (const [t, b] of pairs) {
  const r = ratio(staff[t], staff[b]);
  const need = 4.5;
  check(`${t} on ${b}: ${r.toFixed(2)}:1 (needs ${need})`, r >= need);
}

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log("\nall passed");
