// THE greeting of every customer message (6 November 2026, Section 7).
//   node --import ./tests/unit/register.mjs tests/unit/greeting.test.mjs        (npm run test:unit)
const { greetingNameOf, personAddressAs, personNameCase } = await import("../../src/lib/messages.ts");

let failed = 0;
const check = (name, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`); };

const g = (c) => greetingNameOf(c);
check(`the case of the day: "DR DHIA YAHYA DHIA AL DIN JAFFAR" → "${g({ full_name: "DR DHIA YAHYA DHIA AL DIN JAFFAR" })}"`, g({ full_name: "DR DHIA YAHYA DHIA AL DIN JAFFAR" }) === "Dr Jaffar");
check(`no title: the first name in normal case ("${g({ full_name: "DHIA YAHYA DHIA AL DIN JAFFAR" })}")`, g({ full_name: "DHIA YAHYA DHIA AL DIN JAFFAR" }) === "Dhia");
check("a surname with Al keeps it", personAddressAs("Mr Ahmed Al Mansouri") === "Mr Al Mansouri" && personAddressAs("MRS FATIMA BINT KHALID") === "Mrs Khalid");
check("titles with a dot and Sheikh", personAddressAs("Dr. Sara Lee") === "Dr Lee" && personAddressAs("SHEIKH SAEED AL MAKTOUM") === "Sheikh Al Maktoum");
check("the saved way wins", g({ full_name: "DHIA JAFFAR", address_as: "Dr Dhia" }) === "Dr Dhia");
check("a company with a contact person greets the person by the same rule", g({ full_name: "MR E2E AHMED", company_name: "E2e Luxe Rental L.l.c" }) === "Mr Ahmed");
check("a company alone keeps its name without the legal ending", g({ full_name: "Al Noor General Trading LLC", company_name: "Al Noor General Trading L.l.c" }) === "Al Noor General Trading");
check("normal case keeps a mixed word and hyphens", personNameCase("MCLAREN McLaren AL-JAFFAR") === "Mclaren McLaren Al-Jaffar");
check("nothing known reads Customer", g(null) === "Customer" && g({ full_name: "" }) === "Customer");
check("a title alone stays the title", personAddressAs("Dr") === "Dr");

console.log(`\n${failed ? `${failed} FAILED` : "all passed"}`);
if (failed) process.exit(1);
