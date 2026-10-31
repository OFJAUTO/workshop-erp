// The customer's gate-in link is the VEHICLE CHECK-IN (31 October 2026): its words, the file name, a company shown once
// (no contact line repeating the company) and the approval line "Approved by <typed name> for <COMPANY> on …".
//   node --import ./tests/unit/register.mjs tests/unit/check-in.test.mjs        (npm run test:unit)
const { CHECK_IN, approvedLine, checkInFileName } = await import("../../src/lib/check-in.ts");
const { contactNameOf, sameName } = await import("../../src/lib/messages.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

check("the words: VEHICLE CHECK-IN, the Arabic, the download button", CHECK_IN.pdfTitle === "VEHICLE CHECK-IN" && CHECK_IN.titleAr === "استلام المركبة" && CHECK_IN.download === "Download check-in (PDF)");
check("no customer word says job card", !Object.values(CHECK_IN).some((w) => /job card/i.test(w)));
check("file name", checkInFileName("J-00859") === "OFJ Vehicle check-in J-00859.pdf", checkInFileName("J-00859"));

// A made-up company (real customer names never go into the repository).
const CO = "AL NOOR GENERAL TRADING LLC";
check("same name: case, dots and the legal ending do not matter", sameName("Al Noor General Trading L.L.C.", CO) && sameName("al noor general trading", CO) && sameName("AL-NOOR GENERAL TRADING LLC", CO));
check("different people are different", !sameName("Ahmed Saleh", CO) && !sameName("", CO) && !sameName(null, CO));
check("contact line: none when the person is the company again", contactNameOf("Al Noor General Trading L.l.c", CO) === null);
check("contact line: none when empty", contactNameOf("  ", CO) === null && contactNameOf(null, CO) === null);
check("contact line: a real, different person", contactNameOf("Ahmed Saleh", CO) === "Ahmed Saleh");
check("contact line: a person without a company is never hidden", contactNameOf("Ahmed Saleh", null) === "Ahmed Saleh");

const when = "31 Oct 2026, 10:15";
check("approval for a company names both", approvedLine("Ahmed Saleh", CO, when) === `Approved by Ahmed Saleh for ${CO} on ${when}.`, approvedLine("Ahmed Saleh", CO, when));
check("approval typed as the company: no 'for' repeat", approvedLine("Al Noor General Trading", CO, when) === `Approved by Al Noor General Trading on ${when}.`);
check("approval by a private customer", approvedLine("Ahmed Saleh", null, when) === `Approved by Ahmed Saleh on ${when}.`);
check("approval company name tidied (L.l.c -> LLC)", approvedLine("Ahmed Saleh", "Al Noor General Trading L.l.c", when).includes("for Al Noor General Trading LLC on"));

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log("\nall passed");
