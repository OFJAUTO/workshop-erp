// Saved recovery names that look like typing mistakes are flagged for the owner (30 October 2026, section 3.5).
const { looksLikeJunk } = await import("../../src/lib/recovery-providers.ts");
let failed = 0;
for (const [name, junk] of [["YGHUHGHU", true], ["SH", true], ["JAMSHAID", false], ["Al Rahma Recovery", false], ["ABC Towing LLC", false], ["asdfgh", true]]) {
  const got = looksLikeJunk(name);
  if (got !== junk) failed++;
  console.log(`${got === junk ? "OK  " : "FAIL"} "${name}" ${junk ? "is flagged" : "is a real name"}`);
}
console.log(failed ? `FAILED (${failed})` : "All passed");
process.exit(failed ? 1 : 0);
