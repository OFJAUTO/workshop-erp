// Edit a charge after it is saved + the Journal Voucher VAT check (21 November 2026): the pure rules.
//   node tests/unit/charge-edit.test.mjs
const mod = await import("file:///" + process.cwd().replaceAll("\\", "/") + "/src/lib/charge-edit-rules.ts");
const { chargeEditState, chargeChanges, editRefusal, vatCheckWords, cleanTrn } = mod;

let n = 0;
const ok = (name, cond, extra) => { n++; if (!cond) { console.error(`FAIL ${name}`, extra ?? ""); process.exitCode = 1; } else console.log(`OK   ${name}`); };

const internal = chargeEditState({ invoiceNumber: null, agreed: false, quote: null, voucher: null, role: "service_advisor" });
ok("internal: nothing locked", internal.internal && !internal.customerLocked && !internal.costLocked);
const agreed = chargeEditState({ invoiceNumber: null, agreed: true, quote: null, voucher: null, role: "service_advisor" });
ok("agreed on the check-in: customer side locked", /check-in/.test(agreed.customerLocked ?? ""));
const sent = chargeEditState({ invoiceNumber: null, agreed: false, quote: { number: "Q-00118", status: "approved" }, voucher: null, role: "owner" });
ok("on an approved quotation: needs a revision", /revision/.test(sent.customerLocked ?? ""));
const jvAdv = chargeEditState({ invoiceNumber: null, agreed: false, quote: null, voucher: { number: "JV-00009", status: "paid" }, role: "service_advisor" });
const jvAcc = chargeEditState({ invoiceNumber: null, agreed: false, quote: null, voucher: { number: "JV-00009", status: "paid" }, role: "accounts" });
ok("on a voucher: cost locked for the advisor, open for accounts", /JV-00009/.test(jvAdv.costLocked ?? "") && jvAcc.costLocked === null);
const base = { description: "DELIVERY CHARGES - SHANGAI GLOBAL AUTO PARTS", kind: "delivery", trips: null, charge: 0, free: true, provider: null, cost: 40, note: null };
const ch = chargeChanges(base, { ...base, description: "DELIVERY CHARGES - SHANGHAI GLOBAL AUTO SPARE PARTS", provider: "SHANGHAI GLOBAL AUTO SPARE PARTS CO.LLC" });
ok("changes: description and provider, old and new", ch.length === 2 && ch[0].old.includes("SHANGAI") && ch[1].old === "—");
ok("a locked customer field is refused", /check-in/.test(editRefusal(agreed, ch) ?? ""));
ok("a cost change on a voucher is refused for the advisor only", !!editRefusal(jvAdv, chargeChanges(base, { ...base, cost: 45 })) && !editRefusal(jvAcc, chargeChanges(base, { ...base, cost: 45 })));
ok("5% VAT matches", vatCheckWords(34.1, 1.71) === null && vatCheckWords(100, 5) === null);
ok("5% VAT mismatch warned", /not 5%/.test(vatCheckWords(34.1, 2) ?? ""));
ok("TRN: 15 digits, spaces ignored", cleanTrn("100 4876 4370 0003") === "100487643700003" && cleanTrn("1234") === null);
console.log(`${n} checks`);
