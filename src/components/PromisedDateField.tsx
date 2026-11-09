"use client";

import { useState } from "react";
import { Input } from "./ui";
import { partsLaterWarning } from "@/lib/promise-dates";

/**
 * THE promised-date box (9 November 2026): one date (required), the time (optional), an amber warning when the parts
 * are expected later than the date, and a reason box that appears as soon as an existing date is changed. Used by the
 * release window (both sides), the advisor's confirmation and the change on the job card. The server re-checks it all
 * (readPromise in src/lib/promise-dates.ts).
 */
export function PromisedDateField({ existing, suggested, partsDate, timeReady, existingTime, label = "Promised date (the day the customer is told)" }: {
  existing: string | null;
  suggested: string | null;
  partsDate: string | null;
  timeReady: boolean;
  existingTime?: string | null;
  label?: string;
}) {
  const start = (existing ?? suggested ?? "").slice(0, 10);
  const [date, setDate] = useState(start);
  const warn = partsLaterWarning(date, partsDate);
  const changed = !!existing && !!date && existing.slice(0, 10) !== date;
  return (
    <div className="flex flex-col gap-2" data-promised-field>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted">{label}</span>
          <Input type="date" name="promised_at" value={date} onChange={(e) => setDate(e.target.value)} required className="w-44" data-promised-date />
        </label>
        {timeReady ? (
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-muted">Time (optional)</span>
            <Input type="time" name="promised_time" defaultValue={existingTime?.slice(0, 5) ?? ""} className="w-32" data-promised-time />
          </label>
        ) : null}
      </div>
      {warn ? <p className="text-sm font-bold text-amber-text" data-promised-parts-later>{warn}</p> : null}
      {changed ? (
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted">Why does the promised date change from {existing!.slice(0, 10)}? (kept in the history)</span>
          <Input name="promise_reason" required minLength={3} data-promise-reason />
        </label>
      ) : null}
    </div>
  );
}
