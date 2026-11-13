/**
 * HR (11 November 2026, Section 15). Pure: the documents kept per person, when their reminders fall due, how an ID
 * number is masked, and who may open HR (the owner and the head accountant, nobody else).
 */
export type HrDocKind = "photo" | "emirates_id" | "passport" | "visa" | "labour_card" | "health_insurance" | "driving_licence";

export const HR_DOC_KINDS: { kind: HrDocKind; label: string; warnDays: number | null; numbered: boolean }[] = [
  { kind: "photo", label: "Personal photo", warnDays: null, numbered: false },
  { kind: "emirates_id", label: "Emirates ID", warnDays: 30, numbered: true },
  { kind: "passport", label: "Passport", warnDays: 60, numbered: true },
  { kind: "visa", label: "Visa", warnDays: 60, numbered: true },
  { kind: "labour_card", label: "Labour card", warnDays: 30, numbered: true },
  { kind: "health_insurance", label: "Health insurance card", warnDays: 30, numbered: true },
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

/* ---------------- The HR list (13 November 2026, Section 13) ---------------- */
/** One person's documents as the list reads them: kind and expiry of each current document. */
export type HrDocBrief = { kind: string; expires_on: string | null };
export type HrStatus = { tone: "red" | "amber" | "grey" | "green"; words: string; have: number; total: number; missing: number; expired: number; expiringSoon: number };

/** The ONE status line of a person: red (something expired), amber (the soonest expiry within its warning), grey (missing), green. */
export function hrStatusOf(docs: HrDocBrief[], today: string): HrStatus {
  const total = HR_DOC_KINDS.length;
  const kinds = new Set(docs.map((d) => d.kind).filter((k) => kindOf(k)));
  const have = kinds.size;
  const missing = total - have;
  const label = (k: string) => kindOf(k)?.label ?? k;
  const dated = docs.filter((d) => kindOf(d.kind)?.warnDays && d.expires_on).map((d) => ({ ...d, left: daysLeft(d.expires_on as string, today), stage: reminderStage(d.kind, d.expires_on, today) }));
  const expired = dated.filter((d) => d.left < 0 || d.stage === 0).sort((a, b) => a.left - b.left);
  const soon = dated.filter((d) => d.stage !== null && d.stage !== 0).sort((a, b) => a.left - b.left);
  const base = { have, total, missing, expired: expired.length, expiringSoon: soon.length };
  if (expired.length) return { ...base, tone: "red", words: expired.length === 1 ? `${label(expired[0].kind)} expired` : `${label(expired[0].kind)} and ${expired.length - 1} more expired` };
  if (soon.length) return { ...base, tone: "amber", words: `${label(soon[0].kind)} expires ${soon[0].left === 0 ? "today" : `in ${soon[0].left} day${soon[0].left === 1 ? "" : "s"}`}` };
  if (missing) return { ...base, tone: "grey", words: `${missing} document${missing === 1 ? "" : "s"} missing` };
  return { ...base, tone: "green", words: "All documents valid" };
}

/** Expiring within 60 days (not yet expired), for the "Expiring in 60 days" tile. */
export function expiresWithin(docs: HrDocBrief[], today: string, days = 60): boolean {
  return docs.some((d) => kindOf(d.kind)?.warnDays && d.expires_on && daysLeft(d.expires_on, today) >= 0 && daysLeft(d.expires_on, today) <= days);
}

/** Needs attention first: red, amber, grey, green; then by name. */
export const HR_TONE_RANK: Record<HrStatus["tone"], number> = { red: 0, amber: 1, grey: 2, green: 3 };

/** Office boys, cleaners, drivers and the like: their own group on the list. */
export function isSupportRole(roleTitle: string | null | undefined): boolean {
  return /office ?boy|cleaner|cleaning|driver|tea ?boy|messenger|support|watchman|security/i.test(roleTitle ?? "");
}

/** The roles offered to a person with no ERP login (the same list as the Team form, plus the support roles). */
export const NO_LOGIN_ROLES = ["Technician", "Team leader", "Workshop manager", "Bodyshop manager", "Service advisor", "Accounts", "Parts", "Gate-in", "QC inspector", "Office boy", "Cleaner", "Driver"];
