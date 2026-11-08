"use client";

import { Input } from "@/components/ui";

/**
 * THE date box of a money record (8 November 2026): the supplier payment's "Paid on", the card settlement's "In bank
 * on" and the bank report's settlement date. Never a future date (`max`), never before the money it covers (`min`),
 * and with `value` empty it says so instead of guessing today - a payout that reached the bank on the 5th must never
 * be recorded as the 7th by mistake.
 */
export function MoneyDate({ name, label, value, defaultValue, onChange, max, min, minWords, required = true, hook, className = "w-44" }: { name: string; label: string; value?: string; defaultValue?: string; onChange?: (v: string) => void; max?: string; min?: string | null; /** Why the earliest day is what it is ("the newest ticked payment"). */ minWords?: string; required?: boolean; hook?: string; className?: string }) {
  const shown = value ?? defaultValue ?? "";
  const tooEarly = !!(shown && min && shown < min);
  const future = !!(shown && max && shown > max);
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase text-muted">{label}</span>
      <Input
        name={name}
        type="date"
        {...(value !== undefined ? { value, onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange?.(e.target.value) } : { defaultValue })}
        max={max}
        min={min ?? undefined}
        required={required}
        className={`${className} ${tooEarly || future || (required && value !== undefined && !value) ? "border-red-bar" : ""}`}
        {...(hook ? { [hook]: "" } : {})}
      />
      {value !== undefined && !value && required ? <span className="text-xs font-semibold text-red" data-money-date-missing>Pick the date – no date is filled in for you</span> : null}
      {tooEarly ? <span className="text-xs font-semibold text-red" data-money-date-early>Not before {min}{minWords ? ` (${minWords})` : ""}</span> : null}
      {future ? <span className="text-xs font-semibold text-red" data-money-date-future>Cannot be in the future</span> : null}
    </label>
  );
}
