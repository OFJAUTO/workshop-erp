import type { Settings } from "./settings";

export type CompanyDetails = { tradingName: string; legalName: string; legalNameAr: string | null; address: string[]; phone: string; email: string; website: string; trn: string; bank: { name: string; accountName: string; accountNumber: string; iban: string; swift: string } };

/** The company details from Settings, for the customer's document pages (the PDFs read the same settings). */
export function companyFromSettings(s: Settings): CompanyDetails {
  return {
    tradingName: String(s.company_name || "OFJ Automotive"),
    legalName: String(s.company_legal_name || s.company_name || ""),
    legalNameAr: String(s.company_legal_name_ar ?? "") || null,
    address: [s.company_address_1, s.company_address_2, s.company_address_3].map((x) => String(x ?? "").trim()).filter(Boolean),
    phone: String(s.company_phone ?? ""),
    email: String(s.company_email ?? ""),
    website: String(s.company_website ?? ""),
    trn: String(s.company_trn ?? ""),
    bank: { name: String(s.bank_name ?? ""), accountName: String(s.bank_account_name ?? ""), accountNumber: String(s.bank_account_number ?? ""), iban: String(s.bank_iban ?? ""), swift: String(s.bank_swift ?? "") },
  };
}
