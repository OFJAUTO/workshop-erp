/** The approval headline rule (13 November 2026, Section 1, J-01002). Pure. */
export function headlineFrom(f: { declinedOutAt: string | null; approvedAfterDecline: boolean; approved: number; total: number }): { kind: "declined" | "part" | null; words: string | null } {
  if (f.declinedOutAt && !f.approvedAfterDecline) return { kind: "declined", words: "Declined, car going out" };
  if (f.total > 0 && f.approved > 0 && f.approved < f.total) return { kind: "part", words: `APPROVED IN PART: ${f.approved} OF ${f.total} ITEMS` };
  return { kind: null, words: null };
}

