"use client";

import { useEffect, useRef, useState } from "react";
import { controlClass } from "@/components/ui";
import { parseTypedDay, showDay } from "@/lib/payment-date-rules";

/**
 * THE date box of a money record (8 November 2026; typed OR picked since 17 November 2026, Section 3): the supplier
 * payment's "Paid on", the customer payment's "Payment date", the card settlement's "In bank on", the bank report's
 * settlement date and every correction. The day can be TYPED (16/11/2026, 16-11-26, 2026-11-16) or picked from the
 * calendar button. Never a future date (`max`), never before the money it covers (`min`), and with `value` empty it says
 * so instead of guessing today. The form receives the day as YYYY-MM-DD under `name`.
 */
export function MoneyDate({ name, label, value, defaultValue, onChange, max, min, minWords, required = true, hook, className = "w-44" }: { name: string; label: string; value?: string; defaultValue?: string; onChange?: (v: string) => void; max?: string; min?: string | null; /** Why the earliest day is what it is ("the newest ticked payment"). */ minWords?: string; required?: boolean; hook?: string; className?: string }) {
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue ?? "");
  const day = controlled ? (value ?? "") : inner;
  const [text, setText] = useState(showDay(day));
  // A day set from outside (a reset, a pick) shows in the box, unless it is what is being typed.
  const [seen, setSeen] = useState(day);
  if (seen !== day) {
    setSeen(day);
    if (parseTypedDay(text) !== day) setText(showDay(day));
  }
  const picker = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLInputElement>(null);
  const set = (d: string) => {
    if (!controlled) setInner(d);
    onChange?.(d);
  };
  const typedBad = text.trim() !== "" && !parseTypedDay(text);
  const tooEarly = !!(day && min && day < min);
  const future = !!(day && max && day > max);
  // The browser stops the form on a box that is not a day, too early or in the future (the words say why below).
  useEffect(() => {
    box.current?.setCustomValidity(typedBad ? "Type the date as day/month/year" : tooEarly ? `Not before ${min}` : future ? "Cannot be in the future" : "");
  }, [typedBad, tooEarly, future, min]);
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase text-muted">{label}</span>
      <span className="relative flex items-center gap-1">
        <input
          ref={box}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="dd/mm/yyyy"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const d = parseTypedDay(e.target.value);
            if (d) set(d);
            else if (!e.target.value.trim()) set("");
          }}
          onBlur={() => {
            if (day && parseTypedDay(text) === day) setText(showDay(day));
          }}
          required={required}
          aria-label={label}
          style={{ width: "9.5rem" }}
          className={`${controlClass} ${className} ${typedBad || tooEarly || future || (required && controlled && !day) ? "border-red-bar" : ""}`}
          {...(hook ? { [hook]: "" } : {})}
        />
        <button
          type="button"
          aria-label={`${label}: open the calendar`}
          onClick={() => {
            const el = picker.current;
            if (!el) return;
            try {
              el.showPicker();
            } catch {
              el.focus();
              el.click();
            }
          }}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control border border-line-strong bg-white"
          data-money-date-calendar
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
        </button>
        <input
          ref={picker}
          type="date"
          tabIndex={-1}
          aria-hidden="true"
          className="pointer-events-none absolute h-px w-px opacity-0"
          value={day}
          max={max}
          min={min ?? undefined}
          onChange={(e) => {
            set(e.target.value);
            setText(showDay(e.target.value));
          }}
        />
        <input type="hidden" name={name} value={day} />
      </span>
      {controlled && !day && required ? <span className="text-xs font-semibold text-red" data-money-date-missing>Pick the date – no date is filled in for you</span> : null}
      {typedBad ? <span className="text-xs font-semibold text-red" data-money-date-bad>Type the date as day/month/year, e.g. 16/11/2026</span> : null}
      {tooEarly ? <span className="text-xs font-semibold text-red" data-money-date-early>Not before {showDay(min!)}{minWords ? ` (${minWords})` : ""}</span> : null}
      {future ? <span className="text-xs font-semibold text-red" data-money-date-future>Cannot be in the future</span> : null}
    </label>
  );
}
