// Pure words for a part the parts desk added to an estimate (13 November 2026, Section 5). Shared by the desk's row and
// the advisor's card, so both say the same thing.
export type DeskPart = { id: string; title: string; quantity: number; status: "pending" | "accepted" | "declined"; forJob: string | null; addedBy: string | null; decidedBy: string | null };

/** "Added by Parts · for job: BRAKE SERVICE · waiting for the advisor" / "… · Accepted by Anas" / "… · Declined by Anas". */
export function deskRowWords(p: Pick<DeskPart, "status" | "forJob" | "decidedBy">): string {
  const job = p.forJob ? ` · for job: ${p.forJob.toUpperCase()}` : "";
  const state = p.status === "pending" ? "waiting for the advisor" : p.status === "accepted" ? `Accepted by ${p.decidedBy ?? "the advisor"}` : `Declined by ${p.decidedBy ?? "the advisor"}`;
  return `Added by Parts${job} · ${state}`;
}
