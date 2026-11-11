/**
 * HR (11 November 2026, Section 15). Pure: the documents kept per person, when their reminders fall due, how an ID
 * number is masked, and who may open HR (the owner and the head accountant, nobody else).
 */
export type HrDocKind = "photo" | "emirates_id" | "passport" | "visa" | "labour_card" | "health_insurance" | "driving_licence";

export const HR_DOC_KINDS: { kind: HrDocKind; label: string; warnDays: number | null; numbered: boolean }[] = [
  { kind: "photo", label: "Photo", warnDays: null, numbered: false },
  { kind: "emirates_id", label: "Emirates ID", warnDays: 30, numbered: true },
  { kind: "passport", label: "Passport", warnDays: 60, numbered: true },
  { kind: "visa", label: "Visa", warnDays: 60, numbered: true },
  { kind: "labour_card", label: "Labour card", warnDays: 30, numbered: true },
  { kind: "health_insurance", label: "Health insurance", warnDays: 30, numbered: true },
  { kind: "driving_licence", label: "Driving licence", warnDays: 30, numbered: true },
];

export const kindOf = (k: string) => HR_DOC_KINDS.find((d) => d.kind === k) ?? null;

const dayMs = 86_400_000;
export function daysLeft(expiresOn: string, today: string): number {
  return Math.round((Date.parse(`${expiresOn.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / dayMs);
}

/**
 * The reminder stage a document is in today: its first warning (60 days for passport and visa, 30 for the others),
 * then 14, then 7, then 0 = expired. Null = nothing to say yet (or the document has no expiry).
 */
export function reminderStage(kind: string, expiresOn: string | null, today: string): number | null {
  const k = kindOf(kind);
  if (!k?.warnDays || !expiresOn) return null;
  const left = daysLeft(expiresOn, today);
  if (left <= 0) return 0;
  if (left <= 7) return 7;
  if (left <= 14) return 14;
  if (left <= k.warnDays) return k.warnDays;
  return null;
}

/** A reminder goes when the document reached a stage it was not reminded at (a later stage is a smaller number). */
export function reminderDue(stage: number | null, remindedStage: number | null): boolean {
  if (stage === null) return false;
  return remindedStage === null || stage < remindedStage;
}

export function expiryTone(kind: string, expiresOn: string | null, today: string): "red" | "amber" | "none" {
  const st = reminderStage(kind, expiresOn, today);
  if (st === null) return "none";
  return st === 0 ? "red" : "amber";
}

export function expiryWords(expiresOn: string | null, today: string): string {
  if (!expiresOn) return "No expiry date";
  const left = daysLeft(expiresOn, today);
  if (left < 0) return `Expired ${-left} day${left === -1 ? "" : "s"} ago`;
  if (left === 0) return "Expires today";
  return `Expires in ${left} day${left === 1 ? "" : "s"}`;
}

/** An ID number with only its last 3 characters showing until tapped ("784-1990-1234567-1" → "•••••••••••••••7-1"). */
export function maskNumber(n: string | null | undefined): string {
  const s = (n ?? "").trim();
  if (!s) return "";
  if (s.length <= 3) return "•".repeat(s.length);
  return s.slice(0, -3).replace(/[A-Za-z0-9]/g, "•") + s.slice(-3);
}

/** THE rule of who opens HR: the owner and the head accountant. */
export function mayOpenHr(staff: { role_id: string; is_head_accountant?: boolean | null }): boolean {
  return staff.role_id === "owner" || (staff.role_id === "accounts" && !!staff.is_head_accountant);
}

/** A file name safe inside a zip and a download ("PASSPORT - MOHAMMED ALI.pdf"). */
export function hrFileName(kindLabel: string, person: string, original: string | null, contentType: string | null): string {
  const ext = (original ?? "").match(/\.[a-z0-9]{2,5}$/i)?.[0] ?? (contentType === "application/pdf" ? ".pdf" : contentType?.startsWith("image/") ? `.${contentType.slice(6).replace("jpeg", "jpg")}` : "");
  const clean = (t: string) => t.replace(/[^\w .-]+/g, " ").replace(/\s+/g, " ").trim();
  return `${clean(kindLabel).toUpperCase()} - ${clean(person).toUpperCase()}${ext.toLowerCase()}`;
}
