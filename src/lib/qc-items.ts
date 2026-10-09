/** QC checklist item shape and the group labels. Kept free of server imports so the QC form (a client component) can use them. */
export type QcItem = { key: string; kind: "complaint" | "work" | "part" | "general"; label: string; result: "pass" | "fail" | null; remark: string | null };

export const QC_KIND_LABELS: Record<QcItem["kind"], string> = { complaint: "Customer complaints", work: "Work done", part: "Parts replaced", general: "General checks" };
