import { formatDayTime } from "@/lib/format";
import { daysAndHours, hoursAndMinutes, type TimeSpent } from "@/lib/time-spent";

const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * THE "Time spent on this car" panel (29 October 2026, batch 2 section 2), for the owner, advisors and accounts: every
 * clocked step with who did it, "not clocked" in amber where a step happened without a clock, the clocked total with
 * its cost and its worth at the selling rate, and how long the car has been in the workshop (waiting included).
 */
export function TimeSpentPanel({ t }: { t: TimeSpent }) {
  return (
    <section className="flex flex-col gap-2 rounded-card border border-line bg-white p-5" data-time-spent>
      <span className="text-xs font-extrabold uppercase tracking-[0.1em] text-muted">Time spent on this car</span>
      {t.rows.length ? (
        <ul className="flex flex-col divide-y divide-line text-sm">
          {t.rows.map((r, i) => (
            <li key={`${r.stage}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5" data-time-row={r.stage}>
              <span>
                <span className="font-semibold">{r.stage}</span>
                {r.who ? <span className="text-muted"> · {r.who}</span> : null}
              </span>
              {r.minutes === null ? <span className="font-bold text-amber" data-not-clocked>not clocked</span> : <span className="font-semibold tabular-nums">{hoursAndMinutes(r.minutes)}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Nothing clocked on this car yet.</p>
      )}
      <p className="text-sm" data-time-total>
        <span className="font-bold">Total clocked: {hoursAndMinutes(t.clockedMinutes)}</span>
        <span className="text-muted"> · cost {aed(t.cost)} (AED {t.costRate}/h) · worth {aed(t.worth)} at our selling rate (AED {t.sellRate}/h)</span>
      </p>
      <p className="text-sm" data-time-in-workshop>
        <span className="font-bold">Car in the workshop: {daysAndHours(t.inWorkshop.minutes)}</span>
        <span className="text-muted"> (gate-in {t.inWorkshop.from ? formatDayTime(t.inWorkshop.from) : "—"} → {t.inWorkshop.to ? `gate-out ${formatDayTime(t.inWorkshop.to)}` : "now"})</span>
      </p>
      <p className="text-xs text-muted">Clocked = someone working on the car; the rest of the time it was waiting. Advisors&apos; and Parts&apos; time is not clocked, so it is not in the total.</p>
    </section>
  );
}
