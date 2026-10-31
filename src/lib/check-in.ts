import { cleanCompanyName, sameName } from "./messages";

/**
 * What the customer's gate-in link is called (31 October 2026): VEHICLE CHECK-IN, never "job card". The job card is the
 * workshop's own work order and staff screens keep the word; the customer's page, its PDF and file name, the page title
 * and the WhatsApp preview all read these words. Pure.
 */
export const CHECK_IN = {
  title: "Vehicle check-in",
  titleAr: "استلام المركبة",
  pdfTitle: "VEHICLE CHECK-IN",
  download: "Download check-in (PDF)",
  pageTitle: "OFJ Automotive – Vehicle check-in",
  pageDescription: "Review your vehicle's check-in videos and photos, then approve the inspection",
  gone: "This check-in is no longer available.",
  approvalSection: "Check-in approval",
} as const;

/** "OFJ Vehicle check-in J-00859.pdf" */
export function checkInFileName(jobNumber: string): string {
  return `OFJ Vehicle check-in ${jobNumber}.pdf`;
}

/**
 * The approval line on the page and the PDF: "Approved by <typed name> for <COMPANY> on <date>." for a company customer
 * (the person who typed their name approves on the company's behalf), "Approved by <name> on <date>." otherwise.
 */
export function approvedLine(name: string | null | undefined, company: string | null | undefined, when: string): string {
  const who = String(name ?? "").trim() || "the customer";
  const co = cleanCompanyName(company);
  return co && !sameName(who, co) ? `Approved by ${who} for ${co} on ${when}.` : `Approved by ${who} on ${when}.`;
}
