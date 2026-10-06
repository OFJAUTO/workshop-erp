const TZ = "Asia/Dubai";

export function formatDateTime(iso: string | null | undefined) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: TZ,
  }).format(new Date(iso));
}

export function formatDate(iso: string | null | undefined) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: TZ }).format(
    new Date(iso),
  );
}

/** Keeps digits and a leading plus sign only. */
export function normalisePhone(value: string) {
  const trimmed = value.trim();
  const plus = trimmed.startsWith("+") ? "+" : "";
  return plus + trimmed.replace(/[^\d]/g, "");
}

export function blankToNull(value: FormDataEntryValue | null | undefined): string | null {
  const s = typeof value === "string" ? value.trim() : "";
  return s === "" ? null : s;
}
