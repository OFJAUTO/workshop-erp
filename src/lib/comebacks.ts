export const COMEBACK_CAUSES = ["workmanship", "faulty_part", "unrelated", "customer_caused"] as const;
export type ComebackCause = (typeof COMEBACK_CAUSES)[number];
export const COMEBACK_CAUSE_LABELS: Record<ComebackCause, string> = {
  workmanship: "Our workmanship",
  faulty_part: "Faulty part (supplier)",
  unrelated: "New, unrelated problem",
  customer_caused: "Caused by the customer or another workshop",
};
/** A comeback we own: our workmanship or a part we supplied. A return visit is paid as normal. */
export const isOurFault = (cause: string | null | undefined) => cause === "workmanship" || cause === "faulty_part";
