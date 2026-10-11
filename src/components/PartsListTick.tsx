import { formatDateTime } from "@/lib/format";

/**
 * The workshop manager's tick directly under the parts list: "I have checked the parts list", or "I confirm no
 * parts are needed" when it is empty. Approving refuses without it; a change to the list clears it.
 */
export function PartsListTick({ action, confirmedAt, confirmedByName, count, canTick }: { action: (formData: FormData) => void | Promise<void>; confirmedAt: string | null; confirmedByName: string | null; count: number; canTick: boolean }) {
  const label = count ? "I have checked the parts list" : "I confirm no parts are needed";
  if (confirmedAt) {
    return (
      <p className="inline-flex min-h-11 items-center gap-2 self-start rounded-control border border-green bg-green-soft px-3 text-sm font-bold text-green">
        ✓ {label} · {confirmedByName ?? "the workshop manager"}, {formatDateTime(confirmedAt)}
      </p>
    );
  }
  if (!canTick) return <p className="text-xs text-muted">The workshop manager ticks the list when approving the report.</p>;
  return (
    <form action={action} className="self-start">
      <button type="submit" className="min-h-12 rounded-control border-2 border-line-strong bg-white px-4 text-sm font-bold">
        {label}
      </button>
    </form>
  );
}
