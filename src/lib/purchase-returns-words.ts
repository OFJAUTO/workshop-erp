/** The status words of a purchase return (pure: the list's client rows read them too). */
export type ReturnStatus = "requested" | "sent" | "credited" | "refunded" | "replaced" | "refused";
export const RETURN_STATUS_WORDS: Record<ReturnStatus, string> = {
  requested: "Return requested – waiting to go back",
  sent: "Sent back – waiting for the credit",
  credited: "Credit received",
  refunded: "Refund received",
  replaced: "Replaced by the supplier",
  refused: "Refused by the supplier",
};
export const RETURN_TABS = [
  { key: "to_go", label: "Waiting to go back", statuses: ["requested"] },
  { key: "credit", label: "Waiting for credit", statuses: ["sent"] },
  { key: "done", label: "Done", statuses: ["credited", "refunded", "replaced"] },
  { key: "refused", label: "Refused", statuses: ["refused"] },
] as const;
