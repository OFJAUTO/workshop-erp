/** Files of a place still on a device (pure; shared by the server pages and their components). */
export type PendingSummary = { count: number; stopped: number; devices: string[]; oldest: string | null };

/** "4 files still uploading from Mech 3" · "1 video … from Mech 3 and Mechanic 1". */
export function pendingFilesWords(s: PendingSummary | null | undefined): string | null {
  if (!s || !s.count) return null;
  const from = s.devices.length > 1 ? `${s.devices.slice(0, -1).join(", ")} and ${s.devices[s.devices.length - 1]}` : (s.devices[0] ?? "a tablet");
  const base = `${s.count} file${s.count === 1 ? "" : "s"} still uploading from ${from}`;
  return s.stopped ? `${base} (${s.stopped} could not be sent – Try again on that tablet)` : base;
}

/** Why the report cannot go to the customer yet. */
export function reportWaitsWords(s: PendingSummary | null | undefined): string | null {
  const w = pendingFilesWords(s);
  return w ? `${w}. The report can go to the customer once they have arrived.` : null;
}
