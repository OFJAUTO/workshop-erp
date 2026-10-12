/** The documents watched for "not sent" and their limits (safe for the browser: the Settings form uses them). */
export type DocKey = "report" | "quotation" | "proforma" | "tax_invoice" | "customer_reply";
export const DOC_KEYS: DocKey[] = ["report", "quotation", "proforma", "tax_invoice", "customer_reply"];
export const DOC_LABELS: Record<DocKey, string> = { report: "Inspection report", quotation: "Quotation", proforma: "Proforma", tax_invoice: "Tax invoice", customer_reply: "Customer's reply to the quotation" };
export const DOC_HINTS: Record<DocKey, string> = {
  report: "after the workshop manager approves the inspection",
  quotation: "after Parts press Pricing done",
  proforma: "after the car is ready",
  tax_invoice: "after the payment that settles the invoice",
  customer_reply: "after the quotation is sent",
};

/** Minutes of working time; the second limit of the customer's reply may be "next working day". */
export type DocLimit = { amber: number; red: number | "next_working_day" };
export type DocLimits = Record<DocKey, DocLimit>;
export const DEFAULT_DOC_LIMITS: DocLimits = {
  report: { amber: 15, red: 30 },
  quotation: { amber: 60, red: 120 },
  proforma: { amber: 30, red: 60 },
  tax_invoice: { amber: 15, red: 30 },
  customer_reply: { amber: 240, red: "next_working_day" },
};

export function docLimitsOf(settings: { doc_reminder_limits?: unknown }): DocLimits {
  const raw = (settings.doc_reminder_limits ?? {}) as Partial<Record<DocKey, Partial<{ amber: number | string; red: number | string }>>>;
  const out: DocLimits = { ...DEFAULT_DOC_LIMITS };
  for (const k of DOC_KEYS) {
    const r = raw[k];
    if (!r) continue;
    const amber = Number(r.amber);
    const red = r.red === "next_working_day" ? "next_working_day" : Number(r.red);
    out[k] = { amber: Number.isFinite(amber) && amber > 0 ? amber : DEFAULT_DOC_LIMITS[k].amber, red: red === "next_working_day" || (Number.isFinite(red) && red > 0) ? red : DEFAULT_DOC_LIMITS[k].red };
  }
  return out;
}
